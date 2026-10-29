import "server-only";

import { continueAfterInstantlyPage, parseInstantlyListPayload } from "@/lib/acquisition/backfill";
import {
  foldSkipKinds,
  gateInstantlyLead,
  membershipMapOrUnverified,
} from "@/lib/acquisition/audience-clearance";
import { liveMembershipByEmail } from "@/lib/acquisition/audience-membership.server";
import {
  EXISTING_INSTANTLY_BATCH,
  INSTANTLY_LEAD_LIST_URL,
  instantlyLeadListBody,
  readInstantlyLead,
  videoUrlNeedsWrite,
  writeAndVerifyVideoUrl,
  type InstantlyLeadView,
} from "@/lib/acquisition/instantly-existing-leads";
import {
  isAcquisitionLifecycle,
  type AcquisitionLifecycle,
} from "@/lib/acquisition/model";
import { currentQuietVideoPlaybook, issueVideoFirstLinks } from "@/lib/acquisition/video-first-leads.server";
import {
  instantlyLeadCsv,
  skipReport,
  type ProspectLead,
  type VerificationClearance,
} from "@/lib/acquisition/video-first-prep";
import { supabaseServer } from "@/lib/supabase-server";

export type AudienceClearanceResult =
  | { ok: false; error: string }
  | {
      ok: true;
      campaignName: string;
      sourceCampaignId: string;
      launchCampaignId: string;
      mode: "update_existing" | "import_csv";
      eligible: number;
      excluded: number;
      unverified: number;
      failed: number;
      reused: number;
      missingFirst: number;
      missingLast: number;
      replaced: number;
      nextCursor: string | null;
      halted: string | null;
      csv: string;
      skipCsv: string;
      skips: Array<{ email: string; reason: string; kind?: "excluded" | "unverified" }>;
      failures: Array<{ email: string; reason: string }>;
    };

/**
 * Clear Instantly source leads, prepare launch-campaign video links, and either
 * patch video_url when the launch campaign already holds the lead or return an
 * Instantly import CSV for an empty replacement campaign.
 */
