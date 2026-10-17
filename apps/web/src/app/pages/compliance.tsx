import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { ComplianceView } from "../../features/compliance/components/compliance-view"

export function CompliancePage() {
  return (
    <DashboardPage
      kicker="Replay"
      title="Compliance"
      lede="A signed bundle for one event: the event, the contract it ran against, its implementation's published conformance run, and a replay of its snapshot, with what each proves and what it does not, to be checked without the dashboard."
    >
      <ComplianceView />
    </DashboardPage>
  )
}
