import "server-only";

import Stripe from "stripe";

import {
  humanFirstTouchLabel,
  isLikelySummittStripeSubscription,
  organicSocialPlatformLabel,
  type GrowthStripeSubscription,
} from "@/lib/admin-subscriber-growth-pure";
import { parseContentProduction } from "@/lib/content-production";
import { earliestQualifyingLandingPath } from "@/lib/landing-page-performance";
import {
  buildRetentionIntelligence,
  partitionRetentionSpells,
  retentionIntervalFromPrice,
  spellFromSubscription,
  unreadableRetentionIntelligence,
  type RetentionAcquisition,
  type RetentionHit,
  type RetentionIntelligence,
  type RetentionInterval,
} from "@/lib/retention-intelligence";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import {
  classifyActiveAchievement,
  type AchievementFact,
} from "@/lib/retention-behavior-retention";
import {
  activityRowFromEvent,
  timingRowFromEvent,
  ENGAGEMENT_EVENT_TYPES,
  TIMING_EVENT_TYPES,
  type MobileActivityRow,
  type MobileTimingRow,
} from "@/lib/mobile-measurement";
import { smsBehaviorFromRows } from "@/lib/retention-sms-behavior";
import { supabaseServer } from "@/lib/supabase-server";
import {
  buildChurnSurveyFacts,
  churnSurveyNotCalculated,
  metadataFlag,
  splitWrittenFeedbackCounts,
  surveyVersionFromMetadata,
  type CancellationFeedbackFact,
  type ChurnSurveyFacts,
} from "@/lib/churn-survey-facts";
import { loadDeletionReasonReport } from "@/lib/account-deletion/account-deletion-reason.server";
import { deletionReasonsUnavailable } from "@/lib/account-deletion/deletion-reason-facts";
import { EXIT_SURVEY_VERSION } from "@/lib/exit-survey";
import { isAppleRowCurrentlyGranting } from "@/lib/summitt-membership-entitlement";
import {
  aggregateYoureInVideoMembers,
  YOURE_IN_VIDEO_EVENT_TYPES,
  youreInVideoUnavailable,
  type YoureInVideoEngagement,
} from "@/lib/youre-in-video";

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const CHUNK = 80;
const ENGAGEMENT_MEMBER_CEILING = 4000;
const ENGAGEMENT_PAGE_ROWS = 500;
const ENGAGEMENT_DEFAULT_MAX_PAGES = 4;
const SMS_HISTORY_MAX_PAGES = 20;

const UNREADABLE = "Stripe subscriptions or paid invoices could not be read.";
const WITHHELD =
  "Paid invoices stopped before the full history, newest first. First payment dates would be unreliable, so cohort rates are not shown. This is not zero retention.";

