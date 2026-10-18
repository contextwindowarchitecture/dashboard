// The ingest service's tests. Most open a store in PGlite, PostgreSQL in WebAssembly, which starts in
// about a second on a developer's machine and in five or more on a shared CI runner while the other
// packages' suites run beside it; Vitest's five-second default failed nine of them there. The limits
// leave room for that start: they bound a hung test, not a slow machine.

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
