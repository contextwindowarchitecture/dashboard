// The Items tab (dashboard-plan.md 7.3): every included occurrence in placement order, joined to its
// candidate. The metadata is shown in every redaction mode (R-DASH-1); the body in the form the mode
// left it, and a redacted body names the wrapper setting that would reveal it (R-DASH-2). For a route
// opted into the vault (ADR-0009), the operator resolves a redacted body with the operator token; the
// service decides, and the body is shown only when its bytes are the ones the event digests.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { planeStyle } from "../../../lib/plane"
import { Badge } from "../../../components/ui/badge"
import { formatCount, formatInstant, formatTokens } from "../../../lib/format"
import { useData } from "../../../data/data-context"
import { useMe } from "../../account/api/me"
import { resolveBody, type VaultAnswer } from "../api/vault"
import { type Body, type ItemRow, joinItems } from "../model/inspector"

interface VaultAccess {
  readonly base: string
  readonly apiBase: string
  /** The operator token, in this page's memory only; undefined until the reader gives one. */
  readonly token: string | undefined
  /** A signed-in reader resolves by session, naming this event and its tenant (ADR-0012). */
  readonly session: { readonly event: string; readonly tenant: string } | undefined
}
const VaultContext = createContext<VaultAccess | undefined>(undefined)

const TIER_SOURCE = { item: "item", "slot-default": "slot default", route: "route" } as const

function Meta({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <span data-slot="meta">
      <span data-slot="meta-label">{label}</span> {children}
    </span>
  )
}

function Counts({ counts }: { readonly counts: Record<string, number> }) {
  const entries = Object.entries(counts)
  if (entries.length === 0) return <>not counted (the body was not text)</>
  return (
    <>
      {entries.map(([tokenizer, count]) => `${formatTokens(count)} under ${tokenizer}`).join(", ")}
    </>
  )
}

function RevealNote({ route }: { readonly route: string }) {
  return (
    <p data-slot="note">
      The wrapper redacted this body before the event left the service. Setting{" "}
      <code>{`routes.${route}.redaction_mode`}</code> to <code>full</code> in the wrapper's
      configuration records bodies as they were emitted.
    </p>
  )
}

function VaultPanel({
  vault,
  apiBase,
  token,
  onToken,
  signedInAs,
}: {
  readonly vault: NonNullable<AssemblyEventV1["vault"]>
  readonly apiBase: string | undefined
  readonly token: string | undefined
  readonly onToken: (token: string | undefined) => void
  /** The signed-in reader's name; they resolve by session, as far as their roles own the route. */
  readonly signedInAs: string | undefined
}) {
  const [typed, setTyped] = useState("")
  // The control a token change replaces had the focus; it goes to the one that takes its place.
  const moved = useRef(false)
  const field = useRef<HTMLInputElement>(null)
  const forget = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    ;(token === undefined ? field.current : forget.current)?.focus()
  }, [token])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (typed !== "") {
      moved.current = true
      onToken(typed)
    }
    setTyped("")
  }
  return (
    <section aria-label="Vault" data-slot="panel" data-padded="">
      <p data-label="">Vault</p>
      <p>
        This route keeps its bodies in the vault at <code data-mono="">{vault.base}</code>
        {vault.kms_key_id ? (
          <>
            , under key <code data-mono="">{vault.kms_key_id}</code>
          </>
        ) : null}
        . The route&rsquo;s owner resolves one signed in, the operator with the operator token: the
        service decides, and a body is shown only when its bytes are the ones the event digests.
      </p>
      {apiBase !== undefined && signedInAs !== undefined && token === undefined ? (
        <p data-slot="cell-note">
          You resolve its bodies as {signedInAs}, where your roles own this route.
        </p>
      ) : apiBase === undefined ? (
        <p data-slot="cell-note">
          The service is not configured: <code>config.json</code> names no apiBase, so nothing can
          resolve a body.
        </p>
      ) : token === undefined ? (
        <form data-slot="field-row" onSubmit={submit}>
          <div data-slot="field">
            <label htmlFor="vault-token" data-label="">
              Operator token
            </label>
            <input
              ref={field}
              id="vault-token"
              type="password"
              autoComplete="off"
              data-slot="input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <button type="submit" data-slot="ghost-button" disabled={typed === ""}>
            Use the token
          </button>
        </form>
      ) : (
        <p data-slot="chip-row">
          <span data-slot="cell-note">The token is held for this page only.</span>
          <button
            ref={forget}
            type="button"
            data-slot="ghost-button"
            onClick={() => {
              moved.current = true
              onToken(undefined)
            }}
          >
            Forget the token
          </button>
        </p>
      )}
    </section>
  )
}

