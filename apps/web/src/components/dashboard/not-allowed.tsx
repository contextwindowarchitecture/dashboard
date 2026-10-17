// A region the API refused (ADR-0011): to a reader who has not signed in, the way to; to one who has,
// that their roles do not include it. The API decides; the page only says which.

import { useLocation } from "react-router"

import { useData } from "../../data/data-context"
import { loginHref } from "../../features/account/api/me"

export function NotAllowed({ signIn }: { readonly signIn: boolean }) {
  const { apiBase } = useData()
  const location = useLocation()
  if (!signIn) {
    return (
      <div role="alert" data-slot="note">
        <p>Your roles do not include this.</p>
      </div>
    )
  }
  return (
    <section aria-label="Sign in to read" data-slot="missing-panel">
      <p>Sign in to read this.</p>
      {apiBase === undefined ? null : (
        <p>
          <a
            data-slot="ghost-button"
            href={loginHref(apiBase, location.pathname + location.search)}
          >
            Sign in
          </a>
        </p>
      )}
    </section>
  )
}
