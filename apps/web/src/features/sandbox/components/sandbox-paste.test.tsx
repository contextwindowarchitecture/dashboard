import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import type { AssemblyEventV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { fakeReplay, recordedAnswer } from "../../../test/fake-replay"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const cases = resolve(
  import.meta.dirname,
  "../../../../../../packages/contract/vendor/cwa/conformance/cases",
)
const snapshotText = readFileSync(join(cases, "budget-margin", "snapshot.json"), "utf8")
const trace = JSON.parse(
  readFileSync(join(cases, "budget-margin", "expected.trace.json"), "utf8"),
) as AssemblyEventV1["trace"]
const answer = {
  kind: "replayed" as const,
  outcome: "assembled" as const,
  trace,
  payloadHash: "a".repeat(64),
  payloadBytes: 10,
  snapshotDigest: trace!.context.snapshot_digest,
}
const session = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "sessions/refund-7.json"), "utf8"),
) as SessionV1
const event = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events", `${session.turns[0]!.event_id}.json`), "utf8"),
) as AssemblyEventV1

const decode = (href: string | null) =>
  JSON.parse(
    decodeURIComponent(href!.replace(/^data:application\/json;charset=utf-8,/, "")),
  ) as unknown

describe("a snapshot of the reader's own", () => {
  it("replays a pasted snapshot and claims no parity, there being no recording", async () => {
    const user = userEvent.setup()
    const fake = fakeReplay(() => answer)
    renderApp("/sandbox", {}, { replay: fake.client })
    fireEvent.change(await screen.findByRole("textbox", { name: "Snapshot JSON" }), {
      target: { value: snapshotText },
    })
    await user.click(screen.getByRole("button", { name: "Replay" }))
    const result = await screen.findByRole("region", { name: "Replay result" })
    expect(fake.sent[0]).toEqual(JSON.parse(snapshotText))
    expect(result).toHaveTextContent("assembled")
    expect(result).toHaveTextContent("No recorded event to compare with")
  })

  it("says a pasted text is not JSON, and sends nothing", async () => {
    const user = userEvent.setup()
    const fake = fakeReplay(() => answer)
    renderApp("/sandbox", {}, { replay: fake.client })
    fireEvent.change(await screen.findByRole("textbox", { name: "Snapshot JSON" }), {
      target: { value: "{" },
    })
    await user.click(screen.getByRole("button", { name: "Replay" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("not JSON")
    expect(fake.sent).toHaveLength(0)
  })

  it("reads an uploaded snapshot into the field", async () => {
    const user = userEvent.setup()
    renderApp("/sandbox", {}, { replay: fakeReplay(() => answer).client })
    const upload = await screen.findByLabelText("Upload a snapshot")
    await user.upload(
      upload,
      new File([snapshotText], "snapshot.json", { type: "application/json" }),
    )
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Snapshot JSON" })).toHaveValue(snapshotText),
    )
  })
})

describe("downloads", () => {
  it("offer the replayed snapshot and its trace as JSON files", async () => {
    const user = userEvent.setup()
    renderApp(
      `/sandbox?event=${event.event_id}&input=300`,
      {},
      { replay: fakeReplay(() => recordedAnswer(event)).client },
    )
    await user.click(await screen.findByRole("button", { name: "Replay" }))
    const result = await screen.findByRole("region", { name: "Replay result" })
    const snapshot = within(result).getByRole("link", { name: "Download the snapshot" })
    expect(snapshot).toHaveAttribute("download", `${event.event_id}.replay.snapshot.json`)
    expect(
      (decode(snapshot.getAttribute("href")) as { budget: { input: number } }).budget.input,
    ).toBe(300)
    const traceLink = within(result).getByRole("link", { name: "Download the trace" })
    expect(decode(traceLink.getAttribute("href"))).toEqual(event.trace)
  })
})
