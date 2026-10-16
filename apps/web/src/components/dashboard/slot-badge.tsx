// A slot as a chip (STYLE.md 3, 6): its id as the contract writes it, in its plane's colour. The
// plane comes from the slot's default in contract/slot-defaults.json, never from a guess.

import { SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import type { CSSProperties } from "react"

import { Badge } from "../ui/badge"

/** The CSS custom property a plane's colour is read from, for an element that sets --plane. */
export function planeStyle(slot: string): CSSProperties | undefined {
  const plane = SLOT_DEFAULTS[slot as keyof typeof SLOT_DEFAULTS]?.plane
  return plane ? ({ "--plane": `var(--p-${plane})` } as CSSProperties) : undefined
}

export function SlotBadge({ slot }: { readonly slot: string }) {
  return (
    <Badge variant="outline" data-tone="plane" data-identifier="" style={planeStyle(slot)}>
      {slot}
    </Badge>
  )
}
