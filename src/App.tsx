import { useContext, useEffect, useLayoutEffect, useState } from "react";
import "./App.css";
import { Context } from "./main";
import { AccessToken } from "@twurple/auth";
import {
  DeviceAuthorizationResponse,
  deviceCodeGrantFlow,
  OAuthError,
  ResponseError,
  TwitchError,
} from "./device-code-grant-flow";
import QRCode from "react-qr-code";
import { useQuery } from "@tanstack/react-query";
import { HelixClip } from "@twurple/api";
import { Alert, Card, Spinner } from "react-bootstrap";

const href = new URL(window.location.href);
const or = (value: number, defaultValue: number) => {
  if (isNaN(value)) {
    return defaultValue;
  }
  return value;
};
const featured =
  /true|1|yes|y|on/i.exec(href.searchParams.get("featured") ?? "true") != null;
const limit = Math.max(
  1,
  or(parseInt(href.searchParams.get("limit") ?? ""), 100),
);
const errorWaitMs = Math.max(
  0,
  or(parseInt(href.searchParams.get("errorWaitMs") ?? ""), 5000),
);
const loadWaitMs = or(
  parseInt(href.searchParams.get("loadWaitMs") ?? ""),
  1000,
);

console.log({
  featured,
  limit,
  errorWaitMs,
  loadWaitMs,
});

function useApiClient() {
  const apiClient = useContext(Context);
  const [userId, setUserId] = useState(() => apiClient.userId);
  const setUser = async (token: AccessToken, userId?: string) => {
    await apiClient.setUser(token, userId).then((userId) => setUserId(userId));
  };
  return {
    userId,
    setUser,
    apiClient: apiClient.apiClient,
    authProvider: apiClient.authProvider,
  };
}

function useObs() {
  const [status, setStatus] = useState<OBSStatus | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const events: Record<string, (value: OBSStatus) => OBSStatus> = {
      obsRecordingPaused: (status) => {
        return { ...status, recordingPaused: true };
      },
      obsRecordingStarted: (status) => {
        return { ...status, recording: true };
      },
      obsRecordingStarting: (status) => {
        return { ...status, recording: true };
      },
      obsRecordingStopped: (status) => {
        return { ...status, recording: false };
      },
      obsRecordingStopping: (status) => {
        return { ...status, recording: false };
      },
      obsRecordingUnpaused: (status) => {
        return { ...status, recordingPaused: false };
      },
      obsStreamingStarted: (status) => {
        return { ...status, streaming: true };
      },
      obsStreamingStarting: (status) => {
        return { ...status, streaming: true };
      },
      obsStreamingStopped: (status) => {
        return { ...status, streaming: false };
      },
      obsStreamingStopping: (status) => {
        return { ...status, streaming: false };
      },
    };
    const queryStatus = (e?: Event) => {
      if (signal.aborted) {
        return;
      }
      const type = e?.type;
      if (type !== undefined && type in events) {
        setStatus((value) => {
          if (value === undefined) {
            return undefined;
          } else {
            return events[type](value);
          }
        });
      }
      window?.obsstudio?.getStatus((status) => {
        if (signal.aborted) {
          return;
        }
        setStatus(status);
      });
    };
    Object.keys(events).forEach((event) =>
      window.addEventListener(event, queryStatus),
    );
    queryStatus();
    return () => {
      controller.abort();
      Object.keys(events).forEach((event) =>
        window.removeEventListener(event, queryStatus),
      );
    };
  });

  return status;
}

type State =
  | {
      type: "loading";
    }
  | {
      type: "timeout";
    }
  | {
      type: "authenticated";
    }
  | ({
      type: "deviceCode";
    } & DeviceAuthorizationResponse)
  | {
      type: "responseError";
      e: ResponseError;
    }
  | {
      type: "error";
      e: unknown;
    };

