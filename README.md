# CWA dashboard

The observability and audit plane for [Context Window Architecture](https://github.com/contextwindowarchitecture/contextwindowarchitecture) (CWA) assemblies. An application wraps a conformant assembler in a thin telemetry layer that emits, for every `assemble()` call, the frozen snapshot and the trace the assembler returned. The dashboard reads those events and shows what the assembler decided: what was admitted, compressed, excluded and why, what was refused and why, how a session's budget moved turn by turn, which route policies and placement profiles were in force, and whether every service in a fleet runs the same contract.

It is not an assembler, not a gateway and not a policy store. It never decides what goes into a context window.

## Status

Planned; the workspace is being bootstrapped. Nothing runs yet.

## Working here

Read [`AGENTS.md`](AGENTS.md) before changing anything: it holds the rules (test-first, real fixtures, the contract as the only vocabulary), the commands and the commit conventions. [`STYLE.md`](STYLE.md) is the visual language, the CWA website's style guide applied to this app.
