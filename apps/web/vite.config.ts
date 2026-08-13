import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      includeManifestIcons: false,
      injectRegister: "auto",
      manifest: {
        lang: "ru",
        name: "Планы",
        short_name: "Планы",
        description: "Личный план на ближайшие дни",
        display: "standalone",
        start_url: "/",
        theme_color: "#f4f2ed",
        background_color: "#f4f2ed",
        icons: [
          { src: "/icons/plan-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/plan-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/plan-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      registerType: "autoUpdate",
      strategies: "generateSW",
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{css,html,js,png}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    environment: "jsdom",
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
