import type { ReactNode } from "react"

import { type Data, DataContext } from "./data-context"

export function DataProvider({ source, root, prices, children }: Data & { children: ReactNode }) {
  return (
    <DataContext.Provider value={{ source, root, ...(prices ? { prices } : {}) }}>
      {children}
    </DataContext.Provider>
  )
}
