import { CONTRACT_SOURCE } from "@cwa-dashboard/contract/data"
import { describe, expect, it } from "vitest"

import { ABOUT } from "./about"
import { TELEMETRY } from "./telemetry"

// Words written by hand about the contract are re-read whenever its pin moves: each content module
// names the commit it was written against, and this fails until someone checks the words and
// updates it (dashboard-plan.md, DP-6).
describe("the hand-written content", () => {
  it("was written against the contract the lock pins", () => {
    for (const content of [ABOUT, TELEMETRY])
      expect(content.writtenAgainst).toBe(CONTRACT_SOURCE.commit)
  })
})
