// GitHub's API as a process, for the browser tests over the query API (playwright.api.config.ts):
// GITHUB_FAKE_PORT, GITHUB_FAKE_REPOSITORY, GITHUB_FAKE_APP_ID, GITHUB_FAKE_INSTALLATION_ID and
// GITHUB_FAKE_KEY_FILE, the App's private key the API is given too. Never part of a deployment.

import { readFileSync } from "node:fs"

import { startGitHub } from "./github-fake.ts"

const github = await startGitHub({
  port: Number(process.env["GITHUB_FAKE_PORT"]),
  repository: process.env["GITHUB_FAKE_REPOSITORY"]!,
  appId: process.env["GITHUB_FAKE_APP_ID"]!,
  installationId: process.env["GITHUB_FAKE_INSTALLATION_ID"]!,
  privateKey: readFileSync(process.env["GITHUB_FAKE_KEY_FILE"]!, "utf8"),
})
process.stdout.write(`test GitHub: ${github.url}, ${github.repository}\n`)
const stop = () => void github.close().then(() => process.exit(0))
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
