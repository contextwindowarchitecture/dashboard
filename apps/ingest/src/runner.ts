// Where a replay runs. assemble() is synchronous, so a replay that runs long cannot be interrupted
// where it runs; the worker runner runs each in a worker thread, one at a time, and on a timeout
// terminates the worker and starts the next replay in a fresh one (dashboard-plan.md 11).

import { Worker } from "node:worker_threads"

import type { ReplayResult } from "./replay.ts"

export interface Runner {
  /** Replays one snapshot; `timeoutMs` overrides the runner's own limit for this call. */
  run(snapshot: unknown, timeoutMs?: number): Promise<ReplayResult>
  close(): Promise<void>
}

export class ReplayTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`The replay took longer than ${timeoutMs} ms and was stopped.`)
    this.name = "ReplayTimeoutError"
    this.timeoutMs = timeoutMs
  }
}

interface Pending {
  readonly resolve: (result: ReplayResult) => void
  readonly reject: (error: Error) => void
}

export function createWorkerRunner({ timeoutMs }: { readonly timeoutMs: number }): Runner {
  let worker: Worker | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let next = 0
  const pending = new Map<number, Pending>()

  const spawn = () => {
    const created = new Worker(new URL("./replay-worker.ts", import.meta.url))
    created.on("message", (message: { id: number; result?: ReplayResult; error?: string }) => {
      const job = pending.get(message.id)
      pending.delete(message.id)
      if (message.result !== undefined) job?.resolve(message.result)
      else job?.reject(new Error(message.error ?? "The replay failed."))
    })
    created.on("error", (error) => {
      for (const job of pending.values()) job.reject(error)
      pending.clear()
      if (worker === created) worker = undefined
    })
    return created
  }

  const runOne = (snapshot: unknown, limit: number) =>
    new Promise<ReplayResult>((resolve, reject) => {
      const current = (worker ??= spawn())
      const id = next++
      const timer = setTimeout(() => {
        pending.delete(id)
        if (worker === current) worker = undefined
        void current.terminate()
        reject(new ReplayTimeoutError(limit))
      }, limit)
      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      current.postMessage({ id, snapshot })
    })

  return {
    run(snapshot, limit = timeoutMs) {
      const job = queue.then(() => runOne(snapshot, limit))
      queue = job.catch(() => undefined)
      return job
    },
    async close() {
      const current = worker
      worker = undefined
      await current?.terminate()
    },
  }
}
