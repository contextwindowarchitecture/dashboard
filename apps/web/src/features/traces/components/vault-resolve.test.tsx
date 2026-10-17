// The inspector's vault control (ADR-0009), over the demo's vaulted events: the review agent's route
// keeps its bodies in the vault, and the operator resolves one with the operator token. The bodies
// answered are the demo vault's own files.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR, type Override } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const EVENTS = join(FIXTURES_DIR, "events")
const events = readdirSync(EVENTS)
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .map((name) => JSON.parse(readFileSync(join(EVENTS, name), "utf8")) as AssemblyEventV1)
const VAULTED = events.find((e) => e.vault !== undefined && e.outcome === "assembled")!
const SCRUBBED = events.find(
  (e) => e.redaction_mode === "pii_scrubbed" && e.outcome === "assembled",
)!
const VAULT_DIR = join(FIXTURES_DIR, "../vault")
const DEPOSITS = readdirSync(VAULT_DIR).flatMap((prefix) =>
  readdirSync(join(VAULT_DIR, prefix)).map((name) => ({
    sha: name.split(".")[0]!,
    text: readFileSync(join(VAULT_DIR, prefix, name), "utf8"),
  })),
)
const WITH_API = { config: { dataRoot: "/data", source: "file" as const, apiBase: "/api" } }
const every = (answer: (deposit: { sha: string; text: string }) => Override) =>
  Object.fromEntries(DEPOSITS.map((d) => [`/api/bodies/${d.sha}`, answer(d)]))

async function resolveFirst(overrides: Record<string, Override>) {
  renderApp(`/traces/${VAULTED.event_id}`, { overrides }, WITH_API)
  const vault = await screen.findByRole("region", { name: "Vault" })
  fireEvent.change(within(vault).getByLabelText("Operator token"), {
    target: { value: "operator-token" },
  })
  await userEvent.click(within(vault).getByRole("button", { name: "Use the token" }))
  const [first] = await screen.findAllByRole("button", { name: "Resolve from the vault" })
  await userEvent.click(first!)
}

describe("the inspector's vault control", () => {
  it("names the vault a vaulted event's bodies went to, and asks for the operator token", async () => {
    renderApp(`/traces/${VAULTED.event_id}`, {}, WITH_API)
    const vault = await screen.findByRole("region", { name: "Vault" })
    expect(vault).toHaveTextContent(VAULTED.vault!.base)
    expect(within(vault).getByLabelText("Operator token")).toHaveAttribute("type", "password")
    expect(screen.queryByRole("button", { name: "Resolve from the vault" })).toBeNull()
  })

  it("resolves a body with the token, once its bytes are the ones the event digests", async () => {
    await resolveFirst(every((d) => ({ status: 200, body: d.text })))
    const resolved = await screen.findByRole("region", { name: "Resolved body" })
    expect(resolved).toHaveTextContent("SHA-256 checked")
    expect(DEPOSITS.some((d) => resolved.textContent?.includes(d.text.slice(0, 40)))).toBe(true)
  })

  it("shows nothing when the vault returns other bytes, and says so", async () => {
    await resolveFirst(every(() => ({ status: 200, body: "not the body" })))
    expect(await screen.findByRole("alert")).toHaveTextContent(/other bytes/)
    expect(screen.queryByText("not the body")).toBeNull()
  })

  it("says the token was refused, and lets the reader try another", async () => {
    await resolveFirst(every(() => ({ status: 401, body: "{}" })))
    expect(await screen.findByRole("alert")).toHaveTextContent(/refused the token/)
  })

  it("names the event's vault when this dashboard's does not hold the body", async () => {
    await resolveFirst(every(() => ({ status: 404, body: "{}" })))
    expect(await screen.findByRole("alert")).toHaveTextContent(VAULTED.vault!.base)
  })

  it("names the setting when the service has no operator token", async () => {
    await resolveFirst(
      every(() => ({
        status: 503,
        body: JSON.stringify({
          kind: "not-configured",
          problems: ["No operator token: set VAULT_TOKEN to resolve and erase bodies."],
        }),
      })),
    )
    expect(await screen.findByRole("alert")).toHaveTextContent("VAULT_TOKEN")
  })

  it("keeps the token in the page's memory only", async () => {
    await resolveFirst(every((d) => ({ status: 200, body: d.text })))
    await screen.findByRole("region", { name: "Resolved body" })
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(stored).not.toContain("operator-token")
  })

  it("says the service is not configured when config.json names no API", async () => {
    renderApp(`/traces/${VAULTED.event_id}`)
    const vault = await screen.findByRole("region", { name: "Vault" })
    expect(vault).toHaveTextContent(/names no apiBase/)
    expect(within(vault).queryByLabelText("Operator token")).toBeNull()
  })

  it("offers nothing for an event whose route is not opted into the vault", async () => {
    renderApp(`/traces/${SCRUBBED.event_id}`, {}, WITH_API)
    await screen.findByRole("list", { name: "Included items" })
    expect(screen.queryByRole("region", { name: "Vault" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Resolve from the vault" })).toBeNull()
  })

  it("resolves a scrubbed body too, from the event a vaulted pii_scrubbed route emits", async () => {
    // The envelope fixtures' pii_scrubbed event with the vault named, as their README defines it.
    const dir = join(FIXTURES_DIR, "../../telemetry/fixtures/envelope/blocks-render")
    const event = {
      ...(JSON.parse(readFileSync(join(dir, "pii_scrubbed.json"), "utf8")) as AssemblyEventV1),
      vault: { base: "https://dashboard.example/api" },
    }
    const deposits = JSON.parse(readFileSync(join(dir, "deposits.json"), "utf8")) as {
      sha256: string
      text: string
    }[]
    renderApp(
      `/traces/${event.event_id}`,
      {
        overrides: {
          [`/data/events/${event.event_id}.json`]: { status: 200, body: JSON.stringify(event) },
          ...Object.fromEntries(
            deposits.map((d) => [`/api/bodies/${d.sha256}`, { status: 200, body: d.text }]),
          ),
        },
      },
      WITH_API,
    )
    const vault = await screen.findByRole("region", { name: "Vault" })
    fireEvent.change(within(vault).getByLabelText("Operator token"), { target: { value: "t" } })
    await userEvent.click(within(vault).getByRole("button", { name: "Use the token" }))
    const [first] = await screen.findAllByRole("button", { name: "Resolve from the vault" })
    await userEvent.click(first!)
    expect(await screen.findByRole("region", { name: "Resolved body" })).toHaveTextContent(
      "SHA-256 checked",
    )
  })
})
