import { Duration, Instant } from "@js-joda/core";
import { Observable } from "rxjs";
import { z, ZodType } from "zod";

/// https://datatracker.ietf.org/doc/html/rfc6749#section-5.2
/// https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
export enum OAuthError {
  InvalidRequest = "invalid_request",
  InvalidClient = "invalid_client",
  InvalidGrant = "invalid_grant",
  UnauthorizedClient = "unauthorized_client",
  UnsupportedGrantType = "unsupported_grant_type",
  InvalidScope = "invalid_scope",

  AuthorizationPending = "authorization_pending",
  SlowDown = "slow_down",
  AccessDenied = "access_denied",
  ExpiredToken = "expired_token",
}

/// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
export enum TwitchError {
  InvalidDeviceCode = "invalid device code",
  InvalidRefreshToken = "Invalid refresh token",
}

/// https://datatracker.ietf.org/doc/html/rfc6749#section-5.2
/// https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
/// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
/// twitch specific: `invalid device code`, `Invalid refresh token`
const ErrorResponse = z
  .object({
    error: z.string(),
    /// note that this should not be shown to end users
    error_description: z.string().optional(),
    /// note that this should not be shown to end users
    error_uri: z.string().optional(),
  })
  .transform((value) => ({
    error: value.error satisfies OAuthError | string,
    twitchStatus: undefined,
    errorDescription: value.error_description,
    errorUri: value.error_uri,
  }))
  .or(
    /// twitch specific
    z
      .object({
        status: z.number().int().optional(),
        message: z.string(),
      })
      .transform((value) => ({
        error: value.message satisfies OAuthError | TwitchError | string,
        twitchStatus: value.status,
        errorDescription: undefined,
        errorUri: undefined,
      })),
  );

export type ErrorResponse = z.output<typeof ErrorResponse>;

/// https://datatracker.ietf.org/doc/html/rfc8628#section-3.2
/// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
const DeviceAuthorizationResponse = z
  .object({
    device_code: z.string(),
    user_code: z.string(),
    /// note that RFC 8628 says that this is a URI
    /// hoever we are only going to allow URLs here
    verification_uri: z.string().url(),
    verification_uri_complete: z.string().optional(),
    expires_in: z.number().int().nonnegative(),
    /// the default is 5 seconds
    interval: z.number().int().nonnegative().default(5),
  })
  .transform((value) => ({
    ...value,
    /// setting the `verification_uri_complete` to `verification_uri` if it is missing
    /// we are going to use `verification_uri` to display the URI, but `verification_uri_complete` for the QR code or a link
    verification_uri_complete:
      value.verification_uri_complete ?? value.verification_uri,
  }))
  .transform((value) => ({
    deviceCode: value.device_code,
    userCode: value.user_code,
    verificationUri: value.verification_uri,
    verificationUriComplete: value.verification_uri_complete,
    expiresIn: value.expires_in,
    interval: value.interval,
  }));

export type DeviceAuthorizationResponse = z.output<
  typeof DeviceAuthorizationResponse
>;

/// https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
/// https://datatracker.ietf.org/doc/html/rfc6749#section-5.1
/// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
const DeviceAccessTokenResponse = z
  .object({
    access_token: z.string(),
    /// case insensitive
    token_type: z.string(),
    expires_in: z.number().nonnegative().optional(),
    refresh_token: z.string(),
    scope: z
      .string()
      .or(
        /// twitch specific
        z.array(z.string()).transform((value) => value.join(" ")),
      )
      .optional(),
  })
  .transform((value) => ({
    accessToken: value.access_token,
    tokenType: value.token_type,
    expiresIn: value.expires_in,
    refreshToken: value.refresh_token,
    scope: value.scope,
    scopes: value.scope?.split(" ") ?? [],
    isBearer() {
      return value.token_type.toLowerCase() === "bearer";
    },
    obtainmentTimestamp: Date.now(),
  }));

export type DeviceAccessTokenResponse = z.output<
  typeof DeviceAccessTokenResponse
