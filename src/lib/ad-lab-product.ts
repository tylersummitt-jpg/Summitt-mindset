/**
 * Admin-only Ad Lab reads and saves.
 * Account id comes from the server environment, never from the browser.
 * This file does not write ad_lab_ads or ad_lab_daily_delivery.
 */

import "server-only";

import { loadAdLabOutcomePeople } from "@/lib/admin-subscriber-growth";
import type { AdLabIdentity, AdLabStoredDay, AdLabSummary } from "@/lib/ad-lab-import-pure";
import {
  AD_LAB_ID,
  assembleLab,
  clipNote,
  notesFromRow,
  type AdLabCreative,
  type AdLabExperimentInput,
  type AdLabLab,
  type AdLabNotes,
} from "@/lib/ad-lab-product-pure";
import { fetchMetaGraph } from "@/lib/meta-ad-lab-insights";
import {
  META_AD_LAB_GRAPH_VERSION,
  normalizeMetaAdAccountId,
} from "@/lib/meta-ad-lab-insights-pure";
import { supabaseServer } from "@/lib/supabase-server";

const METRICS = new Set([
  "outbound_ctr",
  "verified_trials",
  "paying_subscribers",
  "cost_per_trial",
]);
const STATUSES = new Set(["draft", "active", "completed", "archived"]);
const ROLES = new Set(["included", "control", "challenger"]);

function accountId(): string | null {
  return normalizeMetaAdAccountId(process.env.META_AD_LAB_ACCOUNT_ID);
}

export async function buildAdLabLab(args: {
  identities: readonly AdLabIdentity[];
  days: readonly AdLabStoredDay[];
  summary: AdLabSummary;
  loadedSince: string;
  loadedUntil: string;
  todayKey: string;
  subscriptions?: { complete: boolean; subs: import("@/lib/admin-subscriber-growth-pure").GrowthStripeSubscription[] };
}): Promise<AdLabLab> {
  const account = accountId();
  const [outcomes, notes, experiments, creatives] = await Promise.all([
    loadAdLabOutcomePeople({
      subs: args.subscriptions?.subs,
      subscriptionsComplete: args.subscriptions?.complete,
    }).catch(() => ({
      people: [],
      paymentsKnown: false,
      subscriptionsComplete: false,
      attributionComplete: false,
    })),
    account ? readNotes(account) : Promise.resolve({ ready: false, notes: new Map<string, AdLabNotes>() }),
    account
      ? readExperiments(account)
      : Promise.resolve({ ready: false, experiments: [] as AdLabExperimentInput[] }),
    readCreatives(),
  ]);
  return assembleLab({
    identities: args.identities,
    days: args.days.map((day) => ({
      metaAdId: day.metaAdId,
      spendDate: day.spendDate,
      spendCents: day.spendCents,
      impressions: day.impressions,
      outboundClicks: day.outboundClicks,
      landingPageViews: day.landingPageViews,
    })),
    rangeSince: args.summary.rangeSince,
    rangeUntil: args.summary.rangeUntil,
    loadedSince: args.loadedSince,
    loadedUntil: args.loadedUntil,
    todayKey: args.todayKey,
    currency: args.summary.currency,
    timezone: args.summary.timezone,
    lastImportedAt: args.summary.lastImportedAt,
    stale: args.summary.stale,
    activeCount: args.summary.activeCount,
    todaySpendCents: args.summary.todaySpendCents,
    weekSpendCents: args.summary.weekSpendCents,
    people: outcomes.people,
    paymentsKnown: outcomes.paymentsKnown,
    subscriptionsComplete: outcomes.subscriptionsComplete,
    attributionComplete: outcomes.attributionComplete,
    notesByAd: notes.notes,
    creativeByAd: creatives.byAd,
    experiments: experiments.experiments,
    storageReady: notes.ready && experiments.ready,
    creativeRead: creatives.ready ? "ready" : "unavailable",
  });
}

async function readNotes(account: string): Promise<{ ready: boolean; notes: Map<string, AdLabNotes> }> {
  const { data, error } = await supabaseServer
    .from("ad_lab_creative_notes")
    .select(
      "meta_ad_id, hook, angle, audience, emotion, person_featured, offer, concept, hypothesis, variable_changed, notes"
    )
    .eq("account_id", account)
    .limit(2000);
  if (error) {
    console.warn("[meta-ad-lab] notes read failed", { code: error.code ?? null });
    return { ready: false, notes: new Map() };
  }
  const notes = new Map<string, AdLabNotes>();
  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    if (typeof record.meta_ad_id === "string") notes.set(record.meta_ad_id, notesFromRow(record));
  }
  return { ready: true, notes };
}

