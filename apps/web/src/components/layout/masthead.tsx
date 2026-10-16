// The masthead (STYLE.md 6): the menu, the plane mark and wordmark, the breadcrumbs, then the theme
// and the repository on the right.

import { useEffect, useRef } from "react"
import { Link } from "react-router"

import { LINKS } from "../../lib/links"
import { useTheme } from "../../lib/theme"
import { useSidebar } from "../ui/sidebar"
import { Breadcrumbs } from "./breadcrumbs"

function PlaneMark() {
  return (
    <span aria-hidden="true" data-slot="plane-mark">
      <span data-plane="gov" />
      <span data-plane="state" />
      <span data-plane="evid" />
      <span data-plane="inter" />
    </span>
  )
}

/**
 * The sidebar's toggle. The phone's sheet opens from state, not from a dialog trigger, so the dialog
 * has nothing to give the focus back to when it closes: this button takes it back. A link in the
 * sheet still ends on the new page's title, which the route change focuses a frame later.
 */
function MenuButton() {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()
  const expanded = isMobile ? openMobile : open
  const button = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(openMobile)
  useEffect(() => {
    if (wasOpen.current && !openMobile) button.current?.focus()
    wasOpen.current = openMobile
  }, [openMobile])
  return (
    <button
      ref={button}
      type="button"
      data-slot="ghost-button"
      aria-expanded={expanded}
      onClick={toggleSidebar}
    >
      {isMobile && openMobile ? "close" : "menu"}
    </button>
  )
}

export function Masthead() {
  const [theme, toggleTheme] = useTheme()
  return (
    <header data-slot="masthead">
      <MenuButton />
      <Link to="/" data-slot="wordmark" aria-label="CWA dashboard, home">
        <PlaneMark />
        <span data-slot="wordmark-name">CWA</span>
        <span data-slot="wordmark-product">dashboard</span>
      </Link>
      <Breadcrumbs />
      <div data-slot="masthead-actions">
        <button type="button" data-slot="ghost-button" onClick={toggleTheme}>
          {theme === "dark" ? "light" : "dark"}
        </button>
        <a data-slot="inverse-button" href={LINKS.repository}>
          GitHub
        </a>
      </div>
    </header>
  )
}
