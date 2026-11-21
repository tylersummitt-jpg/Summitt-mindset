import { NextResponse } from "next/server";

import { checkLetterAudience } from "@/lib/acquisition/letter-audience.server";
import type { LetterFactTicket, LetterLead, LetterPendingTicket, LetterSkip } from "@/lib/acquisition/letter-audience";
import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STOPPED = "Eligibility check stopped on the server. No import file was created. Nothing was written.";

export async function POST(req: Request) {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as {
    phase?: unknown;
    sourceCampaignId?: unknown;
    sourceCampaignIds?: unknown;
    launchCampaignId?: unknown;
    pairCampaignId?: unknown;
    manifest?: unknown;
    tickets?: unknown;
    pending?: unknown;
    historySkips?: unknown;
    outcomes?: unknown;
  } | null;
  const phase = body?.phase;
  if (phase !== "history" && phase !== "facts" && phase !== "finish") {
    return NextResponse.json({
      ok: false,
      error: "Eligibility has to run in steps. Refresh this page, then run the check again. Nothing was written.",
    }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  const sourceCampaignIds = [
    ...(Array.isArray(body?.sourceCampaignIds) ? body.sourceCampaignIds : []),
    body?.sourceCampaignId,
  ].filter((id): id is string => typeof id === "string");
  try {
    const result = await checkLetterAudience({
      phase,
      sourceCampaignIds,
      launchCampaignId: typeof body?.launchCampaignId === "string" ? body.launchCampaignId : "",
      pairCampaignId: typeof body?.pairCampaignId === "string" ? body.pairCampaignId : null,
      manifest: typeof body?.manifest === "string" ? body.manifest : "",
      tickets: readTickets(body?.tickets),
      pending: readLeads(body?.pending),
      historySkips: readSkips(body?.historySkips),
      outcomes: readOutcomes(body?.outcomes),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: STOPPED }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

function readTickets(value: unknown): LetterPendingTicket[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { email?: unknown; token?: unknown; lead?: unknown };
    const lead = readLead(row.lead);
    if (!lead || typeof row.token !== "string" || lead.email !== row.email) return [];
    return [{ email: lead.email, token: row.token, lead }];
  });
}

function readLeads(value: unknown): LetterLead[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const lead = readLead(item);
    return lead ? [lead] : [];
  });
}

function readLead(value: unknown): LetterLead | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.email !== "string" || !row.email.includes("@")) return null;
  return {
    email: row.email,
    firstName: typeof row.firstName === "string" ? row.firstName : null,
    lastName: typeof row.lastName === "string" ? row.lastName : null,
    state: typeof row.state === "string" ? row.state : "unknown",
    role: typeof row.role === "string" ? row.role : "unknown",
    level: typeof row.level === "string" ? row.level : "unknown",
    provider: typeof row.provider === "string" ? row.provider : "other",
  };
}

function readSkips(value: unknown): LetterSkip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const skip = readSkip(item);
    return skip ? [skip] : [];
  });
}

function readSkip(value: unknown): LetterSkip | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.email !== "string" || typeof row.reason !== "string") return null;
  if (row.kind !== "excluded" && row.kind !== "unverified") return null;
  const reasons = Array.isArray(row.reasons) ? row.reasons.filter((reason): reason is string => typeof reason === "string") : [row.reason];
  return { email: row.email, reason: row.reason, reasons, kind: row.kind };
}

function readOutcomes(value: unknown): LetterFactTicket[] {
  if (!Array.isArray(value)) return [];
  const outcomes: LetterFactTicket[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { email?: unknown; token?: unknown; lead?: unknown; skip?: unknown };
    if (typeof row.email !== "string" || typeof row.token !== "string") continue;
    const lead = readLead(row.lead);
    const skip = readSkip(row.skip);
    if (lead) outcomes.push({ email: row.email, token: row.token, lead });
    else if (skip) outcomes.push({ email: row.email, token: row.token, skip });
  }
  return outcomes;
}
