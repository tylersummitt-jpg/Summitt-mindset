import type { Metadata } from "next";

import {
  AudienceLandingRoute,
  audienceLandingMetadata,
} from "@/components/audience-landing-page";

export const metadata: Metadata = audienceLandingMetadata("daily_coaching");

export default function DailyCoachingLandingPage() {
  return <AudienceLandingRoute id="daily_coaching" />;
}
