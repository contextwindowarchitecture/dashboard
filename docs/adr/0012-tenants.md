# ADR-0012: Tenants keep their documents apart, and a route's owner resolves its vaulted bodies

- Status: accepted
- Date: 2026-10-17

## Context

Roles decide what a reader may read (ADR-0011), but every event still lands in one pile: two teams' services share one index, one fleet report and one sources report, and an owner of `support-chat` owns every team's `support-chat`. The plan names tenants as the boundary (P3-D4), and the vault's single operator token as the thing roles should replace for reading (P2-D5, ADR-0009). Service names cannot be the boundary: two teams name their services alike.

## Decision

- **An event names its tenant**: `tenant` in `assembly-event` v1, optional, lowercase letters, digits, dots, dashes and underscores, at most 64; set by the wrapper's configuration (`tenant`), never derived. An event without one belongs to `default`.
- **No document mixes tenants.** The default tenant's documents stay where they are (`/data/events/index.json`, `/data/events/<id>.json` and the rest); another tenant's are at `/data/tenants/<tenant>/` in the same layout. An event is found only under its own tenant. The tree keeps another tenant under `tenants/<tenant>/` beside its own files, so the generator and a static host need nothing else; the PostgreSQL store keeps a tenant column on events and corpora (migration 7) and scopes every query by it. `/data/tenants.json` (`tenants` v1) lists the tenants and their events; the API lists only those the reader may read.
- **A role may name a tenant**: `viewer@northwind`, `owner:support-chat@northwind`, `auditor@*`. A role without `@` applies to every tenant, which is what the access files written before tenants meant. An access file may grant `anonymous` the default tenant alone and members every tenant.
- **Corpora and shadow runs belong to a tenant**: a corpus is frozen from one tenant's events, and listed and run for readers of that tenant.
- **The page reads one tenant at a time**, chosen by `?tenant=` and kept across navigation, so a shared link opens the same tenant; the data root, which every query key carries, includes it. The masthead offers the tenants the reader may read when there is more than one.
- **A route's owner resolves a vaulted body by session**: `GET /bodies/<sha256>?event=<id>` answers a reader who owns the event's route in its tenant, and only for a digest that event holds, so a session can never fetch a body by guessing a digest. The operator token keeps its access for automation. Every resolution, by session or by token, is written to the service's log: who (the issuer's subject, or `operator token`), the digest, the event, the time.
- **The demo gains a second tenant**, `northwind`: the support chat's scenario replayed for its own service, its events under `tenants/northwind/`, so the live host shows anonymous readers the default tenant and signed-in members both.

## Consequences

- A wrapper upgraded to set `tenant` starts writing into a tenant whose earlier events, without one, stay in `default`; a deployment that adopts tenants late moves nothing silently.
- The tree stays useful for a single team or a demo; tenancy with roles is PostgreSQL's (P3-D8).
- The log is the audit trail of resolutions until there is a store for it.

## Left open

Moving events between tenants, per-tenant retention, and an audit store queried from the page.
