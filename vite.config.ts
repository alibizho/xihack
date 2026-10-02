import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: ".vite",
  server: { proxy: { "/api": `http://127.0.0.1:${process.env.LOCAL_API_PORT || "8000"}` } },
});
