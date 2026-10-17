// The shadow page's route module, loaded lazily: the report validator and the candidate's registry
// choices are in this chunk only.

import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { ShadowView } from "../../features/shadow/components/shadow-view"

export function Component() {
  return (
    <DashboardPage
      kicker="Replay"
      title="Shadow"
      lede="What a changed route policy or profile would do to a frozen corpus of recorded events: each replayed twice through the pinned assembler, as recorded and with the candidate, and every assembly that changes listed with both sides."
    >
      <ShadowView />
    </DashboardPage>
  )
}
