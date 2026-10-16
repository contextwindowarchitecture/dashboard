// Hierarchy, not history (STYLE.md 6, Breadcrumbs): one crumb per route that names one, the last
// the current page.

import { Fragment } from "react"
import { Link, useMatches, useParams } from "react-router"

import type { RouteHandle } from "../../app/routes"

export function Breadcrumbs() {
  const matches = useMatches()
  const params = useParams()
  const crumbs = matches.flatMap((match) => {
    const crumb = (match.handle as RouteHandle | undefined)?.crumb
    return crumb ? [{ to: match.pathname, label: crumb(params) }] : []
  })
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumbs" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb.to}>
            {i > 0 ? (
              <li aria-hidden="true" data-slot="breadcrumb-separator">
                /
              </li>
            ) : null}
            <li className="min-w-0 truncate">
              {i === crumbs.length - 1 ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <Link to={crumb.to}>{crumb.label}</Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
