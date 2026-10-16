// The telemetry and about pages' route modules, loaded lazily: their words and the conventions doc are
// in these chunks only.

import { AboutView } from "../../features/reference/components/about-view"
import { TelemetryView } from "../../features/reference/components/telemetry-view"

export const Telemetry = () => <TelemetryView />
export const About = () => <AboutView />
