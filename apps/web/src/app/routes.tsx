// The routes (dashboard-plan.md 6). Each route's handle names its document title and its crumb;
// record pages name them from their params.

import type { Params, RouteObject } from "react-router"

import { Shell } from "../components/layout/shell"
import { InspectorPage } from "./pages/inspector"
import { NotFoundPage } from "./pages/not-found"
import { OverviewPage } from "./pages/overview"
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
        children: [{ index: true, element: <SessionsPage />, handle: handle("Sessions") }],
      },
      { path: "*", element: <NotFoundPage />, handle: handle("Page not found") },
    ],
  },
]
