// The masthead's tenant switch (ADR-0012): the tenants the data root lists, offered when there is
// more than one. Through the API the list holds only the tenants the reader may read.

import { validateTenantsV1 } from "@cwa-dashboard/telemetry/validators"
import { useQuery } from "@tanstack/react-query"

import { useData } from "../../data/data-context"
import { formatCount } from "../../lib/format"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { DEFAULT_TENANT, useChooseTenant } from "./tenant-scope"

function useTenants() {
  const { dataRoot, root, fetchFn = fetch } = useData()
  const base = (dataRoot ?? root).replace(/\/+$/, "")
  return useQuery({
    queryKey: ["tenants", base],
    queryFn: async ({ signal }) => {
      const response = await fetchFn(`${base}/tenants.json`, { signal })
      if (!response.ok) return []
      const body: unknown = await response.json().catch(() => undefined)
      return validateTenantsV1(body) ? body.tenants : []
    },
    staleTime: 60_000,
    retry: false,
  })
}

export function TenantSwitch() {
  const { tenant = DEFAULT_TENANT } = useData()
  const tenants = useTenants().data ?? []
  const choose = useChooseTenant()
  if (tenants.length < 2) return null
  return (
    <Select value={tenant} onValueChange={choose}>
      <SelectTrigger aria-label="Tenant" data-slot="tenant-switch">
        {/* The name alone: the masthead has no room for the count, which the options give. */}
        <SelectValue>{tenant}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {tenants.map((each) => (
          <SelectItem key={each.tenant} value={each.tenant}>
            {each.tenant} · {formatCount(each.events)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