export async function loadRetentionIntelligence(
  now: Date,
  preloaded: { complete: boolean; subs: GrowthStripeSubscription[] } | null,
  deadlineMs?: number
): Promise<RetentionIntelligence> {
  if (!preloaded || (!preloaded.complete && preloaded.subs.length === 0)) {
    return unreadableRetentionIntelligence(UNREADABLE);
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return unreadableRetentionIntelligence(UNREADABLE);
  try {
    const stripe = new Stripe(key);
    let churnSurvey = churnSurveyNotCalculated(
      "Cancellation survey counts could not be read. That is not zero."
    );
    try {
      churnSurvey = await loadChurnSurveyFacts(deadlineMs);
    } catch (err) {
      console.warn("[retention] cancellation survey read failed", {
        message: err instanceof Error ? err.name : "survey_read_failed",
      });
    }
    let deletionReasons = deletionReasonsUnavailable();
    try {
      deletionReasons = await loadDeletionReasonReport();
    } catch (err) {
      console.warn("[retention] deletion reason report failed", {
        message: err instanceof Error ? err.name : "deletion_reason_report_failed",
      });
    }
    const subscriptions = {
      rows: preloaded.subs.map(fromGrowthSubscription),
      complete: preloaded.complete,
    };
    const invoices = await listPaidInvoices(stripe, deadlineMs);
    const appleRows = await countAppleRows();
    if (!invoices.complete) {
      const withheld = buildRetentionIntelligence({
        nowMs: now.getTime(),
        partial: true,
        partialReason: WITHHELD,
        withheld: WITHHELD,
        spells: [],
        activeWithoutPayment: 0,
        appleRows,
        customerFeedbackCount: 0,
        engagementReadable: false,
        engagementGaps: [],
        hits: [],
        measuredSignals: [],
        acquisitionReadable: false,
        landingReadable: false,
        experimentReadable: false,
        acquisition: [],
        churnSurvey,
        deletionReasons,
      });
      return withheld;
    }

    const paidAtBySubscription = new Map<string, number[]>();
    for (const invoice of invoices.rows) {
      const list = paidAtBySubscription.get(invoice.subscriptionId) ?? [];
      list.push(invoice.paidAtMs);
      paidAtBySubscription.set(invoice.subscriptionId, list);
    }

    const recognized = new Set(getRecognizedSummittPriceIds());
    const spells = [];
    const feedbackSpellIds = new Set<string>();
    let activeWithoutPayment = 0;
    for (const row of subscriptions.rows) {
      if (!isLikelySummittStripeSubscription(row.growth, recognized)) continue;
      const paidAtMs = paidAtBySubscription.get(row.id) ?? [];
      const spell = spellFromSubscription({
        id: row.id,
        clerkUserId: row.clerkUserId,
        paidAtMs,
        status: row.growth.status,
        endedAtMs: row.endedAtMs,
        paused: row.paused,
        interval: row.interval,
        cancellationReason: row.cancellationReason,
        trialStartMs: row.trialStartMs,
      });
      if (!spell) {
        if (
          (row.growth.status === "active" || row.growth.status === "past_due") &&
          !row.paused
        ) {
          activeWithoutPayment += 1;
        }
        continue;
      }
      spells.push(spell);
      if (spell.endKnown && !spell.open && row.customerFeedback) feedbackSpellIds.add(spell.id);
    }

    const monthlySpellIds = new Set(partitionRetentionSpells(spells).monthly.map((spell) => spell.id));
    const customerFeedbackCount = spells.filter(
      (spell) => monthlySpellIds.has(spell.id) && feedbackSpellIds.has(spell.id)
    ).length;

    const clerkIds = [
      ...new Set(spells.map((spell) => spell.clerkUserId).filter((id): id is string => Boolean(id))),
    ];
    let youreInVideo = youreInVideoUnavailable(
      "You're In! video events could not be read. They are not shown as zero."
    );
    try {
      youreInVideo = await loadYoureInVideoEvents(deadlineMs);
    } catch (err) {
      console.warn("[retention] you're in video read failed", {
        message: err instanceof Error ? err.name : "youre_in_video_read_failed",
      });
    }
    const engagement = await loadEngagement(clerkIds, deadlineMs);
    const acquisition =
      deadlineMs != null && Date.now() >= deadlineMs
        ? { readable: false, landingReadable: false, experimentReadable: false, rows: [] as RetentionAcquisition[] }
        : await loadAcquisition(clerkIds, deadlineMs);

    return buildRetentionIntelligence({
      nowMs: now.getTime(),
      partial: !subscriptions.complete,
      partialReason: subscriptions.complete
        ? null
        : "The Stripe subscription list stopped early. These rates are not the whole business.",
      withheld: null,
      spells,
      activeWithoutPayment,
      appleRows,
      customerFeedbackCount,
      engagementReadable: engagement.readable,
      engagementGaps: engagement.gaps,
      hits: engagement.hits,
      mobileActivity: engagement.mobileActivity,
      mobileTiming: engagement.mobileTiming,
      achievementFacts: engagement.achievementFacts,
      measuredSignals: engagement.signals,
      acquisitionReadable: acquisition.readable,
      landingReadable: acquisition.landingReadable,
      experimentReadable: acquisition.experimentReadable,
      acquisition: acquisition.rows,
      churnSurvey,
      deletionReasons,
      youreInVideo,
    });
  } catch (err) {
    console.warn("[retention] billing read failed", {
      reason: err instanceof Error ? err.message : "retention_read_failed",
    });
    return unreadableRetentionIntelligence(UNREADABLE);
  }
}

type ListedSubscription = {
  id: string;
  growth: GrowthStripeSubscription;
  clerkUserId: string | null;
  endedAtMs: number | null;
  paused: boolean;
  interval: RetentionInterval;
  cancellationReason: string | null;
  customerFeedback: boolean;
  trialStartMs: number | null;
};

function fromGrowthSubscription(sub: GrowthStripeSubscription): ListedSubscription {
  const price = sub.items?.data?.[0]?.price;
  const interval = retentionIntervalFromPrice(price);
  const feedback = sub.cancellation_feedback?.trim() ?? "";
  return {
    id: sub.id,
    growth: sub,
    clerkUserId: sub.metadata?.userId?.trim() || null,
    endedAtMs: typeof sub.ended_at === "number" ? sub.ended_at * 1000 : null,
    paused: Boolean(sub.pause_collection),
    interval,
    cancellationReason: sub.cancellation_reason ?? null,
    customerFeedback: feedback.length > 0,
    trialStartMs: typeof sub.trial_start === "number" ? sub.trial_start * 1000 : null,
  };
}

async function listPaidInvoices(
  stripe: Stripe,
  deadlineMs?: number
): Promise<{ rows: Array<{ subscriptionId: string; paidAtMs: number }>; complete: boolean }> {
  const rows: Array<{ subscriptionId: string; paidAtMs: number }> = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (deadlineMs != null && Date.now() >= deadlineMs) return { rows, complete: false };
    const res = await stripe.invoices.list({
      status: "paid",
      limit: PAGE_SIZE,
      starting_after: startingAfter,
    });
    for (const invoice of res.data) {
      if (!(invoice.amount_paid > 0)) continue;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) continue;
      const paidAt = (
        invoice as { status_transitions?: { paid_at?: number | null } }
      ).status_transitions?.paid_at;
      const paidAtUnix = typeof paidAt === "number" ? paidAt : invoice.created;
      if (typeof paidAtUnix !== "number" || !Number.isFinite(paidAtUnix)) continue;
      rows.push({ subscriptionId, paidAtMs: paidAtUnix * 1000 });
    }
    if (!res.has_more) return { rows, complete: true };
    startingAfter = res.data[res.data.length - 1]?.id;
    if (!startingAfter) return { rows, complete: false };
  }
  return { rows, complete: false };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as { subscription?: string | { id?: string } | null }).subscription;
  if (typeof legacy === "string" && legacy) return legacy;
  if (legacy && typeof legacy === "object" && typeof legacy.id === "string") return legacy.id;
  const parent = (
    invoice as {
      parent?: {
        subscription_details?: { subscription?: string | { id?: string } | null } | null;
      } | null;
    }
  ).parent;
  const current = parent?.subscription_details?.subscription;
  if (typeof current === "string" && current) return current;
  if (current && typeof current === "object" && typeof current.id === "string") return current.id;
  return null;
}

