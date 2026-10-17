// The providers every page runs under: the query client, the data source and its root, the replay
// service's client when there is one, and the router. main.tsx and the tests compose the app the same way.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, type createBrowserRouter } from "react-router"

import { TooltipProvider } from "../components/ui/tooltip"
import type { AppConfig } from "../data/config"
import { DataProvider } from "../data/data-provider"
import type { EventSource } from "../data/source"
import type { ReplayClient } from "../features/sandbox/api/replay"
import { ReplayContext } from "../features/sandbox/api/replay-context"

export interface AppProvidersProps {
  readonly client: QueryClient
  readonly source: EventSource
  readonly config: AppConfig
  readonly router: ReturnType<typeof createBrowserRouter>
  /** The replay service's client; null when config.json names no apiBase. */
  readonly replay?: ReplayClient | null
}

export function AppProviders({ client, source, config, router, replay = null }: AppProvidersProps) {
  return (
    <QueryClientProvider client={client}>
      <DataProvider
        source={source}
        root={config.dataRoot}
        {...(config.prices ? { prices: config.prices } : {})}
      >
        <ReplayContext.Provider value={replay}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </ReplayContext.Provider>
      </DataProvider>
    </QueryClientProvider>
  )
}
