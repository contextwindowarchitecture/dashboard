# Envelope conformance fixtures

What a wrapper around a conformant CWA assembler must emit, so that wrappers in every language agree on every digest, count, payload part and redacted form. `docs/otel-semantic-conventions.md` defines the rules; these files are the cases.

Each directory is one vendored case of the specification (`recording.json` names it, under `packages/contract/vendor/cwa/`):

| File | Holds |
| --- | --- |
| `recording.json` | The envelope's inputs: the case, the event id, the recording time, the service, the session, the trace id to pass the assembler, and the scrubber's declared terms for `pii_scrubbed` |
| `full.json`, `pii_scrubbed.json`, `digest_only.json` | The assembly event the wrapper emits for the case's `snapshot.json` in that redaction mode |
| `deposits.json` | What a route opted into the vault deposits for the snapshot, under `pii_scrubbed` or `digest_only`: every body and variant body once, in the snapshot's order, each its `sha256`, its `media_type` and its bytes as UTF-8 `text` |

A wrapper passes when, for every directory and mode, it assembles the case's snapshot with the recording's inputs and emits an event equal to the file, ignoring two measurements: `timings_ms.total` (the files hold 0) and the trace's own `timings` (the files leave it out). The cases span the three published renderers, an assembly, a refusal and a rejection, variants, and candidate bodies that are malformed or not strings.

The demo-traffic generator's wrapper (`packages/demo-traffic/src/wrapper.ts`) wrote them and is the first to pass them: `node packages/demo-traffic/src/envelope-fixtures.ts --check`. A route opted into the vault emits the mode's event with `"vault": {"base": <the configured base>}` added, and puts each deposit at `<base>/bodies/<sha256>` before it sends the event (`docs/adr/0009-body-vault.md`). The `pii_scrubbed` scrubber replaces e-mail addresses with `[email]` and each declared term, longest first, with `[name]`; a wrapper with a different scrubber reproduces every other field, and `content_sha256` and `token_counts` always describe the original body.

## Vendoring them into a wrapper's repository

A wrapper lives in its own repository and vendors these files from a committed checkout of this one, the way this repository vendors the specification (`packages/contract/vendor/cwa.lock.json`): it copies them unchanged and records, in its own lock, this repository's commit and each file's SHA-256, and its check fails on any difference. The set is:

| From this repository | Why |
| --- | --- |
| `packages/telemetry/schemas/assembly-event.v1.schema.json` | The event the wrapper emits; it refers to the specification's `snapshot` and `trace` schemas by their published `$id`s |
| `packages/telemetry/fixtures/envelope/` | The cases and the events each mode must produce |
| `docs/otel-semantic-conventions.md` | The rules: the attributes, the digests, the payload parts and the redaction modes |

Each case's `snapshot.json` and the schemas the event refers to are the specification's, at the commit `packages/contract/vendor/cwa.lock.json` pins; the wrapper vendors them from the specification repository at that commit, not from here. A move of either pin is one commit in the wrapper's repository, with the fixtures re-run.