async function countAppleRows(): Promise<number | null> {
  const { count, error } = await supabaseServer
    .from("apple_subscriptions")
    .select("id", { count: "exact", head: true });
  if (error || typeof count !== "number") {
    console.warn("[retention] apple count failed", { reason: error?.message ?? "apple_count_failed" });
    return null;
  }
  return count;
}

async function loadChurnSurveyFacts(deadlineMs?: number): Promise<ChurnSurveyFacts> {
  if (deadlineMs != null && Date.now() >= deadlineMs) {
    return churnSurveyNotCalculated(
      "The cancellation survey read did not finish. That is not zero."
    );
  }
  const feedback = await loadCancellationFeedbackFacts();
  const apple = await loadAppleChurnCounts();
  const deletions = await loadDeletionStatusCounts();
  const facts = buildChurnSurveyFacts({
    feedbackReadable: feedback.readable,
    feedbackNote: feedback.note,
    rows: feedback.rows,
    appleRenewalOffStillActive: apple.renewalOffStillActive,
    appleExpiredStatus: apple.expiredStatus,
    appleExpiredNotifications: apple.expiredNotifications,
    completedDeletions: deletions.completed,
    openDeletionRequests: deletions.open,
  });
  if (!facts.readable) return facts;
  try {
    const written = await loadWrittenFeedbackCounts();
    facts.legacyWritten = written.legacyWritten;
    facts.version2Written = written.version2Written;
  } catch (err) {
    console.warn("[retention] written feedback count failed", {
      message: err instanceof Error ? err.name : "written_count_failed",
    });
    facts.legacyWritten = null;
    facts.version2Written = null;
  }
  return facts;
}

