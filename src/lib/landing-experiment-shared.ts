/** Fixed registry id. Inserts use this id so a redeploy cannot create a second row. */
export const PROUD_TEST_EXPERIMENT_ID = "b8c1e2a0-7d4f-4a1e-9c3b-6f0a1d2e4b70";

export const PROUD_TEST_ENTRY_PATH = "/go/proud-test";

export const PROUD_TEST_INSTRUMENTATION_VERSION = "1";

export const PROUD_TEST_COOKIE = "sm_exp";

export const PROUD_TEST_MIN_EXPOSED_PER_VARIANT = 200;

export const PROUD_TEST_MIN_DAYS = 14;

export const PROUD_TEST_TRIAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The only pages a landing experiment may send someone to. */
export const APPROVED_LANDING_DESTINATIONS = [
  "/",
  "/leadership",
  "/become-proud",
  "/daily-coaching",
  "/life-worth-remembering",
] as const;

export type ApprovedLandingDestination = (typeof APPROVED_LANDING_DESTINATIONS)[number];

export type LandingVariant = "control" | "challenger";

export type LandingDestinations = {
  entrySlug: string;
  controlPath: ApprovedLandingDestination;
  challengerPath: ApprovedLandingDestination;
};

export const PROUD_TEST_VARIANTS = {
  control: "/",
  challenger: "/become-proud",
} as const satisfies Record<LandingVariant, ApprovedLandingDestination>;

export type ProudTestVariant = LandingVariant;

const ENTRY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXPERIMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isApprovedLandingDestination(
  path: string
): path is ApprovedLandingDestination {
  return (APPROVED_LANDING_DESTINATIONS as readonly string[]).includes(path);
}

export function parseEntrySlug(raw: string | null | undefined): string | null {
  const slug = (raw ?? "").trim().toLowerCase();
  if (!slug || slug.length > 40 || !ENTRY_SLUG.test(slug)) return null;
  return slug;
}

export function isLandingExperimentEntryPath(pathname: string): boolean {
  if (!pathname.startsWith("/go/")) return false;
  const slug = pathname.slice("/go/".length);
  if (!slug || slug.includes("/")) return false;
  return parseEntrySlug(slug) != null;
}

/**
 * Accepts a slug and two different approved pages.
 * Anything else, including an arbitrary URL, is rejected.
 * All-empty means this registry row is not a landing experiment.
 */
export function landingAssignmentFromInput(input: {
  entrySlug?: string | null;
  controlPath?: string | null;
  challengerPath?: string | null;
}): LandingDestinations | null {
  const slug = (input.entrySlug ?? "").trim();
  const control = (input.controlPath ?? "").trim();
  const challenger = (input.challengerPath ?? "").trim();
  if (!slug && !control && !challenger) return null;
  const entrySlug = parseEntrySlug(slug);
  if (
    !entrySlug ||
    !isApprovedLandingDestination(control) ||
    !isApprovedLandingDestination(challenger) ||
    control === challenger
  ) {
    throw new Error(
      "A landing-page experiment needs a slug and two different approved pages."
    );
  }
  return { entrySlug, controlPath: control, challengerPath: challenger };
}

export function parseStoredLanding(row: {
  entry_slug?: string | null;
  control_path?: string | null;
  challenger_path?: string | null;
}): LandingDestinations | null {
  const slug = row.entry_slug ?? "";
  const control = row.control_path ?? "";
  const challenger = row.challenger_path ?? "";
  if (!slug && !control && !challenger) return null;
  return landingAssignmentFromInput({
    entrySlug: slug,
    controlPath: control,
    challengerPath: challenger,
  });
}

export function landingColumnPayload(landing: LandingDestinations | null) {
  return {
    entry_slug: landing?.entrySlug ?? null,
    control_path: landing?.controlPath ?? null,
    challenger_path: landing?.challengerPath ?? null,
  };
}

export type ProudTestStatus =
  | "running"
  | "paused"
  | "planned"
  | "completed"
  | "missing"
  | "unavailable";

export const PROUD_TEST_DEFINITION = {
  name: "Homepage vs Become proud",
  area: "distribution" as const,
  hypothesis:
    "Comparable visitors who enter through /go/proud-test and see /become-proud will start more genuine free trials than visitors who see the current homepage.",
  control:
    "Current homepage at /. Only visitors assigned at /go/proud-test while this experiment is running. A direct visit to / is not an assignment.",
  challenger:
    "Audience page /become-proud. About half of eligible visitors from the same entry URL. A direct visit to /become-proud is not an assignment.",
  primaryOutcome: "Verified free-trial starts per unique exposed visitor.",
  decisionCriteria:
    "Primary metric: verified free-trial starts per unique exposed visitor. A trial counts only when that visitor was exposed to one variant, the Clerk link is unambiguous, and the trial starts within 7 days after the first exposure. Minimum before a human decision: 200 exposed visitors on each variant and 14 days after the start date. Below that, the result is inconclusive. Paid outcomes: confirmed first payments and mature trial-to-paid. Do not judge paid conversion while trials are still running. past_due is not paid. Guardrail: pause if signup or checkout breaks on one variant. A higher button-click rate is not a decision. Inconclusive when the minimum is not met, too many trials cannot be tied to a visitor, or tracking is untrustworthy. A person records the decision in this registry. This system does not select a winner.",
  secondaryOutcomes:
    "Join button clicks, checkout starts, confirmed first payments, and mature trial-to-paid conversion.",
  nextAction:
    "Start this in the registry only when a selected campaign will use /go/proud-test. Do not send existing homepage visitors there.",
  limitations:
    "Apple memberships are not included. Deployment does not start this test. The entry URL assigns new visitors only while the status is running.",
};