>;

/// https://datatracker.ietf.org/doc/html/rfc8628#section-3.1
/// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
/// note that twitch requires scopes and not scope
export async function deviceAuthorizationRequest(
  params: {
    location: string;
    clientId: string;
    scopes: string[];
    twitch?: boolean | undefined;
  } & { signal?: AbortSignal | undefined },
) {
  try {
    const body = new URLSearchParams();
    body.append("client_id", params.clientId);
    // twitch specific parameter name
    body.append(
      params.twitch === true ? "scopes" : "scope",
      params.scopes.join(" "),
    );

    const response = await fetch(params.location, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: params.signal,
    });

    return await handleResponse(response, DeviceAuthorizationResponse);
  } catch (e) {
    throw new Error("could not request device code", { cause: e });
  }
}

/// https://datatracker.ietf.org/doc/html/rfc8628#section-3.4
/// https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
/// note that twitch requires scopes to be passed to the token request, however RFC 8628 does not mention scope or scopes for this request
export async function deviceAccessTokenRequest(
  params: {
    location: string;
    clientId: string;
    deviceCode: string;
  } & ({ scopes: string[]; twitch: true } | { twitch?: false | undefined }) & {
      signal?: AbortSignal | undefined;
    },
) {
  try {
    const body = new URLSearchParams();
    body.append("client_id", params.clientId);
    if (params.twitch === true) {
      // twitch specific parameter
      body.append("scopes", params.scopes.join(" "));
    }
    body.append("device_code", params.deviceCode);
    body.append("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

    const response = await fetch(params.location, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: params.signal,
    });

    return await handleResponse(response, DeviceAccessTokenResponse);
  } catch (e) {
    throw new Error("could not obtain tokens", { cause: e });
  }
}

async function handleResponse<T extends ZodType<unknown>>(
  response: Response,
  schema: T,
): Promise<z.output<T>> {
  const contentType = response.headers.get("content-type");
  // allow `application/json; charset=utf-8`
  const isJson = contentType?.split(";")?.at(0)?.trim() === "application/json";

  if (response.status == 200) {
    if (!isJson) {
      throw new Error(
        `unexpected content-type ${contentType} (status ${response.status})`,
      );
    }
    return schema.parse(await response.json());
  }

  if (response.status == 400) {
    if (!isJson) {
      throw new Error(
        `unexpected content-type ${contentType} (status ${response.status})`,
      );
    }
    throw new ResponseError(ErrorResponse.parse(await response.json()));
  }

  throw new Error(`status ${response.status}`);
}

const notFound: unique symbol = Symbol();
type NotFound = typeof notFound;

function findError<T>(
  extract: (e: unknown) => T | NotFound,
  e: unknown,
  errors?: Set<unknown>,
): T | NotFound {
  if (errors === undefined) {
    errors = new Set();
  }
  if (errors.has(e)) {
    // prevent endless loop
    return notFound;
  }
  errors.add(e);
  const result = extract(e);
  if (result !== notFound) {
    return result;
  }
  if (e instanceof AggregateError) {
    for (const aggregateError of e.errors) {
      const aggregateResult = findError<T>(extract, aggregateError, errors);
      if (aggregateResult !== notFound) {
        return aggregateResult;
      }
    }
    // fallthrough
  }
  if (e instanceof Error) {
    return findError<T>(extract, e.cause, errors);
  }
  return notFound;
}

function extractError<T>(
  extract: (e: unknown) => T | NotFound,
  fallback: T,
  e: unknown,
) {
  const result = findError(extract, e, new Set());
  if (result !== notFound) {
    return result;
  }
  return fallback;
}

export class ResponseError extends Error {
  constructor(public response: z.output<typeof ErrorResponse>) {
    super(response.error);
    Object.setPrototypeOf(this, ResponseError.prototype);
  }

  get oAuthError(): OAuthError | null {
    const error = this.response.error;
    if ((Object.values(OAuthError) as string[]).includes(error)) {
      return error as OAuthError;
    }
    return null;
  }

