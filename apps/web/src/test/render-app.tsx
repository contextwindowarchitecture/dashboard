// Renders the whole app at a path, over the demo tree, as the browser would: the same routes and
// providers as main.tsx, with a memory router and a fixture-backed source; under Strict Mode, as
// main.tsx renders it, when a test asks.

import { QueryClient } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { StrictMode } from "react"
import { createMemoryRouter } from "react-router"

import { AppProviders } from "../app/providers"
import { ROUTES } from "../app/routes"
import type { AppConfig } from "../data/config"
import { createFileSource } from "../data/source"
import type { ReplayClient } from "../features/sandbox/api/replay"
import { fixtureFetch, type FixtureFetchOptions } from "./fixture-fetch"

export function renderApp(
  path: string,
  fetchOptions: FixtureFetchOptions = {},
  {
    strict = false,
    replay = null,
    config = { dataRoot: "/data", source: "file" },
  }: {
    readonly strict?: boolean
    readonly replay?: ReplayClient | null
    readonly config?: AppConfig
  } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  const source = createFileSource("/data", fixtureFetch(fetchOptions))
  const router = createMemoryRouter(ROUTES, { initialEntries: [path] })
  const app = (
    <AppProviders client={client} source={source} config={config} router={router} replay={replay} />
  )
  const rendered = render(strict ? <StrictMode>{app}</StrictMode> : app)
  return { ...rendered, router }
}
