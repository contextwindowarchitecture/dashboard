// A reason code as a chip (STYLE.md 6, Chips): the code as the trace wrote it and the rule the
// contract's registry gives it, linking to the glossary's entry for the code it is an instance of.
// A code outside the registry is shown as itself and said to be so; it never gets a rule or a link
// (AGENTS.md, "Never invent vocabulary"). A dense table asks for the chip without its link.

import { Link } from "react-router"

import { glossaryHref } from "../../lib/glossary"
import { reasonInfo } from "../../lib/reasons"
import { Badge } from "../ui/badge"

export function ReasonChip({
  code,
  link = true,
}: {
  readonly code: string
  readonly link?: boolean
}) {
  const info = reasonInfo(code)
  const words = (
    <>
      <span>{code}</span>{" "}
      <span data-slot="chip-detail">· {info ? info.rule : "not in the contract"}</span>
    </>
  )
  if (info === undefined || !link) {
    return (
      <Badge variant="outline" data-tone={info ? "bad" : "warn"} data-identifier="">
        {words}
      </Badge>
    )
  }
  return (
    <Badge asChild variant="outline" data-tone="bad" data-identifier="">
      <Link to={glossaryHref("reason", info.registered)}>{words}</Link>
    </Badge>
  )
}