async function loadCancellationFeedbackFacts(): Promise<{
  readable: boolean;
  note: string | null;
  rows: CancellationFeedbackFact[];
}> {
  const rows: CancellationFeedbackFact[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const from = page * pageSize;
    const { data, error } = await supabaseServer
      .from("feedback_events")
      .select("moment, reason_code, metadata, created_at, source")
      .eq("type", "churn")
      .in("moment", ["cancel_attempt", "pause_offer_accepted"])
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      console.warn("[retention] cancellation feedback read failed", { code: error.code });
      return {
        readable: false,
        note: "Cancellation survey counts could not be read. That is not zero.",
        rows: [],
      };
    }
    const batch = data ?? [];
    for (const row of batch) {
      rows.push({
        moment: typeof row.moment === "string" ? row.moment : null,
        reasonCode: typeof row.reason_code === "string" ? row.reason_code : null,
        messagePresent: false,
        surveyVersion: surveyVersionFromMetadata(row.metadata),
        skippedReason: metadataFlag(row.metadata, "skipped_reason"),
        skippedComment: metadataFlag(row.metadata, "skipped_comment"),
        confirmedStripeCancel: metadataFlag(row.metadata, "confirmed_stripe_cancel"),
        source: typeof row.source === "string" ? row.source : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
      });
    }
    if (batch.length < pageSize) {
      return { readable: true, note: null, rows };
    }
  }
  return {
    readable: false,
    note: "Cancellation survey counts stopped before the full history. That is not zero.",
    rows: [],
  };
}

async function loadWrittenFeedbackCounts(): Promise<{
  legacyWritten: number | null;
  version2Written: number | null;
}> {
  const total = await supabaseServer
    .from("feedback_events")
    .select("moment", { count: "exact", head: true })
    .eq("type", "churn")
    .eq("moment", "cancel_attempt")
    .not("message", "is", null);
  const version2 = await supabaseServer
    .from("feedback_events")
    .select("moment", { count: "exact", head: true })
    .eq("type", "churn")
    .eq("moment", "cancel_attempt")
    .not("message", "is", null)
    .contains("metadata", {
      survey_version: EXIT_SURVEY_VERSION,
      confirmed_stripe_cancel: true,
    });
  if (
    total.error ||
    version2.error ||
    typeof total.count !== "number" ||
    typeof version2.count !== "number"
  ) {
    console.warn("[retention] written feedback count failed", {
      code: total.error?.code ?? version2.error?.code ?? "written_count_failed",
    });
    return splitWrittenFeedbackCounts(null, null);
  }
  return splitWrittenFeedbackCounts(total.count, version2.count);
}

async function loadAppleChurnCounts(): Promise<{
  renewalOffStillActive: number | null;
  expiredStatus: number | null;
  expiredNotifications: number | null;
}> {
  const unavailable = {
    renewalOffStillActive: null,
    expiredStatus: null,
    expiredNotifications: null,
  };
  const { data, error } = await supabaseServer
    .from("apple_subscriptions")
    .select("product_id, status, expires_at, auto_renew_enabled");
  if (error || (data ?? []).length >= 1000) {
    console.warn("[retention] apple churn read failed", { code: error?.code ?? "apple_churn_truncated" });
    return unavailable;
  }
  const now = new Date();
  let renewalOffStillActive = 0;
  let expiredStatus = 0;
  for (const row of data ?? []) {
    const productId = typeof row.product_id === "string" ? row.product_id : "";
    const status = typeof row.status === "string" ? row.status : "";
    if (status === "expired") expiredStatus += 1;
    const granting = isAppleRowCurrentlyGranting(
      {
        product_id: productId,
        status,
        expires_at:
          typeof row.expires_at === "string" || row.expires_at instanceof Date
            ? row.expires_at
            : null,
      },
      now
    );
    if (granting && row.auto_renew_enabled === false) renewalOffStillActive += 1;
  }
  const notes = await supabaseServer
    .from("apple_notification_events")
    .select("notification_uuid", { count: "exact", head: true })
    .eq("notification_type", "EXPIRED");
  return {
    renewalOffStillActive,
    expiredStatus,
    expiredNotifications: notes.error || typeof notes.count !== "number" ? null : notes.count,
  };
}

