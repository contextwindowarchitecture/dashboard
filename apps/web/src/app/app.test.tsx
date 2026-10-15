import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { App } from "./app"

describe("App", () => {
  it("renders one main region titled with the dashboard's name", () => {
    render(<App />)
    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: "CWA dashboard" })).toBeInTheDocument()
  })
})
