// Freezes the corpus the shadow page's browser tests run against (ADR-0008): the support chat's
// events under cache-first-chat, frozen through the preview's /api proxy with the ingest token, as an
// operator would. A deployment under test (PLAYWRIGHT_BASE_URL) is not written to.

import { expect, test } from "@playwright/test"

import { E2E_CORPUS, INGEST_TOKEN } from "./env"

test("the store holds the shadow corpus", async ({ request }) => {
  test.skip(!!process.env["PLAYWRIGHT_BASE_URL"], "a deployment's corpora are its operator's")
  const response = await request.post("/api/corpora", {
    headers: { authorization: `Bearer ${INGEST_TOKEN}` },
    data: { name: E2E_CORPUS, from: { profile: "cache-first-chat" } },
  })
  // 409: a service kept from an earlier run already holds it, and a corpus is never overwritten.
  expect([201, 409]).toContain(response.status())
})
