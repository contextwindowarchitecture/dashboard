import { defineConfig, mergeConfig } from "vitest/config"

import viteConfig from "./vite.config.ts"

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        environment: "jsdom",
        globals: false,
        setupFiles: ["./src/test/setup.ts"],
        include: ["src/**/*.test.{ts,tsx}", "dev/**/*.test.ts", "scripts/**/*.test.ts"],
        css: false,
        // Above the setup's ten-second wait, so a slow wait fails as itself, not as a timeout.
        testTimeout: 30_000,
      },
    }),
  ),
)
