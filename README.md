# CWA dashboard

The observability and audit plane for [Context Window Architecture](https://github.com/contextwindowarchitecture/contextwindowarchitecture) (CWA) assemblies. An application wraps a conformant assembler in a thin telemetry layer that emits, for every `assemble()` call, the frozen snapshot and the trace the assembler returned. The dashboard reads those events and shows what the assembler decided: what was admitted, compressed, excluded and why, what was refused and why, how a session's budget moved turn by turn, which route policies and placement profiles were in force, and whether every service in a fleet runs the same contract.

It is not an assembler, not a gateway and not a policy store. It never decides what goes into a context window.

## Status

Phase 1 is built (DP-0 to DP-7 of the working plan), and so is Phase 2 (DP-8 to DP-14): events can be kept in PostgreSQL as well as the tree (`docs/adr/0007-store-and-query-api.md`), and the stream pages back through the closed days. Over the committed demo traffic (`packages/demo-traffic/fixtures`, produced by the real TypeScript assembler and labelled `demo`), the web app shows:

- the overview and the trace stream, and each event in the trace inspector, with the stage walk; for a route opted into the vault, the operator resolves a redacted body with the operator token, shown only when its bytes are the ones the event digests (`docs/adr/0009-body-vault.md`);
- the sessions, each with its turn timeline, turn detail and the played session;
- the registry's route policies and profiles, and the events that ran them pinned, drifted or unregistered;
- the fleet: every implementation's conformance run, the services, their contract and latency;
- the sources: what each producer sent in the current window and what became of it, admitted, compressed or excluded by reason, each reason linked to the stream;
- the conflicts: the window's events that resolved one item against another, counted by code, and for one event the forest of what each excluded item lost to, was superseded by or duplicated;
- FinOps: per route, the input tokens the window's assembled events took and what compression saved, priced only where `config.json` sets `prices` (otherwise every money figure reads Not available);
- compliance: a bundle for one event, signed by the ingest service (the event, its contract beside the dashboard's lock, its implementation's published conformance run, and a replay of its snapshot with what it proves), checked offline with `deploy/verify-bundle.mjs`;
- shadow: a frozen corpus of recorded events replayed twice through the pinned assembler on the ingest service, as recorded and with a candidate route policy or profile, and every assembly that changes listed with both sides (`docs/adr/0008-shadow-regression.md`); the same run gates a pull request (`deploy/shadow-check.mjs`);
- the seven guardrails, each with its codes counted and linked to the stream;
- the sandbox, which replays an event or a snapshot of your own through the real TypeScript assembler on the replay service (`apps/ingest`), with its controls, its parity with what the event recorded, and the trace diff;
- sign-in, where the service has an OpenID Connect issuer configured (`docs/adr/0010-sign-in.md`): the masthead names the signed-in reader and signs them out; and roles, where the service has an access file (`docs/adr/0011-roles.md`): a page the reader's roles do not reach says so, or offers sign-in, and a body withheld from them is named as withheld, its metadata in view; and tenants (`docs/adr/0012-tenants.md`): a page reads one tenant at a time, chosen in the masthead (in the sheet on a phone) and kept in `?tenant=`, and a route's owner resolves a vaulted body signed in;
- authoring, for a signed-in route owner (`docs/adr/0013-authoring.md`): a route policy or a profile drafted from a registry entry, field by field as the contract names them or as JSON, checked by the contract's validators with every change in view, kept in the service under the author's name, and previewed by the pinned assembler (an event of the route replayed with the draft, a frozen corpus shadowed with it);
- the glossary, the telemetry page and the about page.

The ingest service also takes events (`POST /events`, with a bearer token) into the tree the app reads. A service sends them with the TypeScript telemetry wrapper, `@contextwindowarchitecture/telemetry` in [toolkit](https://github.com/contextwindowarchitecture/toolkit) (`telemetry/typescript`, not yet published), which wraps `assemble()`, records each call as an event with an OpenTelemetry span beside it, and holds itself to this repository's envelope fixtures; wrappers in the other languages follow when a service needs one. Run it all with `pnpm install` and `pnpm dev`, or as containers with `podman compose up --build`; `deploy/README.md` covers both and the cluster. The three illustrations are deferred (`docs/adr/0006-illustrations-deferred.md`).

The app is held to its performance budgets over a generated tree of 50,000 events (`pnpm --filter web test:perf`: a filter change on the stream's 20,000 rows within 100 ms, a 200-item replay within 500 ms) and to its bundle budgets (`pnpm --filter web budgets`). Its browser tests check every page type in both themes from 375 to 1440px with no sideways scroll, axe at WCAG 2.2 AA, the keyboard, focus restoration and forced colours. No screen reader run has been done yet.

## Working here

Read [`AGENTS.md`](AGENTS.md) before changing anything: it holds the rules (test-first, real fixtures, the contract as the only vocabulary), the commands and the commit conventions. [`STYLE.md`](STYLE.md) is the visual language, the CWA website's style guide applied to this app.

## License

Apache License 2.0: see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). The vendored specification files and the assembler this repository builds keep their own notices.
