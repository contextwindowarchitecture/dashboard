# RFC-D2 · Rendered occurrence digests in the trace

- Status: draft proposal for the CWA specification (`contextwindowarchitecture/contextwindowarchitecture`), written from this repository; not a requirement. The specification assigns it a number and a requirement if it is taken up.
- Date: 2026-10-15
- Proposes: one field on every row of a trace's `included[]`.

## Problem

Placement decides how much of one call's payload the next call repeats, which is what provider prompt caches reuse. The specification already says so: section 5 ties placement to prompt caches, and section 6.1's "Cache reuse" test (R-7) asks that two consecutive turns of a frozen conversation under a cache-ordered profile render the same leading bytes through the last turn the earlier call held. The conformance README adds that `cwa-message-blocks/v1` gives one entry per occurrence so that a cache breakpoint marked on one call still exists on the next.

Nothing outside an assembler can observe this. A trace says which occurrences were placed and their token counts, but not what was rendered. To tell whether turn 4 kept turn 3's leading content, something must know where each occurrence's rendering lies in the payload, and that is the renderer's knowledge. A wrapper that recovers it reimplements the renderer, in each of four languages, and can disagree with it.

Byte ranges of the payload, the obvious answer, do not work for every published renderer. `cwa-messages/v1` writes the RFC 8785 serialization of `{"system", "tools", "messages"}`, and RFC 8785 sorts members, so the payload's bytes run `messages`, `system`, `tools`: its leading bytes are the user message, history and query included, not the system text a provider would cache first. A range would also cut through JSON escapes.

The dashboard (`contextwindowarchitecture/dashboard`) meets this as its session page's "prefix stability" and its guardrail for redundant re-reading (failure mode 06), and cannot show either today.

## Proposal

Every row of `included[]` gains:

| Field | Type | Meaning |
| --- | --- | --- |
| `rendered_sha256` | string, lowercase hex, 64 characters | The SHA-256 of the UTF-8 bytes of this occurrence's rendered text, exactly as the renderer emits it |

An occurrence's rendered text, for each published renderer:

- `fixture-xml/v1`: the element `<{tag} id="{id}">\n{body}\n</{tag}>\n`, with its escaping and, for a member of a surfaced conflict group, its `conflict` attribute.
- `cwa-messages/v1`: for an occurrence placed with wrap `system` or `tools`, its entry's `text`, conflict mark included; for one placed with an `xml:` wrap, the element as it is written into the user message's `content`, `speaker` attribute included.
- `cwa-message-blocks/v1`: the entry's `text`, which is the same string.

A future renderer defines its occurrences' rendered text alongside its rendering. Each repeated occurrence of an item has its own row and its own digest, as it has its own tokens.

## What it makes possible

From two consecutive traces alone, with no payload and no renderer:

- **Reuse through the leading run.** Walk both traces' `included[]` in order (placement order, and the renderer's order within a placement, as the conformance README fixes it) and compare `(slot, item_id, rendered_sha256)`. The rows they share from the start are the content the later call repeats. When history grows, the earlier turns stay identical rows and the run ends at the first new turn, which is the behaviour the Cache reuse test asks for.
- **Where reuse broke.** The first row that differs names the slot and item that changed: a refreshed state item, a new tool result, a re-ranked chunk.
- **The same answer in every language.** The digest is part of the trace, so the conformance cases fix it, and an implementation that renders a byte differently fails a case instead of reporting a different stability.

## Properties

- **Deterministic.** Rendering is deterministic (R-23), so the digest is too, and an expected trace can hold it. It is compared like every other field when a case is run.
- **No new disclosure in practice.** The rendered text is the body plus the renderer's wrapping, already in the payload the trace's `result.hash` covers. A digest of a short, guessable body can be confirmed by guessing; a deployment that withholds bodies already faces that with any digest it keeps, and the trace is the assembler's record, not a redaction layer.
- **Small.** One 64-character string per included occurrence.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Byte ranges of each placement in the payload | Under `cwa-messages/v1` the payload's member order is not request order, and ranges cut through JSON escapes |
| One digest per placement | A growing history changes its placement's digest every turn, hiding the reuse of the earlier turns |
| A prefix hash in the trace | Needs the specification to choose where "static" ends, which is a deployment's or a provider's question, not the assembler's |
| The wrapper keeps the previous payload and compares | Puts session state in every wrapper, says how many bytes matched but not where content changed, and is still blind to member order |
| The wrapper re-renders to find boundaries | Reimplements the renderers in every language |

## Cost

- `schema/trace.schema.json`: one required property on `included[]` items.
- Every case's `expected.trace.json`: one digest per included row, written by the generators, which already produce the expected payload bytes and so the rendered text.
- Each of the four assemblers: compute the digest when rendering and emit it, then re-run conformance.

## For the dashboard, if adopted

Session prefix stability and guardrail 06 are computed from consecutive traces, by the generator or the ingest service, and the session page shows how many leading occurrences each turn kept and which one changed. The telemetry envelope's `prefix` field, which no wrapper can fill correctly today, would be removed before the envelope's v1 is first published, and nothing in a wrapper needs to know about rendering. Until then, demo events carry no prefix and the dashboard shows prefix stability as "Not available".

## Open questions

- The name: `rendered_sha256`, or `text_sha256` to match the renderers' wording.
- Whether to add `rendered_bytes`, so that a reader can weigh a stable run by size rather than by count.
- Whether the Cache reuse test should become a published case pair (two consecutive frozen turns) that checks the shared run through the traces.
