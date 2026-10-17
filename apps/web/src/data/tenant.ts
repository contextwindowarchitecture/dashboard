// The tenant a page reads (ADR-0012): its name's form, the default's, where its documents are, and
// the switch to another, which TenantScope provides.

import { createContext, useContext } from "react"

export const DEFAULT_TENANT = "default"
export const TENANT = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Where a tenant's documents are: the default's at the root, another's under tenants/<tenant>. */
export const tenantRoot = (root: string, tenant: string) =>
  tenant === DEFAULT_TENANT ? root : `${root.replace(/\/+$/, "")}/tenants/${tenant}`

export const ChooseContext = createContext<(tenant: string) => void>(() => undefined)
/** Switches the page to a tenant, the default's dropping ?tenant=. */
export const useChooseTenant = () => useContext(ChooseContext)
