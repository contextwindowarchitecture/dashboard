import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

// The sandbox's own controls, the module its page runs, here put through the real assembler: the
// web app may not load the assembler, so what each edit leads to is tested on this side.
import { applyControls, type Snapshot } from "../../web/src/features/sandbox/model/controls.ts"
import { replay } from "../src/replay.ts"

const cases = resolve(
  import.meta.dirname,
  "../../../packages/contract/vendor/cwa/conformance/cases",
)
const snapshotOf = (id: string) =>
  JSON.parse(readFileSync(join(cases, id, "snapshot.json"), "utf8")) as Snapshot
const refusal = (snapshot: Snapshot) => {
  const result = replay(snapshot)
  if (result.status !== 200) throw new Error(`not replayed: ${JSON.stringify(result.body)}`)
  return (result.body.trace as { refused: { reason: string | null } }).refused.reason
}

describe("the sandbox's controls, replayed", () => {
  it("leave the outcome as recorded when nothing is changed", () => {
    expect(refusal(applyControls(snapshotOf("fixture-three-slot"), {}).snapshot)).toBeNull()
  })

  it("refuse with required_slot_missing when the query is left out (R-4)", () => {
    const { snapshot } = applyControls(snapshotOf("fixture-three-slot"), { off: ["turn:18"] })
    expect(refusal(snapshot)).toBe("required_slot_missing")
  })

  it("refuse with protected_content_over_budget when the budget is below the protected content (R-17)", () => {
    const { snapshot } = applyControls(snapshotOf("fixture-three-slot"), { input: 10 })
    expect(refusal(snapshot)).toBe("protected_content_over_budget")
  })

  it("refuse with slot_floor_over_budget when the budget is below a slot's floor (R-16)", () => {
    const { snapshot } = applyControls(snapshotOf("budget-slot-floor"), { input: 40 })
    expect(refusal(snapshot)).toBe("slot_floor_over_budget")
  })
})
