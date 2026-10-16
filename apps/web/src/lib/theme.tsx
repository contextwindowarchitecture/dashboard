// The theme (STYLE.md 3, Dark mode): data-theme on <html>, set before the first paint by
// public/theme.js from the website's cwa-theme key, toggled here and written back.

import { useCallback, useState } from "react"

export type Theme = "light" | "dark"
const KEY = "cwa-theme"

const current = (): Theme =>
  document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current)
  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark"
    document.documentElement.setAttribute("data-theme", next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Storage can be unavailable; the choice then lasts for the page.
    }
    setTheme(next)
  }, [])
  return [theme, toggle]
}
