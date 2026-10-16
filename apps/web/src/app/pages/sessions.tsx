import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { SessionsList } from "../../features/sessions/components/sessions-list"

export function SessionsPage() {
  return (
    <DashboardPage
      kicker="Observe"
      title="Sessions"
      lede="Conversations turn by turn, as the wrappers grouped them: how each turn spent its budget, and where the first compression, budget omission or refusal came."
    >
      <SessionsList />
    </DashboardPage>
  )
}
