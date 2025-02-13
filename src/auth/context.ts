import { createContext } from "react";
import { AccessToken, AccessTokenWithUserId } from "@twurple/auth";
import DeviceFlowAuthProvider from "./auth-provider";
import { ApiClient } from "@twurple/api";

export interface DcfContextProps {
  isLoading: boolean;
  user: AccessTokenWithUserId | null;
  authProvider: DeviceFlowAuthProvider;
  error: Error | null;
  apiClient: ApiClient;
  setUser: (token: AccessToken) => void;
  storePrefix: string;
  scopes: string[];
}

const DcfContext = createContext<DcfContextProps | null>(null);

export default DcfContext;
