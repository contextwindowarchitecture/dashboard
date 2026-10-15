// The TypeScript assembler at the pinned tag, as scripts/build.mjs built it (ADR-0003), and what an
// assembly event says about it, read from the build itself.
export * from "./.build/assembler-typescript/dist/index.js"

export declare const BUILT_ASSEMBLER: {
  /** As implementations/index.json names it. */
  readonly language: "typescript"
  /** The built package's name and version. */
  readonly name: string
  readonly version: string
  /** The tag and commit pin.json pins. */
  readonly tag: string
  readonly commit: string
  /** The contract the assembler's vendored lock pins, and the SHA-256 of that lock's bytes. */
  readonly contract: {
    readonly repository: string
    readonly commit: string
    readonly lock_sha256: string
  }
}
