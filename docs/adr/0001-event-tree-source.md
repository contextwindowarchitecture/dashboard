# ADR-0001: Phase 1 reads a static event tree

- Status: accepted
- Date: 2026-10-15

## Context

The dashboard reads assembly events: for each `assemble()` call, the frozen snapshot and the trace inside this repository's telemetry envelope. Those events have to live somewhere the web app can read. The full design (a query API over ClickHouse, fed by an OpenTelemetry collector and four language wrappers) is a programme of its own. The web app should be useful before any of it exists, and adopters should be able to try it with no infrastructure.

## Decision

In Phase 1 the web app reads a static **event tree**: `index.json`, one file per event, one file per session, and a fleet report. It is served from a volume by nginx in a deployment and by a Vite plugin in development. Every read goes through an `EventSource` interface (`index()`, `event(id)`, `session(id)`, `fleet()`), and the file source is its first implementation.

The tree is written by the demo-traffic generator, and by the Phase 1 ingest service (`apps/ingest`, `POST /events`), which validates each event, writes it and rebuilds the index. The web app never derives an index from a directory listing.

`index.json` holds the current window: the newest 24 hours or the newest 20,000 events, whichever is smaller. Older windows close into `index/<day>.json` and are listed in `index.json`, so the index does not grow without bound.

The query API, ClickHouse, the collector and the wrappers are Phase 2. They arrive as a second `EventSource` implementation over HTTP, behind the same interface.

## Consequences

- Every page is testable from a fixture tree on disk, through a filesystem-backed `fetch`.
- Trying the dashboard needs no database, queue or collector: a volume of JSON files is enough.
- The file index suits demo traffic and audits of exported windows, not a busy production stream. Features that only a database can serve (cross-window search, facets beyond counts) wait for Phase 2's API rather than being built on the file index and thrown away.
- Events, sessions and the fleet report are immutable once written and can be cached indefinitely; the index is not, and is polled.
