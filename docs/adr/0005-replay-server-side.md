# ADR-0005: The sandbox replays on the server, with the real assembler

- Status: accepted
- Date: 2026-10-15

## Context

The sandbox replays a snapshot to show what the assembler decides when a control changes, and checks a replay's payload hash against the one an event recorded (R-23). The dashboard never assembles (`AGENTS.md`, "Never assemble"), so the replay must run a real assembler: the TypeScript one this repository builds (ADR-0003).

That assembler compiles its schemas with Ajv when it is imported, which needs `eval`. The web app's Content Security Policy is `script-src 'self'` with no `unsafe-eval`, and it does not loosen.

## Decision

Replay runs on the server, in `apps/ingest`, the Phase 1 Node service (D9, D12):

- `POST /replay` takes a snapshot as JSON and returns the trace, the payload's SHA-256 and size, and the snapshot digest the trace records. A snapshot the checks reject returns its problems (400), and a tokenizer or renderer the assembler does not provide is named apart from a rejection (422, R-16).
- `GET /replay/components` lists the published tokenizers and renderers, whether each is required, and whether this assembler provides it, from the contract's generated `COMPONENTS`.
- `assemble()` is synchronous, so a replay that runs long cannot be interrupted where it runs. Each replay runs in a worker thread, one at a time; on a timeout the worker is terminated, the request gets 504, and the next replay starts in a fresh worker.
- Bodies are size-limited (413) and the queue is bounded (503). The service is stateless and writes nothing for a replay.
- The service is built on Node's own `http`, with no framework.
- The web app reaches it through the API base in `config.json`, a path that nginx proxies (`/api/`), so `connect-src` stays `'self'`.

## Consequences

- The browser never loads the assembler, and the CSP never loosens.
- A replay is a round trip, so the sandbox needs the service running. Without an API base it says the service is not configured; when the service does not answer it says that.
- The sandbox proves what the TypeScript assembler does. For an event another language's service recorded, a matching hash is the cross-implementation check R-23 promises, and a mismatch says one of the two is non-conformant, not which.

## Left open

A replay in the browser, in a worker, stays possible. It would need either a CSP header for the worker's own script that allows `eval`, or an assembler option that takes precompiled validators (a request to `assembler-typescript`, dashboard-plan.md section 13). Neither is needed for Phase 1, and the decision is taken when a browser replay is wanted.
