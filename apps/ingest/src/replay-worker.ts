// The worker the runner replays in: one snapshot in, the replay's result out.

import { parentPort } from "node:worker_threads"

import { replay } from "./replay.ts"

parentPort!.on("message", ({ id, snapshot }: { id: number; snapshot: unknown }) => {
  try {
    parentPort!.postMessage({ id, result: replay(snapshot) })
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
