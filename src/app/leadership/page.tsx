import type { Metadata } from "next";

import {
  AudienceLandingRoute,
  audienceLandingMetadata,
} from "@/components/audience-landing-page";

export const metadata: Metadata = audienceLandingMetadata("leadership");

export default function LeadershipLandingPage() {
  return <AudienceLandingRoute id="leadership" />;
}
