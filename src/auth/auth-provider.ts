import {
  AccessToken,
  AccessTokenWithUserId,
  AuthProvider,
} from "@twurple/auth";
import { DeviceFlowState } from "./state";
import { SyncStore } from "./store";
import { extractUserId, UserIdResolvable } from "@twurple/api";
import tokenChain, { validateAccessToken } from "./tokenChain";
import LockController from "./lock-controller";

function toError(error: NonNullable<DeviceFlowState["error"]>): Error {
  const cause = new Error(error.message);
  cause.stack = error.stack;
  return new Error("could not get access token: " + error.message, { cause });
}

class DeviceFlowAuthProvider implements AuthProvider {
  private currentScopes: { userId: string; scopes: string[] } | null = null;
  private errorTimer: number | null = null;
  private controller: LockController = new LockController();
  private forceValidation = true;
  constructor(
    readonly clientId: string,
    readonly store: SyncStore<DeviceFlowState>,
  ) {}
  reset() {
    this.controller.close();
    this.controller = new LockController();
  }
  getCurrentScopesForUser(user: UserIdResolvable): string[] {
    if (
      this.currentScopes !== null &&
      this.currentScopes.userId === extractUserId(user)
    ) {
      return this.currentScopes.scopes;
    }
    return [];
  }
  async getAccessTokenForUser(
    user: UserIdResolvable,
    ...scopeSets: (string[] | undefined)[]
  ): Promise<AccessTokenWithUserId | null> {
    try {
      return await this.getAccessToken({
        userId: extractUserId(user),
        scopeSets,
      });
    } catch (e) {
      // FIXME: use custom type instead
      if (e instanceof Error && e.message === "user id does not match") {
        return null;
      }
      throw e;
    }
  }
  async getAccessTokenForIntent(
    _intent: string,
    ...scopeSets: (string[] | undefined)[]
  ): Promise<AccessTokenWithUserId | null> {
    return await this.getAccessToken({
      scopeSets,
    });
  }
  async getAnyAccessToken(): Promise<AccessTokenWithUserId> {
    return await this.getAccessToken({
      forceToken: true,
    });
  }
  async getUserAccessToken(): Promise<AccessTokenWithUserId | null> {
    return await this.getAccessToken({});
  }
  async refreshAccessTokenForUser(
    user: UserIdResolvable,
  ): Promise<AccessTokenWithUserId> {
    return await this.getAccessToken({
      forceRefresh: true,
      forceToken: true,
      userId: extractUserId(user),
    });
  }
  async refreshAccessTokenForIntent(
    _intent: string,
  ): Promise<AccessTokenWithUserId> {
    return await this.getAccessToken({
      forceRefresh: true,
      forceToken: true,
    });
  }
  private updateTimer(state: DeviceFlowState | null) {
    if (state?.error !== null) {
      if (this.errorTimer === null) {
        const forceRetryErrorId = state?.error.id;
        const timeout = Math.min(
          600_000,
          Math.pow(1000, state?.error?.count ?? 1),
        );
        this.errorTimer = setTimeout(() => {
          this.errorTimer = null;
          // ignore errors
          void this.getAccessToken({
            forceRefresh: false,
            forceRetryErrorId,
            forceToken: false,
            scopeSets: [],
          })
            .then(() => console.log("retry refreshing token succeeded"))
            .catch((e) => console.log("retry refreshing token failed", e));
        }, timeout);
      }
    } else if (this.errorTimer !== null) {
      clearTimeout(this.errorTimer ?? undefined);
      this.errorTimer = null;
    }
  }
  private updateCurrentScopes(state: DeviceFlowState | null) {
    if (state === null) {
      this.currentScopes = null;
    } else {
      this.currentScopes = {
        userId: state.userId,
        scopes: state.token.scope,
      };
    }
  }
  private async getAccessToken(options: {
    forceToken?: false;
    forceRefresh?: boolean;
    forceRetryErrorId?: string;
    forceRetry?: boolean;
    scopeSets?: (string[] | undefined)[];
    userId?: string;
  }): Promise<AccessTokenWithUserId | null>;
  private async getAccessToken(options: {
    forceToken: true;
    forceRefresh?: boolean;
    forceRetryErrorId?: string;
    forceRetry?: boolean;
    scopeSets?: (string[] | undefined)[];
    userId?: string;
  }): Promise<AccessTokenWithUserId>;
  private async getAccessToken(options: {
    forceRefresh?: boolean;
    forceToken?: boolean;
    forceRetryErrorId?: string;
    scopeSets?: (string[] | undefined)[];
    userId?: string;
  }): Promise<AccessTokenWithUserId | null> {
    const token = await this.store.lock(async (ref) => {
      let currentState = ref.get();
      if (currentState === null) {
        return null;
      }
      const updateState = (newState: DeviceFlowState | null) => {
        if (newState !== currentState) {
          ref.set(newState);
        }
        currentState = newState;
      };
      const newState = await tokenChain(currentState, {
        clientId: this.clientId,
        forceRefresh: options.forceRefresh,
        forceRetryErrorId: options.forceRetryErrorId,
        scopeSets: options.scopeSets,
        userId: options.userId,
        forceValidation: this.forceValidation,
        // only on refresh: immediatly set the value to the store
        onRefresh: updateState,
      });
      updateState(newState);
      this.forceValidation = false;
      this.updateTimer(newState);
      this.updateCurrentScopes(newState);
      // convert DeviceFlowState | null to AccessTokenWithUserId | null
      if (newState === null) {
        return null;
      }
      if (newState.error !== null) {
        throw toError(newState.error);
      }
      return { ...newState.token, userId: newState.userId };
    }, this.controller);
    if (options.forceToken && token === null) {
      throw new Error("no token available");
    }
    return token;
  }
  async setUser(token: AccessToken, intents: string[]): Promise<void> {
    const lastVerified = new Date().getTime();
    // validation can happen outside of lock,
    // because the user has not been added yet
    const result = await validateAccessToken(this.clientId, token);
    return await this.store.lock(
      (ref) => {
        const newState: DeviceFlowState = {
          error: null,
          intents,
          lastVerified,
          token: result.token,
          userId: result.userId,
        };
        ref.set(newState);
        // the token was just validated
        this.forceValidation = false;
        this.updateTimer(newState);
        this.updateCurrentScopes(newState);
      },
      // not passing a lock controller here on purpose
      // lets just always allow setting the user even if the application is shutting down
      undefined,
    );
  }
}

export default DeviceFlowAuthProvider;
