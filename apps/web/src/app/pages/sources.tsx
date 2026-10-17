import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { SourcesView } from "../../features/sources/components/sources-view"

export function SourcesPage() {
  return (
    <DashboardPage
      kicker="Observe"
      title="Sources"
      lede="What each producer sent the assemblers in the current window, and what became of it: admitted, compressed, or excluded and why."
    >
      <SourcesView />
    </DashboardPage>
  )
}
