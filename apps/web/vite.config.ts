import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { securityHeaders } from "./src/lib/security-headers";

export default defineConfig(({ command }) => ({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    varlockVitePlugin({ ssrInjectMode: "resolved-env" }),
    tailwindcss(),
    tanstackStart(),
    // Security headers on every response — the policy itself lives in
    // src/lib/security-headers and is pinned by tests. Nitro installs these
    // route rules; a top-level Vite `routeRules` key is ignored.
    nitro({ routeRules: { "/**": { headers: securityHeaders } } }),
    viteReact(),
  ],
  // The build artifact is standalone, but dev's module runner can't evaluate React's inlined CJS entry.
  ssr: command === "serve" ? { external: ["react", "react-dom"] } : { noExternal: true },
}));
