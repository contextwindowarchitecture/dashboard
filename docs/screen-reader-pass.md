# The screen reader pass

What a person runs with a screen reader over the pages the automated checks cannot hear. Axe runs on
every page type, and the tests hold what a screen reader is given: names, roles, descriptions, live
regions and where focus goes after each action (`apps/web/e2e/a11y.spec.ts`, `apps/web/e2e/smoke.spec.ts`,
the component tests). None of that is a person listening. This is.

Run it against the live host, <https://dashboard.contextwindowarchitecture.io>, or `pnpm dev`, with
VoiceOver on macOS in Safari (Command-F5) and, when there is one to hand, NVDA on Windows in Firefox.
Navigate by keyboard only: Tab, the rotor (VoiceOver-U) or the elements list (NVDA-F7), and the
arrow keys inside lists and tables. For each step, note what was heard where it differs from what
should be; a step passes when what is heard says the same thing, in any words the reader uses.

Record the run in the plan's DP-20 "as built": the date, the reader, the browser, and each step that
did not pass.

## The trace inspector

Open an assembled event from the stream (`/traces`, Tab to a row, Enter).

| Step | What should be heard |
| --- | --- |
| The page opens | Focus on the title: the event's id, heading level 1 |
| The headings list | The page's title, then each panel's heading in reading order |
| Tab to the tabs | A tab list; each tab named (Items, Excluded, …), the current one selected |
| Into an included item | The item's id, then its metadata: authority, trust, effective tier, freshness, expires, source, source version, lineage, injection risk, relevance, scope, producer (R-DASH-1) |
| An item whose body is withheld | "body withheld", that it is for your role, and the setting that would grant it |
| The excluded tab, then the stage walk | Each stage announced as the walk reaches it, without moving focus |
| A reason-code chip, Enter | The glossary opens as a dialog named by its kicker; Escape returns focus to the chip |

## The shadow page

Open `/shadow`, choose a corpus from the table.

| Step | What should be heard |
| --- | --- |
| The corpora table | A table named Corpora, its column headers read with each cell |
| Choose a corpus | The corpus's link; the page stays where it was |
| Start from | A combobox named Start from; the options read as the arrow keys move |
| Shadow | "Replaying … events twice", then the report's status line, read without moving focus |
| A run that is refused | The service's words, read at once (an alert) |

## The vault control

Open an event of a route opted into the vault (the default tenant's demo has one), Items tab.

| Step | What should be heard |
| --- | --- |
| The Vault panel | A region named Vault, then what it is and who may resolve |
| Signed out, the operator token | A password field named Operator token; Use the token, disabled until something is typed |
| Resolve from the vault | The resolved body takes focus: "Resolved body", then the text |
| A refusal | The reason, read at once (an alert); focus stays on the button |

## Sign-in

From any page.

| Step | What should be heard |
| --- | --- |
| The masthead, signed out | A link named sign in |
| After signing in | Back on the page you left; a button named Account: your name |
| The account button | A menu; your name and email; Sign out |
| Sign out | Focus on the sign in link |
| A page your roles do not reach | "Sign in to read this." with the link, or "Your roles do not include this." |

## Authoring

Sign in as an owner of a route, open `/authoring`.

| Step | What should be heard |
| --- | --- |
| Signed out | A region named Sign in to draft, and the sign in link |
| Your drafts | A table named Your drafts, each draft's route a link |
| Start from, then Start a draft | The draft opens, and focus is on the page's title |
| A field | Its name (the contract's), then its description; Required where it is |
| Type a value it cannot hold | Nothing interrupts; Tab away and back: the field is invalid, its problem read first |
| The contract's problems | A region named Problems, each problem by path |
| Save | "Saved at …", read without moving focus |
| Replay, then Shadow | Each answer read when it arrives, without moving focus |
| Publish | "Publishing…", then the pull request's name as a link, or why not |
| Delete | Focus on Delete the draft for good; Keep it returns focus to Delete |
| All your drafts | The list, and focus on the page's title |
