// The trace diff (dashboard-plan.md 7.8): the recorded trace and the replay's, each as indented JSON
// without the trace's random id and the assembler's timings (R-23), compared line by line by their
// longest common subsequence. A change shows as the line removed and the line added, a few unchanged
// lines around it, the rest collapsed; traces over the bound are not compared, and it says so.

export type DiffRow =
  | { readonly kind: "same" | "removed" | "added"; readonly text: string }
  | { readonly kind: "skipped"; readonly lines: number }

export interface TraceDiff {
  readonly changed: boolean
  /** The traces were over the bound, so `rows` is empty. */
  readonly tooLarge: boolean
  readonly rows: readonly DiffRow[]
}

const lines = (trace: unknown) => {
  if (trace === undefined || trace === null) return []
  const { trace_id: _id, timings: _timings, ...rest } = trace as Record<string, unknown>
  return JSON.stringify(rest, null, 2).split("\n")
}

export function traceDiff(
  recorded: unknown,
  replayed: unknown,
  { context = 3, maxLines = 4000 }: { readonly context?: number; readonly maxLines?: number } = {},
): TraceDiff {
  const a = lines(recorded)
  const b = lines(replayed)
  const changed = a.length !== b.length || a.some((line, i) => line !== b[i])
  if (a.length + b.length > maxLines) return { changed, tooLarge: true, rows: [] }

  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const all: { kind: "same" | "removed" | "added"; text: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({ kind: "same", text: a[i]! })
      i += 1
      j += 1
    } else if (j >= b.length || (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      all.push({ kind: "removed", text: a[i]! })
      i += 1
    } else {
      all.push({ kind: "added", text: b[j]! })
      j += 1
    }
  }

  // Keep the unchanged lines within `context` of a change; collapse each other run into one row.
  const near = all.map(() => false)
  all.forEach((row, k) => {
    if (row.kind === "same") return
    for (let d = Math.max(0, k - context); d <= Math.min(all.length - 1, k + context); d += 1)
      near[d] = true
  })
  const rows: DiffRow[] = []
  let skipped = 0
  all.forEach((row, k) => {
    if (row.kind === "same" && !near[k]) {
      skipped += 1
      return
    }
    if (skipped > 0) rows.push({ kind: "skipped", lines: skipped })
    skipped = 0
    rows.push(row)
  })
  if (skipped > 0) rows.push({ kind: "skipped", lines: skipped })
  return { changed, tooLarge: false, rows }
}
