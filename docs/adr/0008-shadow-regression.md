# ADR-0008: Shadow regression replays a frozen corpus twice, through one assembler

- Status: accepted
- Date: 2026-10-17

## Context

A change to a route policy or a placement profile can make the assemblers refuse calls they used to answer, shed more content, or place it differently. The dashboard can show that before the change ships: replay the snapshots real calls froze, once as they were and once with the candidate, and compare. The plan names it shadow regression (dashboard-plan.md DP-12), with a gate that fails a pull request over a threshold. The dashboard never assembles; replays run in the ingest service through the pinned TypeScript assembler (ADR-0005).

## Decision

- **A candidate** is a route policy, a placement profile, or both, in the contract's own JSON. It replaces the snapshot's `route_policy` or `profile`. A profile binds a route and a route policy version (R-20), so a candidate policy of a new version needs a profile bound to it; whatever the assembler refuses is reported per event with its problems, never skipped silently.
- **Both sides are replayed through the same pinned assembler**: the snapshot as stored, and the snapshot with the candidate. Comparing a replay with the recorded trace would mix a difference between implementations into the candidate's effect; the baseline's parity with the recorded payload hash is reported beside it.
- **Only a full event is replayed.** A redacted body is not the body assembled, and a rejected snapshot has no decision to compare; both are counted as skipped, with why.
- **A corpus is a named, frozen list of events** with their snapshot digests, so a check replays the same snapshots each time. Freezing one is a write (`POST /corpora`, the ingest token); both stores keep corpora, the PostgreSQL store in a table of migration 4.
- **The report** (`shadow-report v1`) counts the events replayed, skipped, changed; refusals added and removed; the change in shedding (`over_budget` exclusions); placement changes (the included items, in order); and lists each changed event's before and after.
- **`POST /shadow` takes no token**, like `POST /replay`: it reads nothing private and writes nothing. It is bounded for a public deployment: a corpus of at most 200 events, one run at a time (503 otherwise), each replay under the runner's timeout.
- **The gate** is `deploy/shadow-check.mjs`, which runs a candidate against a corpus on a dashboard and exits 1 over its thresholds (refusals added, shedding increase; both 0 by default), and a composite GitHub Action in this repository that runs it. A policy repository references the Action at a pinned commit; there is no policy repository yet, so it lives here.

## Consequences

- A check's verdict depends on the dashboard's assembler version, which the report names; moving the pin can change a verdict, as it should.
- A corpus freezes ids, not snapshots: deleting an event from the store makes a later run report it as missing.
- The cap keeps a public demo responsive; a deployment that needs larger corpora raises it in configuration.

## Left open

Candidate tokenizers and renderers, a scheduled shadow of every registry change, and keeping reports.
