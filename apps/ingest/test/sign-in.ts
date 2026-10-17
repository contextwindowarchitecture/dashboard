// What the sign-in and access tests share: a free port, the cookies a response sets, a sign-in run by
// hand against the test issuer, and /me.

import { createServer as createNetServer } from "node:net"
import type { AddressInfo } from "node:net"

export const freePort = () =>
  new Promise<number>((done) => {
    const probe = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => done(port))
    })
  })

export /** A cookie a response sets: its value and its attributes, lower-cased. */
function setCookie(response: Response, name: string) {
  const line = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
  if (line === undefined) return undefined
  const [pair, ...attributes] = line.split(";").map((part) => part.trim())
  return { value: pair!.slice(name.length + 1), attributes: attributes.map((a) => a.toLowerCase()) }
}

export async function signIn(base: string, returnTo = "/traces") {
  const login = await fetch(`${base}/auth/login?return=${encodeURIComponent(returnTo)}`, {
    redirect: "manual",
  })
  const loginCookie = setCookie(login, "cwa_login")
  const authorize = await fetch(login.headers.get("location")!, { redirect: "manual" })
  const callback = await fetch(authorize.headers.get("location")!, {
    redirect: "manual",
    headers: { cookie: `cwa_login=${loginCookie?.value}` },
  })
  return { login, loginCookie, authorize, callback, session: setCookie(callback, "cwa_session") }
}

export const me = async (base: string, session?: string): Promise<Record<string, unknown>> => {
  const headers: Record<string, string> = session ? { cookie: `cwa_session=${session}` } : {}
  return (await (await fetch(`${base}/me`, { headers })).json()) as Record<string, unknown>
}
