# ADR-0003: The TypeScript assembler is pinned to a tag and built by this repository

- Status: accepted
- Date: 2026-10-15

## Context

Two parts of this repository run a real assembler: the demo-traffic generator, which turns snapshots into the fixture tree's traces, and the replay service (`POST /replay` in `apps/ingest`), which the sandbox calls. Neither may reimplement assembly (`AGENTS.md`, "Never assemble"). `@contextwindowarchitecture/assembler`, the TypeScript implementation, is not published to npm (checked 2026-10-15).

A git dependency on a tag is not enough on its own. The package's entry point is its compiled `dist/`, which `assembler-typescript` does not commit, and the package has no `prepare` script, so installing the tag from git yields no entry point. Something has to compile it, and nothing about that needs the assembler's repository to change.

## Decision

The assembler is pinned to a tag of `contextwindowarchitecture/assembler-typescript`, first `draft-release` at commit `c533e44`, and this repository builds it:

- **One pin.** A pin file records the repository, the tag and the commit. A script moves it and records the change in the project profile.
- **One build step**, owned here. A script fetches the pinned tag into a git-ignored directory, fails when the tag no longer points at the pinned commit, installs the assembler's dependencies from its own lockfile, and compiles it with its own toolchain. The assembler's TypeScript version is its own and does not constrain this repository's.
- **Local consumers.** `packages/demo-traffic` and `apps/ingest` depend on that local build by path, never on a registry or a moving branch.
- **The same step everywhere** the assembler runs: a developer's install, CI (the generator and its conformance check), and the build stage of the ingest service's image. The deployed image carries the compiled assembler; nothing is fetched at runtime.

The assembler is never a dependency of `apps/web`. It compiles its schemas with Ajv at import, which needs `eval`, and the web app's Content Security Policy forbids it.

The pinned assembler and the vendored contract must agree. A test in the generator checks that the assembler reproduces every vendored conformance case's expected trace and payload, so a pin that drifts from the contract fails CI. At the time of writing they agree: the tag was built against specification commit `c252494`, and the vendored copy (`16de4be`) differs from it only in `implementations/`.

## Consequences

- Fixture traces and replays come from the same code the assembler's own conformance run uses, at a commit this repository names.
- The sandbox proves what the TypeScript assembler does. When an event came from another language's service, a matching hash is a cross-implementation check, and a mismatch says one of the two is non-conformant, not which.
- Installs, CI and the ingest image build need network access to GitHub and take the assembler's build time. The commit check keeps them reproducible: a retagged release fails the build instead of changing the traces.
- When `assembler-typescript` gains a `prepare` script, publishes a release artifact, or is published to npm, the build step is replaced by an ordinary pinned dependency, in one commit that moves the pin and removes the script.
