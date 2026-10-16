// Renders the whole app at a path, over the demo tree, as the browser would: the same routes and
// providers as main.tsx, with a memory router and a fixture-backed source.

import { QueryClient } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { createMemoryRouter } from "react-router"

import { AppProviders } from "../app/providers"
import { ROUTES } from "../app/routes"
import { createFileSource } from "../data/source"
import { fixtureFetch, type FixtureFetchOptions } from "./fixture-fetch"

export function renderApp(path: string, fetchOptions: FixtureFetchOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const source = createFileSource("/data", fixtureFetch(fetchOptions))
  const router = createMemoryRouter(ROUTES, { initialEntries: [path] })
  const rendered = render(
    <AppProviders
      client={client}
      source={source}
      config={{ dataRoot: "/data", source: "file" }}
      router={router}
    />,
  )
  return { ...rendered, router }
}
