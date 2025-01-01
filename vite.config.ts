import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  base: "/clips-player/v0",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => /node_modules[/]([^/]+)[/]/.exec(id)?.at(1),
      },
    },
  },
});
