# ADR-0009: A content-addressed vault keeps redacted bodies for the operator

- Status: accepted
- Date: 2026-10-17

## Context

A route under `digest_only` or `pii_scrubbed` sends no original body: the event holds its SHA-256 and its token count, so an auditor who needs the body later cannot have it (dashboard-plan.md, devil's advocate 7). D8 keeps that irreversible form and adds an opt-in one from Phase 2: the wrapper deposits each original body in a vault, keyed by the digest the event already carries, and an authorised reader resolves it. `assembly-event` v1 reserved `vault {base, kms_key_id?}` for it. Phase 2 has no roles (P2-D5): resolution sits behind one operator token, and the auditor and owner split waits for Phase 3's RBAC.

## Decision

```mermaid
sequenceDiagram
  participant W as Wrapper
  participant A as Ingest service
  participant V as Vault (VAULT_DIR or PostgreSQL)
  participant B as Inspector
  W->>A: PUT /bodies/<sha256> (ingest token), each redacted body's original bytes
  A->>A: SHA-256 of the bytes is the path's; JSON is its RFC 8785 form
  A->>V: keep the bytes and their media type
  W->>A: POST /events, the event with vault.base and only the digests
  B->>A: GET /bodies/<sha256> (operator token, typed by the reader, kept in memory)
  A->>V: read
  A-->>B: the bytes, never cached
  B->>B: SHA-256 of the bytes equals the event's content_sha256, or nothing is shown
```

- **The setting** is `routes.<route>.vault: true` in the wrapper's configuration, with the vault's `base` and the ingest token beside the sender's. It applies to a route under `pii_scrubbed` or `digest_only`; under `full` the body is already in the event, and the wrapper refuses the setting.
- **What is deposited** is exactly what `content_sha256` digests: a string body's UTF-8 bytes as `text/plain; charset=utf-8`, any other body's RFC 8785 serialization as `application/json`. Each is put at `PUT /bodies/<sha256>` before the event is sent, with the ingest token. The service refuses bytes whose SHA-256 is not the path's, a JSON body that is not in its RFC 8785 form, and any other media type. A body already held answers 200: the same digest is the same bytes.
- **The event says where**: `vault.base` is the API the wrapper deposited into. The dashboard resolves through its own API (`apiBase`) and names the event's base beside a body it cannot find.
- **Reading and erasing need the operator token**, `VAULT_TOKEN`, distinct from the ingest token, so a wrapper, which holds the ingest token, cannot read every body. `GET /bodies/<sha256>` answers the bytes with their media type and `cache-control: no-store`; `DELETE /bodies/<sha256>` erases one, for an erasure request. Without `VAULT_TOKEN` both answer 503 and the inspector says so. There is no listing.
- **Where bodies are kept**: in PostgreSQL, a table of migration 5, when the service has `DATABASE_URL`; otherwise in `VAULT_DIR`, which the service refuses inside the event tree, since the web server serves the tree under `/data/` without a token. Without either, there is no vault and `PUT` answers 503.
- **The browser verifies, it does not reveal.** The reader types the operator token into the inspector; it stays in the page's memory and is never stored. Each body resolves when asked, one at a time. The inspector computes the SHA-256 of the bytes the vault returned and shows the body only when it equals the event's `content_sha256`, labelled as resolved from the vault; otherwise it says the vault returned other bytes. The access decision is the service's.
- **`kms_key_id`** stays reserved: this service keeps the bytes as deposited, and encryption at rest is the database's or the volume's. The inspector shows the key id when an event names one.
- **The demo** opts one route into the vault: the pull-request review scenario, under `digest_only`. The generator writes its deposits beside the tree (`packages/demo-traffic/vault/`, never under `fixtures/`), and the browser tests and `deploy/seed-events.mjs` deposit them.

## Consequences

- A vault holds the bodies the redaction kept out of the events: PII at rest, under the database's or the volume's protection and one token. A deployment that cannot accept that leaves routes off the vault; the irreversible forms stay.
- One token reads every body. Phase 3 replaces it with roles and per-route access.
- A deposit that fails leaves an event naming a vault without its body; the inspector says the vault does not hold it.

## Left open

Per-route and per-reader access (Phase 3), retention by age, encryption with the event's `kms_key_id`, and an audit log of resolutions.
