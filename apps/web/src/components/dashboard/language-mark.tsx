// An assembler's language (STYLE.md 3, Languages and services): a category, not an outcome, so it
// has no hue; its symbol in currentColor and its word, as implementations/index.json names it.

import { IMPLEMENTATION_INDEX } from "@cwa-dashboard/contract/data"

const SYMBOLS: Record<string, "circle" | "square" | "triangle" | "diamond"> = {
  python: "circle",
  typescript: "square",
  go: "triangle",
  rust: "diamond",
}

const SHAPES = {
  circle: <circle cx="4" cy="4" r="3.5" />,
  square: <rect x="0.5" y="0.5" width="7" height="7" />,
  triangle: <polygon points="4,0.5 7.5,7.5 0.5,7.5" />,
  diamond: <polygon points="4,0 8,4 4,8 0,4" />,
}

export function LanguageMark({ language }: { readonly language: string }) {
  const label = IMPLEMENTATION_INDEX.find((entry) => entry.id === language)?.label ?? language
  const symbol = SYMBOLS[language]
  return (
    <span data-slot="language-mark">
      {symbol ? (
        <svg
          aria-hidden="true"
          data-symbol={symbol}
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="currentColor"
        >
          {SHAPES[symbol]}
        </svg>
      ) : null}
      <span>{label}</span>
    </span>
  )
}
