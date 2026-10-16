// The providers every page runs under: the query client, the data source and its root, and the
// router. main.tsx and the tests compose the app the same way.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, type createBrowserRouter } from "react-router"

import { TooltipProvider } from "../components/ui/tooltip"
import type { AppConfig } from "../data/config"
import { DataProvider } from "../data/data-provider"
import type { EventSource } from "../data/source"

export interface AppProvidersProps {
  readonly client: QueryClient
  readonly source: EventSource
  readonly config: AppConfig
  readonly router: ReturnType<typeof createBrowserRouter>
}

export function AppProviders({ client, source, config, router }: AppProvidersProps) {
  return (
    <QueryClientProvider client={client}>
      <DataProvider source={source} root={config.dataRoot}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </DataProvider>
    </QueryClientProvider>
  )
}
