// A slot as a chip (STYLE.md 3, 6): its id as the contract writes it, in its plane's colour. The
// plane comes from the slot's default in contract/slot-defaults.json, never from a guess.

import { planeStyle } from "../../lib/plane"
import { Badge } from "../ui/badge"

export function SlotBadge({ slot }: { readonly slot: string }) {
  return (
    <Badge variant="outline" data-tone="plane" data-identifier="" style={planeStyle(slot)}>
      {slot}
    </Badge>
  )
}
