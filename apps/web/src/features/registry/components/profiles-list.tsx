// The profiles (dashboard-plan.md 7.5): every one the vendored registry holds, with the route policy
// it binds (R-20), its evaluation and whether it could be promoted (R-19), and the events that ran
// it; and the profiles events ran that the registry does not hold.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { Link } from "react-router"

import { DataRegion } from "../../../components/dashboard/data-region"
import { useIndex } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount } from "../../../lib/format"
import { policyPath, profilePath } from "../model/paths"
import { promotable, registryModel } from "../model/registry"
import { DriftNote } from "./registry-parts"

export function ProfilesList() {
  const region = regionOf(useIndex(), { what: "The index" })
  return (
    <DataRegion region={region} label="the profiles">
      {(index) => {
        const model = registryModel(REGISTRY, index.events)
        return (
          <div data-slot="content">
            <DriftNote drift={model.drift.filter((d) => d.kind === "profile")} />
            <div role="region" aria-label="Profiles table" tabIndex={0} data-slot="scroll-region">
              <table aria-label="Profiles" data-slot="chart-table" data-wide="">
                <thead>
                  <tr>
                    <th scope="col">Profile</th>
                    <th scope="col">Route policy</th>
                    <th scope="col">Evaluation</th>
                    <th scope="col">Promotable</th>
                    <th scope="col" data-numeric="">
                      Events
                    </th>
                    <th scope="col" data-numeric="">
                      Drifted
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.profiles.map((entry) => {
                    const { profile } = entry
                    const evaluation = profile.evaluation as { status?: string } | undefined
                    return (
                      <tr key={`${entry.id} ${entry.version}`}>
                        <th scope="row" data-mono="">
                          <Link to={profilePath(entry.id, entry.version)}>
                            {entry.id} v{entry.version}
                          </Link>
                        </th>
                        <td data-mono="">
                          {entry.binds ? (
                            <Link to={policyPath(entry.binds.route, entry.binds.version)}>
                              {entry.binds.route} {entry.binds.version}
                            </Link>
                          ) : (
                            `${profile.route} ${profile.route_policy_version} · not in the registry`
                          )}
                        </td>
                        <td data-mono="">{evaluation?.status ?? "—"}</td>
                        <td data-mono="">{promotable(profile) ? "yes" : "no"}</td>
                        <td data-numeric="">{formatCount(entry.usage.events)}</td>
                        <td data-numeric="" data-drift={entry.usage.drifted > 0 ? "" : undefined}>
                          {formatCount(entry.usage.drifted)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <section aria-labelledby="unregistered-profiles" data-slot="panel">
              <h2 id="unregistered-profiles" data-slot="panel-header" data-label="">
                Run by events, not in the registry
              </h2>
              <div
                role="region"
                aria-labelledby="unregistered-profiles"
                tabIndex={0}
                data-slot="scroll-region"
              >
                <table aria-label="Not in the registry" data-slot="chart-table" data-wide="">
                  <thead>
                    <tr>
                      <th scope="col">Profile</th>
                      <th scope="col" data-numeric="">
                        Events
                      </th>
                      <th scope="col">Services</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.unregisteredProfiles.map((entry) => (
                      <tr key={`${entry.id} ${entry.version}`}>
                        <th scope="row" data-mono="">
                          {entry.id} v{entry.version}
                        </th>
                        <td data-numeric="">{formatCount(entry.events)}</td>
                        <td data-mono="">{entry.services.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p data-slot="panel-note">
                A snapshot carries the profile it ran; these were never locked in this registry. The
                conformance cases each bring their own.
              </p>
            </section>
          </div>
        )
      }}
    </DataRegion>
  )
}
