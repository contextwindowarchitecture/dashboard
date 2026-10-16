// The width an element is laid out at, for a chart that draws in pixels (dashboard-plan.md 8): the
// fallback until the element is measured, then whatever ResizeObserver reports.

import { useLayoutEffect, useRef, useState } from "react"

export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => {
      const measured = entry?.contentRect.width
      if (measured) setWidth(measured)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}