async function loadDeletionStatusCounts(): Promise<{
  completed: number | null;
  open: number | null;
}> {
  const { data, error } = await supabaseServer
    .from("account_deletion_requests")
    .select("status");
  if (error || (data ?? []).length >= 1000) {
    console.warn("[retention] deletion count read failed", { code: error?.code ?? "deletion_count_truncated" });
    return { completed: null, open: null };
  }
  let completed = 0;
  let open = 0;
  for (const row of data ?? []) {
    if (row.status === "completed") completed += 1;
    else open += 1;
  }
  return { completed, open };
}

async function loadEngagement(clerkIds: string[], deadlineMs?: number): Promise<{
  readable: boolean;
  hits: RetentionHit[];
  mobileActivity: MobileActivityRow[] | null;
  mobileTiming: MobileTimingRow[] | null;
  achievementFacts: AchievementFact[] | null;
  signals: Array<{ id: string; label: string }>;
  gaps: string[];
}> {
  if (clerkIds.length === 0) {
    return {
      readable: true,
      hits: [],
      mobileActivity: [],
      mobileTiming: [],
      achievementFacts: [],
      signals: [],
      gaps: [],
    };
  }
  if (clerkIds.length > ENGAGEMENT_MEMBER_CEILING) {
    return {
      readable: false,
      hits: [],
      mobileActivity: null,
      mobileTiming: null,
      achievementFacts: null,
      signals: [],
      gaps: ["Member product history was too large to read. It is not shown as zero."],
    };
  }
  const hits: RetentionHit[] = [];
  const signals: Array<{ id: string; label: string }> = [];
  const gaps: string[] = [];

  const sends = await readChunked(
    "sms_send_events",
    "id, clerk_user_id, day_key, send_slot, message_sid, status, metadata, created_at",
    clerkIds,
    { maxPages: SMS_HISTORY_MAX_PAGES, orderColumn: "created_at", orderTieBreak: "id", deadlineMs }
  );
  const inbound = await readChunked(
    "sms_inbound_messages",
    "clerk_user_id, received_at, raw_body, message_sid",
    clerkIds,
    { maxPages: SMS_HISTORY_MAX_PAGES, orderColumn: "received_at", orderTieBreak: "message_sid", deadlineMs }
  );
  const weekly = await readChunked(
    "sms_weekly_send_events",
    "id, clerk_user_id, message_sid, metadata, created_at, status",
    clerkIds,
    { orderColumn: "created_at", orderTieBreak: "id", deadlineMs }
  );
  const sms = smsBehaviorFromRows({
    sends: sends.ok ? sends.rows : null,
    inbound: inbound.ok ? inbound.rows : null,
    weekly: weekly.ok ? weekly.rows : null,
  });
  hits.push(...sms.hits);
  signals.push(...sms.signals);
  gaps.push(...sms.gaps);

  const experienceEvents = await readChunked(
    "v2_event",
    "clerk_user_id, event_type, occurred_at, idempotency_key, payload_json",
    clerkIds,
    {
      maxPages: SMS_HISTORY_MAX_PAGES,
      orderColumn: "occurred_at",
      orderTieBreak: "idempotency_key",
      eventTypes: [...ENGAGEMENT_EVENT_TYPES],
      deadlineMs,
    }
  );
  let mobileActivity: MobileActivityRow[] | null = null;
  if (!experienceEvents.ok) {
    gaps.push(
      "Victory Room and Film Room could not be fully read. They are not shown as zero."
    );
  } else {
    mobileActivity = [];
    for (const row of experienceEvents.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = isoMs(row.occurred_at);
      const eventType = text(row.event_type);
      if (!clerkUserId || atMs == null) continue;
      if (eventType === "victory_room_visited" || eventType === "film_room_played") {
        hits.push({ clerkUserId, atMs, signal: eventType });
      }
      const activity = activityRowFromEvent({
        clerkUserId,
        atMs,
        eventType,
        payload: row.payload_json,
      });
      if (activity) mobileActivity.push(activity);
    }
  }
  const timingEvents = await readChunked(
    "v2_event",
    "clerk_user_id, event_type, occurred_at, idempotency_key, payload_json",
    clerkIds,
    {
      maxPages: SMS_HISTORY_MAX_PAGES,
      orderColumn: "occurred_at",
      orderTieBreak: "idempotency_key",
      eventTypes: [...TIMING_EVENT_TYPES],
      deadlineMs,
    }
  );
  let mobileTiming: MobileTimingRow[] | null = null;
  if (!timingEvents.ok) {
    gaps.push("Startup and screen timing could not be fully read. They are not shown as zero.");
  } else {
    mobileTiming = [];
    for (const row of timingEvents.rows) {
      const timing = timingRowFromEvent({
        clerkUserId: text(row.clerk_user_id),
        atMs: isoMs(row.occurred_at),
        eventType: text(row.event_type),
        payload: row.payload_json,
      });
      if (timing) mobileTiming.push(timing);
    }
  }

  const askPat = await readChunked("ask_pat_questions", "clerk_user_id, day_key", clerkIds, { deadlineMs });
  if (!askPat.ok) {
    gaps.push("Ask Pat could not be fully read. It is not shown as zero.");
  } else {
    signals.push({ id: "ask_pat", label: "Ask Pat" });
    for (const row of askPat.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = dayKeyMs(row.day_key);
      if (!clerkUserId || atMs == null) continue;
      hits.push({ clerkUserId, atMs, signal: "ask_pat" });
    }
  }

  const wins = await readChunked(
    "v2_win",
    "clerk_user_id, occurred_at, win_kind, status, idempotency_key",
    clerkIds,
    { deadlineMs }
  );
  let achievementFacts: AchievementFact[] | null = null;
  if (!wins.ok) {
    gaps.push("Goal Wins and Proud Moments could not be fully read. They are not shown as zero.");
  } else {
    achievementFacts = [];
    signals.push(
      { id: "goal_win", label: "Goal Win" },
      { id: "proud_moment", label: "Proud Moment" }
    );
    for (const row of wins.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = isoMs(row.occurred_at);
      const kind = text(row.win_kind);
      if (!clerkUserId || atMs == null) continue;
      if (kind === "goal_win" || kind === "proud_moment") {
        hits.push({ clerkUserId, atMs, signal: kind });
      }
      const fact = classifyActiveAchievement({
        clerkUserId,
        atMs,
        winKind: kind,
        status: text(row.status),
        idempotencyKey: text(row.idempotency_key),
      });
      if (fact) achievementFacts.push(fact);
    }
  }

  const programs = await readChunked(
    "learning_mini_program_progress",
    "clerk_user_id, started_at, completed_at",
    clerkIds,
    { deadlineMs }
  );
  if (!programs.ok) {
    gaps.push("Programs could not be fully read. They are not shown as zero.");
  } else {
    signals.push(
      { id: "program_start", label: "Program starts" },
      { id: "program_complete", label: "Program completions" }
    );
    for (const row of programs.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const started = isoMs(row.started_at);
      const completed = isoMs(row.completed_at);
      if (!clerkUserId) continue;
      if (started != null) hits.push({ clerkUserId, atMs: started, signal: "program_start" });
      if (completed != null) hits.push({ clerkUserId, atMs: completed, signal: "program_complete" });
    }
  }

  const profiles = await readChunked(
    "user_profiles",
    "clerk_user_id, identity_intake_completed_at",
    clerkIds,
    { deadlineMs }
  );
  if (!profiles.ok) {
    gaps.push("Onboarding completion could not be fully read. It is not shown as zero.");
  } else {
    signals.push({ id: "onboarding", label: "Onboarding completed" });
    for (const row of profiles.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = isoMs(row.identity_intake_completed_at);
      if (!clerkUserId || atMs == null) continue;
      hits.push({ clerkUserId, atMs, signal: "onboarding" });
    }
  }

  return { readable: signals.length > 0, hits, mobileActivity, mobileTiming, achievementFacts, signals, gaps };
}

