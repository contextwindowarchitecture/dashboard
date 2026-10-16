// The navigation tree (dashboard-plan.md 6): stable ids, the words, the icon, and the route patterns
// under which an item is the current page. Only pages that exist are listed; each is added here when
// it lands.

import {
  LayoutDashboard,
  ListTree,
  MessagesSquare,
  ScrollText,
  type LucideIcon,
} from "lucide-react"
import { matchPath } from "react-router"

export interface NavItem {
  readonly id: string
  readonly label: string
  readonly to: string
  readonly icon: LucideIcon
  /** The patterns under which this item is the current page: its records included. */
  readonly patterns: readonly string[]
}

export interface NavGroup {
  readonly id: string
  readonly label: string
  readonly items: readonly NavItem[]
}

export const NAVIGATION: readonly NavGroup[] = [
  {
    id: "observe",
    label: "Observe",
    items: [
      { id: "overview", label: "Overview", to: "/", icon: LayoutDashboard, patterns: ["/"] },
      {
        id: "traces",
        label: "Traces",
        to: "/traces",
        icon: ListTree,
        patterns: ["/traces", "/traces/:eventId"],
      },
      {
        id: "sessions",
        label: "Sessions",
        to: "/sessions",
        icon: MessagesSquare,
        patterns: ["/sessions", "/sessions/:sessionId"],
      },
    ],
  },
  {
    id: "registry",
    label: "Registry",
    items: [
      {
        id: "policies",
        label: "Route policies",
        to: "/registry/policies",
        icon: ScrollText,
        patterns: ["/registry/policies", "/registry/policies/:route/:version"],
      },
    ],
  },
]

export const isCurrent = (item: NavItem, pathname: string) =>
  item.patterns.some((pattern) => matchPath(pattern, pathname) !== null)
