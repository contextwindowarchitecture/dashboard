import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LanguageMark } from "./language-mark"
import { ReasonChip } from "./reason-chip"
import { StatusBadge } from "./status-badge"

// STYLE.md 3: every chip carries its word; colour is never the only signal.
describe("StatusBadge", () => {
  it("names an assembly with its tokens, quietly", () => {
    render(<StatusBadge outcome="assembled" inputTokens={3740} />)
    const chip = screen.getByText("assembled · 3,740 tokens")
    expect(chip).toHaveAttribute("data-tone", "ok")
  })

  it("names a refusal by its code, loudly", () => {
    render(<StatusBadge outcome="refused" refusedReason="evidence_required" />)
    const chip = screen.getByText(/refused/)
    expect(chip).toHaveTextContent("refused · evidence_required")
    expect(chip).toHaveAttribute("data-tone", "bad")
  })

  it("names a rejection with its problem count", () => {
    render(<StatusBadge outcome="rejected" problemCount={1} />)
    expect(screen.getByText("rejected · 1 problem")).toHaveAttribute("data-tone", "bad")
  })
})

describe("ReasonChip", () => {
  it("names the code and the rule the registry gives it", () => {
    render(<ReasonChip code="expired" />)
    const chip = screen.getByText("expired").closest("[data-slot=badge]")!
    expect(chip).toHaveTextContent("expired · R-9")
    expect(chip).toHaveAttribute("data-tone", "bad")
  })

  it("reads missing_field:<name> as the code the trace wrote", () => {
    render(<ReasonChip code="missing_field:relevance" />)
    expect(
      screen.getByText("missing_field:relevance").closest("[data-slot=badge]"),
    ).toHaveTextContent("· R-2")
  })

  it("never gives a code outside the registry a rule", () => {
    render(<ReasonChip code="ITEM_EXPIRED" />)
    const chip = screen.getByText("ITEM_EXPIRED").closest("[data-slot=badge]")!
    expect(chip).toHaveTextContent("ITEM_EXPIRED · not in the contract")
    expect(chip.textContent).not.toMatch(/R-\d/)
    expect(chip).toHaveAttribute("data-tone", "warn")
  })
})

describe("LanguageMark", () => {
  it("names a language by the implementations index's label, with its symbol beside it", () => {
    const { container } = render(<LanguageMark language="typescript" />)
    expect(screen.getByText("TypeScript")).toBeInTheDocument()
    const symbol = container.querySelector("svg")!
    expect(symbol).toHaveAttribute("aria-hidden", "true")
    expect(symbol.getAttribute("data-symbol")).toBe("square")
  })

  it("gives each language its own symbol", () => {
    const symbols = ["python", "typescript", "go", "rust"].map((language) => {
      const { container, unmount } = render(<LanguageMark language={language} />)
      const symbol = container.querySelector("svg")!.getAttribute("data-symbol")
      unmount()
      return symbol
    })
    expect(symbols).toEqual(["circle", "square", "triangle", "diamond"])
  })
})
