import type { Metadata } from "next";

import {
  AudienceLandingRoute,
  audienceLandingMetadata,
} from "@/components/audience-landing-page";

export const metadata: Metadata = audienceLandingMetadata("life_worth_remembering");

export default function LifeWorthRememberingLandingPage() {
  return <AudienceLandingRoute id="life_worth_remembering" />;
}
