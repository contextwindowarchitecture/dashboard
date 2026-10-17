// The data source, its root and the configured prices, shared with every page through context.

import { createContext, useContext } from "react"

import type { Prices } from "./config"
import type { EventSource } from "./source"

export interface Data {
  readonly source: EventSource
  /** The data root, which every query key carries. */
  readonly root: string
  /** What input tokens cost, from config.json; absent, money is "Not available". */
  readonly prices?: Prices
}

export const DataContext = createContext<Data | null>(null)

export function useData(): Data {
  const data = useContext(DataContext)
  if (data === null) throw new Error("useData outside a DataProvider")
  return data
}
