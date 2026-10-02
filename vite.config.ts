import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleTrainingFeedback } from "./server/trainingFeedback.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MIMO_");
  const backendEnv = loadEnv(mode, process.cwd(), "BACKEND_");
  return {
    plugins: [react(), {
      name: "training-feedback-local-api",
      configureServer(server) {
        server.middlewares.use("/api/training-feedback", (request, response) => {
          void handleTrainingFeedback(request, response, { ...process.env, ...env });
        });
      },
    }],
    server: { proxy: { "^/api/(?!training-feedback(?:$|[/?]))": { target: backendEnv.BACKEND_URL || "http://127.0.0.1:8000", changeOrigin: true } } },
    cacheDir: ".vite",
  };
});
