// What every route change does (dashboard-plan.md 6): the document title follows the route, as
// "Page — CWA dashboard" or "record — Section — CWA dashboard", and focus moves to the new page's
// title, so a keyboard or screen-reader user lands on what changed. The first load keeps the
// browser's focus, so the skip link stays the first stop.

import { useEffect, useRef } from "react"
import { useLocation } from "react-router"

import { PAGE_TITLE_ID } from "../dashboard/dashboard-page"
import { useDocumentTitle } from "./document-title"

export function RouteEffects() {
  const title = useDocumentTitle()
  const location = useLocation()
  const first = useRef(true)

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const frame = requestAnimationFrame(() => document.getElementById(PAGE_TITLE_ID)?.focus())
    return () => cancelAnimationFrame(frame)
  }, [location.key])

  return null
}