async function loadAcquisition(
  clerkIds: string[],
  deadlineMs?: number
): Promise<{
  readable: boolean;
  landingReadable: boolean;
  experimentReadable: boolean;
  rows: RetentionAcquisition[];
}> {
  if (clerkIds.length === 0) {
    return { readable: true, landingReadable: true, experimentReadable: true, rows: [] };
  }
  const attribution = await readChunked(
    "marketing_attribution",
    "clerk_user_id, visitor_id, source_normalized, is_paid_acquisition, source_detail, referrer_host, utm_source, utm_campaign, utm_content",
    clerkIds,
    { deadlineMs }
  );
  if (!attribution.ok) {
    return { readable: false, landingReadable: false, experimentReadable: false, rows: [] };
  }
  const byClerk = new Map<string, Array<Record<string, unknown>>>();
  for (const row of attribution.rows) {
    const clerkUserId = text(row.clerk_user_id);
    if (!clerkUserId) continue;
    const list = byClerk.get(clerkUserId) ?? [];
    list.push(row);
    byClerk.set(clerkUserId, list);
  }

  const visitorByClerk = new Map<string, string | null>();
  const rows: RetentionAcquisition[] = clerkIds.map((clerkUserId) => {
    const records = byClerk.get(clerkUserId) ?? [];
    const visitorIds = uniqueText(records.map((row) => row.visitor_id));
    const visitorId = visitorIds.length === 1 ? visitorIds[0] : null;
    visitorByClerk.set(clerkUserId, visitorId);
    return {
      clerkUserId,
      source: records.length === 0 ? null : singleText(records.map((row) => row.source_normalized)),
      campaign: records.length === 0 ? null : singleText(records.map((row) => row.utm_campaign)),
      content: records.length === 0 ? null : singleText(records.map((row) => row.utm_content)),
      channel: records.length === 0 ? null : singleText(records.map((row) => channelLabel(row))),
      production: null,
      landing: null,
      experiment: null,
    };
  });

  const visitorIds = [...new Set([...visitorByClerk.values()].filter((id): id is string => Boolean(id)))];
  const events = await readVisitorEvents(visitorIds, deadlineMs);
  if (!events.ok) {
    return { readable: true, landingReadable: false, experimentReadable: false, rows };
  }
  const eventsByVisitor = new Map<string, Array<Record<string, unknown>>>();
  for (const row of events.rows) {
    const visitorId = text(row.visitor_id);
    if (!visitorId) continue;
    const list = eventsByVisitor.get(visitorId) ?? [];
    list.push(row);
    eventsByVisitor.set(visitorId, list);
  }
  for (const row of rows) {
    const visitorId = visitorByClerk.get(row.clerkUserId);
    if (!visitorId) {
      row.experiment = "Unknown";
      continue;
    }
    const visits = eventsByVisitor.get(visitorId) ?? [];
    row.landing = earliestQualifyingLandingPath(
      visits.map((visit) => ({
        path: text(visit.path),
        occurredAtMs: isoMs(visit.occurred_at) ?? Number.NaN,
      }))
    );
    row.experiment = experimentLabel(visits);
    row.production = productionFromVisits(visits);
  }
  return { readable: true, landingReadable: true, experimentReadable: true, rows };
}