async function readExperiments(
  account: string
): Promise<{ ready: boolean; experiments: AdLabExperimentInput[] }> {
  const [headers, members] = await Promise.all([
    supabaseServer
      .from("ad_lab_experiments")
      .select(
        "id, name, question, hypothesis, success_metric, status, starts_on, review_on, planned_days, budget_cents, stop_spend_cents, stop_clicks, stop_trials, variable_tested, notes, outcome, winner_meta_ad_id, what_worked, what_didnt, decision, next_test"
      )
      .eq("account_id", account)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseServer
      .from("ad_lab_experiment_ads")
      .select("experiment_id, meta_ad_id, role, ad_name_snapshot, campaign_name_snapshot")
      .eq("account_id", account)
      .limit(2000),
  ]);
  if (headers.error || members.error) {
    console.warn("[meta-ad-lab] experiment read failed", {
      code: headers.error?.code ?? members.error?.code ?? null,
    });
    return { ready: false, experiments: [] };
  }
  const adsByExperiment = new Map<string, AdLabExperimentInput["ads"]>();
  for (const row of members.data ?? []) {
    const record = row as Record<string, unknown>;
    const experimentId = typeof record.experiment_id === "string" ? record.experiment_id : "";
    const metaAdId = typeof record.meta_ad_id === "string" ? record.meta_ad_id : "";
    if (!experimentId || !AD_LAB_ID.test(metaAdId)) continue;
    const role = ROLES.has(String(record.role))
      ? (record.role as AdLabExperimentInput["ads"][number]["role"])
      : "included";
    const list = adsByExperiment.get(experimentId) ?? [];
    list.push({
      metaAdId,
      role,
      adNameSnapshot: typeof record.ad_name_snapshot === "string" ? record.ad_name_snapshot : metaAdId,
      campaignNameSnapshot:
        typeof record.campaign_name_snapshot === "string" ? record.campaign_name_snapshot : null,
    });
    adsByExperiment.set(experimentId, list);
  }
  const experiments: AdLabExperimentInput[] = [];
  for (const row of headers.data ?? []) {
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    const status = STATUSES.has(String(record.status))
      ? (record.status as AdLabExperimentInput["status"])
      : "draft";
    experiments.push({
      id: record.id,
      name: record.name,
      question: text(record.question),
      hypothesis: text(record.hypothesis),
      successMetric: METRICS.has(String(record.success_metric))
        ? String(record.success_metric)
        : "verified_trials",
      status,
      startsOn: dateText(record.starts_on),
      reviewOn: dateText(record.review_on),
      plannedDays: intOrNull(record.planned_days),
      budgetCents: intOrNull(record.budget_cents),
      stopSpendCents: intOrNull(record.stop_spend_cents),
      stopClicks: intOrNull(record.stop_clicks),
      stopTrials: intOrNull(record.stop_trials),
      variableTested: text(record.variable_tested),
      notes: text(record.notes),
      outcome: text(record.outcome),
      winnerMetaAdId: AD_LAB_ID.test(text(record.winner_meta_ad_id)) ? text(record.winner_meta_ad_id) : null,
      whatWorked: text(record.what_worked),
      whatDidnt: text(record.what_didnt),
      decision: text(record.decision),
      nextTest: text(record.next_test),
      ads: adsByExperiment.get(record.id) ?? [],
    });
  }
  return { ready: true, experiments };
}

async function readCreatives(): Promise<{ ready: boolean; byAd: Map<string, AdLabCreative> }> {
  const token = process.env.META_AD_LAB_ACCESS_TOKEN?.trim() || "";
  const account = accountId();
  if (!token || !account) return { ready: false, byAd: new Map() };
  const url = new URL(
    `https://graph.facebook.com/${META_AD_LAB_GRAPH_VERSION}/act_${account}/ads`
  );
  url.searchParams.set(
    "fields",
    "id,creative{body,title,thumbnail_url,image_url,object_type,call_to_action_type,object_story_spec}"
  );
  url.searchParams.set("limit", "100");
  try {
    const result = await fetchMetaGraph(url.toString(), token);
    if ("failed" in result || result.httpStatus >= 400) {
      return { ready: false, byAd: new Map() };
    }
    return { ready: true, byAd: creativesFromPayload(result.payload) };
  } catch {
    return { ready: false, byAd: new Map() };
  }
}

