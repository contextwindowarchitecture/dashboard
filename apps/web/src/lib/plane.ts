// A slot's plane colour for an element that sets --plane (STYLE.md 3, 9): read from the slot's
// default in contract/slot-defaults.json, never guessed.

import { SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import type { CSSProperties } from "react"

export function planeStyle(slot: string): CSSProperties | undefined {
  const plane = SLOT_DEFAULTS[slot as keyof typeof SLOT_DEFAULTS]?.plane
  return plane ? ({ "--plane": `var(--p-${plane})` } as CSSProperties) : undefined
}
