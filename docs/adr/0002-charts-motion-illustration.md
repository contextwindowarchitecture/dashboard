# ADR-0002: D3 and React SVG for charts; GSAP and Lottie only where named

- Status: accepted
- Date: 2026-10-15

## Context

The dashboard draws a small, known set of charts: the budget bar, the turn timeline, reason bars, latency dots, the conformance matrix, the outcome strip and, in Phase 2, conflict and lineage graphs. Each must use the tokens of `STYLE.md`, come with a table beside it, and have its edge cases tested (empty, one point, zero budget, refused, over budget, out of order).

A chart library brings its own rendering, theming and animation, and each of those would have to be bent to the style guide. `AGENTS.md` forbids a second chart, animation or component library without a decision record.

Motion and illustration have a cost in attention and bundle size. `STYLE.md` 7 names the only places they show something a still page cannot.

## Decision

- **Charts**: D3 modules (`d3-array`, `d3-scale`, `d3-shape`, and `d3-hierarchy` in Phase 2) compute geometry in pure modules (`*-geometry.ts`, tested without a DOM), and React renders it as SVG in the tokens. D3 never touches the DOM and `.transition()` is not used.
- **Motion**: GSAP, with `@gsap/react`, registered once in `lib/motion.ts`, for exactly three reader-controlled choreographies: playing a session turn by turn, walking a trace stage by stage, and settling a replay against its original. Each is imported only by the lazy module that carries it, runs only under `prefers-reduced-motion: no-preference`, and is cleaned up under Strict Mode and on route change.
- **Illustration**: `@lottiefiles/dotlottie-react`, lazy, for exactly three authored animations in the tokens' palette: the empty event tree, the ingestion flow, and replaying. Each has its still first frame as a fallback, is `aria-hidden` with its meaning in text, and pauses offscreen.
- **No Apache ECharts** or other chart library in Phase 1. If a measured chart cannot meet its interaction budget (the trace stream over 50,000 events, say), a further ADR may admit one for that chart alone, with the measurement.

## Consequences

- Every chart's geometry is a pure function with tests, and every chart reads the same tokens as the rest of the page.
- More code is written by hand than with a chart library; the chart set is small and fixed, and the sibling benchmark site has shipped every chart class this one needs the same way.
- A fourth choreography or illustration, a count-up, a reveal or an entrance needs a further ADR. A style test checks that GSAP and the illustration player are imported only from the named modules.
