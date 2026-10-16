// A metric cell (STYLE.md 6, Panels and cards): its label, its value, and a line naming the unit,
// the window and the comparison. A value the app cannot compute is "Not available", never 0.

import type { ReactNode } from "react"

export interface MetricCellProps {
  readonly label: string
  readonly value: string
  readonly note: ReactNode
  readonly children?: ReactNode
}

export function MetricCell({ label, value, note, children }: MetricCellProps) {
  return (
    <li aria-label={label} data-slot="metric">
      <p data-label="">{label}</p>
      <p data-slot="metric-value">{value}</p>
      <p data-slot="metric-note">{note}</p>
      {children}
    </li>
  )
}
