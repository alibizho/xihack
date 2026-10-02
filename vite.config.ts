import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const port = process.env.LOCAL_API_PORT || loadEnv(mode, process.cwd(), "LOCAL_").LOCAL_API_PORT || "8000";
  return {
    plugins: [react()],
    cacheDir: ".vite",
    server: { proxy: { "/api": `http://127.0.0.1:${port}` } },
  };
});
