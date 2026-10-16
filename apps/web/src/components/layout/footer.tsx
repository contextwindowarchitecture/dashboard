// The footer (STYLE.md 6): the specification's one-line description, the build, the contract the
// lock pins, and the links every page carries.

import { CONTRACT_SOURCE } from "@cwa-dashboard/contract/data"

import { LINKS } from "../../lib/links"

export function Footer() {
  const contract = CONTRACT_SOURCE.commit.slice(0, 7)
  return (
    <footer data-slot="footer">
      <p>Context Window Architecture is a context assembler specification, not a library.</p>
      <p data-slot="footer-links">
        <span>build {__BUILD_COMMIT__}</span>
        <a href={`${LINKS.specification}/tree/${CONTRACT_SOURCE.commit}`}>contract {contract}</a>
        <a href={LINKS.specification}>specification</a>
        <a href={LINKS.site}>contextwindowarchitecture.io</a>
        <a href={LINKS.organisation}>GitHub</a>
      </p>
    </footer>
  )
}