function channelLabel(row: Record<string, unknown>): string | null {
  const source = text(row.source_normalized);
  if (!source) return null;
  const platform = organicSocialPlatformLabel(source, text(row.utm_source));
  if (platform) return platform;
  return humanFirstTouchLabel({
    source_normalized: source,
    is_paid_acquisition: row.is_paid_acquisition === true,
    source_detail: text(row.source_detail),
    referrer_host: text(row.referrer_host),
    utm_source: text(row.utm_source),
  });
}

function productionFromVisits(visits: Array<Record<string, unknown>>): string | null {
  const labels = new Set<string>();
  for (const visit of visits) {
    const metadata = visit.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const production = parseContentProduction(
      (metadata as { production?: unknown }).production
    );
    if (production) labels.add(production);
  }
  if (labels.size === 1) return [...labels][0] ?? null;
  return null;
}

function experimentLabel(visits: Array<Record<string, unknown>>): string {
  const labels = new Set<string>();
  for (const visit of visits) {
    const metadata = visit.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const record = metadata as { experiment_id?: unknown; experiment_variant?: unknown };
    const id = text(record.experiment_id);
    const variant = text(record.experiment_variant);
    if (!id || (variant !== "control" && variant !== "challenger")) continue;
    labels.add(`${id.slice(0, 8)} · ${variant}`);
  }
  if (labels.size === 1) return [...labels][0] ?? "Unknown";
  if (labels.size > 1) return "Unknown";
  return "Not in a controlled experiment";
}

