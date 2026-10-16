import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { FleetView } from "../../features/fleet/components/fleet-view"

export function FleetPage() {
  return (
    <DashboardPage
      kicker="Fleet"
      title="Fleet"
      lede="Every implementation's published conformance run and every service's assembler, against the contract the dashboard's lock pins, with the latency each service's wrapper measured."
    >
      <FleetView />
    </DashboardPage>
  )
}
