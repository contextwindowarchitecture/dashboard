import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { gsap } from "../../../lib/motion"
import { fakeReplay, recordedAnswer } from "../../../test/fake-replay"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { prefer, running, withMotionClock } from "../../../test/motion"
import { renderApp } from "../../../test/render-app"

withMotionClock()

const read = <T,>(path: string) => JSON.parse(readFileSync(join(FIXTURES_DIR, path), "utf8")) as T
const session = read<SessionV1>("sessions/refund-7.json")
const event = read<AssemblyEventV1>(`events/${session.turns[0]!.event_id}.json`)
const index = read<EventsIndexV1>("events/index.json")
const refused = read<AssemblyEventV1>(
  `events/${index.events.find((r) => r.outcome === "refused")!.event_id}.json`,
)

async function replay(answer = recordedAnswer(event), strict = false) {
  const user = userEvent.setup()
  const app = renderApp(
    `/sandbox?event=${event.event_id}`,
    {},
    { replay: fakeReplay(() => answer).client, strict },
  )
  await user.click(await screen.findByRole("button", { name: "Replay" }))
  const result = await screen.findByRole("region", { name: "Replay result" })
  const segments = () => [...result.querySelectorAll('[data-slot="budget-bar"] > [data-segment]')]
  return { ...app, result, segments }
}

describe("settling the replay", () => {
  it("tweens the replay's segments from the recorded widths, then reveals the diff", async () => {
    prefer(false)
    gsap.globalTimeline.timeScale(0.01)
    const { result, segments } = await replay()
    await waitFor(() => expect(gsap.getTweensOf(segments()).length).toBeGreaterThan(0))
    expect(
      gsap.getTweensOf(result.querySelector('[data-slot="settle-reveal"]')).length,
    ).toBeGreaterThan(0)
  })

  it("draws the segments the replay lost, to collapse them", async () => {
    prefer(false)
    const { result } = await replay({ ...recordedAnswer(refused), snapshotDigest: "x" } as never)
    expect(
      result.querySelectorAll('[data-slot="budget-bar"] > [data-ghost]').length,
    ).toBeGreaterThan(0)
  })

  it("sets everything at once under reduced motion, the diff in view", async () => {
    prefer(true)
    const { result, segments } = await replay()
    await act(() => new Promise((done) => setTimeout(done, 50)))
    expect(gsap.getTweensOf(segments())).toHaveLength(0)
    expect(screen.getByRole("region", { name: "Trace diff lines" })).toBeVisible()
    expect(result.querySelector('[data-slot="settle-reveal"]')).not.toHaveAttribute("style")
  })

  it("leaves nothing on GSAP's clock after a route change, under Strict Mode", async () => {
    prefer(false)
    gsap.globalTimeline.timeScale(0.01)
    const { router } = await replay(recordedAnswer(event), true)
    await waitFor(() => expect(running().length).toBeGreaterThan(0))
    await act(() => router.navigate("/traces"))
    await screen.findByRole("heading", { level: 1, name: "Trace stream" })
    expect(running()).toHaveLength(0)
  })
})