function Resolve({ sha256 }: { readonly sha256: string }) {
  const access = useContext(VaultContext)
  const { fetchFn = fetch } = useData()
  const [answer, setAnswer] = useState<VaultAnswer | "running" | undefined>(undefined)
  const inFlight = useRef<AbortController | null>(null)
  // A resolved body takes the place of the button that had the focus, so it takes the focus.
  const resolved = useRef<HTMLElement>(null)
  const ok = answer !== undefined && answer !== "running" && answer.kind === "ok"
  useEffect(() => {
    if (ok) resolved.current?.focus()
  }, [ok])
  if (access === undefined || (access.token === undefined && access.session === undefined))
    return null
  const { apiBase, base, token, session } = access
  const resolve = async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setAnswer("running")
    try {
      const got = await resolveBody(apiBase, sha256, token ?? session!, fetchFn, controller.signal)
      if (!controller.signal.aborted) setAnswer(got)
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }
  if (answer !== undefined && answer !== "running" && answer.kind === "ok") {
    return (
      <section ref={resolved} tabIndex={-1} aria-label="Resolved body" data-slot="stack">
        <p data-label="">resolved from the vault · SHA-256 checked</p>
        <pre>{answer.text}</pre>
      </section>
    )
  }
  const words: Record<Exclude<VaultAnswer["kind"], "ok">, () => string> = {
    mismatch: () => "The vault returned other bytes than the event digests; nothing is shown.",
    unauthorised: () => "The service refused the token.",
    "not-found": () =>
      `This dashboard's vault does not hold it; the event names ${base} as where it was deposited.`,
    "not-configured": () =>
      (answer as { problems: readonly string[] }).problems.join(" ") ||
      "The service keeps no vault.",
    failed: () => (answer as { message: string }).message,
  }
  return (
    <div data-slot="stack">
      <div>
        <button
          type="button"
          data-slot="ghost-button"
          // Not disabled while running: a disabled button would drop the reader's focus.
          onClick={() => {
            if (answer !== "running") void resolve()
          }}
          aria-disabled={answer === "running"}
          aria-busy={answer === "running"}
        >
          Resolve from the vault
        </button>
      </div>
      {answer !== undefined && answer !== "running" ? (
        <p role="alert" data-slot="note">
          {words[answer.kind as Exclude<VaultAnswer["kind"], "ok">]()}
        </p>
      ) : null}
    </div>
  )
}

function BodyView({
  body,
  tokens,
  route,
}: {
  readonly body: Body
  readonly tokens: number
  readonly route: string
}) {
  switch (body.form) {
    case "text":
      return (
        <details data-slot="item-body">
          <summary>body · {formatTokens(tokens)}</summary>
          <pre>{body.text}</pre>
        </details>
      )
    case "scrubbed":
      return (
        <details data-slot="item-body">
          <summary>body scrubbed at source · pii_scrubbed</summary>
          <pre>{body.text}</pre>
          <dl data-slot="key-values">
            <div>
              <dt>original sha256</dt>
              <dd>{body.content_sha256}</dd>
            </div>
            <div>
              <dt>original tokens</dt>
              <dd>
                <Counts counts={body.token_counts} />
              </dd>
            </div>
          </dl>
          <RevealNote route={route} />
          <Resolve sha256={body.content_sha256} />
        </details>
      )
    case "digest":
      return (
        <details data-slot="item-body">
          <summary>body redacted · digest_only</summary>
          <dl data-slot="key-values">
            <div>
              <dt>sha256</dt>
              <dd>{body.content_sha256}</dd>
            </div>
            <div>
              <dt>tokens</dt>
              <dd>
                <Counts counts={body.token_counts} />
              </dd>
            </div>
          </dl>
          <RevealNote route={route} />
          <Resolve sha256={body.content_sha256} />
        </details>
      )
    case "raw":
      return (
        <details data-slot="item-body">
          <summary>body · not text</summary>
          <pre>{JSON.stringify(body.value, null, 2)}</pre>
        </details>
      )
    case "withheld":
      return (
        <details data-slot="item-body">
          <summary>body withheld · your role</summary>
          <dl data-slot="key-values">
            <div>
              <dt>sha256</dt>
              <dd>{body.content_sha256}</dd>
            </div>
          </dl>
          <p data-slot="note">
            Your roles do not include this route&rsquo;s bodies. The dashboard&rsquo;s access file
            grants them as <code data-mono="">{`owner:${route}`}</code>, by group or to every
            signed-in reader.
          </p>
        </details>
      )
    case "absent":
      return <p data-slot="cell-note">no body</p>
  }
}

