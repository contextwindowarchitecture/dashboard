// The glossary's route module, loaded lazily: it carries the contract's texts, which no other page needs whole.

import { GlossaryView } from "../../features/glossary/components/glossary-view"

export function Component() {
  return <GlossaryView />
}
