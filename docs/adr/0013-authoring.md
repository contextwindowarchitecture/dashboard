# ADR-0013: A route's owner drafts a policy or a profile, previewed by the real assembler, kept in the API

- Status: accepted
- Date: 2026-10-17

## Context

Phase 3's second half is authoring (dashboard-plan.md DP-18, DP-19): a route's owner changes a route policy or a profile and sees what it would do before it ships. The pieces to see it exist: the contract's precompiled validators, `/replay` (ADR-0005) and `/shadow` (ADR-0008). Three rules bound the editor: the dashboard never assembles (a preview is the pinned assembler's), never invents vocabulary (every field the editor shows is the contract's, with the contract's words), and keeps nothing a reader may not see in the browser's storage.

## Decision

- **Who authors**: a signed-in reader who owns the draft's route in the tenant the page reads (`owner:<route>`, ADR-0011, ADR-0012). A route policy and a profile both name their route; a draft whose route its author does not own is not saved.
- **Drafts live in the API**, per author, in PostgreSQL (migration 8): `GET /drafts.json` lists the reader's own, `GET`, `PUT` and `DELETE /drafts/<id>.json` read, keep and remove one. A draft holds its kind (`route_policy` or `profile`), what it started from (a registry entry, by id and version or route and version), and the document as last saved, valid or not: an author saves work in progress. Nothing of a draft is kept in the browser's storage, and another author's drafts are not there to read (404). A draft is at most the API's request size.
- **The editor is the contract's**: the structured view's fields are the schema's top-level properties, in its order, with its names and descriptions (`FIELDS`, generated from the vendored schemas like every other contract datum); a scalar is an input, an object or an array a JSON field of its own. A JSON view edits the whole document. Both are checked by the contract's precompiled validators, which name every problem by path; the diff against the starting document lists every changed path, before and after.
- **A preview is the assembler's**: a chosen event of the draft's route, its snapshot with the draft in place of its route policy or profile, replayed through `/replay`, beside what the event recorded; and a frozen corpus shadowed with the draft as the candidate, through `/shadow`, read as the shadow page reads it. A draft the assembler rejects is shown rejected, with the assembler's problems.
- **Publishing is DP-19's**; a draft goes nowhere until then.

## Consequences

- An author's work survives a reload and another browser, and leaves no copy where the next person at the machine can read it.
- The editor changes when the contract does, with no code to change for a new top-level field.
- A preview needs a recorded event of the route, in full; a route with none is previewed by shadow only, or not at all.

## Left open

Editing deeper than the top level field by field, a draft shared between authors, and comments.
