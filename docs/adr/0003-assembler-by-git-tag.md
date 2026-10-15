# ADR-0003: The TypeScript assembler is a git dependency pinned to a tag

- Status: accepted; installation open (see Consequences)
- Date: 2026-10-15

## Context

Two parts of this repository run a real assembler: the demo-traffic generator, which turns snapshots into the fixture tree's traces, and the replay service (`POST /replay` in `apps/ingest`), which the sandbox calls. Neither may reimplement assembly (`AGENTS.md`, "Never assemble"). `@contextwindowarchitecture/assembler`, the TypeScript implementation, is not published to npm (checked 2026-10-15).

## Decision

`packages/demo-traffic` and `apps/ingest` depend on `@contextwindowarchitecture/assembler` as a git dependency pinned to a tag of `contextwindowarchitecture/assembler-typescript`, first `draft-release` (commit `c533e44`). A script, `scripts/pin-assembler.mjs`, written with the first package that depends on the assembler, moves the pin and records the tag and commit in the project profile. When the package is published to npm, the dependency moves to an exact npm version.

The assembler is never a dependency of `apps/web`. It compiles its schemas with Ajv at import, which needs `eval`, and the web app's Content Security Policy forbids it.

The pinned assembler and the vendored contract must agree. A test in the generator checks that the assembler reproduces every vendored conformance case's expected trace and payload, so a pin that drifts from the contract fails CI. At the time of writing they agree: the tag was built against specification commit `c252494`, and the vendored copy (`16de4be`) differs from it only in `implementations/`.

## Consequences

- Fixture traces and replays come from the same code the assembler's own conformance run uses.
- The sandbox proves what the TypeScript assembler does. When an event came from another language's service, a matching hash is a cross-implementation check, and a mismatch says one of the two is non-conformant, not which.
- **Open: the tag cannot be installed as it stands.** The package exports `dist/`, `dist/` is git-ignored in `assembler-typescript`, and the package has no `prepare` script, so a git install has no entry point. This has to be resolved before DP-1's generator runs the assembler: a `prepare` script in `assembler-typescript` (with the build allowed in this workspace), a release artifact the dependency can point at, or npm publication. That is an ask of the assembler's repository, made there.
