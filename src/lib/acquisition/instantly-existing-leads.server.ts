import "server-only";

import { continueAfterInstantlyPage, parseInstantlyListPayload } from "@/lib/acquisition/backfill";
import {
  EXISTING_INSTANTLY_BATCH,
  INSTANTLY_LEAD_LIST_URL,
  instantlyDeliveryStop,
  instantlyLeadListBody,
  readInstantlyLead,
  writeAndVerifyVideoUrl,
  type InstantlyLeadView,
} from "@/lib/acquisition/instantly-existing-leads";
import { currentQuietVideoPlaybook, issueVideoFirstLinks } from "@/lib/acquisition/video-first-leads.server";
import type { ProspectLead } from "@/lib/acquisition/video-first-prep";

export type ExistingLeadUpdateResult =
  | { ok: false; error: string }
  | {
      ok: true;
      campaignName: string;
      completed: number;
      excluded: number;
      failed: number;
      reused: number;
      missingFirst: number;
      missingLast: number;
      replaced: number;
      nextCursor: string | null;
      halted: string | null;
      skips: Array<{ email: string; reason: string }>;
      failures: Array<{ email: string; reason: string }>;
    };

export async function prepareExistingInstantlyLeads(args: {
  campaignId: string;
  personalVideoId: string;
  startingAfter: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ExistingLeadUpdateResult> {
  const campaignId = args.campaignId.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(campaignId)) {
    return { ok: false, error: "Choose a campaign from the list. Nothing was written." };
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

  const playbook = await currentQuietVideoPlaybook(campaignId, videoId);
  if ("error" in playbook) return { ok: false, error: playbook.error };

  const fetchImpl = args.fetchImpl ?? fetch;
  const page = await readLeadPage(fetchImpl, apiKey, campaignId, startingAfter);
  if (!page.ok) return { ok: false, error: page.error };
  const window = leadWindow(page.items, page.nextCursor);
  if ("error" in window) return { ok: false, error: window.error };

  const skips: Array<{ email: string; reason: string }> = [];
  let unreadable = 0;
  let missingFirst = 0;
  let missingLast = 0;
  const eligible: Array<ProspectLead & { instantly: InstantlyLeadView }> = [];
  for (const row of window.rows) {
    const lead = readInstantlyLead(row);
    if (!lead) {
      unreadable += 1;
      continue;
    }
    if (lead.missingFirst) missingFirst += 1;
    if (lead.missingLast) missingLast += 1;
    if (lead.campaignId !== campaignId) {
      skips.push({ email: lead.email, reason: "This lead is not in the selected campaign." });
      continue;
    }
    const stopped = instantlyDeliveryStop(lead.status);
    if (stopped) {
      skips.push({
        email: lead.email,
        reason: stopped === "bounced" ? "Instantly has this lead as bounced." : "Instantly has this lead as unsubscribed.",
      });
      continue;
    }
    eligible.push({ email: lead.email, firstName: lead.firstName, lastName: lead.lastName, instantly: lead });
  }

  if (eligible.length === 0) {
    return {
      ok: true,
      campaignName: playbook.name,
      completed: 0,
      excluded: skips.length + unreadable,
      failed: 0,
      reused: 0,
      missingFirst,
      missingLast,
      replaced: 0,
      nextCursor: window.nextCursor,
      halted: null,
      skips,
      failures: [],
    };
  }

  const issued = await issueVideoFirstLinks({
    campaignId,
    personalVideoId: videoId,
    leads: eligible,
    playbook,
  });
  if (!issued.ok) return issued;

  const linkByEmail = new Map(issued.links.map((link) => [link.email, link.videoUrl]));
  const failures: Array<{ email: string; reason: string }> = [];
  let completed = 0;
  let replaced = 0;
  for (const lead of eligible) {
    const videoUrl = linkByEmail.get(lead.email);
    if (!videoUrl) continue;
    if (lead.instantly.videoUrl === videoUrl) {
      completed += 1;
      continue;
    }
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
        return {
          ok: true,
          campaignName: playbook.name,
          completed,
          excluded: skips.length + issued.skips.length + unreadable,
          failed: failures.length,
          reused: issued.reused,
          missingFirst,
          missingLast,
          replaced,
          nextCursor: null,
          halted: written.reason,
          skips: [...skips, ...issued.skips],
          failures,
        };
      }
      continue;
    }
    completed += 1;
    if (written.replaced) replaced += 1;
  }

  return {
    ok: true,
    campaignName: playbook.name,
    completed,
    excluded: skips.length + issued.skips.length + unreadable,
    failed: failures.length,
    reused: issued.reused,
    missingFirst,
    missingLast,
    replaced,
    nextCursor: window.nextCursor,
    halted: null,
    skips: [...skips, ...issued.skips],
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