function VideoPlayer({
  clip,
  setRunning,
}: {
  clip: HelixClip;
  setRunning: (value: boolean) => void;
}) {
  const url = new URL(clip.embedUrl);
  url.searchParams.append("parent", window.location.hostname);
  url.searchParams.append("autoplay", "true");
  url.searchParams.append("muted", "false");
  useLayoutEffect(() => {
    console.log("register event");
    const onMessage = (e: MessageEvent) => {
      console.log("received message");
      console.log(e);
    };
    window.addEventListener("message", onMessage);
    return () => {
      return window.removeEventListener("message", onMessage);
    };
  }, []);
  return (
    <>
      <iframe
        onLoad={() => {
          console.log("iframe loaded");
          setTimeout(
            () => {
              setRunning(false);
            },
            Math.max(0, clip.duration * 1000 + loadWaitMs),
          );
        }}
        onError={() => {
          console.log("iframe error");
          setTimeout(() => {
            setRunning(false);
          }, errorWaitMs);
        }}
        src={url.toString()}
        height="100%"
        width="100%"
        allowFullScreen={true}
      />

      <div className="overlay overlay-top">{clip.title}</div>
      <div className="overlay overlay-bottom">
        clipped by {clip.creatorDisplayName}
      </div>
    </>
  );
}

function Login({
  userId,
  setUser,
}: Pick<ReturnType<typeof useApiClient>, "userId" | "setUser">) {
  const [state, setState] = useState<State>({ type: "loading" });

  useEffect(() => {
    if (userId !== null) {
      setState({ type: "authenticated" });
      return;
    }
    const controller = new AbortController();
    setState({ type: "loading" });
    setTimeout(() => {
      if (controller.signal.aborted) {
        return;
      }
      const subscription = deviceCodeGrantFlow({
        clientId: import.meta.env.VITE_CLIENT_ID ?? "",
        twitch: true,
        scopes: [],
      }).subscribe({
        next: (item) => {
          if ("deviceCode" in item) {
            setState({
              type: "deviceCode",
              ...item,
            });
          } else if ("accessToken" in item) {
            setState({
              type: "authenticated",
            });
            void setUser({
              accessToken: item.accessToken,
              expiresIn: item.expiresIn ?? null,
              obtainmentTimestamp: item.obtainmentTimestamp,
              refreshToken: item.refreshToken,
              scope: item.scopes,
            });
          }
        },
        error: (e) => {
          console.error(e);
          const responseError = ResponseError.from(e);
          if (responseError != null) {
            setState({
              type: "responseError",
              e: responseError,
            });
          } else {
            setState({
              type: "error",
              e,
            });
          }
        },
        complete: () => {
          setState((value) => {
            if (value.type === "authenticated") {
              // ignore complete in this case
              return value;
            }
            return { type: "timeout" };
          });
        },
      });
      controller.signal.addEventListener("abort", () => {
        subscription.unsubscribe();
      });
    }, 1000);
    return () => {
      controller.abort();
    };
  }, [userId, setUser]);

  if (
    state.type === "loading" ||
    userId !== null ||
    state.type === "authenticated"
  ) {
    return (
      <Spinner animation="border" role="status">
        <span className="visually-hidden">Loading...</span>
      </Spinner>
    );
  }

  if (state.type === "deviceCode") {
    const url = new URL(state.verificationUri);
    url.searchParams.delete("device-code");
    return (
      <>
        <QRCode value={state.verificationUriComplete} />
        <br />
        Go to{" "}
        <a
          className="text-reset text-decoration-none"
          href={state.verificationUriComplete}
        >
          {url.toString()}
        </a>{" "}
        and enter code <b>{state.userCode}</b>.
      </>
    );
  }

  if (state.type === "responseError") {
    const twitchError = state.e.twitchError;
    if (twitchError != null) {
      switch (twitchError) {
        case TwitchError.InvalidDeviceCode:
          return <Alert variant={"danger"}>Invalid Device Code</Alert>;
        case TwitchError.InvalidRefreshToken:
          return <Alert variant={"danger"}>Invalid Refresh Token</Alert>;
      }
    }
    const oAuthError = state.e.oAuthError;
    const errors: Record<OAuthError, string> = {
      access_denied: "Access Denied",
      authorization_pending: "Authorization Pending",
      expired_token: "Expired Token",
      invalid_client: "Invalid Client",
      invalid_grant: "Invalid Grant",
      invalid_request: "Invalid Request",
      invalid_scope: "Invalid Scope",
      slow_down: "Slow Down",
      unauthorized_client: "Unauthorized Client",
      unsupported_grant_type: "Unsupported Grant Type",
    };
    if (oAuthError != null) {
      return <Alert variant={"danger"}>{errors[oAuthError]}</Alert>;
    }
  }

  if (state.type === "error" || state.type === "responseError") {
    return (
      <Alert variant={"danger"}>
        Unknown authentication error: Please refresh browser source and try
        again
      </Alert>
    );
  }

  return (
    <Alert variant={"danger"}>
      Authentication timed out: Please refresh browser source and try again
    </Alert>
  );
}

