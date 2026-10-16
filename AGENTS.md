# Working in contextwindowarchitecture/dashboard

Guidance for anyone, human or agent, working in this repository.

## What this is

The observability and audit plane for Context Window Architecture (CWA) assemblies. Applications wrap a conformant assembler (`assembler-python`, `assembler-typescript`, `assembler-go`, `assembler-rust`) in a thin telemetry layer that emits, for every `assemble()` call, the frozen `Snapshot` and the `Trace` the assembler returned, inside an envelope this repository defines. The dashboard reads those events and shows what the assembler decided: what was admitted, compressed, excluded and why, what was refused and why, how a session's budget moved turn by turn, which route policies and placement profiles were in force, and whether every service in a fleet runs the same contract. It is not an assembler, not a gateway and not a policy store: it never decides what goes into a context window, and in Phase 1 it writes nothing but the events it is given.

Status: Phase 1 in progress. The contract, the telemetry envelope, the demo traffic and the web app's overview, stream, inspector, sessions, registry, fleet and guardrails pages are built (DP-0 to DP-4); the sandbox, the ingest service and the deployment are not. The working plan is `docs/plans/dashboard-plan.md` (local, git-ignored: read it first, update it as phases land, never commit it). Its section 0 holds the decisions taken on 2026-10-15 (D1 to D12) and the two added requirements, R-DASH-1 (item metadata is always visible) and R-DASH-2 (redaction is switchable outside the dashboard, and the dashboard names the switch). The first phase is DP-0 in its section 12.

| Path | What |
| --- | --- |
| `STYLE.md` | The visual language: the CWA website's style guide applied to this app. Read it before any UI work; its checklist (section 11) applies to every page, and `pnpm test` checks what it can |
| `docs/plans/dashboard-plan.md` | The working plan: readers, the contract as published, the telemetry envelope, the fixtures, the stack, the pages, the data layer, the test rules, the phases with their checklists and "as built" records, the risks and the devil's advocate. Local, never committed |
| `docs/design/project-profile.md` | The profile the plan's DP-0 fills in: versions, the shadcn preset, the budgets, the test commands and every deliberate deviation, each linked to an ADR |
| `docs/adr/` | Architecture decision records, one per decision the plan's section 0 names and every later one |
| `docs/otel-semantic-conventions.md` | The `gen_ai.cwa.*` span attributes mapped one to one onto the `assembly-event` fields; a test holds the two together |
| `docs/rfc-digested-replay.md` | RFC-D1: `trace_only` assembly over digested items, preserved for the specification; not a requirement |
| `packages/contract/` | The vendored contract (`vendor/cwa/`: schemas, reasons, requirements, model, slot defaults, scope, the conformance cases and rejections, the registry, the implementation reports, the examples) pinned by `vendor/cwa.lock.json`; `scripts/vendor-contract.mjs`; the generated types, standalone validators and typed contract data under `generated/`, regenerated, never edited |
| `packages/telemetry/` | This repository's own schemas, `assembly-event`, `events-index`, `session`, `fleet-report` and `digested-snapshot` at v1, their generated types and validators, and the envelope conformance fixtures every wrapper must reproduce |
| `packages/assembler/` | The TypeScript assembler at the tag `pin.json` names, built by `scripts/build.mjs` into `.build/` (git-ignored) on every install, and re-exported as `@cwa-dashboard/assembler`; its tests hold it to every vendored conformance case (ADR-0003) |
| `packages/demo-traffic/` | The fixture generator: authored scenario snapshots and the vendored conformance cases run through the real TypeScript assembler into an event tree (`fixtures/`, committed, diffed in CI). Nothing in the tree is typed by hand |
| `apps/web/` | The dashboard: Vite, React, TypeScript strict, Tailwind 4, the generated shadcn primitives, TanStack Query and Table, D3 modules for geometry, React SVG for charts, GSAP for the three choreographies and Lottie for the three illustrations `STYLE.md` 7 names, Vitest, Playwright with axe |
| `apps/ingest/` | The Phase 1 Node service: `POST /events` validates an event and writes it into the tree; `POST /replay` runs the real assembler over a snapshot for the sandbox |
| `deploy/` | The container images, the nginx configuration, the Kustomize base and the production overlay, `docker-compose.yml` for the one-command local stack, and `publish.sh` |

