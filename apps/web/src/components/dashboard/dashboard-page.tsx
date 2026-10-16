// A dashboard page's header and body (STYLE.md 5, 6, Page header): a kicker, the h1 the route
// change focuses, the lede, the mono meta row and the actions on the right.

import type { ReactNode } from "react"

export interface DashboardPageProps {
  readonly kicker: string
  readonly title: string
  /** The title is a record's id, set without the title's measure (STYLE.md 4). */
  readonly identifier?: boolean
  readonly lede?: ReactNode
  readonly meta?: ReactNode
  readonly actions?: ReactNode
  readonly children?: ReactNode
}

export const PAGE_TITLE_ID = "page-title"

export function DashboardPage({
  kicker,
  title,
  identifier = false,
  lede,
  meta,
  actions,
  children,
}: DashboardPageProps) {
  return (
    <div data-slot="dashboard-page">
      <div
        data-slot="page-header"
        className="flex flex-wrap items-start justify-between gap-6 px-8 pt-8 pb-6"
      >
        <div className="min-w-0">
          <p data-kicker="">{kicker}</p>
          <h1
            id={PAGE_TITLE_ID}
            tabIndex={-1}
            data-slot="page-title"
            {...(identifier ? { "data-identifier": "" } : {})}
          >
            {title}
          </h1>
          {lede ? <p data-slot="page-lede">{lede}</p> : null}
          {meta ? <p data-slot="page-meta">{meta}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2.5">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}
