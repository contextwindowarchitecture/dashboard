// The first table under a heading of a Markdown document, as cells of text, so a page can show a
// table the repository's docs keep (docs/otel-semantic-conventions.md) without copying it.

export interface MarkdownTable {
  readonly head: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim())

export function markdownTable(doc: string, heading: string): MarkdownTable {
  const start = doc.indexOf(`\n## ${heading}\n`)
  if (start < 0) throw new Error(`no section "${heading}"`)
  const lines = doc.slice(start).split("\n")
  const first = lines.findIndex((line) => line.startsWith("|"))
  const table: string[] = []
  for (const line of lines.slice(first)) {
    if (!line.startsWith("|")) break
    table.push(line)
  }
  const [head, , ...rows] = table
  if (head === undefined) throw new Error(`no table under "${heading}"`)
  return { head: cells(head), rows: rows.map(cells) }
}
