import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleTrainingFeedback } from "./server/trainingFeedback.ts";

export default defineConfig(({ mode }) => {
  const port = process.env.LOCAL_API_PORT || loadEnv(mode, process.cwd(), "LOCAL_").LOCAL_API_PORT || "8000";
  const mimoEnv = loadEnv(mode, process.cwd(), "MIMO_");
  return {
    plugins: [react(), {
      name: "training-feedback-local-api",
      configureServer(server) {
        server.middlewares.use("/api/training-feedback", (request, response) => {
          void handleTrainingFeedback(request, response, { ...process.env, ...mimoEnv });
        });
      },
    }],
    cacheDir: ".vite",
    server: { proxy: { "^/api/(?!training-feedback(?:$|[/?]))": `http://127.0.0.1:${port}` } },
  };
});