function creativesFromPayload(payload: unknown): Map<string, AdLabCreative> {
  const byAd = new Map<string, AdLabCreative>();
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return byAd;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const adId = (row as { id?: unknown }).id;
    if (typeof adId !== "string" || !AD_LAB_ID.test(adId)) continue;
    const creative = (row as { creative?: unknown }).creative;
    if (!creative || typeof creative !== "object") continue;
    const record = creative as Record<string, unknown>;
    const story = record.object_story_spec as Record<string, unknown> | undefined;
    const linkData = story?.link_data as Record<string, unknown> | undefined;
    const videoData = story?.video_data as Record<string, unknown> | undefined;
    const link =
      short(linkData?.link) ??
      short((videoData?.call_to_action as { value?: { link?: unknown } } | undefined)?.value?.link);
    byAd.set(adId, {
      body: short(record.body) ?? short(linkData?.message) ?? short(videoData?.message),
      headline: short(record.title) ?? short(linkData?.name) ?? short(videoData?.title),
      cta: short(record.call_to_action_type) ?? short((linkData?.call_to_action as { type?: unknown } | undefined)?.type),
      link,
      thumbnailUrl: httpsUrl(short(record.thumbnail_url) ?? short(record.image_url)),
      format: short(record.object_type) ?? (videoData ? "video" : linkData ? "image" : null),
    });
  }
  return byAd;
}

function short(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}

