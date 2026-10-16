// The data source and its root, shared with every query through context.

import { createContext, useContext } from "react"

import type { EventSource } from "./source"

export interface Data {
  readonly source: EventSource
  /** The data root, which every query key carries. */
  readonly root: string
}

export const DataContext = createContext<Data | null>(null)

export function useData(): Data {
  const data = useContext(DataContext)
  if (data === null) throw new Error("useData outside a DataProvider")
  return data
}
