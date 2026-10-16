// The sandbox's controls in the URL (dashboard-plan.md 6): input, reserved, margin, profile, off,
// offset, tokenizer and renderer beside the event, each read on its own; a value that is not one the
// control takes is left out, never applied.

import type { Controls } from "./controls"

const KEYS = [
  "input",
  "reserved",
  "margin",
  "profile",
  "off",
  "offset",
  "tokenizer",
  "renderer",
] as const

/** A component id as conformance/README.md writes them: lowercase, a slash and a version. */
const COMPONENT = /^[a-z0-9-]+\/v\d+$/

const count = (value: string | null, max = Number.MAX_SAFE_INTEGER) =>
  value !== null && /^\d+$/.test(value) && Number(value) <= max ? Number(value) : undefined

export function controlsFromSearch(search: URLSearchParams): Controls {
  const input = count(search.get("input"))
  const reserved = count(search.get("reserved"))
  const margin = count(search.get("margin"), 100)
  const profile = search.get("profile")
  const off = (search.get("off") ?? "").split(",").filter((id) => id !== "")
  const offset = search.get("offset")
  const tokenizer = search.get("tokenizer")
  const renderer = search.get("renderer")
  return {
    ...(input === undefined ? {} : { input }),
    ...(reserved === undefined ? {} : { reserved_output: reserved }),
    ...(margin === undefined ? {} : { margin_percent: margin }),
    ...(profile !== null && /^[^@\s]+@\d+$/.test(profile) ? { profile } : {}),
    ...(off.length === 0 ? {} : { off }),
    ...(offset !== null && /^-?\d+$/.test(offset) && Number(offset) !== 0
      ? { offset: Number(offset) }
      : {}),
    ...(tokenizer !== null && COMPONENT.test(tokenizer) ? { tokenizer } : {}),
    ...(renderer !== null && COMPONENT.test(renderer) ? { renderer } : {}),
  }
}

export function searchWithControls(search: URLSearchParams, controls: Controls): URLSearchParams {
  const next = new URLSearchParams(search)
  for (const key of KEYS) next.delete(key)
  if (controls.input !== undefined) next.set("input", String(controls.input))
  if (controls.reserved_output !== undefined) next.set("reserved", String(controls.reserved_output))
  if (controls.margin_percent !== undefined) next.set("margin", String(controls.margin_percent))
  if (controls.profile !== undefined && controls.profile !== "")
    next.set("profile", controls.profile)
  if (controls.off !== undefined && controls.off.length > 0) next.set("off", controls.off.join(","))
  if (controls.offset !== undefined && controls.offset !== 0)
    next.set("offset", String(controls.offset))
  if (controls.tokenizer !== undefined) next.set("tokenizer", controls.tokenizer)
  if (controls.renderer !== undefined) next.set("renderer", controls.renderer)
  return next
}

/** Whether the controls change the snapshot at all, so a replay has nothing recorded to compare with. */
export const edited = (controls: Controls) =>
  controls.input !== undefined ||
  controls.reserved_output !== undefined ||
  controls.margin_percent !== undefined ||
  (controls.profile !== undefined && controls.profile !== "") ||
  (controls.off ?? []).length > 0 ||
  (controls.offset ?? 0) !== 0 ||
  controls.tokenizer !== undefined ||
  controls.renderer !== undefined
