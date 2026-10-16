// A reason code as a chip (STYLE.md 6, Chips): the code as the trace wrote it and the rule the
// contract's registry gives it. A code outside the registry is shown as itself and said to be so;
// it never gets a rule (AGENTS.md, "Never invent vocabulary").

import { reasonInfo } from "../../lib/reasons"
import { Badge } from "../ui/badge"

export function ReasonChip({ code }: { readonly code: string }) {
  const info = reasonInfo(code)
  return (
    <Badge variant="outline" data-tone={info ? "bad" : "warn"} data-identifier="">
      <span>{code}</span>{" "}
      <span data-slot="chip-detail">· {info ? info.rule : "not in the contract"}</span>
    </Badge>
  )
}
