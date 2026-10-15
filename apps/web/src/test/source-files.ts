import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

export const SRC = resolve(import.meta.dirname, "..")

export interface SourceFile {
  /** The path relative to src/, with forward slashes. */
  readonly name: string
  readonly text: string
}

/**
 * The app's own source under src/, for the tests that scan it: every .ts, .tsx and .css file except
 * tests, the test helpers, and the generated primitives in components/ui/, which are kept as
 * generated and restyled from tokens.css.
 */
export function sourceFiles(): SourceFile[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        return path === join(SRC, "components/ui") || path === join(SRC, "test") ? [] : walk(path)
      }
      return /\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
    })
  return walk(SRC).map((path) => ({
    name: relative(SRC, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  }))
}