export async function checkAndPrepareAudience(args: {
  launchCampaignId: string;
  sourceCampaignId: string;
  personalVideoId: string;
  startingAfter: string | null;
  fetchImpl?: typeof fetch;
}): Promise<AudienceClearanceResult> {
  const launchCampaignId = args.launchCampaignId.trim();
  const sourceCampaignId = args.sourceCampaignId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(launchCampaignId) || !/^[A-Za-z0-9_-]{1,80}$/.test(sourceCampaignId)) {
    return { ok: false, error: "Choose a launch campaign and a source audience. Nothing was written." };
  }
  const videoId = args.personalVideoId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(videoId)) {
    return { ok: false, error: "Choose a personal video. Nothing was written." };
  }
  const startingAfter = args.startingAfter?.trim() || null;
  if (startingAfter && !/^[A-Za-z0-9_-]{1,80}$/.test(startingAfter)) {
    return { ok: false, error: "The lead page cursor was not usable. Nothing was written." };
  }
  const apiKey = process.env.INSTANTLY_API_KEY?.trim() || "";
  if (!apiKey) return { ok: false, error: "Instantly is not connected from this server. Nothing was written." };

  const playbook = await currentQuietVideoPlaybook(launchCampaignId, videoId);
  if ("error" in playbook) return { ok: false, error: playbook.error };

  const fetchImpl = args.fetchImpl ?? fetch;
  const page = await readLeadPage(fetchImpl, apiKey, sourceCampaignId, startingAfter);
  if (!page.ok) return { ok: false, error: page.error };
  const window = leadWindow(page.items, page.nextCursor);
  if ("error" in window) return { ok: false, error: window.error };

  const skips: Array<{ email: string; reason: string; kind?: "excluded" | "unverified" }> = [];
  let unreadable = 0;
  let missingFirst = 0;
  let missingLast = 0;
  const gated: Array<ProspectLead & { instantly: InstantlyLeadView; verification: VerificationClearance }> = [];
  for (const row of window.rows) {
    const lead = readInstantlyLead(row);
    if (!lead) {
      unreadable += 1;
      continue;
    }
    if (lead.missingFirst) missingFirst += 1;
    if (lead.missingLast) missingLast += 1;
    const gate = gateInstantlyLead(lead, sourceCampaignId);
    if (!gate.ok) {
      skips.push({ email: gate.email, reason: gate.reason, kind: gate.kind });
      continue;
    }
    gated.push({ ...gate.lead, verification: gate.verification });
  }

  const mode = launchCampaignId === sourceCampaignId ? "update_existing" : "import_csv";
  if (gated.length === 0) {
    const folded = foldSkipKinds(skips);
    return {
      ok: true,
      campaignName: playbook.name,
      sourceCampaignId,
      launchCampaignId,
      mode,
      eligible: 0,
      excluded: folded.excluded + unreadable,
      unverified: folded.unverified,
      failed: 0,
      reused: 0,
      missingFirst,
      missingLast,
      replaced: 0,
      nextCursor: window.nextCursor,
      halted: null,
      csv: instantlyLeadCsv([]),
      skipCsv: skipReport(skips),
      skips,
      failures: [],
    };
  }

  const people = await peopleHints(gated.map((lead) => lead.email));
  if (!people) return { ok: false, error: "Existing people could not be read. Nothing was written." };
  const live = await liveMembershipByEmail(
    gated.map((lead) => {
      const person = people.get(lead.email);
      return {
        email: lead.email,
        clerkUserId: person?.clerkUserId ?? null,
        stripeSubscriptionId: person?.stripeSubscriptionId ?? null,
      };
    }),
  );
  const membershipByEmail = membershipMapOrUnverified(
    gated.map((lead) => lead.email),
    live,
  );
  for (const lead of gated) {
    const person = people.get(lead.email);
    if (person && (person.lifecycle === "trial_started" || person.lifecycle === "paid_member")) {
      membershipByEmail.set(lead.email, "member");
    }
  }
  const verificationByEmail = new Map<string, VerificationClearance>(
    gated.map((lead) => [lead.email, lead.verification]),
  );

  const issued = await issueVideoFirstLinks({
    campaignId: launchCampaignId,
    personalVideoId: videoId,
    leads: gated,
    playbook,
    sourceCampaignId,
    membershipByEmail,
    verificationByEmail,
  });
  if (!issued.ok) return issued;

  for (const skip of issued.skips) {
    skips.push({
      email: skip.email,
      reason: skip.reason,
      kind: skip.kind ?? "excluded",
    });
  }

  const failures: Array<{ email: string; reason: string }> = [];
  let replaced = 0;
  if (mode === "update_existing") {
    const linkByEmail = new Map(issued.links.map((link) => [link.email, link.videoUrl]));
    for (const lead of gated) {
      const videoUrl = linkByEmail.get(lead.email);
      if (!videoUrl) continue;
      if (!videoUrlNeedsWrite(lead.instantly.videoUrl, videoUrl)) continue;
      const written = await writeAndVerifyVideoUrl({
        leadId: lead.instantly.id,
        expectedUrl: videoUrl,
        before: lead.instantly.payload,
        apiKey,
        fetchImpl,
        sleep,
      });
      if (!written.ok) {
        failures.push({ email: lead.email, reason: written.reason });
        if (written.halt) {
          const folded = foldSkipKinds(skips);
          return {
            ok: true,
            campaignName: playbook.name,
            sourceCampaignId,
            launchCampaignId,
            mode,
            eligible: issued.links.length,
            excluded: folded.excluded + unreadable,
            unverified: folded.unverified,
            failed: failures.length,
            reused: issued.reused,
            missingFirst,
            missingLast,
            replaced,
            nextCursor: null,
            halted: written.reason,
            csv: instantlyLeadCsv(issued.links),
            skipCsv: skipReport(skips),
            skips,
            failures,
          };
        }
        continue;
      }
      if (written.replaced) replaced += 1;
    }
  }

  const folded = foldSkipKinds(skips);
  return {
    ok: true,
    campaignName: playbook.name,
    sourceCampaignId,
    launchCampaignId,
    mode,
    eligible: issued.links.length,
    excluded: folded.excluded + unreadable,
    unverified: folded.unverified,
    failed: failures.length,
    reused: issued.reused,
    missingFirst,
    missingLast,
    replaced,
    nextCursor: window.nextCursor,
    halted: null,
    csv: instantlyLeadCsv(issued.links),
    skipCsv: skipReport(skips),
    skips,
    failures,
  };
}

