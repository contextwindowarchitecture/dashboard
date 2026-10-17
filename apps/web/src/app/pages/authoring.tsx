// The authoring page's route module, loaded lazily: the contract's field list, the drafts client and
// the previews are in this chunk only, and the validators load with the editor.

import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { AuthoringView } from "../../features/authoring/components/authoring-view"

export function Component() {
  return (
    <DashboardPage
      kicker="Registry"
      title="Authoring"
      lede="Draft a route policy or a profile for a route you own, checked by the contract's validators and previewed by the pinned assembler: an event of the route replayed with the draft, a frozen corpus shadowed with it. A draft is kept in the service under your name and goes nowhere until it is published."
    >
      <AuthoringView />
    </DashboardPage>
  )
}
