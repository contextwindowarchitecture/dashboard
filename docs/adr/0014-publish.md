# ADR-0014: Publish opens a pull request in the tenant's policy repository, as a GitHub App

- Status: accepted
- Date: 2026-10-17

## Context

A draft (ADR-0013) goes nowhere until it is published (dashboard-plan.md DP-19, P3-D6, P3-D7). Route policies and profiles are an adopter's, not the specification's: they belong in a repository the adopter owns, reviewed as code, gated by the shadow run (ADR-0008) before they merge. The dashboard must never hold a reader's GitHub token in the browser, must act only where the repository has let it, and must stay useful where nothing is configured.

## Decision

- **A policy repository** has one layout, which this repository documents (`deploy/policy-repository/README.md`) and checks (`deploy/policy-check.mjs`):

  ```text
  route-policies/<route>/<version>.json   a route policy, the contract's schema
  profiles/<id>/<version>.json            a profile, the contract's schema
  shadow.json                             the dashboard's API, the tenant, a corpus per route, the limits
  .github/workflows/policy-check.yml      the check every pull request runs
  ```

  A file's path is its identity: its `route` (or `id`) and `version` are the path's. A version is path segments of letters, digits, dots, dashes and underscores (`illustrative/v1` is two), never `..`. A published version is never edited in place: events pin it by digest, so a change is a new version.
- **Publish is the API's**, `POST /drafts/<id>/publish`, for the draft's author, who must still own its route in its tenant (ADR-0011, ADR-0012), from the page's own origin. A draft the contract's validators refuse is not published, and neither is one whose version the repository already holds (a conflict, named with the path). The API creates the branch `cwa-dashboard/<draft id>` from the repository's default branch, commits the file to it, and opens a pull request whose body names the author (the issuer's name and subject), the draft, where it started, and, when the author names a corpus, the shadow report's counts from a run the API makes itself, never one the browser sends. Publishing the same draft again commits the new document to the same branch and keeps the same pull request. The draft records the pull request (`published` in `draft` v1).
- **As a GitHub App**, `cwa-dashboard-publisher` for the live host: repository permissions Contents and Pull requests read and write, Metadata read, nothing else; no webhook, no user authorization. Installed by the repository's owner on the repositories it may write, so the App's reach is theirs to grant. The API signs a short-lived JWT with the App's private key and takes an installation token scoped to the one repository and those two permissions for each publish; neither reaches the browser. The commit and the pull request are the App's (`<app>[bot]`); the author is named in the body.
- **Configuration**: `GITHUB_APP_DIR`, a directory holding `app-id`, `installation-id` and `private-key.pem` (the cluster secret `dashboard-github-app`, mounted), and `POLICY_REPOSITORIES`, a JSON object naming each tenant's repository (`{"default": "contextwindowarchitecture/policies-demo"}`). `GITHUB_API` points at another GitHub API, for GitHub Enterprise and the tests.
- **Without the App, or for a tenant with no repository**, Publish answers with what to do by hand: the path the file belongs at, the document as the file, and the `git` commands that branch, commit and push it. The page shows them; nothing is written.
- **Each way it can fail has a name**: not configured (the fallback), a refused draft (the validators' problems), a conflict (the version exists), no access (the App is not installed on the repository, or lacks a permission: GitHub's 403 or 404), a refused push (a protected branch or a rule: GitHub's 409 or 422, with its message), and GitHub not answering.
- **The policy repository's check**, `.github/actions/policy-check` at a pinned commit of this repository, runs `deploy/policy-check.mjs`: it checks every file's layout and identity, and for each route a pull request changes, shadows the changed route policy and profile together over the route's corpus in `shadow.json` with its limits (`deploy/shadow-check.mjs`), failing over them. A route without a corpus fails the check, so nothing merges unshadowed. It installs nothing: the shadow run's assembler checks the candidate against the contract, and a rejection counts against `max-candidate-rejected`, 0 by default.

## Consequences

- The App's private key is the one credential that writes anywhere; it lives in one secret, and rotating it is a new key on the App's page and a new secret.
- A repository that protects its default branch keeps every rule it has: the App proposes, people merge.
- A policy repository's check depends on the dashboard's API answering; when it does not, the check fails rather than passes.

## Left open

Reading a policy repository on the registry page (P3-D6's last clause), a repository per tenant in another organisation (another installation), and closing a pull request when its draft is deleted.