  get twitchError(): TwitchError | null {
    const error = this.response.error;
    if ((Object.values(TwitchError) as string[]).includes(error)) {
      return error as TwitchError;
    }
    return null;
  }

  static from(e: unknown): ResponseError | null {
    return extractError(
      (e) => {
        if (e instanceof ResponseError) {
          return e;
        }
        return notFound;
      },
      null,
      e,
    );
  }
}

function isConnectionTimeout(e: unknown): boolean {
  return extractError(
    (e) => {
      return (
        (e !== null &&
          typeof e === "object" &&
          "code" in e &&
          e.code === "ETIMEDOUT" &&
          "syscall" in e &&
          e.syscall === "connect") ||
        notFound
      );
    },
    false,
    e,
  );
}

function canRetry(
  e: unknown,
  setInterval: (modify: (interval: number) => number) => void,
): boolean {
  if (isConnectionTimeout(e)) {
    // it is recommended to double the interval on connection timeout (exponential backoff)
    // see https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
    setInterval((interval: number) => (interval *= 2));
    // retry request after interval
    return true;
  }
  const responseError = ResponseError.from(e);
  const oAuthError = responseError?.oAuthError;
  if (oAuthError === OAuthError.AuthorizationPending) {
    // retry request after interval
    return true;
  } else if (oAuthError === OAuthError.SlowDown) {
    // interval needs to be increased by 5 seconds
    // see https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
    setInterval((interval: number) => (interval += 5));
    // retry request after interval
    return true;
  }
  return false;
}

export type Message = Awaited<
  ReturnType<
    typeof deviceAccessTokenRequest | typeof deviceAuthorizationRequest
  >
>;

export function deviceCodeGrantFlow(
  params:
    | {
        locations: {
          tokenEndpoint: string;
          deviceAuthorizationEndpoint: string;
        };
        clientId: string;
        scopes: string[];
        twitch?: false | undefined;
      }
    | {
        clientId: string;
        scopes: string[];
        twitch: true;
      },
): Observable<Message> {
  const locations = params.twitch
    ? {
        tokenEndpoint: "https://id.twitch.tv/oauth2/token",
        deviceAuthorizationEndpoint: "https://id.twitch.tv/oauth2/device",
      }
    : params.locations;
  return new Observable((subscriber) => {
    const controller = new AbortController();
    const signal = controller.signal;

    const timeout = (seconds: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("aborted"));
        }
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
        setTimeout(() => {
          resolve();
        }, seconds * 1000);
      });
    };

    const flow = async () => {
      const response = await deviceAuthorizationRequest({
        location: locations.deviceAuthorizationEndpoint,
        clientId: params.clientId,
        scopes: params.scopes,
        twitch: params.twitch,
        signal,
      });
      let interval = response.interval;
      const setInterval = (modify: (interval: number) => number) =>
        (interval = modify(interval));

      const startTime = Instant.now();
      const expiresIn = Duration.ofSeconds(response.expiresIn);
      const expired = () => {
        const durationSince = Duration.between(startTime, Instant.now());
        const durationAfterTimeout = durationSince.plusSeconds(interval);
        return durationAfterTimeout.compareTo(expiresIn) >= 0;
      };

      subscriber.next(response);
      while (!expired()) {
        await timeout(interval);
        try {
          return await deviceAccessTokenRequest({
            location: locations.tokenEndpoint,
            clientId: params.clientId,
            deviceCode: response.deviceCode,
            scopes: params.scopes,
            twitch: params.twitch,
            signal,
          });
        } catch (e) {
          if (!canRetry(e, setInterval)) {
            throw e;
          }
        }
      }
      throw new Error("expired");
    };

    flow()
      .then((value: Awaited<ReturnType<typeof deviceAccessTokenRequest>>) => {
        subscriber.next(value);
        subscriber.complete();
      })
      .catch((e) => subscriber.error(e));
    return () => {
      // teardown
      controller.abort(new Error("unsubscribed"));
    };
  });
}
