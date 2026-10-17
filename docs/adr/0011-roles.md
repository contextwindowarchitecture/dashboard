# ADR-0011: The API grants roles from an access file and withholds bodies a reader may not see

- Status: accepted
- Date: 2026-10-17

## Context

Sign-in tells the API who a reader is (ADR-0010); Phase 3 decides what they may read (dashboard-plan.md P3-D3, DP-16). Every read already goes through the API, so it is the one place to enforce, and the page only reflects what it is told. Two rules of AGENTS.md shape the answer: item metadata is shown in every case (R-DASH-1), and redaction is the wrapper's setting, never the dashboard's, so an event's `redaction_mode` must keep saying what the wrapper did. The contract requires every item to have a body, and the event schema binds each redacted body form to the mode that produced it, so a reader without a route's bodies cannot be served the event with its bodies relabelled or simply gone.

## Decision

- **Roles**: `viewer` reads every event's metadata and every document derived from them (the index, the days, sessions, fleet, sources, corpora, shadow runs); `owner:<route>` also reads that route's bodies, as stored, and its compliance bundles; `owner:*` owns every route; `auditor` reads what a viewer does and every compliance bundle; `operator` reads what a viewer does (its writes come with the vault in DP-17). Every role but `viewer` implies it.
- **The access file** (`ACCESS_FILE`, JSON) grants them: `anonymous` (the roles of a reader who has not signed in), `signed_in` (of every reader who has) and `groups` (by the issuer's group names). A reader's roles are the union of everything that applies to them, `anonymous` included, so signing in never narrows what a reader sees.
- **Without an access file** the API serves every reader everything, as it did before sign-in: a tree or a deployment without sign-in changes nothing. **With one**, everything not granted is refused: a reader with no role gets 401 when not signed in and 403 when signed in, and the page says which.
- **What a role does not cover is withheld, never relabelled.** An event read by someone who does not own its route keeps its `redaction_mode` and every field but bodies; each body, and each variant body, becomes `{"withheld": "role", "content_sha256": "…"}`, the digest the conventions define (taken from a redacted body, or computed from a full one). `assembly-event` v1 gains this form as one the API may serve and a wrapper never emits. The inspector says the body is withheld for the reader's role and names the setting that would grant it (`groups` or `signed_in` with `owner:<route>` in the access file), as R-DASH-2 names the wrapper's.
- **Responses that depend on the reader are not shared.** With an access file, an event and every document the API serves answer `Cache-Control: private, no-cache` instead of `immutable`, and signing out clears the page's cached documents.
- **Unchanged by roles**: `/healthz`, `/me`, `/signing-key.pem` and `/replay/components` are public; `/replay` needs `viewer` (it reads nothing stored, but runs the assembler); `POST /events`, `/corpora` writes and `/bodies` keep their tokens.

## Consequences

- The public demo host keeps its anonymous readers' full view by granting `anonymous` `viewer` and `owner:*`; an adopter's deployment grants nothing to `anonymous` and names its owners by group.
- Every route's answer to every role is one table, tested; adding a route means adding its row.
- A role is read from the session's groups when the session is made: a change of team takes effect at the next sign-in.

## Left open

Tenants (DP-17), writes by role (corpora, erasure, the vault's resolution), and roles from the issuer's claims other than groups.
