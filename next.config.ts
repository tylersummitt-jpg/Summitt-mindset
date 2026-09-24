import type { NextConfig } from "next";

import { SOCIAL_BIO_REDIRECTS } from "./src/lib/social-bio-redirects";

const nextConfig: NextConfig = {
  async redirects() {
    return [...SOCIAL_BIO_REDIRECTS];
  },
  outputFileTracingIncludes: {
    "/api/onboarding/complete": [
      "./src/lib/onboarding-victory-milestones/assets/**/*.jpg",
    ],
  },
};

export default nextConfig;
