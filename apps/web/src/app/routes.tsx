// The routes (dashboard-plan.md 6). Each route's handle names its document title and its crumb;
// record pages name them from their params.

import { Navigate, type Params, type RouteObject } from "react-router"

import { Shell } from "../components/layout/shell"
import { ImplementationView } from "../features/fleet/components/implementation-view"
import { GuardrailView } from "../features/guardrails/components/guardrails-view"
import { PolicyView } from "../features/registry/components/policy-view"
import { ProfileView } from "../features/registry/components/profile-view"
import { FleetPage } from "./pages/fleet"
import { ConflictsPage } from "./pages/conflicts"
import { SourcesPage } from "./pages/sources"
import { GuardrailsPage } from "./pages/guardrails"
import { InspectorPage } from "./pages/inspector"
import { NotFoundPage } from "./pages/not-found"
import { OverviewPage } from "./pages/overview"
import { PoliciesPage, ProfilesPage } from "./pages/registry"
import { SessionPage } from "./pages/session"
import { SessionsPage } from "./pages/sessions"
import { TracesPage } from "./pages/traces"

export interface RouteHandle {
  /** The page's name in the document title. */
  readonly title: (params: Params) => string
  /** The crumb, when the route adds one; a link unless it is the last. */
  readonly crumb?: (params: Params) => string
}

const handle = (
  title: string | ((params: Params) => string),
  crumb?: (params: Params) => string,
): RouteHandle => ({
  title: typeof title === "string" ? () => title : title,
  ...(crumb ? { crumb } : {}),
})

export const ROUTES: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { index: true, element: <OverviewPage />, handle: handle("Overview") },
      {
        path: "traces",
        handle: handle("Traces", () => "Traces"),
        children: [
          { index: true, element: <TracesPage />, handle: handle("Trace stream") },
          {
            path: ":eventId",
            element: <InspectorPage />,
            handle: handle(
              (params) => params["eventId"] ?? "",
              (params) => params["eventId"] ?? "",
            ),
          },
        ],
      },
      {
        path: "sessions",
        handle: handle("Sessions", () => "Sessions"),
        children: [
          { index: true, element: <SessionsPage />, handle: handle("Sessions") },
          {
            path: ":sessionId",
            element: <SessionPage />,
            handle: handle(
              (params) => params["sessionId"] ?? "",
              (params) => params["sessionId"] ?? "",
            ),
          },
        ],
      },
      {
        path: "registry",
        handle: handle("Registry", () => "Registry"),
        children: [
          { index: true, element: <Navigate to="policies" replace /> },
          {
            path: "policies",
            handle: handle("Route policies", () => "Route policies"),
            children: [
              { index: true, element: <PoliciesPage />, handle: handle("Route policies") },
              {
                path: ":route/:version",
                element: <PolicyView />,
                handle: handle(
                  (params) => `${params["route"] ?? ""} ${params["version"] ?? ""}`,
                  (params) => `${params["route"] ?? ""} ${params["version"] ?? ""}`,
                ),
              },
            ],
          },
          {
            path: "profiles",
            handle: handle("Profiles", () => "Profiles"),
            children: [
              { index: true, element: <ProfilesPage />, handle: handle("Profiles") },
              {
                path: ":id/:version",
                element: <ProfileView />,
                handle: handle(
                  (params) => `${params["id"] ?? ""} v${params["version"] ?? ""}`,
                  (params) => `${params["id"] ?? ""} v${params["version"] ?? ""}`,
                ),
              },
            ],
          },
        ],
      },
      {
        path: "conflicts",
        element: <ConflictsPage />,
        handle: handle("Conflicts", () => "Conflicts"),
      },
      {
        path: "sources",
        element: <SourcesPage />,
        handle: handle("Sources", () => "Sources"),
      },
      {
        path: "guardrails",
        handle: handle("Guardrails", () => "Guardrails"),
        children: [
          { index: true, element: <GuardrailsPage />, handle: handle("Guardrails") },
          {
            path: ":number",
            element: <GuardrailView />,
            handle: handle(
              (params) => params["number"] ?? "",
              (params) => params["number"] ?? "",
            ),
          },
        ],
      },
      {
        path: "telemetry",
        lazy: async () => ({ Component: (await import("./pages/reference")).Telemetry }),
        handle: handle("Telemetry", () => "Telemetry"),
      },
      {
        path: "about",
        lazy: async () => ({ Component: (await import("./pages/reference")).About }),
        handle: handle("About", () => "About"),
      },
      {
        path: "glossary",
        lazy: () => import("./pages/glossary"),
        handle: handle("Glossary", () => "Glossary"),
      },
      {
        path: "sandbox",
        lazy: () => import("./pages/sandbox"),
        handle: handle("Sandbox", () => "Sandbox"),
      },
      {
        path: "fleet",
        handle: handle("Fleet", () => "Fleet"),
        children: [
          { index: true, element: <FleetPage />, handle: handle("Fleet") },
          {
            path: ":language",
            element: <ImplementationView />,
            handle: handle(
              (params) => params["language"] ?? "",
              (params) => params["language"] ?? "",
            ),
          },
        ],
      },
      { path: "*", element: <NotFoundPage />, handle: handle("Page not found") },
    ],
  },
]
