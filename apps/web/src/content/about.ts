// The about page's words (dashboard-plan.md 7.9), written against the contract below; the content test
// fails when the lock moves, so these are re-read then.

export const ABOUT = {
  writtenAgainst: "16de4be0534583f135a597171c927d42c87ee82c",
  what: "The observability and audit plane for Context Window Architecture assemblies: for every assemble() call a service records, it shows what the assembler decided, what it admitted, compressed, excluded and refused and why, how a session's budget moved turn by turn, which route policies and profiles were in force, and whether every service runs the same contract.",
  never: [
    "It never assembles. Every decision on these pages is a recorded assembler's; the sandbox replays through the real TypeScript assembler on the server.",
    "It never invents vocabulary. Every code, requirement, slot and field is the vendored contract's.",
    "It never hides an item's metadata, whatever the redaction mode: a mode touches bodies only.",
    "It never redacts, scrubs or reveals a body in the browser. It shows what the event holds and names the wrapper setting that decides it.",
    "It never shows a number it did not measure. What it cannot compute reads Not available.",
    "It never labels traffic as another implementation's. Demo traffic is labelled demo and comes from the TypeScript assembler.",
  ],
} as const
