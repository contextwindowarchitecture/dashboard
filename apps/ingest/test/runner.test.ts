import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { replay } from "../src/replay.ts"
import { createWorkerRunner, ReplayTimeoutError, type Runner } from "../src/runner.ts"

const cases = resolve(
  import.meta.dirname,
  "../../../packages/contract/vendor/cwa/conformance/cases",
)
const snapshot = JSON.parse(
  readFileSync(join(cases, "messages-render", "snapshot.json"), "utf8"),
) as unknown

let runner: Runner | undefined
afterEach(async () => {
  await runner?.close()
  runner = undefined
})

describe("the worker runner", () => {
  it("replays in a worker exactly as in-process", async () => {
    runner = createWorkerRunner({ timeoutMs: 20_000 })
    const result = await runner.run(snapshot)
    const local = replay(snapshot)
    expect(result.status).toBe(200)
    if (result.status === 200 && local.status === 200) {
      expect(result.body.payload_hash).toBe(local.body.payload_hash)
      expect(result.body.snapshot_digest).toBe(local.body.snapshot_digest)
    }
  }, 30_000)

  it("stops a replay that outruns its time, and replays the next one in a fresh worker", async () => {
    runner = createWorkerRunner({ timeoutMs: 20_000 })
    await expect(runner.run(snapshot, 1)).rejects.toBeInstanceOf(ReplayTimeoutError)
    // The same runner: the stopped worker is gone, so this one starts afresh and answers.
    expect((await runner.run(snapshot)).status).toBe(200)
  }, 30_000)
})
