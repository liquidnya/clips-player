import { DeviceFlowState } from "./state";
import { SyncStore } from "./store";

interface DcfProviderProps {
  clientId: string;
  scopes?: string[];
  store?: SyncStore<DeviceFlowState>;
  storePrefix?: string;
  intents: string[];
}

export default DcfProviderProps;
