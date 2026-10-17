// The navigation tree (dashboard-plan.md 6): stable ids, the words, the icon, and the route patterns
// under which an item is the current page. Only pages that exist are listed; each is added here when
// it lands.

import {
  BookOpen,
  Info,
  RadioTower,
  Boxes,
  Coins,
  Inbox,
  FileCheck,
  FlaskConical,
  GitMerge,
  Layers,
  LayoutDashboard,
  ListTree,
  MessagesSquare,
  ScrollText,
  ShieldCheck,
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
      { id: "sources", label: "Sources", to: "/sources", icon: Inbox, patterns: ["/sources"] },
      { id: "finops", label: "FinOps", to: "/finops", icon: Coins, patterns: ["/finops"] },
      {
        id: "conflicts",
        label: "Conflicts",
        to: "/conflicts",
        icon: GitMerge,
        patterns: ["/conflicts"],
      },
      {
        id: "guardrails",
        label: "Guardrails",
        to: "/guardrails",
        icon: ShieldCheck,
        patterns: ["/guardrails", "/guardrails/:number"],
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
      {
        id: "profiles",
        label: "Profiles",
        to: "/registry/profiles",
        icon: Layers,
        patterns: ["/registry/profiles", "/registry/profiles/:id/:version"],
      },
    ],
  },
  {
    id: "fleet",
    label: "Fleet",
    items: [
      {
        id: "fleet",
        label: "Fleet",
        to: "/fleet",
        icon: Boxes,
        patterns: ["/fleet", "/fleet/:language"],
      },
    ],
  },
  {
    id: "replay",
    label: "Replay",
    items: [
      {
        id: "sandbox",
        label: "Sandbox",
        to: "/sandbox",
        icon: FlaskConical,
        patterns: ["/sandbox"],
      },
      {
        id: "compliance",
        label: "Compliance",
        to: "/compliance",
        icon: FileCheck,
        patterns: ["/compliance"],
      },
    ],
  },
  {
    id: "reference",
    label: "Reference",
    items: [
      {
        id: "glossary",
        label: "Glossary",
        to: "/glossary",
        icon: BookOpen,
        patterns: ["/glossary"],
      },
      {
        id: "telemetry",
        label: "Telemetry",
        to: "/telemetry",
        icon: RadioTower,
        patterns: ["/telemetry"],
      },
      {
        id: "about",
        label: "About",
        to: "/about",
        icon: Info,
        patterns: ["/about"],
      },
    ],
  },
]

export const isCurrent = (item: NavItem, pathname: string) =>
  item.patterns.some((pattern) => matchPath(pattern, pathname) !== null)
