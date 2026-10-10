import type { Metadata } from "next";

import {
  AudienceLandingRoute,
  audienceLandingMetadata,
} from "@/components/audience-landing-page";

export const metadata: Metadata = audienceLandingMetadata("become_proud");

export default function BecomeProudLandingPage() {
  return <AudienceLandingRoute id="become_proud" />;
}
