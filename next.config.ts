import type { NextConfig } from "next";

import { SOCIAL_BIO_REDIRECTS } from "./src/lib/social-bio-redirects";

const retiredLandingRedirects = [
  { source: "/leadership", destination: "/become-proud", permanent: true },
  { source: "/daily-coaching", destination: "/become-proud", permanent: true },
  { source: "/life-worth-remembering", destination: "/become-proud", permanent: true },
] as const;

const nextConfig: NextConfig = {
  async redirects() {
    return [...SOCIAL_BIO_REDIRECTS, ...retiredLandingRedirects];
  },
  outputFileTracingIncludes: {
    "/api/onboarding/complete": [
      "./src/lib/onboarding-victory-milestones/assets/**/*.jpg",
    ],
  },
};

export default nextConfig;
