// The telemetry page's words (dashboard-plan.md 7.9), written against the contract below; the content
// test fails when the lock moves, so these are re-read then. The attribute and redaction tables are
// not here: the page reads them from docs/otel-semantic-conventions.md, which a test holds to the
// assembly-event schema.

export const TELEMETRY = {
  writtenAgainst: "16de4be0534583f135a597171c927d42c87ee82c",
  /** How an event reaches the dashboard in Phase 1. */
  arrival: [
    "A wrapper around a conformant assembler times each assemble() call, applies the route's redaction mode, and builds one assembly event around the frozen snapshot and the trace the assembler returned.",
    "It posts the event to the ingest service with the deployment's token. The service checks it against assembly-event v1, whose snapshot and trace are held to the vendored schemas, writes it into the event tree, adds it to its session, and rebuilds the index a moment later.",
    "The demo traffic in this deployment comes the same way, from the TypeScript assembler run over the conformance cases and the authored scenarios, and is labelled demo.",
  ],
  /** Phase 2's ingestion patterns: named, not built, their overhead not measured. */
  phase2: [
    {
      name: "OpenTelemetry collector",
      use: "Spans carrying the cwa.* attributes, exported over OTLP beside the model call they feed.",
    },
    {
      name: "Event bus",
      use: "A stream such as Kafka for services that assemble at a rate one writer cannot take.",
    },
    {
      name: "Snapshot vault",
      use: "Bodies kept in a content-addressed store, so a digest_only event can be replayed by a reader allowed to see them.",
    },
    {
      name: "Gateway",
      use: "Assembly at a proxy in front of the services, which report nothing themselves.",
    },
  ],
} as const
