# Envelope conformance fixtures

What a wrapper around a conformant CWA assembler must emit, so that wrappers in every language agree on every digest, count, payload part and redacted form. `docs/otel-semantic-conventions.md` defines the rules; these files are the cases.

Each directory is one vendored case of the specification (`recording.json` names it, under `packages/contract/vendor/cwa/`):

| File | Holds |
| --- | --- |
| `recording.json` | The envelope's inputs: the case, the event id, the recording time, the service, the session, the trace id to pass the assembler, and the scrubber's declared terms for `pii_scrubbed` |
| `full.json`, `pii_scrubbed.json`, `digest_only.json` | The assembly event the wrapper emits for the case's `snapshot.json` in that redaction mode |

A wrapper passes when, for every directory and mode, it assembles the case's snapshot with the recording's inputs and emits an event equal to the file, ignoring two measurements: `timings_ms.total` (the files hold 0) and the trace's own `timings` (the files leave it out). The cases span the three published renderers, an assembly, a refusal and a rejection, variants, and candidate bodies that are malformed or not strings.

The demo-traffic generator's wrapper (`packages/demo-traffic/src/wrapper.ts`) wrote them and is the first to pass them: `node packages/demo-traffic/src/envelope-fixtures.ts --check`. The `pii_scrubbed` scrubber replaces e-mail addresses with `[email]` and each declared term, longest first, with `[name]`; a wrapper with a different scrubber reproduces every other field, and `content_sha256` and `token_counts` always describe the original body.