export function assignLandingVariant(
  visitorId: string,
  experimentId: string
): LandingVariant {
  let hash = 2166136261;
  const input = `${experimentId}:${visitorId}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? "control" : "challenger";
}

export function assignProudTestVariant(
  visitorId: string,
  experimentId = PROUD_TEST_EXPERIMENT_ID
): ProudTestVariant {
  return assignLandingVariant(visitorId, experimentId);
}

export function isLikelyBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || !userAgent.trim()) return true;
  return /bot|crawl|spider|slurp|preview|headless|lighthouse|wget|curl|python-requests|bytespider/i.test(
    userAgent
  );
}

export function isPrefetchRequest(headers: {
  get(name: string): string | null;
}): boolean {
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""} ${headers.get("x-purpose") ?? ""}`;
  if (/prefetch/i.test(purpose)) return true;
  if (headers.get("next-router-prefetch") === "1") return true;
  if (headers.get("x-middleware-prefetch") === "1") return true;
  return false;
}

export type LandingAssignmentCookie = {
  experimentId: string;
  variant: LandingVariant;
  path: ApprovedLandingDestination;
};

export function serializeLandingAssignment(assignment: LandingAssignmentCookie): string {
  return `${assignment.experimentId}.${assignment.variant}.${assignment.path}`;
}

export function serializeProudTestAssignment(variant: ProudTestVariant): string {
  return serializeLandingAssignment({
    experimentId: PROUD_TEST_EXPERIMENT_ID,
    variant,
    path: PROUD_TEST_VARIANTS[variant],
  });
}

/** Keeps only assignments whose path is one of the five approved pages. */
export function parseLandingAssignments(
  raw: string | null | undefined
): LandingAssignmentCookie[] {
  if (!raw) return [];
  const assignments: LandingAssignmentCookie[] = [];
  for (const part of raw.split(",")) {
    const match = /^([0-9a-f-]{36})\.(control|challenger)\.(\/.*)$/i.exec(part);
    if (!match) continue;
    const experimentId = match[1]?.toLowerCase() ?? "";
    const variant = match[2];
    const path = match[3] ?? "";
    if (!EXPERIMENT_ID.test(experimentId)) continue;
    if (variant !== "control" && variant !== "challenger") continue;
    if (!isApprovedLandingDestination(path)) continue;
    assignments.push({ experimentId, variant, path });
  }
  return assignments.slice(-8);
}

export function parseProudTestAssignment(
  raw: string | null | undefined
): LandingAssignmentCookie | null {
  return (
    parseLandingAssignments(raw).find(
      (assignment) => assignment.experimentId === PROUD_TEST_EXPERIMENT_ID
    ) ?? null
  );
}

export function upsertLandingAssignment(
  existingRaw: string | null | undefined,
  created: LandingAssignmentCookie
): string {
  const kept = parseLandingAssignments(existingRaw).filter(
    (assignment) => assignment.experimentId !== created.experimentId
  );
  return [...kept, created]
    .slice(-8)
    .map((assignment) => serializeLandingAssignment(assignment))
    .join(",");
}

export function exposureMatchesDestination(args: {
  viewedPath: string;
  officialPath: string;
}): boolean {
  return (
    isApprovedLandingDestination(args.viewedPath) && args.viewedPath === args.officialPath
  );
}

export function decideLandingEntry(args: {
  experimentId: string;
  status: ProudTestStatus;
  visitorId: string | null;
  existingVariant: LandingVariant | null;
  destinations: LandingDestinations | null;
  userAgent: string | null;
  prefetch: boolean;
}): { destination: ApprovedLandingDestination; created: boolean; variant: LandingVariant | null } {
  const home = "/" as const;
  if (args.prefetch || isLikelyBotUserAgent(args.userAgent) || !args.destinations) {
    return { destination: home, created: false, variant: null };
  }
  if (args.status === "unavailable" || !args.visitorId) {
    return { destination: home, created: false, variant: null };
  }
  if (args.existingVariant) {
    return {
      destination: args.destinations[args.existingVariant === "control" ? "controlPath" : "challengerPath"],
      created: false,
      variant: args.existingVariant,
    };
  }
  if (args.status !== "running") {
    return { destination: home, created: false, variant: null };
  }
  const variant = assignLandingVariant(args.visitorId, args.experimentId);
  return {
    destination:
      variant === "control" ? args.destinations.controlPath : args.destinations.challengerPath,
    created: true,
    variant,
  };
}

export function decideProudTestEntry(args: {
  experimentId?: string;
  status: ProudTestStatus;
  visitorId: string | null;
  existingVariant: ProudTestVariant | null;
  userAgent: string | null;
  prefetch: boolean;
  destinations?: LandingDestinations | null;
}): { destination: ApprovedLandingDestination; created: boolean; variant: ProudTestVariant | null } {
  const destinations =
    args.destinations === undefined
      ? {
          entrySlug: "proud-test",
          controlPath: PROUD_TEST_VARIANTS.control,
          challengerPath: PROUD_TEST_VARIANTS.challenger,
        }
      : args.destinations;
  return decideLandingEntry({
    ...args,
    experimentId: args.experimentId ?? PROUD_TEST_EXPERIMENT_ID,
    destinations,
  });
}

