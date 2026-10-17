// Deposits the demo vault's bodies for playwright.api.config.ts (ADR-0009), as the review agent's
// wrapper would: each with the ingest token, under its digest. The tree run points VAULT_DIR at a
// copy of the same files instead.

import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { API_INGEST_PORT, INGEST_TOKEN } from "./env"

const vault = resolve(import.meta.dirname, "../../../packages/demo-traffic/vault")

test("the vault holds the demo's deposited bodies", async ({ request }) => {
  for (const prefix of readdirSync(vault)) {
    for (const name of readdirSync(join(vault, prefix))) {
      const [sha, extension] = name.split(".")
      const response = await request.put(`http://127.0.0.1:${API_INGEST_PORT}/bodies/${sha}`, {
        headers: {
          authorization: `Bearer ${INGEST_TOKEN}`,
          "content-type": extension === "json" ? "application/json" : "text/plain; charset=utf-8",
        },
        data: readFileSync(join(vault, prefix, name)),
      })
      expect([200, 201], name).toContain(response.status())
    }
  }
})
