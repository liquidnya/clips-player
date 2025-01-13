import { DeviceFlowState } from "./state";
import {
  AccessToken,
  accessTokenIsExpired,
  getTokenInfo,
  InvalidTokenError,
  refreshUserToken,
} from "@twurple/auth";

export interface HandlerOptions {
  clientId: string;
  forceRetryErrorId?: string;
  userId?: string;
  forceRefresh?: boolean;
  forceValidation?: boolean;
  scopeSets?: (string[] | undefined)[];
  onRefresh?: (value: DeviceFlowState) => void;
}
export type Handler = (
  value: DeviceFlowState,
  options: HandlerOptions,
  next: (
    value: DeviceFlowState,
  ) => PromiseLike<DeviceFlowState | null> | DeviceFlowState | null,
) => PromiseLike<DeviceFlowState | null> | DeviceFlowState | null;
export type IdentityHandler = (
  value: DeviceFlowState,
  options: HandlerOptions,
) => PromiseLike<DeviceFlowState | null> | DeviceFlowState | null;

export async function validateAccessToken(
  clientId: string,
  token: AccessToken,
  userId?: string,
  ..._scopeSets: (string[] | undefined)[]
): Promise<{ token: AccessToken; userId: string; changed: boolean }> {
  let changed = false;
  const tokenInfo = await getTokenInfo(token.accessToken, clientId);
  // this is a bug of the @twurple library: scopes can be null
  const scopes = tokenInfo.scopes ?? [];

  // update token information
  if (tokenInfo.userId == null) {
    throw new InvalidTokenError({
      cause: new Error("app access token can not be used"),
    });
  }
  // FIXME: validate _scopeSets
  changed ||= userId != tokenInfo.userId;
  userId = tokenInfo.userId;
  // FIXME: compare lists
  changed ||= token.scope != scopes;
  token.scope = scopes;
  let newExpiresIn;
  if (tokenInfo.expiryDate == null) {
    newExpiresIn = null;
  } else {
    newExpiresIn = tokenInfo.expiryDate.getTime() - token.obtainmentTimestamp;
  }
  changed ||= token.expiresIn != newExpiresIn;
  token.expiresIn = newExpiresIn;
  return { token, userId, changed };
}

function handleError(
  currentState: NonNullable<DeviceFlowState>,
  e: unknown,
  message: string,
  forceRefresh: boolean,
): DeviceFlowState | null {
  console.error(e);
  if (e instanceof InvalidTokenError) {
    return null;
  } else {
    let error;
    if (e instanceof Error) {
      error = new Error(`${message}: ${e.message}`);
      error.stack = e.stack;
    } else {
      error = new Error(`${message}: ${String(e)}`);
    }
    const count = (currentState.error?.count ?? 0) + 1;
    return {
      ...currentState,
      error: {
        id: crypto.randomUUID(),
        message: error.message,
        stack: error.stack,
        count,
        time: new Date().getTime(),
        forceRefresh,
      },
    };
  }
}

const refreshHandler: Handler = async (currentState, options, next) => {
  if (
    !options.forceRefresh &&
    !currentState.error?.forceRefresh &&
    !accessTokenIsExpired(currentState.token)
  ) {
    return await next(currentState);
  }
  if (currentState.token.refreshToken === null) {
    console.error("token could not be refreshed: no refresh token available");
    return null;
  }
  // refresh token
  let result;
  try {
    result = await refreshUserToken(
      options.clientId,
      undefined as unknown as string,
      currentState.token.refreshToken,
    );
  } catch (e) {
    return handleError(currentState, e, "token refresh failed", true);
  }
  const newState = {
    ...currentState,
    error: null,
    lastVerified: null,
    token: { ...result, scope: result.scope ?? [] },
  };
  options.onRefresh?.(newState);
  return await next(newState);
};
const validationHandler: Handler = async (currentState, options, next) => {
  if (
    !options.forceValidation &&
    currentState.lastVerified !== null &&
    new Date().getTime() - currentState.lastVerified < 3_600_000
  ) {
    return await next(currentState);
  }
  const lastVerified = new Date().getTime();
  let result;
  try {
    result = await validateAccessToken(
      options.clientId,
      currentState.token,
      currentState.userId,
      ...(options.scopeSets ?? []),
    );
  } catch (e) {
    return handleError(currentState, e, "token validation failed", false);
  }
  if (result.changed) {
    return await next({
      ...currentState,
      error: null,
      lastVerified,
      token: result.token,
      userId: result.userId,
    });
  } else {
    return await next(currentState);
  }
};
const forceRetryHandler: Handler = async (currentState, options, next) => {
  if (options.forceRetryErrorId !== undefined) {
    if (
      currentState?.error === null ||
      options.forceRetryErrorId !== currentState.error.id
    ) {
      throw new Error(
        "force retry failed: token might have been refreshed by other tab",
      );
    }
  }
  return await next(currentState);
};
const checkState: Handler = async (currentState, options, next) => {
  if (options.userId !== undefined && currentState?.userId !== options.userId) {
    throw new Error("user id does not match");
  }
  return await next(currentState);
};
const tokenChain: IdentityHandler = [
  forceRetryHandler,
  checkState,
  refreshHandler,
  checkState,
  validationHandler,
  checkState,
].reduceRight<IdentityHandler>(
  (accumulator, handler) => async (currentState, options) => {
    const next = async (nextState: DeviceFlowState) => {
      return await accumulator(nextState, options);
    };
    return await handler(currentState, options, next);
  },
  (value) => value,
);

export default tokenChain;
