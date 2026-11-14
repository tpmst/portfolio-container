import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 30074,
    proxy: {
      "/api": "http://localhost:30073",
      "/images": "http://localhost:30073",
      "/uploads": "http://localhost:30073",
      "/icons": "http://localhost:30073",
      "/skill-icons": "http://localhost:30073",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
