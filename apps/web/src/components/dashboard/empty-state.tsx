// An empty or no-results panel (STYLE.md 6, Callouts): dashed, on --surface, a title and a sentence,
// and, for no results, the action that clears the filters.

import type { ReactNode } from "react"

export interface EmptyStateProps {
  readonly title: string
  readonly children: ReactNode
  readonly action?: ReactNode
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div data-slot="empty-state">
      <h3>{title}</h3>
      <div data-slot="empty-state-body">{children}</div>
      {action ? <div data-slot="empty-state-action">{action}</div> : null}
    </div>
  )
}
