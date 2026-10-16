import type { AssemblyEventV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { validateAssemblyEventV1, validateSessionV1 } from "@cwa-dashboard/telemetry/validators"
import { describe, expect, it } from "vitest"

import { generateTree } from "../src/generate.ts"
import { LONG_SESSION } from "../src/long.ts"

describe("the long-content events (for performance trees, never the committed one)", () => {
  const tree = generateTree({ long: true })
  const events = [...tree]
    .filter(([path]) => /^events\/[0-9A-Z]{26}\.json$/.test(path))
    .map(([, text]) => JSON.parse(text) as AssemblyEventV1)

  it("include an assembled trace of at least 400 rows, from the real assembler", () => {
    const big = events.find((e) => {
      const t = e.trace
      return t !== undefined && t.included.length + t.excluded.length >= 400
    })
    expect(big).toBeDefined()
    expect(validateAssemblyEventV1(big) ? null : validateAssemblyEventV1.errors).toBeNull()
    expect(big!.outcome).toBe("assembled")
  })

  it("include a session of 60 turns", () => {
    const session = JSON.parse(tree.get(`sessions/${LONG_SESSION}.json`)!) as SessionV1
    expect(validateSessionV1(session) ? null : validateSessionV1.errors).toBeNull()
    expect(session.turns).toHaveLength(60)
  })

  it("are not in the committed tree", () => {
    expect(generateTree().has(`sessions/${LONG_SESSION}.json`)).toBe(false)
  })
})
