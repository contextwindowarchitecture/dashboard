# Policies

The route policies and placement profiles this organisation's services assemble with, each in the Context Window
Architecture contract's own JSON, reviewed here as code before a service runs it. The CWA dashboard drafts them,
previews them against recorded traffic, and opens the pull requests that add them.

## Layout

```text
route-policies/<route>/<version>.json   a route policy: the contract's route_policy schema
profiles/<id>/<version>.json            a placement profile: the contract's profile schema
shadow.json                             where each route's changes are shadowed, and within what limits
.github/workflows/policy-check.yml      the check every pull request runs
```

A file's path is its identity: a route policy's `route` and `version`, a profile's `id` and `version`, are the
path's. A version is path segments of letters, digits, dots, dashes and underscores (`illustrative/v1` is two); a
profile's is a whole number with no leading zero.

**A published version is never edited or removed.** Assemblies record the policy and profile they ran by digest, so
a version that changed under them would make those records lie. A change is a new version: a new file.

## How a change arrives

- **From the dashboard**: a route's owner drafts it on the authoring page, previews it, and presses Publish. The
  dashboard's GitHub App opens a pull request from a branch `cwa-dashboard/<draft>`, naming the author and, when a
  corpus was chosen, the counts of a shadow run over it.
- **By hand**: the same file at the same path, on a branch, in a pull request. Where the dashboard has no App, its
  Publish gives the file and the commands.

Either way, people review and merge; the App never merges.

## The check

Every pull request runs `policy-check`, which:

1. checks every file under `route-policies/` and `profiles/` is where the layout puts it and holds what its path
   names;
2. fails a change to, or a removal of, a published version;
3. for each route the pull request changes, replays the route's corpus in `shadow.json` twice through the
   dashboard's assembler, as recorded and with the new route policy and profile together, and fails over the
   limits.

A route with no corpus in `shadow.json` fails, so nothing merges unshadowed: add the route's corpus first. A check
that cannot reach the dashboard fails rather than passes. Each route's shadow report is kept as the run's artifact.

`shadow.json`:

| Field | What |
| --- | --- |
| `api` | The dashboard's API, where `POST /shadow` answers |
| `tenant` | The tenant the corpora belong to |
| `corpora` | Route to the name of a corpus frozen on the dashboard |
| `limits` | `max-refusals-added`, `max-shedding-increase`, `max-candidate-rejected`: each 0 unless given |
