import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { FinopsView } from "../../features/finops/components/finops-view"

export function FinopsPage() {
  return (
    <DashboardPage
      kicker="Observe"
      title="FinOps"
      lede="What the current window's assemblies took in input tokens and what compression saved, per route, priced only where the deployment's configuration says what a route's tokens cost."
    >
      <FinopsView />
    </DashboardPage>
  )
}
