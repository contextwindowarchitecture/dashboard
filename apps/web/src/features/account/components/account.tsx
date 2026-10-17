// The masthead's account control (ADR-0010): "sign in" for a reader who is not, a menu with their
// name and "Sign out" for one who is, and nothing where there is no sign-in. Signing in is a
// navigation to the API, which sends the reader to the issuer and back to this page.

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { useLocation } from "react-router"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { useData } from "../../../data/data-context"
import { loginHref, signOut, useMe } from "../api/me"

export function Account() {
  const { apiBase, fetchFn = fetch } = useData()
  const me = useMe()
  const location = useLocation()
  const client = useQueryClient()
  // Signing out removes the menu that had the focus; the focus goes to the sign-in link that replaces it.
  const signedOut = useRef(false)
  const link = useRef<HTMLAnchorElement>(null)
  const kind = me.data?.kind
  useEffect(() => {
    if (kind === "signed-out" && signedOut.current) {
      signedOut.current = false
      link.current?.focus()
    }
  }, [kind])
  if (apiBase === undefined || me.data === undefined || me.data.kind === "none") return null
  if (me.data.kind === "signed-out") {
    return (
      <a
        ref={link}
        data-slot="ghost-button"
        href={loginHref(apiBase, location.pathname + location.search)}
      >
        sign in
      </a>
    )
  }
  const { name, email } = me.data
  return (
    // Not modal: a modal menu hides the page from assistive technology while it stays focusable.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger data-slot="ghost-button" aria-label={`Account: ${name}`}>
        <span data-slot="account-name">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span data-slot="account-label">
            Signed in as {name}
            {email ? <span data-slot="cell-note"> · {email}</span> : null}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            signedOut.current = true
            void signOut(apiBase, fetchFn).then(() =>
              client.invalidateQueries({ queryKey: ["me"] }),
            )
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