function leadWindow(items: unknown[], apiNext: string | null): { rows: unknown[]; nextCursor: string | null } | { error: string } {
  const rows = items.slice(0, EXISTING_INSTANTLY_BATCH);
  if (items.length <= rows.length) return { rows, nextCursor: apiNext };
  const last = rows[rows.length - 1];
  const id = last && typeof last === "object" && !Array.isArray(last) && typeof (last as { id?: unknown }).id === "string"
    ? (last as { id: string }).id.trim()
    : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    return { error: "Instantly's lead list could not be paged safely. Nothing was written." };
  }
  return { rows, nextCursor: id };
}

async function readLeadPage(
  fetchImpl: typeof fetch,
  apiKey: string,
  campaignId: string,
  startingAfter: string | null,
): Promise<{ ok: true; items: unknown[]; nextCursor: string | null } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetchImpl(INSTANTLY_LEAD_LIST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(instantlyLeadListBody(campaignId, startingAfter)),
    });
  } catch {
    return { ok: false, error: "Instantly's lead list could not be read. Nothing was written." };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "Instantly refused the lead list. Nothing was written." };
  }
  if (response.status === 429 || response.status >= 500) {
    return { ok: false, error: "Instantly's lead list was unavailable. Nothing was written." };
  }
  if (!response.ok) return { ok: false, error: "Instantly's lead list could not be read. Nothing was written." };
  const parsed = parseInstantlyListPayload(await response.json().catch(() => null));
  if (!parsed.ok) return { ok: false, error: "Instantly's lead list had an unexpected shape. Nothing was written." };
  const decision = continueAfterInstantlyPage({
    pageNumber: 1,
    pageCap: 500,
    itemCount: parsed.items.length,
    nextCursor: parsed.nextCursor,
    requestCursor: startingAfter,
  });
  if (decision.error) return { ok: false, error: "Instantly's lead list could not be paged safely. Nothing was written." };
  return { ok: true, items: parsed.items, nextCursor: decision.continue ? parsed.nextCursor : null };
}

async function peopleHints(emails: string[]): Promise<Map<string, {
  clerkUserId: string | null;
  stripeSubscriptionId: string | null;
  lifecycle: AcquisitionLifecycle;
}> | null> {
  const byEmail = new Map<string, {
    clerkUserId: string | null;
    stripeSubscriptionId: string | null;
    lifecycle: AcquisitionLifecycle;
  }>();
  for (let i = 0; i < emails.length; i += 200) {
    const chunk = emails.slice(i, i + 200);
    const { data, error } = await supabaseServer
      .from("acquisition_people")
      .select("email_normalized, lifecycle_state, stripe_subscription_id, clerk_user_id")
      .in("email_normalized", chunk);
    if (error) return null;
    for (const row of data ?? []) {
      if (typeof row.email_normalized !== "string" || !isAcquisitionLifecycle(String(row.lifecycle_state))) continue;
      byEmail.set(row.email_normalized, {
        lifecycle: row.lifecycle_state,
        stripeSubscriptionId: typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id : null,
        clerkUserId: typeof row.clerk_user_id === "string" ? row.clerk_user_id : null,
      });
    }
  }
  return byEmail;
}

function sleep(ms: number): Promise<void> {
  return Promise.resolve().then(() => new Promise((resolve) => setTimeout(resolve, ms)));
}
