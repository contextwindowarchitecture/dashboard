// The sandbox's route module, loaded lazily: the replay client and the trace validator it carries
// are in this chunk only.

import { SandboxView } from "../../features/sandbox/components/sandbox-view"

export function Component() {
  return <SandboxView />
}
