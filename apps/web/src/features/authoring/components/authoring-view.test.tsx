// The authoring page (ADR-0013): a signed-in owner lists their drafts, starts one from a registry
// entry, edits it field by field or as JSON with the contract's validators and the diff in view,
// saves it to the API, and previews it: an event of its route replayed, a corpus shadowed.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { fakeReplay, recordedAnswer } from "../../../test/fake-replay"
import { FIXTURES_DIR, type Override } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const PROFILE = REGISTRY.profiles.find((p) => p.id === "cache-first-chat")!
const ID = "a1b2c3d4-0000-4000-8000-000000000001"
const WITH_API = { config: { dataRoot: "/data", source: "file" as const, apiBase: "/api" } }
const json = (status: number, body: unknown): Override => ({ status, body: JSON.stringify(body) })
const ME = json(200, {
  sign_in: "configured",
  signed_in: true,
  name: "Ada",
  groups: [],
  roles: ["owner:*"],
})
const DRAFT = {
  $schema: "cwa-dashboard/draft/v1",
  id: ID,
  kind: "profile",
  started_from: { profile: { id: PROFILE.id, version: PROFILE.version } },
  route: PROFILE.route,
  document: PROFILE,
  updated_at: "2026-10-17T12:00:00.000Z",
}
const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const CHAT = index.events.find(
  (r) => r.route === PROFILE.route && r.profile?.id === PROFILE.id && r.outcome === "assembled",
)!
const event = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events", `${CHAT.event_id}.json`), "utf8"),
) as AssemblyEventV1

type Sent = { url: string; method: string; body: unknown }
function open(
  path: string,
  overrides: Record<string, Override> = {},
  replay = fakeReplay(() => recordedAnswer(event)),
) {
  const sent: Sent[] = []
  const answers: Record<string, Override> = {
    "/api/me": ME,
    "/api/drafts.json": json(200, { drafts: [] }),
    ...overrides,
  }
  renderApp(
    path,
    {
      overrides: answers,
      onRequest: (url, init) =>
        sent.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        }),
    },
    { ...WITH_API, replay: replay.client },
  )
  return { sent, replay, answers }
}

