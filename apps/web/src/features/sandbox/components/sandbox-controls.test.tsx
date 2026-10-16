import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { fakeReplay, recordedAnswer } from "../../../test/fake-replay"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

// A refund-7 turn: support-chat under illustrative/v1, full bodies.
const session = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "sessions/refund-7.json"), "utf8"),
) as SessionV1
const event = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events", `${session.turns[0]!.event_id}.json`), "utf8"),
) as AssemblyEventV1
const base = `/sandbox?event=${event.event_id}`
type Sent = {
  budget: { input: number }
  assembly_time: string
  profile: { id: string }
  batches: { items: { id: string }[] }[]
}

async function open(path = base) {
  const fake = fakeReplay(() => recordedAnswer(event))
  const app = renderApp(path, {}, { replay: fake.client })
  const controls = await screen.findByRole("group", { name: "Controls" })
  const search = () => new URLSearchParams(app.router.state.location.search)
  return { ...app, fake, controls, search }
}

describe("the sandbox's controls", () => {
  it("start at the recorded budget, and put a change in the URL", async () => {
    const { controls, search } = await open()
    const input = within(controls).getByRole("spinbutton", { name: "budget.input" })
    expect(input).toHaveValue(event.snapshot!.budget.input)
    fireEvent.change(input, { target: { value: "120" } })
    expect(search().get("input")).toBe("120")
    expect(search().get("event")).toBe(event.event_id)
  })

  it("replay the edited snapshot, and claim no parity for it", async () => {
    const user = userEvent.setup()
    const { fake } = await open(`${base}&input=120&offset=86400`)
    await user.click(screen.getByRole("button", { name: "Replay" }))
    const result = await screen.findByRole("region", { name: "Replay result" })
    const sent = fake.sent[0] as Sent
    expect(sent.budget.input).toBe(120)
    expect(Date.parse(sent.assembly_time) - Date.parse(event.snapshot!.assembly_time)).toBe(
      86_400_000,
    )
    expect(within(result).getByRole("region", { name: "Parity" })).toHaveTextContent("no parity")
  })

  it("leave an item out when its box is cleared", async () => {
    const user = userEvent.setup()
    const { controls, search, fake } = await open()
    const items = within(controls).getByRole("group", { name: "Items" })
    const first = within(items).getAllByRole("checkbox")[0]!
    const id = first.getAttribute("value")!
    await user.click(first)
    expect(search().get("off")).toBe(id)
    await user.click(screen.getByRole("button", { name: "Replay" }))
    await screen.findByRole("region", { name: "Replay result" })
    const sent = fake.sent[0] as Sent
    expect(sent.batches.flatMap((b) => b.items.map((i) => i.id))).not.toContain(id)
  })

  it("offer only the profiles R-20 allows, the others disabled with the reason", async () => {
    const user = userEvent.setup()
    const { controls, search } = await open()
    expect(
      within(controls).getByRole("list", { name: "Profiles this snapshot cannot use" }),
    ).toHaveTextContent("R-20")
    await user.click(within(controls).getByRole("combobox", { name: "profile" }))
    const option = (id: string) => screen.getByRole("option", { name: new RegExp(`^${id} v1`) })
    expect(option("document-analysis")).toHaveAttribute("aria-disabled", "true")
    expect(option("policy-first-chat")).not.toHaveAttribute("aria-disabled")
    await user.click(option("policy-first-chat"))
    expect(search().get("profile")).toBe("policy-first-chat@1")
  })

  it("replay a swapped profile from the registry", async () => {
    const user = userEvent.setup()
    const { fake } = await open(`${base}&profile=policy-first-chat@1`)
    await user.click(screen.getByRole("button", { name: "Replay" }))
    await screen.findByRole("region", { name: "Replay result" })
    expect((fake.sent[0] as Sent).profile).toEqual(
      REGISTRY.profiles.find((p) => p.id === "policy-first-chat"),
    )
  })

  it("will not replay a profile R-20 forbids, and says why", async () => {
    await open(`${base}&profile=document-analysis@1`)
    expect(screen.getByRole("region", { name: "Control problems" })).toHaveTextContent("R-20")
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled()
  })

  it("offer the service's tokenizers and renderers, saying which are required and which it lacks", async () => {
    const user = userEvent.setup()
    const { controls, search } = await open()
    await user.click(await within(controls).findByRole("combobox", { name: "renderer" }))
    expect(
      screen.getByRole("option", { name: "cwa-message-blocks/v1 · optional · not provided" }),
    ).toHaveAttribute("aria-disabled", "true")
    await user.click(screen.getByRole("option", { name: "fixture-xml/v1 · required" }))
    expect(search().get("renderer")).toBe("fixture-xml/v1")
  })

  it("puts everything back with Reset", async () => {
    const user = userEvent.setup()
    const { search } = await open(`${base}&input=120&off=x`)
    await user.click(screen.getByRole("button", { name: "Reset" }))
    expect([...search().keys()]).toEqual(["event"])
  })
})
