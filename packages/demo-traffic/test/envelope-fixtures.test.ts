import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { ENVELOPE_CASES, expectedEvent, FIXTURES, MODES } from "../src/envelope-fixtures.ts"
import type { FixtureRecording } from "../src/envelope-fixtures.ts"

// This wrapper is the first to pass the envelope conformance fixtures every wrapper must reproduce.
describe("the envelope conformance fixtures", () => {
  for (const path of ENVELOPE_CASES) {
    const dir = path.split("/").at(-1)!
    it(`${dir}: the wrapper emits the stored event in every mode`, () => {
      const recording = JSON.parse(
        readFileSync(join(FIXTURES, dir, "recording.json"), "utf8"),
      ) as FixtureRecording
      expect(recording.case).toBe(path)
      for (const mode of MODES) {
        const stored = JSON.parse(readFileSync(join(FIXTURES, dir, `${mode}.json`), "utf8"))
        expect(expectedEvent(recording, mode), mode).toEqual(stored)
      }
    })
  }
})
