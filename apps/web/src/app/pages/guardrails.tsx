import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { GuardrailsList } from "../../features/guardrails/components/guardrails-view"

export function GuardrailsPage() {
  return (
    <DashboardPage
      kicker="Guardrails"
      title="Guardrails"
      lede="Seven ways a context window fails in production, each with the decisions an assembler records when it prevents one, counted in this window, and what a count cannot show."
    >
      <GuardrailsList />
    </DashboardPage>
  )
}
