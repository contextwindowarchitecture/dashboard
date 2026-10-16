// The sandbox's controls (dashboard-plan.md 7.8): what the reader changes in a snapshot before it is
// replayed: the budget, the profile (only one the registry binds to the same route and policy
// version, R-20), items left out, and the assembly time moved. A pure edit of the snapshot the
// reader asks for (a tokenizer or renderer too); what the assembler then decides is the replay's,
// never computed here.

import type { Snapshot as ContractSnapshot } from "@cwa-dashboard/contract/types"
import { REGISTRY } from "@cwa-dashboard/contract/registry"

export type Snapshot = ContractSnapshot

export interface Controls {
  readonly input?: number
  readonly reserved_output?: number
  readonly margin_percent?: number
  /** A registry profile as "id@version"; absent keeps the snapshot's own. */
  readonly profile?: string
  /** Item ids to leave out of every batch. */
  readonly off?: readonly string[]
  /** Seconds to move assembly_time by, to expire items or bring them into date. */
  readonly offset?: number
  /** A published tokenizer or renderer in place of the snapshot's (conformance/README.md). */
  readonly tokenizer?: string
  readonly renderer?: string
}

export interface ProfileChoice {
  /** "" for the snapshot's own profile, else "id@version". */
  readonly value: string
  readonly label: string
  readonly available: boolean
  readonly reason?: string
}

/** The snapshot's own profile, then every registry profile, those it may not use disabled (R-20). */
export function profileChoices(snapshot: Snapshot): ProfileChoice[] {
  const { route, version } = snapshot.route_policy
  return [
    {
      value: "",
      label: `${snapshot.profile.id} v${snapshot.profile.version} · as recorded`,
      available: true,
    },
    ...REGISTRY.profiles.map((profile) => {
      const fits = profile.route === route && profile.route_policy_version === version
      return {
        value: `${profile.id}@${profile.version}`,
        label: `${profile.id} v${profile.version}`,
        available: fits,
        ...(fits
          ? {}
          : {
              reason: `R-20: it binds ${profile.route} ${profile.route_policy_version}; this snapshot runs ${route} ${version}.`,
            }),
      }
    }),
  ]
}

export function applyControls(
  snapshot: Snapshot,
  controls: Controls,
): { snapshot: Snapshot; problems: string[] } {
  const out = structuredClone(snapshot)
  const problems: string[] = []
  const budget = { ...out.budget }
  if (controls.input !== undefined) budget.input = controls.input
  if (controls.reserved_output !== undefined) budget.reserved_output = controls.reserved_output
  if (controls.margin_percent !== undefined) budget.margin_percent = controls.margin_percent
  out.budget = budget
  if (controls.off !== undefined && controls.off.length > 0) {
    const off = new Set(controls.off)
    out.batches = out.batches.map((batch) => ({
      ...batch,
      // The generated type leaves a batch's items open; every item has an id (context_item.schema.json).
      items: batch.items.filter((item) => !off.has((item as { id: string }).id)),
    }))
  }
  if (controls.offset !== undefined && controls.offset !== 0) {
    out.assembly_time = new Date(
      Date.parse(out.assembly_time) + controls.offset * 1000,
    ).toISOString()
  }
  if (controls.tokenizer !== undefined) out.tokenizer = controls.tokenizer
  if (controls.renderer !== undefined) out.renderer = controls.renderer
  if (controls.profile !== undefined && controls.profile !== "") {
    const choice = profileChoices(snapshot).find((c) => c.value === controls.profile)
    if (choice === undefined) problems.push(`The registry holds no profile ${controls.profile}.`)
    else if (!choice.available) problems.push(choice.reason!)
    else {
      const [id, version] = controls.profile.split("@")
      out.profile = structuredClone(
        REGISTRY.profiles.find((p) => p.id === id && String(p.version) === version)!,
      )
    }
  }
  return { snapshot: out, problems }
}
