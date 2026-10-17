import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { ConflictsView } from "../../features/conflicts/components/conflicts-view"

export function ConflictsPage() {
  return (
    <DashboardPage
      kicker="Observe"
      title="Conflicts"
      lede="Where the assemblers resolved one item against another in the current window: a conflict lost or deferred, an observation superseded, a duplicate dropped; and, for one event, how its items hang together."
    >
      <ConflictsView />
    </DashboardPage>
  )
}
