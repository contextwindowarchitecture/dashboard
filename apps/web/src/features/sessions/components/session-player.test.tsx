import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { renderApp } from "../../../test/render-app"

async function openPlayer(path = "/sessions/refund-7") {
  const app = renderApp(path)
  const player = await screen.findByRole("group", { name: "Session player" })
  const button = (name: string) => within(player).getByRole("button", { name })
  const turn = () => new URLSearchParams(app.router.state.location.search).get("turn")
  return { ...app, player, button, turn }
}

describe("the session player, stepping", () => {
  it("announces the turn shown, of how many", async () => {
    const { player } = await openPlayer()
    expect(within(player).getByRole("status")).toHaveTextContent("Turn 4 · step 5 of 5 · assembled")
  })

  it("steps back and forward through the turns, the turn in the URL, the ends marked", async () => {
    const user = userEvent.setup()
    const { player, button, turn } = await openPlayer()
    expect(button("Step forward")).toHaveAttribute("aria-disabled", "true")
    await user.click(button("Step back"))
    expect(turn()).toBe("3")
    expect(within(player).getByRole("status")).toHaveTextContent("Turn 3 · step 4 of 5 · assembled")
    expect(await screen.findByRole("region", { name: "Turn 3" })).toBeInTheDocument()
    await user.click(button("Step forward"))
    expect(turn()).toBe("4")
  })

  it("steps with the arrow keys", async () => {
    const user = userEvent.setup()
    const { button, turn } = await openPlayer()
    button("Step back").focus()
    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(turn()).toBe("2")
    await user.keyboard("{ArrowRight}")
    expect(turn()).toBe("3")
  })

  it("sets the turn with the scrubber", async () => {
    const { player, turn } = await openPlayer()
    const scrubber = within(player).getByRole("slider", { name: "Turn" })
    expect(scrubber).toHaveAttribute("aria-valuetext", "Turn 4 · step 5 of 5")
    fireEvent.change(scrubber, { target: { value: "1" } })
    expect(turn()).toBe("1")
    expect(scrubber).toHaveAttribute("aria-valuetext", "Turn 1 · step 2 of 5")
  })

  it("leaves the arrow keys on the scrubber to the scrubber", async () => {
    const { player, turn } = await openPlayer("/sessions/refund-7?turn=2")
    fireEvent.keyDown(within(player).getByRole("slider", { name: "Turn" }), { key: "ArrowLeft" })
    expect(turn()).toBe("2")
  })

  it("names a refused turn's code as it reaches it", async () => {
    const { player } = await openPlayer("/sessions/intake-12")
    expect(within(player).getByRole("status")).toHaveTextContent(
      "Turn 2 · step 3 of 3 · refused · ",
    )
  })
})
