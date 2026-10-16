// The masthead (STYLE.md 6): the menu, the plane mark and wordmark, the breadcrumbs, then the theme
// and the repository on the right.

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

function MenuButton() {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()
  const expanded = isMobile ? openMobile : open
  return (
    <button type="button" data-slot="ghost-button" aria-expanded={expanded} onClick={toggleSidebar}>
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
