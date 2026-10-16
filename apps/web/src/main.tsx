import { QueryClient } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter } from "react-router"

import { AppProviders } from "./app/providers"
import { ROUTES } from "./app/routes"
import { ConfigError, loadConfig } from "./data/config"
import { createFileSource } from "./data/source"
import { createReplayClient } from "./features/sandbox/api/replay"
import "./styles/globals.css"
import "./styles/tokens.css"

const element = document.getElementById("root")
if (element === null) throw new Error("index.html has no #root element")
const root = createRoot(element)

// The configuration comes first: without it there is nothing to read, and a bad one is shown, never
// replaced by a default.
loadConfig()
  .then((config) => {
    const router = createBrowserRouter(ROUTES)
    root.render(
      <StrictMode>
        <AppProviders
          client={new QueryClient()}
          source={createFileSource(config.dataRoot)}
          config={config}
          router={router}
          replay={config.apiBase === undefined ? null : createReplayClient(config.apiBase)}
        />
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    const message =
      error instanceof ConfigError || error instanceof Error ? error.message : String(error)
    root.render(
      <main id="main" data-slot="config-error">
        <h1>The dashboard cannot start</h1>
        <p>{message}</p>
      </main>,
    )
  })
