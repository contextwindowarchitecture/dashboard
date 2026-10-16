// What every route change does (dashboard-plan.md 6): the document title follows the route, as
// "Page — CWA dashboard" or "record — Section — CWA dashboard", and focus moves to the new page's
// title, so a keyboard or screen-reader user lands on what changed. A change of the query alone (a
// filter, a tab, a stage of the walk) is the same page's state and leaves focus on the control
// that made it. The first load keeps the browser's focus, so the skip link stays the first stop.
// A link with a hash lands on the element it names once that element has rendered, which in this app
// is after the page's data arrives (STYLE.md 6: a smooth scroll, instant under reduced motion).

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
  }, [location.pathname])

  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (id === "") return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let frame = 0
    let tries = 0
    // About two seconds of frames for the page's data to arrive and its target to render.
    const land = () => {
      const target = document.getElementById(id)
      if (target !== null)
        target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
      else if (tries++ < 120) frame = requestAnimationFrame(land)
    }
    frame = requestAnimationFrame(land)
    return () => cancelAnimationFrame(frame)
  }, [location.key, location.hash])

  return null
}
