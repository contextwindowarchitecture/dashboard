import { defineConfig } from "vitest/config"

// Only this package's tests: the built assembler under .build/ carries its own.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
})
