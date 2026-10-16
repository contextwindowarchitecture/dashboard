// The authored scenarios, in the order the generator records them.

import { annualReport } from "./annual-report.ts"
import { billingFacts } from "./billing-facts.ts"
import type { Scenario } from "./build.ts"
import { clinicalIntake } from "./clinical-intake.ts"
import { contractReview } from "./contract-review.ts"
import { extractionOverflow } from "./extraction-overflow.ts"
import { fixtureRoute } from "./fixture-route.ts"
import { knowledgeFlood } from "./knowledge-flood.ts"
import { policyDesk } from "./policy-desk.ts"
import { prReview } from "./pr-review.ts"
import { refundSession } from "./refund-session.ts"

export const SCENARIOS: readonly Scenario[] = [
  refundSession,
  clinicalIntake,
  prReview,
  billingFacts,
  knowledgeFlood,
  policyDesk,
  extractionOverflow,
  contractReview,
  annualReport,
  fixtureRoute,
]