function httpsUrl(value: string | null): string | null {
  if (!value || !value.startsWith("https://")) return null;
  return value;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function dateText(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function intOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

export async function saveAdLabNote(
  metaAdId: string,
  notes: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const account = accountId();
  if (!account) return { ok: false, error: "Ad Lab account is not configured." };
  if (!AD_LAB_ID.test(metaAdId)) return { ok: false, error: "That ad id is not valid." };
  const row = {
    account_id: account,
    meta_ad_id: metaAdId,
    hook: clipNote(notes.hook),
    angle: clipNote(notes.angle),
    audience: clipNote(notes.audience),
    emotion: clipNote(notes.emotion),
    person_featured: clipNote(notes.personFeatured),
    offer: clipNote(notes.offer),
    concept: clipNote(notes.concept),
    hypothesis: clipNote(notes.hypothesis),
    variable_changed: clipNote(notes.variableChanged),
    notes: clipNote(notes.notes, 2000),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseServer.from("ad_lab_creative_notes").upsert(row);
  if (error) {
    console.warn("[meta-ad-lab] note save failed", { code: error.code ?? null });
    return { ok: false, error: "The note could not be saved. The ad may not be imported yet." };
  }
  return { ok: true };
}

export async function saveAdLabExperiment(
  body: Record<string, unknown>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const account = accountId();
  if (!account) return { ok: false, error: "Ad Lab account is not configured." };
  const name = clipNote(body.name, 160);
  if (!name) return { ok: false, error: "Give the experiment a name." };
  const status = typeof body.status === "string" ? body.status : "draft";
  if (!STATUSES.has(status)) return { ok: false, error: "Choose a status." };
  const metric = typeof body.successMetric === "string" ? body.successMetric : "verified_trials";
  if (!METRICS.has(metric)) return { ok: false, error: "Choose what success means." };
  const adsRaw = Array.isArray(body.ads) ? body.ads : null;
  if (!adsRaw) return { ok: false, error: "Choose the ads for this experiment. Nothing was changed." };
  if (adsRaw.length > 50) return { ok: false, error: "An experiment can include up to 50 ads." };
  const ads = [];
  const seen = new Set<string>();
  for (const entry of adsRaw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "One selected ad could not be read. Nothing was changed." };
    }
    const record = entry as Record<string, unknown>;
    const metaAdId = typeof record.metaAdId === "string" ? record.metaAdId.trim() : "";
    if (!AD_LAB_ID.test(metaAdId)) {
      return { ok: false, error: "One selected ad is not a Meta ad id. Nothing was changed." };
    }
    if (seen.has(metaAdId)) {
      return { ok: false, error: "Each ad can be in the experiment once. Nothing was changed." };
    }
    seen.add(metaAdId);
    const role = typeof record.role === "string" ? record.role : "";
    if (!ROLES.has(role)) {
      return { ok: false, error: "Each ad needs a role. Nothing was changed." };
    }
    const adNameSnapshot = typeof record.adNameSnapshot === "string" ? record.adNameSnapshot.trim() : "";
    if (adNameSnapshot.length < 1 || adNameSnapshot.length > 400) {
      return { ok: false, error: "Each ad needs the name it has today. Nothing was changed." };
    }
    const campaignName = typeof record.campaignNameSnapshot === "string" ? record.campaignNameSnapshot.trim() : "";
    if (campaignName.length > 400) {
      return { ok: false, error: "A campaign name is too long. Nothing was changed." };
    }
    ads.push({
      meta_ad_id: metaAdId,
      role,
      ad_name_snapshot: adNameSnapshot,
      campaign_name_snapshot: campaignName,
    });
  }
  if ((status === "active" || status === "completed") && ads.length < 2) {
    return {
      ok: false,
      error: "An active or completed comparison needs at least two ads. Nothing was changed.",
    };
  }
  const optional = (key: string, max: number) => {
    const parsed = optionalNumber(body[key], max);
    if (parsed === "bad") return "bad" as const;
    return parsed;
  };
  const plannedDays = optional("plannedDays", 365);
  if (plannedDays === 0) return { ok: false, error: "Planned days must be at least 1, or left blank." };
  const budgetCents = optional("budgetCents", 100_000_000);
  const stopSpendCents = optional("stopSpendCents", 100_000_000);
  const stopClicks = optional("stopClicks", 1_000_000);
  const stopTrials = optional("stopTrials", 1_000_000);
  if ([plannedDays, budgetCents, stopSpendCents, stopClicks, stopTrials].includes("bad")) {
    return { ok: false, error: "Use a whole number, or leave that field blank." };
  }
  const winner = typeof body.winnerMetaAdId === "string" ? body.winnerMetaAdId.trim() : "";
  if (winner && !AD_LAB_ID.test(winner)) return { ok: false, error: "The winner must be a Meta ad id." };
  if (winner && !seen.has(winner)) {
    return { ok: false, error: "The winner has to be one of the ads in this experiment. Nothing was changed." };
  }
  if (ads.length > 0) {
    const { data: known, error: knownError } = await supabaseServer
      .from("ad_lab_ads")
      .select("meta_ad_id")
      .eq("account_id", account)
      .in("meta_ad_id", ads.map((ad) => ad.meta_ad_id));
    const knownIds = new Set(
      (known ?? []).map((row) => (row as { meta_ad_id?: unknown }).meta_ad_id).filter((id) => typeof id === "string")
    );
    if (knownError || knownIds.size !== ads.length) {
      return { ok: false, error: "Every ad has to already be imported. Nothing was changed." };
    }
  }
  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";
  const { data, error } = await supabaseServer.rpc("ad_lab_save_experiment", {
    p_account_id: account,
    p_experiment: {
      id,
      name,
      question: clipNote(body.question, 1000),
      hypothesis: clipNote(body.hypothesis, 1000),
      success_metric: metric,
      status,
      starts_on: dateOrEmpty(body.startsOn),
      review_on: dateOrEmpty(body.reviewOn),
      planned_days: plannedDays ?? "",
      budget_cents: budgetCents ?? "",
      stop_spend_cents: stopSpendCents ?? "",
      stop_clicks: stopClicks ?? "",
      stop_trials: stopTrials ?? "",
      variable_tested: clipNote(body.variableTested, 500),
      notes: clipNote(body.notes, 2000),
      outcome: clipNote(body.outcome, 500),
      winner_meta_ad_id: winner,
      what_worked: clipNote(body.whatWorked, 2000),
      what_didnt: clipNote(body.whatDidnt, 2000),
      decision: clipNote(body.decision, 2000),
      next_test: clipNote(body.nextTest, 2000),
    },
    p_ads: ads,
  });
  if (error || typeof data !== "string") {
    console.warn("[meta-ad-lab] experiment save failed", { code: error?.code ?? null });
    return {
      ok: false,
      error: "The experiment could not be saved. Use ads that have already been imported.",
    };
  }
  return { ok: true, id: data };
}

function optionalNumber(value: unknown, max: number): number | null | "bad" {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) return "bad";
  return parsed;
}

function dateOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return value;
}