let id = 0;

function App() {
  const { userId, setUser, apiClient } = useApiClient();
  //const [messages, setMessages] = useState<React.ReactNode[]>([]);
  const [video, setVideo] = useState<{ clip: HelixClip; key: string }>();
  const [running, setRunning] = useState(false);

  const { data: clips } = useQuery({
    initialData: [],
    queryKey: ["clips", userId],
    queryFn: async ({ signal }) => {
      if (userId === null) {
        return [];
      }
      return await apiClient.asIntent(["chat"], async (client) => {
        console.log("meow!");
        if (signal.aborted) {
          return [];
        }
        const result: HelixClip[] = [];
        const paginator = client.clips.getClipsForBroadcasterPaginated(userId, {
          isFeatured: featured,
        });
        const clips = await paginator.getNext();
        if (signal.aborted) {
          return [];
        }
        console.log(clips);
        clips.forEach((value) => result.push(value));
        let i = 0;
        while (
          result.length < limit &&
          clips.length > 0 &&
          paginator.currentCursor !== undefined &&
          ++i < limit
        ) {
          const clips = await paginator.getNext();
          if (signal.aborted) {
            return [];
          }
          console.log(clips);
          clips.forEach((value) => result.push(value));
        }
        if (result.length > limit) {
          return result.splice(0, limit);
        }
        return result;
      });
    },
  });

  useEffect(() => {
    if (Array.isArray(clips) && clips.length > 0 && !running) {
      const controller = new AbortController();
      setRunning(true);
      const played = localStorage.getItem("played2");
      const availableClipIds = new Set();
      clips.forEach((clip) => availableClipIds.add(clip.id));
      let map: [string, number][];
      if (played != null) {
        map = (JSON.parse(played) as [string, number][]).filter(([key]) =>
          availableClipIds.has(key),
        );
      } else {
        map = [];
      }
      // map only contains available clips now
      const wanted = Math.max(Math.floor(clips.length / 2), 1);
      if (map.length > wanted) {
        map = map.slice(wanted);
      }
      // now remove all available clip ids
      map.forEach(([key]) => availableClipIds.delete(key));
      // remove all clips
      let newClips = clips.filter((clip) => availableClipIds.has(clip.id));
      if (newClips.length <= 0) {
        newClips = clips;
        map = [];
      }

      const random = Math.floor(Math.random() * newClips.length);
      const clip = newClips[random];
      map.push([clip.id, new Date().getTime()]);

      localStorage.setItem("played2", JSON.stringify(map));

      const key = `${id++}`;
      setVideo({ clip, key });
      return () => {
        controller.abort();
      };
    }
  }, [clips, running]);
  const status = useObs();

  if (userId === null) {
    if (status?.streaming || status?.recording) {
      // safety
      return null;
    }
    return (
      <div className="container card-container">
        <Card className="w-100">
          <Card.Body className="text-center">
            <Login userId={userId} setUser={setUser} />
          </Card.Body>
        </Card>
      </div>
    );
  }

  if (video !== undefined) {
    return (
      <VideoPlayer key={video.key} clip={video.clip} setRunning={setRunning} />
    );
  }

  return <></>;
}

export default App;
