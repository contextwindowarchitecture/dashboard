// OKLCH to sRGB and WCAG contrast, for the style tests. The conversion is Björn Ottosson's OKLab
// (https://bottosson.github.io/posts/oklab/), clipped to the sRGB gamut as a browser displays it.

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/

/** The linear-light sRGB channels of an `oklch(L C H)` value, each clipped to 0..1. */
export function oklchToLinearRgb(value: string): Rgb {
  const match = OKLCH.exec(value.trim())
  if (!match) throw new Error(`not an oklch() value: ${value}`)
  const [lightness, chroma, hue] = match.slice(1).map(Number) as [number, number, number]
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (x: number) => Math.min(1, Math.max(0, x))
  return {
    r: clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

/** The 8-bit sRGB channels of an `oklch(L C H)` value. */
export function oklchToSrgb8(value: string): Rgb {
  const encode = (x: number) =>
    Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
  const { r, g, b } = oklchToLinearRgb(value)
  return { r: encode(r), g: encode(g), b: encode(b) }
}

export function hexToSrgb8(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) throw new Error(`not a #rrggbb value: ${hex}`)
  const [r, g, b] = match.slice(1).map((part) => Number.parseInt(part, 16)) as [
    number,
    number,
    number,
  ]
  return { r, g, b }
}

/** WCAG 2 contrast ratio between two `oklch()` colours. */
export function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const { r, g, b } = oklchToLinearRgb(value)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (lighter! + 0.05) / (darker! + 0.05)
}