function Item({
  row,
  route,
  anchor,
}: {
  readonly row: ItemRow
  readonly route: string
  readonly anchor: boolean
}) {
  return (
    <li
      id={anchor ? `item-${row.item_id}` : undefined}
      data-slot="item-row"
      data-compressed={row.compressed ? "" : undefined}
      style={planeStyle(row.slot)}
    >
      <div data-slot="chip-row">
        <SlotBadge slot={row.slot} />
        <Badge variant="outline" data-tone="plane">
          included · {formatTokens(row.tokens)}
        </Badge>
        {row.compressed ? (
          <Badge variant="outline" data-tone="info">
            compressed {formatCount(row.compressed.from)} → {formatCount(row.compressed.to)}
          </Badge>
        ) : null}
      </div>
      <code data-slot="item-id">{row.item_id}</code>
      <p data-slot="item-meta">
        <Meta label="producer">
          {row.producer.id} · {row.producer.kind}
        </Meta>
        <Meta label="authority">{row.authority}</Meta>
        <Meta label="trust">{row.trust}</Meta>
        {row.tier ? (
          <Meta label="tier">
            {row.tier.tier} ({TIER_SOURCE[row.tier.source]})
          </Meta>
        ) : null}
        {row.lineage ? (
          <Meta label="lineage">
            {row.lineage.value}
            {row.lineage.defaulted ? " (default)" : ""}
          </Meta>
        ) : null}
        {row.injection_risk ? (
          <Meta label="injection_risk">
            {row.injection_risk.value}
            {row.injection_risk.defaulted ? " (default)" : ""}
          </Meta>
        ) : null}
        <Meta label="freshness">{formatInstant(row.freshness)}</Meta>
        {row.expires ? <Meta label="expires">{formatInstant(row.expires)}</Meta> : null}
        <Meta label="source">{row.source}</Meta>
        <Meta label="version">{row.source_version}</Meta>
        {row.relevance !== undefined ? <Meta label="relevance">{row.relevance}</Meta> : null}
        {row.scope ? (
          <Meta label="scope">
            {Object.entries(row.scope)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" ")}
          </Meta>
        ) : null}
      </p>
      {row.compressed ? (
        <p data-slot="cell-note">
          {row.compressed.method}
          {row.compressed.variant_id ? ` · variant ${row.compressed.variant_id}` : ""}
        </p>
      ) : null}
      {row.eligibility ? <p data-slot="cell-note">{row.eligibility}</p> : null}
      <BodyView body={row.body} tokens={row.tokens} route={route} />
    </li>
  )
}

export function ItemsTab({ event }: { readonly event: AssemblyEventV1 }) {
  const rows = joinItems(event)
  const route = event.snapshot?.route_policy.route ?? ""
  const { apiBase, tenant = "default" } = useData()
  const me = useMe().data
  const signedInAs = me?.kind === "signed-in" ? me.name : undefined
  const [token, setToken] = useState<string | undefined>(undefined)
  const vault = event.vault
  const panel =
    vault === undefined ? null : (
      <VaultPanel
        vault={vault}
        apiBase={apiBase}
        token={token}
        onToken={setToken}
        signedInAs={signedInAs}
      />
    )
  if (rows.length === 0) {
    return (
      <p data-slot="cell-note">
        Nothing was included:{" "}
        {event.outcome === "refused" ? "the assembly refused." : "the trace includes no item."}
      </p>
    )
  }
  return (
    <VaultContext.Provider
      value={
        vault === undefined || apiBase === undefined
          ? undefined
          : {
              base: vault.base,
              apiBase,
              token,
              session: signedInAs === undefined ? undefined : { event: event.event_id, tenant },
            }
      }
    >
      {panel}
      <ol data-slot="item-list" aria-label="Included items">
        {rows.map((row, i) => (
          // An item placed twice is linked to at its first occurrence.
          <Item
            key={row.index}
            row={row}
            route={route}
            anchor={rows.findIndex((r) => r.item_id === row.item_id) === i}
          />
        ))}
      </ol>
    </VaultContext.Provider>
  )
}
