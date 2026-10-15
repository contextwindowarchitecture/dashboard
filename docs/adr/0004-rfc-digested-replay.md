# ADR-0004: The digested-replay proposal is RFC-D1, not "R-25"

- Status: accepted
- Date: 2026-10-15

## Context

The prototype that preceded this repository proposed a "digested candidate envelope": a `trace_only` assembly over items whose bodies are replaced by `content_sha256` and `token_counts`, so a `digest_only` event could be replayed without its bodies. It called the proposal "R-25". In the published contract, R-25 is already a requirement: route-requested supersession of stale observations (`superseded`). Using the number would make every page that cites it wrong.

## Decision

The proposal is named **RFC-D1 · digested replay** and is written up in `docs/rfc-digested-replay.md` when the telemetry envelope lands (DP-1). It proposes a requirement; the specification assigns its number if it is taken up. The dashboard never shows "R-25" for it, and never cites a requirement number the vendored `contract/requirements.json` does not hold.

## Consequences

- The dashboard's requirement chips and glossary come only from the vendored contract, so a proposal cannot appear as if it were a requirement.
- A `digest_only` event cannot be replayed in Phase 1. The sandbox says so and links RFC-D1, and Phase 2's content-addressed vault is the other way to replay one.
- If the specification adopts the proposal, the RFC document is replaced by a pointer to the requirement, and the sandbox's replay of digested events arrives through a re-vendored contract and a re-pinned assembler.
