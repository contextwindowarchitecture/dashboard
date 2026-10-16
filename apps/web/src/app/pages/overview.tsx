import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { Overview } from "../../features/overview/components/overview"

export function OverviewPage() {
  return (
    <DashboardPage
      kicker="Observe"
      title="Overview"
      lede="What the assemblers decided in this window: how often they assembled, refused and rejected, what they kept out, and where the seven failure modes showed."
    >
      <Overview />
    </DashboardPage>
  )
}
