// RFC 8785, the JSON Canonicalization Scheme: the one serialization a digest is taken over, here
// for the bodies a wrapper redacts and for the registry digests an index records.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The RFC 8785 (JSON Canonicalization Scheme) serialization of a JSON value: object members sorted
 * by their names' UTF-16 code units, at every depth, with no whitespace; strings and numbers as
 * ECMAScript's JSON.stringify writes them, which is what the scheme specifies.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isRecord(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${members.join(",")}}`
  }
  return JSON.stringify(value)
}
