import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 30074,
    proxy: {
      "/api": "http://localhost:30073",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
