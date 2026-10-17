// The body vault (ADR-0009): the original bodies a route under pii_scrubbed or digest_only keeps out
// of its events, deposited by the wrapper under the content_sha256 the event carries, and read back
// by the operator. A deposit is exactly the bytes the digest covers: a string body's UTF-8 bytes,
// any other body's RFC 8785 serialization. The directory vault is here; the PostgreSQL store keeps
// one in a table of its own (postgres-store.ts).

import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"

export const TEXT_TYPE = "text/plain; charset=utf-8"
export const JSON_TYPE = "application/json"
export type MediaType = typeof TEXT_TYPE | typeof JSON_TYPE

export interface Deposit {
  readonly bytes: Uint8Array
  readonly mediaType: MediaType
}

export interface BodyVault {
  /** Keeps a checked deposit; a digest already held is the same bytes, and is left as it is. */
  put(sha256: string, deposit: Deposit): Promise<"stored" | "held">
  get(sha256: string): Promise<Deposit | undefined>
  /** Erases a body; false when there was none. */
  delete(sha256: string): Promise<boolean>
}

export const SHA256 = /^[0-9a-f]{64}$/

function mediaTypeOf(contentType: string | undefined): MediaType | undefined {
  const [type, ...parameters] = (contentType ?? "")
    .split(";")
    .map((part) => part.trim().toLowerCase())
  const charset = parameters.find((p) => p.startsWith("charset="))?.slice("charset=".length)
  if (type === "text/plain" && charset === "utf-8") return TEXT_TYPE
  if (type === "application/json" && (charset === undefined || charset === "utf-8"))
    return JSON_TYPE
  return undefined
}

export type Checked =
  | { readonly ok: true; readonly deposit: Deposit }
  | { readonly ok: false; readonly problems: string[] }

/** Whether bytes sent under a digest and a content type are a deposit the vault takes. */
export function checkDeposit(
  sha256: string,
  bytes: Uint8Array,
  contentType: string | undefined,
): Checked {
  if (!SHA256.test(sha256))
    return { ok: false, problems: ["The digest must be a lowercase hexadecimal SHA-256."] }
  const mediaType = mediaTypeOf(contentType)
  if (mediaType === undefined) {
    return {
      ok: false,
      problems: [`A body is sent as ${TEXT_TYPE} (a string body) or ${JSON_TYPE} (any other).`],
    }
  }
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    return { ok: false, problems: ["The bytes' SHA-256 is not the digest named."] }
  }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, problems: ["The body is not UTF-8."] }
  }
  if (mediaType === JSON_TYPE) {
    let canonical: string | undefined
    try {
      canonical = canonicalJson(JSON.parse(text))
    } catch {
      canonical = undefined
    }
    if (canonical !== text) {
      return {
        ok: false,
        problems: [
          "A JSON body is sent in its RFC 8785 serialization, the bytes content_sha256 digests.",
        ],
      }
    }
  }
  return { ok: true, deposit: { bytes, mediaType } }
}

const EXTENSION: Record<MediaType, string> = { [TEXT_TYPE]: "txt", [JSON_TYPE]: "json" }

/**
 * A vault in a directory: `<dir>/<first two hex digits>/<sha256>.txt|.json`, each written to a
 * temporary name and renamed, so a reader never sees half a body. The directory must not be one the
 * web server serves (open-store.ts refuses one inside the event tree).
 */
export function directoryVault(dir: string): BodyVault {
  // A digest names a file here, so nothing else may: the routes check, and so does the vault.
  const path = (sha256: string, mediaType: MediaType) => {
    if (!SHA256.test(sha256)) throw new Error(`${JSON.stringify(sha256)} is not a SHA-256 digest`)
    return join(dir, sha256.slice(0, 2), `${sha256}.${EXTENSION[mediaType]}`)
  }
  async function get(sha256: string): Promise<Deposit | undefined> {
    path(sha256, TEXT_TYPE)
    for (const mediaType of [TEXT_TYPE, JSON_TYPE] as const) {
      try {
        return { bytes: new Uint8Array(await readFile(path(sha256, mediaType))), mediaType }
      } catch {
        // not under this type
      }
    }
    return undefined
  }
  return {
    async put(sha256, deposit) {
      path(sha256, deposit.mediaType)
      if ((await get(sha256)) !== undefined) return "held"
      const target = path(sha256, deposit.mediaType)
      await mkdir(join(dir, sha256.slice(0, 2)), { recursive: true })
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporary, deposit.bytes, { mode: 0o600 })
      await rename(temporary, target)
      return "stored"
    },
    get,
    async delete(sha256) {
      const held = await get(sha256)
      if (held === undefined) return false
      await rm(path(sha256, held.mediaType), { force: true })
      return true
    },
  }
}
