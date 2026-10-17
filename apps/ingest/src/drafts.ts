// Drafts of route policies and profiles (ADR-0013), kept per author: the PostgreSQL store keeps them
// (migration 8), found by author and id, so one author never reaches another's.

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
  /** The author's drafts, the latest first. */
  list(author: string): Promise<DraftSummary[]>
  get(author: string, id: string): Promise<DraftV1 | undefined>
  /** Keeps the draft; "taken" when the id is another author's. */
  put(author: string, draft: DraftV1): Promise<"saved" | "taken">
  /** Removes the author's draft; false when they have none of that id. */
  delete(author: string, id: string): Promise<boolean>
}
