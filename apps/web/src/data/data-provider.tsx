import type { ReactNode } from "react"

import { type Data, DataContext } from "./data-context"

export function DataProvider({
  source,
  root,
  prices,
  apiBase,
  fetchFn,
  children,
}: Data & { children: ReactNode }) {
  return (
    <DataContext.Provider
      value={{
        source,
        root,
        ...(prices ? { prices } : {}),
        ...(apiBase ? { apiBase } : {}),
        ...(fetchFn ? { fetchFn } : {}),
      }}
    >
      {children}
    </DataContext.Provider>
  )
}
