# ADR-0007: Events in PostgreSQL, served as the tree's documents

- Status: accepted
- Date: 2026-10-17

## Context

Phase 1 keeps every event in a static tree (ADR-0001): one file per event, a session file per conversation, the fleet report, and an index of the current window, the newest 24 hours or 20,000 events, with older rows closed into one index per UTC day. It needs no infrastructure, but its writer is a single process holding a lock over files, and a busy service outgrows it. Phase 2 puts the events in a database (dashboard-plan.md, P2-D3: PostgreSQL first, behind an interface other stores can implement) and lets the stream reach events past the window.

The web app reads four kinds of document through one `EventSource` (ADR-0001): the index, an event, a session and the fleet report, each validated at the boundary against its schema.

## Decision

- **One interface, two stores.** `apps/ingest` gains an `EventStore`: `write(event)`, and `index()`, `window(day)`, `event(id)`, `session(id)` and `fleet()`, each returning the document the tree holds at the same place. The tree store is Phase 1's writer with readers added; the PostgreSQL store keeps events in one table (the event as `jsonb`, its id, recording time, session and turn as columns) and derives every document on read with `@cwa-dashboard/telemetry`'s derivations, the same functions the generator and the tree store use. One contract-test suite runs against both, and loading the demo fixtures into each must give the same documents.
- **The API serves the tree's documents at the tree's paths.** `GET /data/events/index.json`, `/data/events/index/<day>.json`, `/data/events/<id>.json`, `/data/sessions/<id>.json` and `/data/fleet.json`, under the API base (`/api/data/…` behind nginx). The web app reads them with the source it has, `dataRoot` set to `/api/data`; there is no second source, and `"source": "http"` is not needed.
- **Paging past the window is by closed day**, over either store: the index lists the closed days (`windows`), and the stream offers them. A day is one document; a cursor over a day larger than the window waits for a measurement that needs it.
- **The fleet report is derived where the events are.** Its builder moves from the generator into `@cwa-dashboard/telemetry`, with the implementation reports, the contract lock and the assembler's tables passed in, so the generator, the tree store and the PostgreSQL store build it the same way.
- **The client is `pg`** (node-postgres) against a PostgreSQL server, chosen by `DATABASE_URL`. Tests, and a local run without a server, use **PGlite**, PostgreSQL compiled to WebAssembly, through the same `query(text, params)` the store needs (`DATABASE_URL=pglite:memory` or `pglite:<directory>`). Without `DATABASE_URL` the service keeps the tree.
- **The service keeps its name.** P2-D7 proposed renaming `apps/ingest` to `apps/api`; the name is in the image, the Deployment, compose and the docs, and a rename changes no behaviour, so it stays.

## Consequences

- Every page renders the same over either store, by construction and by test; a deployment switches with `DATABASE_URL` and `dataRoot`.
- Documents are derived on each read, so a read costs a query and a derivation where the tree cost a file. The window caps the index; a session and the fleet report are derived from their events. Caching (`Cache-Control` as nginx sets it for the tree) keeps an event immutable to the browser.
- PGlite makes the store's tests real PostgreSQL without a container; the compose stack and the cluster run a PostgreSQL server, and the contract suite also runs against one when `TEST_DATABASE_URL` names it.

## Left open

Server-side filtering and a cursor across days, a materialised index for very large windows, retention, and other stores (ClickHouse among them) behind the same interface. Each waits for a measurement or a service that needs it.
