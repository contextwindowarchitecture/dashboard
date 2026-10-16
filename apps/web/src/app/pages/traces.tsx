import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { TraceStream } from "../../features/traces/components/trace-stream"

export function TracesPage() {
  return (
    <DashboardPage
      kicker="Observe"
      title="Trace stream"
      lede="Every assembly the services recorded, newest first: what each one admitted, compressed, excluded or refused, and why."
    >
      <TraceStream />
    </DashboardPage>
  )
}