async function loadYoureInVideoEvents(deadlineMs?: number): Promise<YoureInVideoEngagement> {
  const unavailable = youreInVideoUnavailable(
    "You're In! video events could not be fully read. They are not shown as zero."
  );
  if (deadlineMs != null && Date.now() >= deadlineMs) return unavailable;
  const rows: Array<{ clerkUserId: string; eventType: string }> = [];
  let from = 0;
  for (let page = 0; page < 40; page += 1) {
    if (deadlineMs != null && Date.now() >= deadlineMs) return unavailable;
    const { data, error } = await supabaseServer
      .from("v2_event")
      .select("clerk_user_id, event_type, occurred_at, idempotency_key")
      .in("event_type", [...YOURE_IN_VIDEO_EVENT_TYPES])
      .order("occurred_at", { ascending: true })
      .order("idempotency_key", { ascending: true })
      .range(from, from + ENGAGEMENT_PAGE_ROWS - 1);
    if (error) {
      console.warn("[retention] you're in video read failed", {
        code: error.code ?? "youre_in_video_read_failed",
      });
      return unavailable;
    }
    const batch = (data ?? []) as Array<{
      clerk_user_id?: unknown;
      event_type?: unknown;
    }>;
    for (const row of batch) {
      const clerkUserId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
      const eventType = typeof row.event_type === "string" ? row.event_type : "";
      if (!clerkUserId || !eventType) continue;
      rows.push({ clerkUserId, eventType });
    }
    if (batch.length < ENGAGEMENT_PAGE_ROWS) return aggregateYoureInVideoMembers(rows);
    from += ENGAGEMENT_PAGE_ROWS;
  }
  return unavailable;
}

async function readVisitorEvents(
  visitorIds: string[],
  deadlineMs?: number
): Promise<{ ok: boolean; rows: Array<Record<string, unknown>> }> {
  if (visitorIds.length === 0) return { ok: true, rows: [] };
  const rows: Array<Record<string, unknown>> = [];
  for (const group of chunks(visitorIds, CHUNK)) {
    let from = 0;
    for (let page = 0; page < 4; page += 1) {
      if (deadlineMs != null && Date.now() >= deadlineMs) return { ok: false, rows: [] };
      const { data, error } = await supabaseServer
        .from("marketing_events")
        .select("visitor_id, path, occurred_at, metadata")
        .eq("event_type", "page_viewed")
        .in("visitor_id", group)
        .order("occurred_at", { ascending: true })
        .range(from, from + 499);
      if (error) {
        console.warn("[retention] landing read failed", { reason: error.message });
        return { ok: false, rows: [] };
      }
      const batch = (data ?? []) as unknown as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < 500) break;
      if (page === 3) return { ok: false, rows: [] };
      from += 500;
    }
  }
  return { ok: true, rows };
}

async function readChunked(
  table: string,
  columns: string,
  ids: string[],
  options?: {
    maxPages?: number;
    orderColumn?: string;
    orderTieBreak?: string;
    eventTypes?: string[];
    deadlineMs?: number;
  }
): Promise<{ ok: boolean; rows: Array<Record<string, unknown>> }> {
  const maxPages = options?.maxPages ?? ENGAGEMENT_DEFAULT_MAX_PAGES;
  const rows: Array<Record<string, unknown>> = [];
  for (const group of chunks(ids, CHUNK)) {
    let from = 0;
    for (let page = 0; page < maxPages; page += 1) {
      if (options?.deadlineMs != null && Date.now() >= options.deadlineMs) return { ok: false, rows: [] };
      let query = supabaseServer.from(table).select(columns).in("clerk_user_id", group);
      if (options?.eventTypes && options.eventTypes.length > 0) {
        query = query.in("event_type", options.eventTypes);
      }
      if (options?.orderColumn) {
        query = query.order(options.orderColumn, { ascending: true });
      }
      if (options?.orderTieBreak) {
        query = query.order(options.orderTieBreak, { ascending: true });
      }
      const { data, error } = await query.range(from, from + ENGAGEMENT_PAGE_ROWS - 1);
      if (error) {
        console.warn("[retention] product read failed", { table, reason: error.message });
        return { ok: false, rows: [] };
      }
      const batch = (data ?? []) as unknown as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < ENGAGEMENT_PAGE_ROWS) break;
      if (page === maxPages - 1) return { ok: false, rows: [] };
      from += ENGAGEMENT_PAGE_ROWS;
    }
  }
  return { ok: true, rows };
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueText(values: unknown[]): string[] {
  return [...new Set(values.map((value) => text(value)).filter((value): value is string => Boolean(value)))];
}

function singleText(values: unknown[]): string | null {
  const unique = uniqueText(values);
  return unique.length === 1 ? unique[0] : null;
}

function dayKeyMs(value: unknown): number | null {
  const day = text(value);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T12:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isoMs(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
