// The routes (dashboard-plan.md 6). Each route's handle names its document title and its crumb;
// record pages name them from their params.

import { Navigate, type Params, type RouteObject } from "react-router"

import { Shell } from "../components/layout/shell"
import { PolicyView } from "../features/registry/components/policy-view"
import { InspectorPage } from "./pages/inspector"
import { NotFoundPage } from "./pages/not-found"
import { OverviewPage } from "./pages/overview"
import { PoliciesPage } from "./pages/registry"
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
        ],
      },
      { path: "*", element: <NotFoundPage />, handle: handle("Page not found") },
    ],
  },
]
