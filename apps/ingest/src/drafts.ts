// Drafts of route policies and profiles (ADR-0013), kept per author: the PostgreSQL store keeps them
// (migrations 8 and 9), found by author, tenant and id, so one author never reaches another's and a
// draft is found only in its own tenant (ADR-0012).

import type { DraftV1 } from "@cwa-dashboard/telemetry/types"

export const DRAFT_ID = /^[a-z0-9][a-z0-9-]{7,63}$/

export interface DraftSummary {
  readonly id: string
  readonly kind: DraftV1["kind"]
  readonly route: string
  readonly started_from: DraftV1["started_from"]
  readonly updated_at: string
}

export interface DraftStore {
  /** The author's drafts in the tenant, the latest first. */
  list(author: string, tenant: string): Promise<DraftSummary[]>
  get(author: string, tenant: string, id: string): Promise<DraftV1 | undefined>
  /** Keeps the draft; "taken" when the id is another author's, or the author's in another tenant. */
  put(author: string, tenant: string, draft: DraftV1): Promise<"saved" | "taken">
  /** Removes the author's draft in the tenant; false when they have none of that id there. */
  delete(author: string, tenant: string, id: string): Promise<boolean>
}
