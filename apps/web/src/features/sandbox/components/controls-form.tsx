// The sandbox's controls (dashboard-plan.md 7.8; STYLE.md 6, Form controls): the budget's input,
// reserve and margin as exact numbers (a refusal can turn on one token), the assembly time's offset,
// the tokenizer and renderer the service lists (required or optional, those it lacks disabled),
// the profile (those R-20 forbids offered disabled, with the reason beside them), and every item
// with a box that leaves it out. Each change goes to the URL; Reset clears them all.

import { useId } from "react"

import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { Checkbox } from "../../../components/ui/checkbox"
import { Input } from "../../../components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select"
import type { Component, Components } from "../api/replay"
import { profileChoices, type Controls, type Snapshot } from "../model/controls"

const RECORDED = "recorded"

function NumberField({
  label,
  value,
  recorded,
  min,
  max,
  onChange,
}: {
  readonly label: string
  readonly value: number | undefined
  readonly recorded: number | undefined
  readonly min?: number
  readonly max?: number
  readonly onChange: (value: number | undefined) => void
}) {
  const id = useId()
  return (
    <div data-slot="field">
      <label htmlFor={id} data-label="">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        {...(min === undefined ? {} : { min })}
        {...(max === undefined ? {} : { max })}
        value={value ?? recorded ?? ""}
        aria-label={label}
        onChange={(e) => {
          const text = e.target.value
          const parsed = Number(text)
          onChange(
            text === "" || !Number.isInteger(parsed) || parsed === recorded ? undefined : parsed,
          )
        }}
      />
    </div>
  )
}

function ComponentField({
  label,
  recorded,
  value,
  list,
  onChange,
}: {
  readonly label: "tokenizer" | "renderer"
  readonly recorded: string
  readonly value: string | undefined
  readonly list: readonly Component[] | undefined
  readonly onChange: (value: string | undefined) => void
}) {
  const id = useId()
  // The snapshot's own, even when the service does not list it (an application's own tokenizer).
  const options = [
    ...(list ?? []),
    ...((list ?? []).some((c) => c.id === recorded)
      ? []
      : [{ id: recorded, required: false, provided: true, own: true }]),
  ]
  return (
    <div data-slot="field">
      <span id={id} data-label="">
        {label}
      </span>
      <Select
        value={value ?? recorded}
        onValueChange={(next) => onChange(next === recorded ? undefined : next)}
        disabled={list === undefined}
      >
        <SelectTrigger aria-labelledby={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c.id} value={c.id} disabled={!c.provided}>
              {"own" in c
                ? `${c.id} · as recorded`
                : `${c.id} · ${c.required ? "required" : "optional"}${c.provided ? "" : " · not provided"}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ControlsForm({
  snapshot,
  controls,
  components,
  onChange,
}: {
  readonly snapshot: Snapshot
  readonly controls: Controls
  /** The service's tokenizers and renderers; undefined until it has said. */
  readonly components: Components | undefined
  readonly onChange: (controls: Controls) => void
}) {
  const set = <K extends keyof Controls>(key: K, value: Controls[K] | undefined) => {
    const next: Record<string, unknown> = { ...controls }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next as Controls)
  }
  const choices = profileChoices(snapshot)
  const off = new Set(controls.off ?? [])
  const profileId = useId()
  return (
    <div role="group" aria-label="Controls" data-slot="sandbox-controls">
      <div data-slot="field-row">
        <NumberField
          label="budget.input"
          value={controls.input}
          recorded={snapshot.budget.input}
          min={0}
          onChange={(v) => set("input", v)}
        />
        <NumberField
          label="budget.reserved_output"
          value={controls.reserved_output}
          recorded={snapshot.budget.reserved_output}
          min={0}
          onChange={(v) => set("reserved_output", v)}
        />
        <NumberField
          label="budget.margin_percent"
          value={controls.margin_percent}
          recorded={snapshot.budget.margin_percent ?? 0}
          min={0}
          max={100}
          onChange={(v) => set("margin_percent", v)}
        />
        <NumberField
          label="assembly_time offset, seconds"
          value={controls.offset}
          recorded={0}
          onChange={(v) => set("offset", v)}
        />
      </div>
      <div data-slot="field-row">
        <ComponentField
          label="tokenizer"
          recorded={snapshot.tokenizer}
          value={controls.tokenizer}
          list={components?.tokenizers}
          onChange={(v) => set("tokenizer", v)}
        />
        <ComponentField
          label="renderer"
          recorded={snapshot.renderer}
          value={controls.renderer}
          list={components?.renderers}
          onChange={(v) => set("renderer", v)}
        />
      </div>
      <div data-slot="field">
        <span id={profileId} data-label="">
          profile
        </span>
        <Select
          value={controls.profile ?? RECORDED}
          onValueChange={(value) => set("profile", value === RECORDED ? undefined : value)}
        >
          <SelectTrigger aria-labelledby={profileId} aria-label="profile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem
                key={choice.value || RECORDED}
                value={choice.value || RECORDED}
                disabled={!choice.available}
              >
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ul aria-label="Profiles this snapshot cannot use" data-slot="cell-note">
          {choices
            .filter((c) => !c.available)
            .map((c) => (
              <li key={c.value}>
                {c.label}: {c.reason}
              </li>
            ))}
        </ul>
      </div>
      <div role="group" aria-label="Items" data-slot="item-boxes">
        {snapshot.batches.map((batch, b) => (
          <fieldset key={b}>
            <legend data-label="">{batch.producer.id}</legend>
            {batch.items.map((raw, i) => {
              const item = raw as { id: string; slot: string }
              const boxId = `sandbox-item-${b}-${i}`
              return (
                <div key={`${b}-${i}`} data-slot="item-box">
                  <Checkbox
                    id={boxId}
                    value={item.id}
                    checked={!off.has(item.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(off)
                      if (checked === true) next.delete(item.id)
                      else next.add(item.id)
                      set("off", next.size === 0 ? undefined : [...next])
                    }}
                  />
                  <label htmlFor={boxId}>
                    <code>{item.id}</code> <SlotBadge slot={item.slot} />
                  </label>
                </div>
              )
            })}
          </fieldset>
        ))}
      </div>
      <div>
        <button type="button" data-slot="ghost-button" onClick={() => onChange({})}>
          Reset
        </button>
      </div>
    </div>
  )
}
