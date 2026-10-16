// A slot as a chip (STYLE.md 3, 6): its id as the contract writes it, in its plane's colour, linking
// to the glossary's entry for the slot. The plane comes from the slot's default in
// contract/slot-defaults.json, never from a guess. Inside a label, where a link would take the
// label's click, the chip is asked for without its link.

import { Link } from "react-router"

import { glossaryHref } from "../../lib/glossary"
import { planeStyle } from "../../lib/plane"
import { Badge } from "../ui/badge"

export function SlotBadge({
  slot,
  link = true,
}: {
  readonly slot: string
  readonly link?: boolean
}) {
  const style = planeStyle(slot)
  if (!link || style === undefined) {
    return (
      <Badge variant="outline" data-tone="plane" data-identifier="" style={style}>
        {slot}
      </Badge>
    )
  }
  return (
    <Badge asChild variant="outline" data-tone="plane" data-identifier="" style={style}>
      <Link to={glossaryHref("slot", slot)}>{slot}</Link>
    </Badge>
  )
}