describe("the authoring page", () => {
  it("asks a reader to sign in to draft", async () => {
    open("/authoring", {
      "/api/me": json(200, { sign_in: "configured", signed_in: false, roles: [] }),
    })
    expect(await screen.findByRole("region", { name: "Sign in to draft" })).toBeInTheDocument()
  })

  it("lists the reader's drafts, each a link to edit it", async () => {
    open("/authoring", {
      "/api/drafts.json": json(200, {
        drafts: [
          {
            id: ID,
            kind: "profile",
            route: PROFILE.route,
            started_from: DRAFT.started_from,
            updated_at: DRAFT.updated_at,
          },
        ],
      }),
    })
    const table = await screen.findByRole("table", { name: "Your drafts" })
    expect(within(table).getByRole("link", { name: PROFILE.route })).toHaveAttribute(
      "href",
      `/authoring?draft=${ID}`,
    )
  })

  it("starts a draft from a registry entry, saved to the API before it is edited", async () => {
    const { sent } = open("/authoring")
    await userEvent.click(await screen.findByRole("combobox", { name: "Start from" }))
    await userEvent.click(
      screen.getByRole("option", {
        name: new RegExp(`^Profile ${PROFILE.id} v${PROFILE.version}`),
      }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Start a draft" }))
    const put = await waitForRequest(sent, (s) => s.method === "PUT")
    expect(put.url).toMatch(/^\/api\/drafts\/[a-z0-9-]{8,64}\.json$/)
    expect(put.body).toEqual({
      kind: "profile",
      started_from: { profile: { id: PROFILE.id, version: PROFILE.version } },
      document: PROFILE,
    })
  })

  it("edits a field, shows the change and the contract's problems, and saves the draft", async () => {
    const { sent, answers } = open(`/authoring?draft=${ID}`, {
      [`/api/drafts/${ID}.json`]: json(200, DRAFT),
    })
    const version = await screen.findByLabelText("version")
    fireEvent.change(version, { target: { value: "2" } })
    const changes = screen.getByRole("table", { name: "Changes" })
    expect(changes).toHaveTextContent("/version")
    expect(changes).toHaveTextContent("1")
    expect(changes).toHaveTextContent("2")
    // The JSON view follows the fields.
    expect(
      JSON.parse((screen.getByLabelText("Draft JSON") as HTMLTextAreaElement).value).version,
    ).toBe(2)
    fireEvent.change(version, { target: { value: "two" } })
    expect(await screen.findByText("version is a whole number")).toBeInTheDocument()
    fireEvent.change(version, { target: { value: "2" } })
    // A value the schema refuses: the contract's validator names it by path.
    fireEvent.change(screen.getByLabelText("route_policy_version"), { target: { value: "" } })
    expect(await screen.findByRole("region", { name: "Problems" })).toHaveTextContent(
      "/route_policy_version",
    )
    // The service answers the save with the draft as kept, saved later.
    answers[`/api/drafts/${ID}.json`] = json(200, {
      ...DRAFT,
      document: { ...PROFILE, version: 2, route_policy_version: "" },
      updated_at: "2026-10-17T13:00:00.000Z",
    })
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    const put = await waitForRequest(sent, (s) => s.method === "PUT")
    expect(put.url).toBe(`/api/drafts/${ID}.json`)
    expect((put.body as { document: { version: number } }).document.version).toBe(2)
    expect(await screen.findByText(/^Saved at /)).toBeInTheDocument()
    // The editor keeps what the author is working on.
    expect(screen.getByLabelText("version")).toHaveValue("2")
  })

  it("replays an event of the draft's route with the draft in its snapshot", async () => {
    const { replay } = open(`/authoring?draft=${ID}`, {
      [`/api/drafts/${ID}.json`]: json(200, { ...DRAFT, document: { ...PROFILE, version: 7 } }),
    })
    const preview = await screen.findByRole("region", { name: "Replay an event" })
    await userEvent.click(await within(preview).findByRole("combobox", { name: "Event" }))
    await userEvent.click(screen.getByRole("option", { name: new RegExp(CHAT.event_id) }))
    await userEvent.click(await within(preview).findByRole("button", { name: "Replay" }))
    const result = await within(preview).findByRole("table", { name: "Replay result" })
    expect(within(result).getByRole("row", { name: /^As recorded/ })).toHaveTextContent("assembled")
    expect(within(result).getByRole("row", { name: /^With the draft/ })).toHaveTextContent(
      "assembled",
    )
    expect((replay.sent[0] as { profile: { version: number } }).profile.version).toBe(7)
  })

  it("shadows a corpus with the draft as the candidate", async () => {
    const { sent } = open(`/authoring?draft=${ID}`, {
      [`/api/drafts/${ID}.json`]: json(200, DRAFT),
      "/api/corpora.json": json(200, {
        corpora: [{ name: "chat", created_at: DRAFT.updated_at, events: 6 }],
      }),
      "/api/shadow": json(503, { kind: "busy", problems: ["A shadow run is under way."] }),
    })
    const preview = await screen.findByRole("region", { name: "Shadow a corpus" })
    await userEvent.click(await within(preview).findByRole("combobox", { name: "Corpus" }))
    await userEvent.click(screen.getByRole("option", { name: /^chat/ }))
    await userEvent.click(within(preview).getByRole("button", { name: "Shadow" }))
    expect(await within(preview).findByRole("alert")).toHaveTextContent("under way")
    const post = sent.find((s) => s.url === "/api/shadow")!
    expect(post.body).toEqual({ corpus: "chat", candidate: { profile: PROFILE } })
  })
})

describe("publishing a draft", () => {
  const PUBLISH = `/api/drafts/${ID}/publish`
  const PATH = `profiles/${PROFILE.id}/${PROFILE.version}.json`

  it("publishes the saved draft, shadowed over a chosen corpus, and links the pull request", async () => {
    const { sent } = open(`/authoring?draft=${ID}`, {
      [`/api/drafts/${ID}.json`]: json(200, DRAFT),
      "/api/corpora.json": json(200, {
        corpora: [{ name: "chat", created_at: DRAFT.updated_at, events: 6 }],
      }),
      [PUBLISH]: json(200, {
        kind: "published",
        repository: "acme/policies",
        path: PATH,
        branch: `cwa-dashboard/${ID}`,
        number: 3,
        url: "https://github.com/acme/policies/pull/3",
      }),
    })
    const panel = await screen.findByRole("region", { name: "Publish" })
    await userEvent.click(await within(panel).findByRole("combobox", { name: "Shadow over" }))
    await userEvent.click(screen.getByRole("option", { name: /^chat/ }))
    await userEvent.click(within(panel).getByRole("button", { name: "Publish" }))
    const link = await within(panel).findByRole("link", { name: "acme/policies#3" })
    expect(link).toHaveAttribute("href", "https://github.com/acme/policies/pull/3")
    const post = await waitForRequest(sent, (s) => s.url === PUBLISH)
    expect(post).toMatchObject({ method: "POST", body: { corpus: "chat" } })
  })

  it("names the pull request a draft was last published to", async () => {
    open(`/authoring?draft=${ID}`, {
      [`/api/drafts/${ID}.json`]: json(200, {
        ...DRAFT,
        published: {
          repository: "acme/policies",
          path: PATH,
          branch: `cwa-dashboard/${ID}`,
          number: 2,
          url: "https://github.com/acme/policies/pull/2",
          at: DRAFT.updated_at,
        },
      }),
    })
    const facts = await screen.findByRole("list", { name: "Draft" })
    expect(within(facts).getByRole("link", { name: "acme/policies#2" })).toHaveAttribute(
      "href",
      "https://github.com/acme/policies/pull/2",
    )
  })

  it("gives the file and the commands where there is no App", async () => {
    open(`/authoring?draft=${ID}`, {
      [`/api/drafts/${ID}.json`]: json(200, DRAFT),
      [PUBLISH]: json(200, {
        kind: "by-hand",
        path: PATH,
        file: '{\n  "id": "x"\n}\n',
        branch: `cwa-dashboard/${ID}`,
        commands: [`git switch -c cwa-dashboard/${ID}`, `git push -u origin cwa-dashboard/${ID}`],
        problems: ["No GitHub App is configured: set GITHUB_APP_DIR and POLICY_REPOSITORIES."],
      }),
    })
    const panel = await screen.findByRole("region", { name: "Publish" })
    await userEvent.click(within(panel).getByRole("button", { name: "Publish" }))
    const hand = await within(panel).findByRole("region", { name: "Publish by hand" })
    expect(hand).toHaveTextContent("No GitHub App is configured")
    expect(hand).toHaveTextContent(PATH)
    expect(within(hand).getByLabelText("File")).toHaveTextContent('"id": "x"')
    expect(within(hand).getByLabelText("Commands")).toHaveTextContent(
      `git push -u origin cwa-dashboard/${ID}`,
    )
  })

  it("says why a draft was not published", async () => {
    open(`/authoring?draft=${ID}`, {
      [`/api/drafts/${ID}.json`]: json(200, DRAFT),
      [PUBLISH]: json(409, {
        ok: false,
        kind: "conflict",
        path: PATH,
        problems: [`acme/policies already holds ${PATH}: raise the version.`],
      }),
    })
    const panel = await screen.findByRole("region", { name: "Publish" })
    await userEvent.click(within(panel).getByRole("button", { name: "Publish" }))
    expect(await within(panel).findByRole("alert")).toHaveTextContent("raise the version")
  })

  it("publishes the draft as saved, so a change waits for Save", async () => {
    open(`/authoring?draft=${ID}`, { [`/api/drafts/${ID}.json`]: json(200, DRAFT) })
    const panel = await screen.findByRole("region", { name: "Publish" })
    expect(within(panel).getByRole("button", { name: "Publish" })).toBeEnabled()
    fireEvent.change(screen.getByLabelText("version"), { target: { value: "5" } })
    expect(within(panel).getByRole("button", { name: "Publish" })).toBeDisabled()
    expect(panel).toHaveTextContent("Save the draft first")
  })
})

async function waitForRequest(sent: Sent[], test: (s: Sent) => boolean): Promise<Sent> {
  for (let i = 0; i < 100; i++) {
    const found = sent.find(test)
    if (found) return found
    await new Promise((done) => setTimeout(done, 10))
  }
  throw new Error("no such request")
}
