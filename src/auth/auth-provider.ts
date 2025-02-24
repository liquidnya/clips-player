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
  private error: { timer: number; id: string } | null = null;
  private controller: LockController = new LockController();
  private startup = true;
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
    const error = state?.error ?? null;
    if (error !== null) {
      if (this.error === null || this.error.id !== error.id) {
        clearTimeout(this.error?.timer ?? undefined);
        const forceRetryErrorId = error.id;
        const refreshTime =
          error.time +
          Math.min(
            600_000,
            Math.ceil(1000 * Math.pow(2, (error.count ?? 1) - 1)),
          );
        const timeout = Math.max(0, refreshTime - new Date().getTime());
        const timer = setTimeout(() => {
          this.error = null;
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
        this.error = { timer, id: forceRetryErrorId };
      }
    } else if (this.error !== null) {
      clearTimeout(this.error.timer);
      this.error = null;
    }
  }
  private onStateChange(state: DeviceFlowState | null) {
    this.updateTimer(state);
    this.updateCurrentScopes(state);
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
      const startup = this.startup;
      // startup has to be set to false, before updateState is called
      // otherwise this can cause an endless loop
      this.startup = false;
      const newState = await tokenChain(currentState, {
        clientId: this.clientId,
        forceRefresh: options.forceRefresh,
        // always retry the error on startup
        forceRetryErrorId: startup
          ? currentState.error?.id
          : options.forceRetryErrorId,
        scopeSets: options.scopeSets,
        userId: options.userId,
        forceValidation: startup,
        // only on refresh: immediatly set the value to the store
        onRefresh: updateState,
      });
      updateState(newState);
      this.onStateChange(newState);
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
        this.startup = false;
        this.onStateChange(newState);
      },
      // not passing a lock controller here on purpose
      // lets just always allow setting the user even if the application is shutting down
      undefined,
    );
  }
}

export default DeviceFlowAuthProvider;
