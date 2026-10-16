// The document title a route names: "Page — CWA dashboard", or "record — Section — CWA dashboard"
// on a record page (STYLE.md 4, Casing and punctuation).

import { useMatches, useParams } from "react-router"

import type { RouteHandle } from "../../app/routes"

export const APP_NAME = "CWA dashboard"

export function useDocumentTitle(): string {
  const matches = useMatches()
  const params = useParams()
  const titled = matches.filter((match) => (match.handle as RouteHandle | undefined)?.title)
  const page = titled.at(-1)
  const section = titled.length > 1 ? titled.at(-2) : undefined
  const pageTitle = (page?.handle as RouteHandle | undefined)?.title(params) ?? APP_NAME
  const parts = [pageTitle]
  // A record page names its section too.
  if (
    section &&
    page &&
    page.pathname !== section.pathname &&
    Object.keys(page.params).length > 0
  ) {
    parts.push((section.handle as RouteHandle).title(params))
  }
  return pageTitle === APP_NAME ? APP_NAME : [...parts, APP_NAME].join(" — ")
}
