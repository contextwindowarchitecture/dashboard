import { describe, expect, it } from "vitest"

import { controlsFromSearch, edited, searchWithControls } from "./url"

const parse = (query: string) => controlsFromSearch(new URLSearchParams(query))

describe("the sandbox's controls in the URL", () => {
  it("reads each control it can, and leaves out any it cannot", () => {
    expect(
      parse("input=300&reserved=0&margin=10&profile=policy-first-chat@1&off=a,b&offset=-60"),
    ).toEqual({
      input: 300,
      reserved_output: 0,
      margin_percent: 10,
      profile: "policy-first-chat@1",
      off: ["a", "b"],
      offset: -60,
    })
    expect(parse("input=-5&reserved=x&margin=101&profile=nope&off=&offset=1.5")).toEqual({})
  })

  it("writes the controls back beside the event, and drops the ones at rest", () => {
    const search = searchWithControls(new URLSearchParams("event=01M4ZCN9D4M5QNPFCQ5A2K3W6H"), {
      input: 300,
      off: ["a", "b"],
    })
    expect(search.toString()).toBe("event=01M4ZCN9D4M5QNPFCQ5A2K3W6H&input=300&off=a%2Cb")
    expect(searchWithControls(search, {}).toString()).toBe("event=01M4ZCN9D4M5QNPFCQ5A2K3W6H")
  })

  it("calls the snapshot edited whenever any control is set", () => {
    expect(edited({})).toBe(false)
    expect(edited({ off: [] })).toBe(false)
    expect(edited({ offset: 0 })).toBe(false)
    expect(edited({ input: 300 })).toBe(true)
    expect(edited({ off: ["a"] })).toBe(true)
  })
})
