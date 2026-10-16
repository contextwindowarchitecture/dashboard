# ADR-0006: The three illustrations are deferred

- Status: accepted
- Date: 2026-10-15
- Supersedes: the illustration clause of ADR-0002

## Context

ADR-0002 admitted `@lottiefiles/dotlottie-react` for three authored animations, which `STYLE.md` 7 places in the stream's first-run empty state, at the top of the Telemetry page, and in the sandbox while a replay runs.

The dotLottie player renders through ThorVG compiled to WebAssembly. A browser instantiates WebAssembly only when the page's Content Security Policy allows `'wasm-unsafe-eval'` in `script-src`. The dashboard's policy is `script-src 'self'`, `AGENTS.md` forbids loosening it, and a test fails on that keyword. A Lottie file's colours are also fixed in the file, so an illustration could not follow the dark theme's tokens without a second set of files.

Two ways remain open: illustrations authored as React SVG drawn with the tokens and animated with CSS that stops under reduced motion, with no player at all; or `lottie-web`'s light build, an SVG renderer without expressions and so without `eval`, playing Lottie JSON authored here.

## Decision

No illustration is built in Phase 1, and the player is not added. The three places keep their words: the empty state says how events arrive, the Telemetry page describes the flow, and the sandbox says it is replaying. Nothing else about motion changes; GSAP stays for the three choreographies.

## Consequences

- The policy stays as it is, and no WebAssembly or player library reaches the bundle.
- `STYLE.md` 7's Illustration section is marked deferred. The import check that keeps a player in one wrapper stays in place for when one is chosen.
- Choosing one of the two ways above, or another, is a new decision record that supersedes this one.
