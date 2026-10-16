import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { fixtureFetch, type FixtureFetchOptions } from "../test/fixture-fetch"
import { DataProvider } from "./data-provider"
import { useEvent, useFleet, useIndex, useSession } from "./queries"
import { regionOf } from "./region"
import { createFileSource } from "./source"

function harness(options: FixtureFetchOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  const source = createFileSource("/data", fixtureFetch(options))
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DataProvider source={source} root="/data">
        {children}
      </DataProvider>
    </QueryClientProvider>
  )
  return { client, wrapper }
}

const EVENT = "01JA2B3C4D5E6F7G8H9JKMNPQR"

describe("the queries and their region states", () => {
  it("loads, then holds the parsed index", async () => {
    const { wrapper } = harness()
    const { result } = renderHook(() => regionOf(useIndex(), { what: "the index" }), { wrapper })
    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("ok"))
    if (result.current.status !== "ok") throw new Error()
    expect(result.current.data.$schema).toBe("cwa-dashboard/events-index/v1")
    expect(result.current.updating).toBe(false)
  })

  it("reads a session and the fleet report", async () => {
    const { wrapper } = harness()
    const session = renderHook(() => regionOf(useSession("refund-7"), { what: "the session" }), {
      wrapper,
    })
    const fleet = renderHook(() => regionOf(useFleet(), { what: "the fleet report" }), { wrapper })
    await waitFor(() => expect(session.result.current.status).toBe("ok"))
    await waitFor(() => expect(fleet.result.current.status).toBe("ok"))
  })

  it("says a missing event is not found, and never retries it", async () => {
    const requests: string[] = []
    const { wrapper } = harness({ onRequest: (url) => requests.push(url) })
    const { result } = renderHook(() => regionOf(useEvent(EVENT), { what: `event ${EVENT}` }), {
      wrapper,
    })
    await waitFor(() =>
      expect(result.current).toEqual({ status: "not-found", what: `event ${EVENT}` }),
    )
    expect(requests.filter((url) => url.includes(EVENT))).toHaveLength(1)
  })

  it("says a failing server is an error, retried once, with a retry action", async () => {
    const requests: string[] = []
    const { wrapper } = harness({
      overrides: { "/data/fleet.json": { status: 503 } },
      onRequest: (url) => requests.push(url),
    })
    const { result } = renderHook(() => regionOf(useFleet(), { what: "the fleet report" }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(requests.filter((url) => url === "/data/fleet.json")).toHaveLength(2)
    if (result.current.status !== "error") throw new Error()
    expect(result.current.error.message).toMatch(/503/)
    expect(typeof result.current.retry).toBe("function")
  })

  it("says a document of another schema is unsupported, and an invalid one invalid, naming the file", async () => {
    const { wrapper } = harness({
      overrides: {
        "/data/fleet.json": {
          status: 200,
          body: JSON.stringify({ $schema: "cwa-dashboard/fleet-report/v2" }),
        },
        "/data/sessions/refund-7.json": {
          status: 200,
          body: JSON.stringify({ $schema: "cwa-dashboard/session/v1" }),
        },
      },
    })
    const fleet = renderHook(() => regionOf(useFleet(), { what: "the fleet report" }), { wrapper })
    const session = renderHook(() => regionOf(useSession("refund-7"), { what: "the session" }), {
      wrapper,
    })
    await waitFor(() =>
      expect(fleet.result.current).toEqual({
        status: "unsupported",
        schema: "cwa-dashboard/fleet-report/v2",
        path: "/data/fleet.json",
      }),
    )
    await waitFor(() => expect(session.result.current.status).toBe("invalid"))
    if (session.result.current.status !== "invalid") throw new Error()
    expect(session.result.current.path).toBe("/data/sessions/refund-7.json")
    expect(session.result.current.issues.length).toBeGreaterThan(0)
  })

  it("is empty when the page's test of emptiness says so", async () => {
    const { wrapper } = harness({
      overrides: {
        "/data/events/index.json": {
          status: 200,
          body: JSON.stringify({
            $schema: "cwa-dashboard/events-index/v1",
            generated_at: "2026-10-15T00:00:00.000Z",
            window: { from: "2026-10-15T00:00:00.000Z", to: "2026-10-15T00:00:00.000Z" },
            events: [],
            facets: { outcome: {}, language: {}, route: {}, reason: {}, service: {} },
          }),
        },
      },
    })
    const { result } = renderHook(
      () =>
        regionOf(useIndex(), { what: "the index", isEmpty: (index) => index.events.length === 0 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.status).toBe("empty"))
  })

  it("keeps the index on screen while it refetches, labelled updating", async () => {
    let release: (() => void) | undefined
    let holding = false
    const { client, wrapper } = harness({
      hold: (url) =>
        holding && url === "/data/events/index.json"
          ? new Promise<void>((resolve) => (release = resolve))
          : undefined,
    })
    const { result } = renderHook(() => regionOf(useIndex(), { what: "the index" }), { wrapper })
    await waitFor(() => expect(result.current).toMatchObject({ status: "ok", updating: false }))
    holding = true
    act(() => void client.invalidateQueries({ queryKey: ["data", "/data", "index"] }))
    await waitFor(() => expect(result.current).toMatchObject({ status: "ok", updating: true }))
    holding = false
    act(() => release!())
    await waitFor(() => expect(result.current).toMatchObject({ status: "ok", updating: false }))
  })
})