## Rules

- **Test-first.** Red, then green, then refactor. Write the failing test, watch it fail for the reason you expect, then make it pass. No production code without a test that needed it.
- **Prove a test protects something.** Before claiming it does, break the code on purpose and watch the test fail.
- **Commit unasked at each green step.** One behavior, or one refactor, per commit. Every commit passes the checks below.
- **Tests and docs come with the change.** A commit that changes behavior also changes the tests, and the README, the profile, this file, `STYLE.md` or the comments that describe it, in the same commit.
- **Fixtures are real.** Component, model and data tests run over `packages/demo-traffic/fixtures` through a filesystem-backed fetch; the vendored conformance cases are the assembler's oracle; nothing is mocked that a fixture can supply.
- **Every state is a test.** Each data region's loading, error, not-found, unsupported, invalid, empty, no-results and updating states; each chart's empty, single, zero, refused, over-budget and out-of-order cases.
- **Browser-only behavior is a Playwright test** with axe on every page type, no horizontal overflow at 400px, and no Content Security Policy violation.
- **Never claim a check ran unless it did.** Each phase's "as built" in the plan names the commands that passed and the ones not run.
- Use Mermaid diagrams in docs wherever a flow or structure reads faster as a picture.

## What this dashboard must never do

- **Never assemble.** No admission, conflict, fitting, rendering or refusal logic lives here. The sandbox replays through the real assembler in `apps/ingest`; the pages format what a trace and a snapshot say. If a view needs a behavior the assemblers lack, the specification changes first (in the specification repository), then the assemblers, then this app.
- **Never invent vocabulary.** Every reason code, requirement number, slot, plane, authority, trust value, tier and field name is the contract's, read from the vendored `contract/` and `schema/` files. `lib/reasons.ts` is the one place a code becomes a label; a test fails when a string outside the registry appears as one. The prototype that preceded this repository used invented codes (`ITEM_EXPIRED`, `BUDGET_SHED_DROPPABLE`, "R-25 digested envelope"); none of them may appear in `src/`.
- **Never hide item metadata.** Authority, trust, effective tier, freshness, expires, source, source version, lineage, injection risk, relevance, scope and the producer are shown for every item in every redaction mode (R-DASH-1). A redaction mode touches bodies only.
- **Never redact, scrub or reveal in the browser.** Redaction is the wrapper's per-route setting, applied before an event is emitted. The dashboard shows what the event holds, names the mode, and names the setting that would change it (R-DASH-2). It never synthesises a body, never applies a regex to one, and never pretends a digest is text.
- **Never label provenance falsely.** An event carries the language, assembler version and service that produced it. Demo traffic is labelled `demo` and is produced by the TypeScript assembler; it is never labelled as another implementation's.
- **Never show a number the app did not measure.** A count names its window and its source; a value the app cannot compute reads "Not available", never 0; latency is the wrapper's measurement and says so; cost needs a price table in configuration, never a figure in code.
- **Never let the sandbox claim more than it proves.** A replay runs the TypeScript assembler; parity with a recorded hash is a cross-implementation check, and a difference means one of the two is non-conformant, not which. A `pii_scrubbed` event replays without a parity claim; a `digest_only` event does not replay.
- **Never loosen the Content Security Policy.** `script-src 'self'`, no inline scripts, no eval: validators are generated at build, the theme script is a file, the assembler runs in Node, never in the browser.
- **Never read the assemblers' source to decide an expectation.** Expectations come from the vendored conformance cases and from a named assembler's recorded run.

## The contract and the assembler are pinned

