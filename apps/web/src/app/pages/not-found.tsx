import { Link } from "react-router"

import { DashboardPage } from "../../components/dashboard/dashboard-page"

export function NotFoundPage() {
  return (
    <DashboardPage
      kicker="Not found"
      title="Page not found"
      lede={
        <>
          Nothing lives at this address. <Link to="/traces">Open the trace stream →</Link>
        </>
      }
    />
  )
}
