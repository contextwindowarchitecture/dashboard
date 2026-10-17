// FinOps (dashboard-plan.md DP-11): per route, what the window's assembled events took in input
// tokens and what compression saved, with their cost only where config.json prices the route. What
// no trace measures is said to be so: the tokens an excluded item would have cost, and what the
// provider's cache reused.

import { DataRegion } from "../../../components/dashboard/data-region"
import { useData } from "../../../data/data-context"
import { useIndex } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, formatMoney } from "../../../lib/format"
import { finopsRows } from "../model/finops"

export function FinopsView() {
  const { source, prices } = useData()
  const region = regionOf(useIndex(), {
    what: "The index",
    isEmpty: (index) => finopsRows(index).total.events === 0,
  })
  return (
    <DataRegion
      region={region}
      label="FinOps"
      empty={{
        title: "Nothing was assembled in this window",
        body: <p>A route appears here once an assembly on it reaches a model.</p>,
      }}
    >
      {(index) => {
        const { routes, total, currency } = finopsRows(index, prices)
        const saved = (known: number, events: number, tokens: number) =>
          known === events ? (
            formatCount(tokens)
          ) : (
            <>
              {formatCount(tokens)}{" "}
              <span data-slot="cell-note">
                · {formatCount(known)} of {formatCount(events)} events say
              </span>
            </>
          )
        return (
          <div data-slot="content">
            <div role="status" aria-label="FinOps status" data-slot="status-region">
              <span>{formatCount(total.events)} assembled events</span>
              <span>
                · current window, {formatInstant(index.window.from)} to{" "}
                {formatInstant(index.window.to)}
              </span>
              <span>· source {source.url("").replace(/\/$/, "")}</span>
              <span>
                · {currency === undefined ? "no prices configured" : `prices in ${currency}`}
              </span>
            </div>
            {prices === undefined ? (
              <section aria-label="Prices" data-slot="note">
                <p>
                  No prices are configured, so every money figure reads Not available. Set{" "}
                  <code>prices.currency</code> and{" "}
                  <code>prices.per_million_input_tokens.&lt;route&gt;</code> in{" "}
                  <code>config.json</code> to price a route; the dashboard never writes a price of
                  its own.
                </p>
              </section>
            ) : null}
            <section aria-label="Not measured" data-slot="note">
              <p>
                Tokens kept out before the model are not available: the contract records no cost for
                an excluded item. What the provider's cache reused is not available either: a trace
                says nothing of it, and RFC-D2 proposes the digests that would let the dashboard
                tell.
              </p>
            </section>
            <div role="region" aria-label="Routes table" tabIndex={0} data-slot="scroll-region">
              <table aria-label="Routes" data-slot="chart-table" data-wide="">
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col" data-numeric="">
                      Assembled events
                    </th>
                    <th scope="col" data-numeric="">
                      Input tokens
                    </th>
                    <th scope="col" data-numeric="">
                      Saved by compression
                    </th>
                    <th scope="col" data-numeric="">
                      Price per million
                    </th>
                    <th scope="col" data-numeric="">
                      Cost
                    </th>
                    <th scope="col" data-numeric="">
                      Saving's worth
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.route}>
                      <th scope="row" data-mono="">
                        {route.route}
                      </th>
                      <td data-numeric="">{formatCount(route.events)}</td>
                      <td data-numeric="">{formatCount(route.input_tokens)}</td>
                      <td data-numeric="">{saved(route.saved_known, route.events, route.saved)}</td>
                      <td data-numeric="">{formatMoney(route.price, currency)}</td>
                      <td data-numeric="">{formatMoney(route.cost, currency)}</td>
                      <td data-numeric="">{formatMoney(route.saved_worth, currency)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">All routes</th>
                    <td data-numeric="">{formatCount(total.events)}</td>
                    <td data-numeric="">{formatCount(total.input_tokens)}</td>
                    <td data-numeric="">{saved(total.saved_known, total.events, total.saved)}</td>
                    <td data-numeric="" />
                    <td data-numeric="">{formatMoney(total.cost, currency)}</td>
                    <td data-numeric="">{formatMoney(total.saved_worth, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      }}
    </DataRegion>
  )
}