`packages/contract/vendor/cwa/` is a copy of the specification repository's (github.com/contextwindowarchitecture/contextwindowarchitecture) `schema/`, `contract/`, `conformance/`, `implementations/` and `examples/`, pinned by SHA-256 in `vendor/cwa.lock.json`, which records the `repository` and `spec_commit` it came from. Don't edit it here. Re-vendor from a committed checkout with `pnpm vendor ../../contextwindowarchitecture`, regenerate with `pnpm generate`, and commit the lock, the copies and the generated files together as `build(contract): vendor spec <short-sha>`. `pnpm vendor:check` fails on drift between the lock, the copy and the checkout.

The TypeScript assembler is pinned to a tag of `contextwindowarchitecture/assembler-typescript` by `packages/assembler/pin.json` (repository, tag, commit), and this repository builds it (ADR-0003): `pnpm install` runs `pnpm build:assembler`, which clones the tag, fails if it no longer points at the pinned commit, installs from the assembler's own lockfile and compiles it. Move the pin by editing `pin.json` and the profile's assembler line in one commit, then run `pnpm build:assembler` and the tests: the pinned assembler must reproduce every vendored conformance case. `@cwa-dashboard/assembler` is a dependency of `packages/demo-traffic` and `apps/ingest`, never of `apps/web`.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm dev                                        # apps/web over packages/demo-traffic/fixtures, with apps/ingest beside it
pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build
pnpm vendor:check && pnpm generate --check && pnpm format:check
pnpm --filter web test:e2e                      # needs `pnpm exec playwright install chromium` once; starts apps/ingest
pnpm --filter web budgets                       # after a build: the bundle against the profile's budgets
pnpm --filter demo-traffic generate             # rebuild the fixture tree; CI fails on a diff
pnpm vendor ../../contextwindowarchitecture && pnpm generate   # move the contract pin, one commit
```

Node 24, pnpm 12, exact versions in every `package.json`; adding a package needs a line in the profile and, for a chart, animation or component library, a decision record.

## Boundaries

- Outside this repository, read only the sibling checkouts: the specification (`../../contextwindowarchitecture`), the assemblers (`../../assembler-*`), the website (`../../website`, whose `STYLE.md` this repository's `STYLE.md` follows), the assembler demo (`../../assembler-demo`) and the benchmark site (`../benchmark-ui`). They are precedents to learn from and sources to vendor from. Never modify them from here, and never copy a file from one of them into this repository as if it were this repository's: every document here is written for this project, names this project, and is maintained here.
- Results of real traffic are never committed. Demo traffic is generated into `packages/demo-traffic/fixtures/` and is the only event tree in the repository.
- Don't add packages, change generated shadcn components, or add a second chart, animation or component library without a decision record in `docs/adr/`.

## Commits

- Commit incrementally while working: one logical change per commit, with the checks passing, rather than one commit at the end. Tests come with the change. Never claim a check ran unless it did.
- Commit directly on `main`. **Never push**; the maintainer pushes.
- Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>(<scope>): <summary>`, imperative mood, summary under about 72 characters, a body that explains why.
  - Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`.
  - Scopes, as the change fits: `contract`, `telemetry`, `demo`, `web`, `shell`, `traces`, `sessions`, `registry`, `fleet`, `guardrails`, `sandbox`, `ingest`, `deploy`, `ci`, `deps`, `style`, `docs`.
  - Breaking changes (an event schema, a URL or a configuration change existing wrappers or deployments depend on): `!` after the scope, plus a `BREAKING CHANGE:` footer.
- Sign off every commit (`git commit -s`). The Developer Certificate of Origin is required, and a commit hook rejects commits without it. The person committing owns the commit: no `Co-Authored-By` trailers, and never a sentence about AI assistance or any other attribution in the message. The body explains the change and nothing else.
- Commits are GPG-signed by the global git config. Never bypass signing or hooks (`--no-gpg-sign`, `--no-verify`); if either fails, stop and ask.
- Never commit `docs/plans/`, `node_modules/`, `dist/`, real traffic, secrets, or the prototype that preceded this repository (`prototype.md`, `prototype.tsx`, kept locally to compare the concept with what gets built). Check `git status` before committing.
