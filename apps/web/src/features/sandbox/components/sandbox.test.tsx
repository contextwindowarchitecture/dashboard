import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { fakeReplay, recordedAnswer } from "../../../test/fake-replay"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const pick = (mode: string, outcome = "assembled") =>
  load(index.events.find((r) => r.redaction_mode === mode && r.outcome === outcome)!.event_id)
const full = pick("full")

async function replayOnce(path: string, client: ReturnType<typeof fakeReplay>["client"]) {
  const user = userEvent.setup()
  renderApp(path, {}, { replay: client })
  await user.click(await screen.findByRole("button", { name: "Replay" }))
  return screen.findByRole("region", { name: "Replay result" })
}

describe("the sandbox", () => {
  it("says the replay service is not configured, and how to run it", async () => {
    renderApp(`/sandbox?event=${full.event_id}`)
    const note = await screen.findByRole("region", { name: "Replay service" })
    expect(note).toHaveTextContent("not configured")
    expect(note).toHaveTextContent("apiBase")
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull()
  })

  it("replays a full event as recorded and finds parity with the recorded hash and digest", async () => {
    const fake = fakeReplay(() => recordedAnswer(full))
    const result = await replayOnce(`/sandbox?event=${full.event_id}`, fake.client)
    expect(fake.sent[0]).toEqual(full.snapshot)
    const parity = within(result).getByRole("region", { name: "Parity" })
    expect(parity).toHaveTextContent("equal")
    expect(parity).toHaveTextContent(full.payload!.hash)
    expect(within(result).getByRole("region", { name: "Trace diff" })).toHaveTextContent(
      "No change",
    )
  })

  it("shows a difference in hash as a difference, without saying which assembler is wrong", async () => {
    const fake = fakeReplay(
      () => ({ ...recordedAnswer(full), payloadHash: "0".repeat(64) }) as never,
    )
    const result = await replayOnce(`/sandbox?event=${full.event_id}`, fake.client)
    const parity = within(result).getByRole("region", { name: "Parity" })
    expect(parity).toHaveTextContent("differ")
    expect(parity).toHaveTextContent("one of the two is non-conformant")
  })

  it("replays a scrubbed event and claims no parity", async () => {
    const scrubbed = pick("pii_scrubbed")
    const fake = fakeReplay(() => recordedAnswer(scrubbed))
    const result = await replayOnce(`/sandbox?event=${scrubbed.event_id}`, fake.client)
    expect(within(result).getByRole("region", { name: "Parity" })).toHaveTextContent("no parity")
    // Sent over the scrubbed text the event holds, never its redaction objects.
    const bodies = (fake.sent[0] as { batches: { items: { body: unknown }[] }[] }).batches.flatMap(
      (b) => b.items.map((i) => i.body),
    )
    for (const body of bodies) expect(body).not.toMatchObject({ redacted: "pii_scrubbed" })
  })

  it("will not replay a digested event, and says why and which setting decides it", async () => {
    const digested = pick("digest_only")
    renderApp(
      `/sandbox?event=${digested.event_id}`,
      {},
      { replay: fakeReplay(() => recordedAnswer(digested)).client },
    )
    const note = await screen.findByRole("region", { name: "Fidelity" })
    expect(note).toHaveTextContent("digest_only")
    expect(note).toHaveTextContent("routes.<route>.redaction_mode")
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull()
  })

  it("shows a rejection's problems", async () => {
    const fake = fakeReplay(() => ({ kind: "rejected", problems: ["budget: required"] }))
    const result = await replayOnce(`/sandbox?event=${full.event_id}`, fake.client)
    expect(result).toHaveTextContent("rejected")
    expect(result).toHaveTextContent("budget: required")
  })

  it("says the service did not answer, when it did not", async () => {
    const fake = fakeReplay(() => ({
      kind: "unreachable",
      message: "The replay service at /api did not answer",
    }))
    const result = await replayOnce(`/sandbox?event=${full.event_id}`, fake.client)
    expect(result).toHaveTextContent("did not answer")
  })

  it("is linked from the inspector and the navigation", async () => {
    renderApp(`/traces/${full.event_id}`)
    expect(await screen.findByRole("link", { name: "Replay in the sandbox →" })).toHaveAttribute(
      "href",
      `/sandbox?event=${full.event_id}`,
    )
    const nav = screen.getByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Sandbox" })).toHaveAttribute("href", "/sandbox")
  })
})
