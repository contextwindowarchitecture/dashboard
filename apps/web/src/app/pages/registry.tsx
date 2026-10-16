import { DashboardPage } from "../../components/dashboard/dashboard-page"
import { PoliciesList } from "../../features/registry/components/policies-list"
import { ProfilesList } from "../../features/registry/components/profiles-list"

export function PoliciesPage() {
  return (
    <DashboardPage
      kicker="Registry"
      title="Route policies"
      lede="The route policies the vendored registry holds, each pinned by its lock, and how the events in this window ran them: on the pinned content, on other content under the same version, or on policies the registry does not hold."
    >
      <PoliciesList />
    </DashboardPage>
  )
}

export function ProfilesPage() {
  return (
    <DashboardPage
      kicker="Registry"
      title="Profiles"
      lede="The placement profiles the vendored registry holds, each pinned by its lock: the route policy each binds, whether it has been evaluated, and how the events in this window ran them."
    >
      <ProfilesList />
    </DashboardPage>
  )
}
