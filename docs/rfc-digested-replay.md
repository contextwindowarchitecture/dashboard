# RFC-D1 · Digested replay

- Status: preserved proposal for the CWA specification (`contextwindowarchitecture/contextwindowarchitecture`); not a requirement. The specification assigns a number if it is taken up. The prototype that preceded this repository called it "R-25"; R-25 is already the specification's supersession requirement (ADR-0004).
- Date: 2026-10-15

## Problem

A deployment that records its traffic under `digest_only` keeps no bodies: each candidate's body becomes its SHA-256 and its token count before the event leaves the process (`docs/otel-semantic-conventions.md`, Redaction). That is the point of the mode, and it also means the dashboard's sandbox cannot replay such an event, and Phase 2's shadow regression cannot run a candidate policy over that history. `assemble()` takes a snapshot with bodies.

The prototype proposed a `trace_only` assembly: a snapshot whose candidates carry a digest and precomputed token counts instead of bodies, assembled to a trace with no payload. Its premise was that every stage before rendering depends only on metadata, digests and counts. Against the published contract that premise does not hold, and this document records why, so the proposal can be judged on what it would actually take.

## What the published contract needs from a body

| Where | What it reads | Why a digest and a raw count are not enough |
| --- | --- | --- |
| Admission (R-2) | that `body` is present and a string | Answerable from the digested form, if the form says what the original's type was |
| Exact deduplication (R-24) | each body with whitespace runs collapsed and the ends trimmed | Two bodies that differ only in whitespace are duplicates; a digest of the raw text says they differ. A digest of the normalised text would be needed |
| Item caps (`token_budget`, R-16) | the tokens of the item's rendered body in each occurrence | Rendered means escaped where the renderer escapes (`fixture-xml/v1`, and the user message of the message renderers), so the count depends on the renderer and on the wrap of each placement, not only on the text |
| Fitting (R-16, R-17) | whether the payload fits: the tokenizer's count of the whole rendered text | A tokenizer need not count a whole as the sum of its parts; `estimate-utf8/v1` does not (the conformance README says so of `cwa-message-blocks/v1`). Per-item counts cannot reproduce the payload's count, so they cannot reproduce what is shed |
| The snapshot digest (R-22, R-23) | the RFC 8785 serialization of the snapshot, bodies included | A digested snapshot has another digest, so a replay's `context.snapshot_digest` cannot be compared with the recorded one unless the digest is redefined over digests |
| The trace's result (R-21) | the payload's token count and hash | With no payload there is no hash; the trace schema would need a result for a trace-only assembly |

## What a proposal would have to specify

1. **A digested candidate.** A candidate or variant may carry, in place of `body`: the original's type; `content_sha256` of the original; a digest of the body normalised as R-24 normalises it; and, for the snapshot's tokenizer and renderer, the token count of the rendered body under each wrap the profile uses.
2. **Which tokenizers allow it.** Fitting is reproducible from parts only under a tokenizer whose count of a whole is the sum of its counts of the parts, plus the counts of the renderer's own text. The specification would either restrict trace-only assembly to such tokenizers, or have the wrapper record the counts fitting needs for every candidate reduction it could make, which grows with the snapshot.
3. **A digest that survives digestion.** A snapshot digest computed over candidates' digests, so a trace-only replay can be matched with the recorded assembly (R-23).
4. **A trace for no payload.** What `result` holds when nothing was rendered, and how a reader tells a trace-only trace from a refusal.
5. **Conformance cases.** Digested twins of existing cases whose traces equal the originals' in every decision.

## What this repository does meanwhile

- The envelope's `digest_only` form, `{redacted, content_sha256, token_counts}`, is the wrapper's, not this proposal's: it is enough to audit an event, not to replay it.
- The sandbox says a `digest_only` event cannot be replayed, and why, and links here.
- Phase 2's content-addressed vault (decision D8) is the practical path: a route may deposit original bodies by `content_sha256` in an access-controlled store, and replay resolves them for a reader the policy allows. That replays with the published contract as it is.

If the specification takes this up, the envelope's digested form is replaced by the specification's digested candidate, and the sandbox gains trace-only replay through a re-vendored contract and a re-pinned assembler.
