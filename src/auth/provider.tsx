import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import DcfContext from "./context";
import DcfProviderProps from "./provider-props";
import DeviceFlowAuthProvider from "./auth-provider";
import { AccessToken, AccessTokenWithUserId } from "@twurple/auth";
import LocalStorageSyncStore from "./store";
import DeviceFlowStateSchema from "./state";
import { ApiClient } from "@twurple/api";

function DcfProvider({
  children,
  clientId,
  store,
  storePrefix,
  intents,
}: PropsWithChildren<DcfProviderProps>) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AccessTokenWithUserId | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const storePrefixMemo = useMemo(
    () => `${storePrefix ?? `${clientId}-`}`,
    [storePrefix, clientId],
  );

  const authProvider = useMemo(
    () =>
      new DeviceFlowAuthProvider(
        clientId,
        store ??
          new LocalStorageSyncStore(
            DeviceFlowStateSchema,
            `${storePrefixMemo}auth`,
            {
              locks: window.navigator.locks,
            },
          ),
      ),
    [clientId, store, storePrefixMemo],
  );

  useEffect(() => {
    return () => authProvider.reset();
  }, [authProvider]);

  const apiClient = useMemo(
    () =>
      new ApiClient({
        authProvider,
      }),
    [authProvider],
  );

  useEffect(() => {
    console.log("loading authentication...");
    const controller = new AbortController();
    setUser(null);
    setError(null);
    setIsLoading(true);
    const load = async () => {
      if (controller.signal.aborted) {
        return;
      }
      try {
        const user = await authProvider.getUserAccessToken();
        if (!controller.signal.aborted) {
          console.log("user", user);
          setUser(user);
          setError(null);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          console.log("error", e);
          setUser(null);
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    const onChange = () => void load();
    authProvider.store.addListener("change", onChange);
    void load();
    return () => {
      authProvider.store.removeListener("change", onChange);
      controller.abort();
    };
  }, [authProvider, setUser, setError, setIsLoading]);

  const setUserCallback = useCallback(
    async (token: AccessToken) => {
      await authProvider.setUser(token, intents);
    },
    [authProvider, intents],
  );

  const context = useMemo(() => {
    return {
      isLoading,
      user,
      authProvider,
      error,
      apiClient,
      setUser: setUserCallback,
      storePrefix: storePrefixMemo,
    };
  }, [
    isLoading,
    user,
    authProvider,
    error,
    apiClient,
    setUserCallback,
    storePrefixMemo,
  ]);
  return <DcfContext.Provider value={context}>{children}</DcfContext.Provider>;
}

export default DcfProvider;
