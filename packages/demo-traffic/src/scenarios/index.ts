// The authored scenarios, in the order the generator records them.

import type { Scenario } from "./build.ts"
import { fixtureRoute } from "./fixture-route.ts"
import { refundSession } from "./refund-session.ts"

export const SCENARIOS: readonly Scenario[] = [refundSession, fixtureRoute]
