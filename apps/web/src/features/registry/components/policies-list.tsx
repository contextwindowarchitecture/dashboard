// The route policies (dashboard-plan.md 7.5): every one the vendored registry holds, with the events
// in the index that ran it, pinned or drifted; the drift; and the policies events ran that the
// registry does not hold, which the conformance cases and deployments' own routes bring.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { Link } from "react-router"

import { DataRegion } from "../../../components/dashboard/data-region"
import { useIndex } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount } from "../../../lib/format"
import { policyPath } from "../model/paths"
import { registryModel } from "../model/registry"
import { DriftNote } from "./registry-parts"

export function PoliciesList() {
  const region = regionOf(useIndex(), { what: "The index" })
  return (
    <DataRegion region={region} label="the route policies">
      {(index) => {
        const model = registryModel(REGISTRY, index.events)
        return (
          <div data-slot="content">
            <DriftNote drift={model.drift.filter((d) => d.kind === "route_policy")} />
            <div
              role="region"
              aria-label="Route policies table"
              tabIndex={0}
              data-slot="scroll-region"
            >
              <table aria-label="Route policies" data-slot="chart-table" data-wide="">
                <thead>
                  <tr>
                    <th scope="col">Route policy</th>
                    <th scope="col" data-numeric="">
                      Events
                    </th>
                    <th scope="col" data-numeric="">
                      Pinned
                    </th>
                    <th scope="col" data-numeric="">
                      Drifted
                    </th>
                    <th scope="col">Services</th>
                    <th scope="col">Lock SHA-256</th>
                  </tr>
                </thead>
                <tbody>
                  {model.policies.map((entry) => (
                    <tr key={`${entry.route} ${entry.version}`}>
                      <th scope="row" data-mono="">
                        <Link to={policyPath(entry.route, entry.version)}>
                          {entry.route} {entry.version}
                        </Link>
                      </th>
                      <td data-numeric="">{formatCount(entry.usage.events)}</td>
                      <td data-numeric="">{formatCount(entry.usage.pinned)}</td>
                      <td data-numeric="" data-drift={entry.usage.drifted > 0 ? "" : undefined}>
                        {formatCount(entry.usage.drifted)}
                      </td>
                      <td data-mono="">{entry.usage.services.join(", ") || "none"}</td>
                      <td data-mono="">{entry.sha256?.slice(0, 12) ?? "not pinned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section aria-labelledby="unregistered-policies" data-slot="panel">
              <h2 id="unregistered-policies" data-slot="panel-header" data-label="">
                Run by events, not in the registry
              </h2>
              <div
                role="region"
                aria-labelledby="unregistered-policies"
                tabIndex={0}
                data-slot="scroll-region"
              >
                <table aria-label="Not in the registry" data-slot="chart-table" data-wide="">
                  <thead>
                    <tr>
                      <th scope="col">Route policy</th>
                      <th scope="col" data-numeric="">
                        Events
                      </th>
                      <th scope="col">Services</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.unregisteredPolicies.map((entry) => (
                      <tr key={`${entry.route} ${entry.version}`}>
                        <th scope="row" data-mono="">
                          {entry.route} {entry.version}
                        </th>
                        <td data-numeric="">{formatCount(entry.events)}</td>
                        <td data-mono="">{entry.services.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p data-slot="panel-note">
                A snapshot carries the route policy it ran; these were never locked in this
                registry. The conformance cases each bring their own.
              </p>
            </section>
          </div>
        )
      }}
    </DataRegion>
  )
}
