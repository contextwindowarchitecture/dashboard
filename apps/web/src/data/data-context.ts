// The data source, its root, the configured prices and the service's base, shared with every page
// through context.

import { createContext, useContext } from "react"

import type { Prices } from "./config"
import type { EventSource } from "./source"

export interface Data {
  readonly source: EventSource
  /** The data root, which every query key carries. */
  readonly root: string
  /** What input tokens cost, from config.json; absent, money is "Not available". */
  readonly prices?: Prices
  /** The Node service's base, from config.json, for what only it answers (a compliance bundle). */
  readonly apiBase?: string
  /** The fetch the source uses, for those requests too; the tests' reads the fixtures. */
  readonly fetchFn?: typeof fetch
}

export const DataContext = createContext<Data | null>(null)

export function useData(): Data {
  const data = useContext(DataContext)
  if (data === null) throw new Error("useData outside a DataProvider")
  return data
}
