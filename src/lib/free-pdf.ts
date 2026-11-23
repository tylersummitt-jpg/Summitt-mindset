import { acquisitionCampaignTokenShape } from "@/lib/acquisition/campaign-token-shape";
import { ACQUISITION_CAMPAIGN_QUERY } from "@/lib/acquisition/email-acquired-member-notice";
import {
  ACQUISITION_ASSET_FILES,
  type AcquisitionFileKey,
} from "@/lib/acquisition/assets";
import { COACH_SIGN_UP_HREF, COACH_SUBSCRIBE_PATH } from "@/lib/coach-funnel-links";

export const FREE_PDF_SITE = "https://summittmindset.com";

export type FreePdfDownload = {
  id: string;
  asset: AcquisitionFileKey;
  href: string;
  filename: string;
  title: string;
  detail: string;
  actionLabel: string;
};

export type FreePdfPageContent = {
  path: string;
  eyebrow: string;
  title: string;
  description: string;
  intro: string[];
  downloads: FreePdfDownload[];
};

function download(
  asset: AcquisitionFileKey,
  fields: Omit<FreePdfDownload, "asset" | "filename">
): FreePdfDownload {
  return {
    ...fields,
    asset,
    filename: ACQUISITION_ASSET_FILES[asset].filename,
  };
}

export const BASKETBALL_PLAYBOOK_PAGE: FreePdfPageContent = {
  path: "/free/basketball-playbook",
  eyebrow: "Free resource",
  title: "Pat Summitt basketball playbook",
  description:
    "Download the Pat Summitt Coaching Solutions playbook, Mastering Special Situations, with diagrammed plays for basketball special situations.",
  intro: [
    "A free playbook for basketball coaches. No account, reply, or subscription.",
    "This is the Pat Summitt Coaching Solutions playbook, Mastering Special Situations. It diagrams plays for handling full-court pressure, beating the trap, beating the low-post double team, and beating the box-and-one, then continues into a special-situations playbank.",
    "Each play includes an overview, key personnel, court diagrams, instructions, and coaching points.",
  ],
  downloads: [
    download("playbook", {
      id: "basketball-playbook-download",
      href: "/free/basketball-playbook/download",
      title: "Mastering Special Situations",
      detail: "The basketball special-situations playbook.",
      actionLabel: "Download the free basketball playbook PDF",
    }),
  ],
};

export const DEFINITE_DOZEN_PAGE: FreePdfPageContent = {
  path: "/free/definite-dozen",
  eyebrow: "Free resource",
  title: "Definite Dozen discussion guide",
  description:
    "Download the Pat Summitt Definite Dozen team discussion guide for coaches in other sports and athletic directors.",
  intro: [
    "A free discussion guide for coaches in other sports and for athletic directors. No account, reply, or subscription.",
    "This is the Pat Summitt Definite Dozen team discussion guide. It uses her twelve principles, one at a time, with prompts for players and teams on standards, accountability, communication, culture, and competitive excellence. Each conversation ends with one observable action.",
    "The last page is a team-meeting rhythm: pick a principle, discuss it, decide one behavior, and follow up at the next team meeting.",
  ],
  downloads: [
    download("definite_dozen", {
      id: "definite-dozen-team-download",
      href: "/free/definite-dozen/team/download",
      title: "Definite Dozen team discussion guide",
      detail: "The team discussion guide for players and teams.",
      actionLabel: "Download the free Definite Dozen discussion guide PDF",
    }),
  ],
};

/** Existing checkout hop. A campaign token is forwarded only when it already has the signed-token shape. Checkout verifies the signature before any campaign credit. */
export function freePdfTrialHref(campaignToken: unknown): string {
  return freePdfCheckoutHref("/checkout/start", campaignToken);
}

export function freePdfCheckoutHref(href: string, campaignToken: unknown): string {
  const token = acquisitionCampaignTokenShape(campaignToken);
  if (!token || !href.startsWith("/checkout/start")) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}${ACQUISITION_CAMPAIGN_QUERY}=${encodeURIComponent(token)}`;
}

/** Keep a shaped campaign token on the existing Leadership Kit pages. An invalid token is dropped. */
export function freePdfCoachKitPageHref(path: "/coach-leadership-kit" | "/coach-leadership-kit/how-it-works", campaignToken: unknown): string {
  const token = acquisitionCampaignTokenShape(campaignToken);
  if (!token) return path;
  return `${path}?${ACQUISITION_CAMPAIGN_QUERY}=${encodeURIComponent(token)}`;
}

/** Leadership Kit enrollment. No token leaves the existing coach signup and subscribe URLs unchanged. */
export function freePdfCoachKitHref(signedIn: boolean, campaignToken: unknown): string {
  const token = acquisitionCampaignTokenShape(campaignToken);
  const subscribe = token
    ? `${COACH_SUBSCRIBE_PATH}&${ACQUISITION_CAMPAIGN_QUERY}=${encodeURIComponent(token)}`
    : COACH_SUBSCRIBE_PATH;
  if (signedIn) return subscribe;
  if (!token) return COACH_SIGN_UP_HREF;
  return `/sign-up?redirect_url=${encodeURIComponent(subscribe)}`;
}

export function campaignTokenFromSearch(value: string | string[] | undefined): unknown {
  return Array.isArray(value) ? value[0] : value;
}
