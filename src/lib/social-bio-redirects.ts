/**
 * Static social-bio aliases only. Display/routing — not attribution logic.
 * /twitter is an alias of the X bio destination (utm_source=x).
 */

export const SOCIAL_BIO_UTM_MEDIUM = "organic_social";
export const SOCIAL_BIO_UTM_CAMPAIGN = "organic";
export const SOCIAL_BIO_UTM_CONTENT = "bio";

function homepageBioDestination(utmSource: "instagram" | "facebook" | "tiktok" | "x"): string {
  return `/?utm_source=${utmSource}&utm_medium=${SOCIAL_BIO_UTM_MEDIUM}&utm_campaign=${SOCIAL_BIO_UTM_CAMPAIGN}&utm_content=${SOCIAL_BIO_UTM_CONTENT}`;
}

export const SOCIAL_BIO_REDIRECTS = [
  {
    source: "/instagram",
    destination: homepageBioDestination("instagram"),
    permanent: false,
  },
  {
    source: "/facebook",
    destination: homepageBioDestination("facebook"),
    permanent: false,
  },
  {
    source: "/tiktok",
    destination: homepageBioDestination("tiktok"),
    permanent: false,
  },
  {
    source: "/x",
    destination: homepageBioDestination("x"),
    permanent: false,
  },
  {
    source: "/twitter",
    destination: homepageBioDestination("x"),
    permanent: false,
  },
] as const;
