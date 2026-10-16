// The registry pages' addresses. A route policy's version may hold a slash ("illustrative/v1"), so
// each part is encoded as one path segment.

export const policyPath = (route: string, version: string) =>
  `/registry/policies/${encodeURIComponent(route)}/${encodeURIComponent(version)}`

export const profilePath = (id: string, version: number) =>
  `/registry/profiles/${encodeURIComponent(id)}/${version}`
