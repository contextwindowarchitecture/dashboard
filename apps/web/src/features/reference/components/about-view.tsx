// The about page (dashboard-plan.md 7.9): what the dashboard is, what it never does, and what this
// build was made against.

import { CONTRACT_SOURCE } from "@cwa-dashboard/contract/data"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { ABOUT } from "../../../content/about"
import { LINKS } from "../../../lib/links"

export function AboutView() {
  return (
    <DashboardPage kicker="Reference" title="About" lede={ABOUT.what}>
      <div data-slot="content">
        <section aria-labelledby="about-never" data-slot="panel" data-padded="">
          <h2 id="about-never" data-slot="panel-header" data-label="">
            What it never does
          </h2>
          <ul aria-label="What the dashboard never does" data-slot="never-list">
            {ABOUT.never.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <section aria-label="This build" data-slot="panel" data-padded="">
          <h2 data-slot="panel-header" data-label="">
            This build
          </h2>
          <dl data-slot="key-values">
            <div>
              <dt>contract</dt>
              <dd data-mono="">
                {CONTRACT_SOURCE.repository} @ {CONTRACT_SOURCE.commit.slice(0, 7)}
              </dd>
            </div>
            <div>
              <dt>app</dt>
              <dd data-mono="">{__BUILD_COMMIT__}</dd>
            </div>
            <div>
              <dt>traffic</dt>
              <dd>demo, produced by the TypeScript assembler this repository pins</dd>
            </div>
            <div>
              <dt>specification</dt>
              <dd>
                <a href={LINKS.specification}>{LINKS.specification}</a>
              </dd>
            </div>
            <div>
              <dt>source</dt>
              <dd>
                <a href={LINKS.repository}>{LINKS.repository}</a>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </DashboardPage>
  )
}
