// The tenant a page reads (ADR-0012): ?tenant= chooses it, a name no tenant can have means the
// default, and a link that drops the parameter keeps the tenant chosen, the URL put right after it,
// so a shared link opens the same tenant. Every document comes from the tenant's own data root,
// which every query key carries, so two tenants' documents never share a cache entry.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"

import { DataContext, useData } from "../../data/data-context"
import { createFileSource } from "../../data/source"

export const DEFAULT_TENANT = "default"
export const TENANT = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Where a tenant's documents are: the default's at the root, another's under tenants/<tenant>. */
export const tenantRoot = (root: string, tenant: string) =>
  tenant === DEFAULT_TENANT ? root : `${root.replace(/\/+$/, "")}/tenants/${tenant}`

const ChooseContext = createContext<(tenant: string) => void>(() => undefined)
/** Switches the page to a tenant, the default's dropping ?tenant=. */
export const useChooseTenant = () => useContext(ChooseContext)

export function TenantScope({ children }: { readonly children: ReactNode }) {
  const outer = useData()
  const [search] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const asked = search.get("tenant")
  // The tenant last chosen, for a link that drops ?tenant=.
  const [remembered, setRemembered] = useState(
    asked !== null && TENANT.test(asked) ? asked : DEFAULT_TENANT,
  )
  const tenant = asked === null ? remembered : TENANT.test(asked) ? asked : DEFAULT_TENANT
  if (tenant !== remembered) setRemembered(tenant)

  // A link that dropped ?tenant= keeps the tenant: the URL is put right, in place.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    // The default needs no parameter: one naming it, as choosing it does, is tidied away.
    if (asked === DEFAULT_TENANT) {
      params.delete("tenant")
      const query = params.toString()
      void navigate(
        {
          pathname: location.pathname,
          search: query === "" ? "" : `?${query}`,
          hash: location.hash,
        },
        { replace: true },
      )
      return
    }
    if (asked !== null || tenant === DEFAULT_TENANT) return
    params.set("tenant", tenant)
    void navigate(
      { pathname: location.pathname, search: `?${params}`, hash: location.hash },
      { replace: true },
    )
  }, [asked, tenant, location.pathname, location.search, location.hash, navigate])

  const choose = useCallback(
    (next: string) => {
      // Named in the URL, so the chosen tenant is the one remembered; the default's is tidied after.
      const params = new URLSearchParams(location.search)
      params.set("tenant", next)
      void navigate({ pathname: location.pathname, search: `?${params}` })
    },
    [location.pathname, location.search, navigate],
  )

  const root = tenantRoot(outer.root, tenant)
  const source = useMemo(
    () =>
      tenant === DEFAULT_TENANT ? outer.source : createFileSource(root, outer.fetchFn ?? fetch),
    [tenant, root, outer.source, outer.fetchFn],
  )
  const value = useMemo(
    () => ({ ...outer, root, source, tenant, dataRoot: outer.root }),
    [outer, root, source, tenant],
  )
  return (
    <ChooseContext.Provider value={choose}>
      <DataContext.Provider value={value}>{children}</DataContext.Provider>
    </ChooseContext.Provider>
  )
}
