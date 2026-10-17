// What Publish writes (ADR-0014): the commit's message, the pull request's title and body (the author,
// the draft, where it started, and a shadow run's counts when there was one), and, without the App,
// the commands that do the same by hand. Words only; the GitHub calls are github.ts's.

import type { DraftV1, ShadowReportV1 } from "@cwa-dashboard/telemetry/types"

export interface Author {
  readonly name: string
  readonly subject: string
}

/** The draft's document as it is named: "profile cache-first-chat v2", "route policy support-chat illustrative/v2". */
export function documentName(draft: DraftV1): string {
  const document = draft.document as { id?: unknown; route?: unknown; version?: unknown }
  return draft.kind === "profile"
    ? `profile ${String(document.id)} v${String(document.version)}`
    : `route policy ${String(document.route)} ${String(document.version)}`
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const startedFrom = (started: DraftV1["started_from"]) =>
  started === null
    ? "nothing in the registry"
    : "profile" in started
      ? `profile ${started.profile.id} v${started.profile.version}`
      : `route policy ${started.route_policy.route} ${started.route_policy.version}`

/** The commit's message: what the file adds. */
export const commitMessage = (draft: DraftV1) => `Add ${documentName(draft)}`

/** The pull request's title: the document and its route. */
export const pullTitle = (draft: DraftV1) => `${capital(documentName(draft))} for ${draft.route}`

export type ShadowRun =
  | { readonly kind: "ran"; readonly report: ShadowReportV1 }
  | { readonly kind: "not-asked" }
  | { readonly kind: "did-not-finish"; readonly reason: string }

const COUNTS: readonly (keyof ShadowReportV1["summary"])[] = [
  "replayed",
  "skipped",
  "changed",
  "refusals_added",
  "refusals_removed",
  "candidate_rejected",
  "shedding_change",
  "placement_changed",
  "baseline_differs",
]

/** A count as the body shows it; skipped events by why, with their total. */
function count(value: number | Readonly<Record<string, number | undefined>>): string {
  if (typeof value === "number") return String(value)
  const reasons = Object.entries(value)
  const total = reasons.reduce((sum, [, n]) => sum + (n ?? 0), 0)
  return reasons.length === 0
    ? "0"
    : `${total} (${reasons.map(([why, n]) => `${why} ${n}`).join(", ")})`
}

/** The pull request's body, in Markdown. */
export function pullBody(input: {
  readonly draft: DraftV1
  readonly author: Author
  readonly tenant: string
  readonly path: string
  readonly shadow: ShadowRun
}): string {
  const { draft, author, tenant, path, shadow } = input
  const lines = [
    `Drafted on the CWA dashboard by **${author.name}** (\`${author.subject}\`), from ${startedFrom(draft.started_from)}.`,
    "",
    "| | |",
    "| --- | --- |",
    `| File | \`${path}\` |`,
    `| Route | \`${draft.route}\` |`,
    `| Tenant | \`${tenant}\` |`,
    `| Draft | \`${draft.id}\` |`,
    "",
  ]
  if (shadow.kind === "ran") {
    const { report } = shadow
    lines.push(
      `### Shadow over \`${report.corpus.name}\``,
      "",
      `Both sides replayed through ${report.assembler.language} ${report.assembler.version} on the dashboard, as recorded and with this ${draft.kind === "profile" ? "profile" : "route policy"}.`,
      "",
      "| | |",
      "| --- | --- |",
      ...COUNTS.map((key) => `| ${key} | ${count(report.summary[key])} |`),
      "",
    )
  } else if (shadow.kind === "not-asked") {
    lines.push(
      "No shadow run was asked for when it was published; the repository's check runs one.",
      "",
    )
  } else {
    lines.push(
      `The shadow run did not finish: ${shadow.reason} The repository's check runs one.`,
      "",
    )
  }
  lines.push(
    "This pull request was opened by the dashboard's GitHub App; review and merge it as any other.",
  )
  return `${lines.join("\n")}\n`
}

/** Without the App: the commands that branch, commit and push the file from a clone of the repository. */
export function byHandCommands(input: {
  readonly draft: DraftV1
  readonly path: string
  readonly branch: string
}): string[] {
  const { draft, path, branch } = input
  const dir = path.slice(0, path.lastIndexOf("/"))
  return [
    `git switch -c ${branch}`,
    `mkdir -p ${dir}`,
    `# save the file as ${path}`,
    `git add ${path}`,
    `git commit -s -m "${commitMessage(draft)}"`,
    `git push -u origin ${branch}`,
  ]
}
