import type { NextConfig } from "next";

import { SOCIAL_BIO_REDIRECTS } from "./src/lib/social-bio-redirects";

const retiredLandingRedirects = [
  { source: "/leadership", destination: "/become-proud", permanent: true },
  { source: "/daily-coaching", destination: "/become-proud", permanent: true },
  { source: "/life-worth-remembering", destination: "/become-proud", permanent: true },
] as const;

/** Temporary. Query strings stay on the request because this destination has none. */
const becomeProudRedirect = {
  source: "/become-proud",
  destination: "/",
  permanent: false,
} as const;

const nextConfig: NextConfig = {
  async redirects() {
    return [...SOCIAL_BIO_REDIRECTS, ...retiredLandingRedirects, becomeProudRedirect];
  },
  outputFileTracingIncludes: {
    "/api/onboarding/complete": [
      "./src/lib/onboarding-victory-milestones/assets/**/*.jpg",
    ],
  },
};

export default nextConfig;
