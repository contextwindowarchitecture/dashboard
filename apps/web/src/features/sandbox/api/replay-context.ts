// The replay client the app was configured with, or null when config.json names no apiBase.

import { createContext, useContext } from "react"

import type { ReplayClient } from "./replay"

export const ReplayContext = createContext<ReplayClient | null>(null)

export const useReplayClient = () => useContext(ReplayContext)
