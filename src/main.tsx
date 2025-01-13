import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "bootstrap/dist/css/bootstrap.min.css";
import DcfProvider from "./auth/provider.tsx";
import DcfProviderProps from "./auth/provider-props.ts";
import { z } from "zod";
import { DeviceFlowState } from "./auth/state.ts";

const queryClient = new QueryClient();

const dcfConfig: DcfProviderProps = {
  clientId: import.meta.env.VITE_CLIENT_ID ?? "",
  intents: ["chat"],
};

// legacy migration code
const userId = localStorage.getItem("userId");
if (userId !== null) {
  const credentials = localStorage.getItem(`twitch/${userId}`);
  if (credentials !== null) {
    try {
      const token = z
        .object({
          accessToken: z.string(),
          refreshToken: z.string().nullable(),
          scope: z.string().array(),
          expiresIn: z.number().nullable(),
          obtainmentTimestamp: z.number(),
        })
        .parse(JSON.parse(credentials));
      localStorage.setItem(
        `${dcfConfig.clientId}-auth`,
        JSON.stringify({
          token,
          userId,
          intents: dcfConfig.intents,
          error: null,
          lastVerified: null,
        } satisfies DeviceFlowState),
      );
    } catch (e) {
      console.error("Could not migrate tokens", e);
    }
    localStorage.removeItem(`twitch/${userId}`);
  }
  localStorage.removeItem("userId");
}
localStorage.removeItem("played");
const played2 = localStorage.getItem("played2");
if (played2 !== null) {
  localStorage.setItem(`${dcfConfig.clientId}-played`, played2);
  localStorage.removeItem("played2");
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DcfProvider {...dcfConfig}>
        <App />
      </DcfProvider>
    </QueryClientProvider>
  </StrictMode>,
);
window.addEventListener("obsExit", () => root.unmount());
