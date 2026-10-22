import "server-only";

import { Resend } from "resend";

import { readAcquisitionAsset } from "@/lib/acquisition/assets";
import { ACQUISITION_ASSET_FILES } from "@/lib/acquisition/assets";
import {
  planInstantlyBackfill,
  type BackfillPlan,
  type BackfillProposal,
} from "@/lib/acquisition/backfill";
import {
  buildAcquisitionDashboard,
  emptyAcquisitionDashboard,
  type AcquisitionDashboard,
  type AcquisitionSenderRow,
} from "@/lib/acquisition/dashboard";
import { normalizeInstantlyWebhook, type InstantlyNormalized } from "@/lib/acquisition/instantly";
import {
  ACQUISITION_CLAIM_MS,
  ACQUISITION_RETRY_MS,
  acquisitionTokenHash,
  assetFromCampaign,
  newAcquisitionToken,
  normalizeAcquisitionEmail,
  parseAcquisitionAsset,
  reduceLiveSignal,
  type AcquisitionActionType,
  type AcquisitionAsset,
  type AcquisitionAutomation,
  type AcquisitionLifecycle,
  type AcquisitionSignal,
} from "@/lib/acquisition/model";
import { runAcquisitionPass, type PassEffect, type PassSendRequest } from "@/lib/acquisition/pass";
import { classifyResendSend } from "@/lib/challenge-send-outcome";
import { getClerkUserOrNull } from "@/lib/clerk-rest";
import { RECOVERY_FROM } from "@/lib/recovery-engine";
import { supabaseServer } from "@/lib/supabase-server";

const PERSON_COLUMNS =
  "id, email_normalized, first_name, last_name, lifecycle_state, requested_asset, clerk_user_id, stripe_customer_id, stripe_subscription_id, source_campaign, source_sender, sport, role, geography, close_reason";

type PersonRow = {
  id: string;
  email_normalized: string;
  first_name: string | null;
  last_name: string | null;
  lifecycle_state: AcquisitionLifecycle;
  requested_asset: AcquisitionAsset | null;
  clerk_user_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  source_campaign: string | null;
  source_sender: string | null;
  sport: string | null;
  role: string | null;
  geography: string | null;
  close_reason: string | null;
};

type Settings = {
  automation: AcquisitionAutomation;
  videoDelayHours: number;
  trialFollowupDelayHours: number;
  dailyCap: number;
  evergreenPersonalVideoId: string | null;
  campaignAssets: Record<string, unknown>;
};

function asPerson(row: PersonRow | null): PersonRow | null {
  if (!row || typeof row.id !== "string") return null;
  return row;
}

export async function readAcquisitionSettings(): Promise<Settings> {
  const { data, error } = await supabaseServer
    .from("acquisition_settings")
    .select("automation_status, video_delay_hours, trial_followup_delay_hours, daily_send_cap, evergreen_personal_video_id, campaign_assets")
    .eq("id", "default")
    .maybeSingle();
  if (error || !data) {
    return {
      automation: "unavailable",
      videoDelayHours: 24,
      trialFollowupDelayHours: 72,
      dailyCap: 25,
      evergreenPersonalVideoId: null,
      campaignAssets: {},
    };
  }
  const status = data.automation_status;
  const automation: AcquisitionAutomation =
    status === "off" || status === "pilot" || status === "active" || status === "paused" ? status : "unavailable";
  return {
    automation,
    videoDelayHours: typeof data.video_delay_hours === "number" ? data.video_delay_hours : 24,
    trialFollowupDelayHours: typeof data.trial_followup_delay_hours === "number" ? data.trial_followup_delay_hours : 72,
    dailyCap: typeof data.daily_send_cap === "number" ? data.daily_send_cap : 25,
    evergreenPersonalVideoId: typeof data.evergreen_personal_video_id === "string" ? data.evergreen_personal_video_id : null,
    campaignAssets: data.campaign_assets && typeof data.campaign_assets === "object" ? data.campaign_assets as Record<string, unknown> : {},
  };
}

async function findPersonByEmail(email: string): Promise<PersonRow | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .select(PERSON_COLUMNS)
    .eq("email_normalized", email)
    .maybeSingle();
  if (error) return null;
  return asPerson(data as PersonRow | null);
}

async function findPersonById(id: string): Promise<PersonRow | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .select(PERSON_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return asPerson(data as PersonRow | null);
}

async function insertEvent(args: {
  personId: string | null;
  provider: "instantly" | "resend" | "personal_video" | "checkout" | "stripe" | "system";
  providerEventId: string;
  eventType: string;
  occurredAt: string;
  campaignId?: string | null;
  sender?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<"stored" | "duplicate" | "failed"> {
  const { error } = await supabaseServer.from("acquisition_events").insert({
    person_id: args.personId,
    provider: args.provider,
    provider_event_id: args.providerEventId,
    event_type: args.eventType,
    occurred_at: args.occurredAt,
    campaign_id: args.campaignId ?? null,
    sender: args.sender ?? null,
    metadata: args.metadata ?? {},
  });
  if (!error) return "stored";
  if ((error as { code?: string }).code === "23505") return "duplicate";
  return "failed";
}

async function writeState(person: PersonRow, state: AcquisitionLifecycle, extra: Record<string, unknown> = {}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .update({ lifecycle_state: state, updated_at: new Date().toISOString(), ...extra })
    .eq("id", person.id)
    .eq("lifecycle_state", person.lifecycle_state)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function cancelPending(personId: string): Promise<void> {
  await supabaseServer
    .from("acquisition_actions")
    .update({ status: "canceled", claim_until: null, updated_at: new Date().toISOString() })
    .eq("person_id", personId)
    .eq("status", "scheduled");
  await supabaseServer
    .from("acquisition_people")
    .update({ next_action_type: null, next_action_at: null, updated_at: new Date().toISOString() })
    .eq("id", personId);
}

async function rememberSenderSignal(row: {
  sender_email: string;
  sender_account_id?: string | null;
  connection_status: string;
  detail: string | null;
  observed_at: string;
  source: "instantly_webhook" | "instantly_api";
}): Promise<void> {
  const { error } = await supabaseServer.from("acquisition_sender_signals").insert(row);
  if (!error) return;
  if ((error as { code?: string }).code !== "23505") return;
  const patch: Record<string, unknown> = {
    connection_status: row.connection_status,
    detail: row.detail,
    observed_at: row.observed_at,
    source: row.source,
  };
  if (row.sender_account_id) patch.sender_account_id = row.sender_account_id;
  await supabaseServer
    .from("acquisition_sender_signals")
    .update(patch)
    .eq("sender_email", row.sender_email);
}

async function rememberSuppression(email: string, reason: "unsubscribe" | "complaint" | "bounce" | "provider"): Promise<void> {
  const { error } = await supabaseServer.from("recovery_suppressions").insert({
    email_normalized: email,
    reason,
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[acquisition] suppression was not stored");
  }
}

async function applySignal(person: PersonRow, signal: AcquisitionSignal, extra: Record<string, unknown> = {}): Promise<PersonRow> {
  const reduced = reduceLiveSignal(person.lifecycle_state, signal);
  if (reduced.outcome === "advance") {
    const wrote = await writeState(person, reduced.state, extra);
    if (!wrote) return person;
    if (
      reduced.state === "unsubscribed" ||
      reduced.state === "suppressed" ||
      reduced.state === "not_interested" ||
      reduced.state === "trial_started" ||
      reduced.state === "paid_member" ||
      reduced.state === "trial_expired"
    ) {
      await cancelPending(person.id);
    }
    return { ...person, lifecycle_state: reduced.state };
  }
  if (Object.keys(extra).length > 0) {
    await supabaseServer.from("acquisition_people").update({ ...extra, updated_at: new Date().toISOString() }).eq("id", person.id);
  }
  return person;
}

async function scheduleAction(personId: string, action: AcquisitionActionType, when: Date): Promise<void> {
  const { error } = await supabaseServer.from("acquisition_actions").insert({
    person_id: personId,
    action_type: action,
    status: "scheduled",
    idempotency_key: `acquisition:${personId}:${action}`,
    scheduled_at: when.toISOString(),
  });
  if (error) {
    if ((error as { code?: string }).code !== "23505") {
      console.warn("[acquisition] action was not scheduled");
    }
    return;
  }
  await supabaseServer
    .from("acquisition_people")
    .update({
      next_action_type: action,
      next_action_at: when.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", personId);
}

async function ensurePerson(args: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  campaignId?: string | null;
  sender?: string | null;
  sport?: string | null;
  role?: string | null;
  geography?: string | null;
}): Promise<PersonRow | null> {
  const existing = await findPersonByEmail(args.email);
  if (existing) {
    const fill: Record<string, unknown> = {};
    if (!existing.first_name && args.firstName) fill.first_name = args.firstName;
    if (!existing.last_name && args.lastName) fill.last_name = args.lastName;
    if (!existing.source_campaign && args.campaignId) fill.source_campaign = args.campaignId;
    if (!existing.source_sender && args.sender) fill.source_sender = args.sender;
    if (!existing.sport && args.sport) fill.sport = args.sport;
    if (!existing.role && args.role) fill.role = args.role;
    if (!existing.geography && args.geography) fill.geography = args.geography;
    if (Object.keys(fill).length > 0) {
      await supabaseServer.from("acquisition_people").update(fill).eq("id", existing.id);
    }
    return existing;
  }
  const { data, error } = await supabaseServer
    .from("acquisition_people")
    .insert({
      email_normalized: args.email,
      first_name: args.firstName ?? null,
      last_name: args.lastName ?? null,
      acquisition_source: "cold_email",
      source_campaign: args.campaignId ?? null,
      source_provider: "instantly",
      source_sender: args.sender ?? null,
      sport: args.sport ?? null,
      role: args.role ?? null,
      geography: args.geography ?? null,
      lifecycle_state: "cold_active",
    })
    .select(PERSON_COLUMNS)
    .maybeSingle();
  if (!error) return asPerson(data as PersonRow | null);
  if ((error as { code?: string }).code === "23505") return findPersonByEmail(args.email);
  return null;
}

export async function applyInstantlyWebhook(payload: unknown, now = new Date()): Promise<{ ok: true; duplicate?: boolean } | { ok: false }> {
  const normalized = normalizeInstantlyWebhook(payload, now);
  if (normalized.kind === "ignore") return { ok: true };
  if (normalized.kind === "sender") {
    const stored = await insertEvent({
      personId: null,
      provider: "instantly",
      providerEventId: normalized.providerEventId,
      eventType: "account_error",
      occurredAt: normalized.occurredAt,
      sender: normalized.sender,
      metadata: { detail: normalized.detail },
    });
    if (stored === "duplicate") return { ok: true, duplicate: true };
    if (normalized.sender) {
      await rememberSenderSignal({
        sender_email: normalized.sender,
        connection_status: "account_error",
        detail: normalized.detail,
        observed_at: normalized.occurredAt,
        source: "instantly_webhook",
      });
    }
    return { ok: stored !== "failed" };
  }
  return applyPersonEvent(normalized, now);
}

async function applyPersonEvent(event: Extract<InstantlyNormalized, { kind: "person" }>, now: Date) {
  const email = normalizeAcquisitionEmail(event.email);
  if (!email) return { ok: true as const };
  const person = await ensurePerson({
    email,
    campaignId: event.campaignId,
    sender: event.sender,
  });
  if (!person) return { ok: false as const };
  const stored = await insertEvent({
    personId: person.id,
    provider: "instantly",
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    campaignId: event.campaignId,
    sender: event.sender,
    metadata: {
      ...(event.preview ? { preview: event.preview } : {}),
      ...(event.closeReason ? { close_reason: event.closeReason } : {}),
      ...(event.step != null ? { step: event.step } : {}),
      ...(event.eventType === "unrecognized" ? { instantly_event_type: "unrecognized" } : {}),
    },
  });
  if (stored === "duplicate") return { ok: true as const, duplicate: true };
  if (stored === "failed") return { ok: false as const };
  const settings = await readAcquisitionSettings();
  let asset = person.requested_asset;
  if (event.signal === "interested" && !asset) {
    asset = assetFromCampaign(event.campaignId, settings.campaignAssets);
  }
  const extra: Record<string, unknown> = {};
  if (event.closeReason) extra.close_reason = event.closeReason;
  if (asset && !person.requested_asset) extra.requested_asset = asset;
  const updated = await applySignal(person, event.signal, extra);
  if (event.signal === "unsubscribed") await rememberSuppression(email, "unsubscribe");
  if (event.signal === "bounced") await rememberSuppression(email, "bounce");
  if (event.signal === "complained") await rememberSuppression(email, "complaint");
  if (updated.lifecycle_state === "asset_requested" && (asset || updated.requested_asset)) {
    await scheduleAction(updated.id, "send_asset", now);
  }
  return { ok: true as const };
}

export async function recordAcquisitionVideoEvent(args: {
  token: string;
  eventType: "personal_video_visited" | "personal_video_played" | "personal_video_cta_clicked";
  occurredAt?: string;
}): Promise<void> {
  const { data, error } = await supabaseServer
    .from("acquisition_video_recipients")
    .select("id, person_id")
    .eq("public_token", args.token)
    .maybeSingle();
  if (error || !data?.person_id || !data.id) return;
  await insertEvent({
    personId: String(data.person_id),
    provider: "personal_video",
    providerEventId: `recipient:${data.id}:${args.eventType}`,
    eventType: args.eventType,
    occurredAt: args.occurredAt ?? new Date().toISOString(),
    metadata: { recipient_id: data.id },
  });
}

export async function resolveAcquisitionRecipient(token: string): Promise<{
  personId: string;
  personalVideoId: string;
  vimeoVideoId: string;
  status: string;
} | null> {
  const { data, error } = await supabaseServer
    .from("acquisition_video_recipients")
    .select("person_id, personal_video_id, personal_videos(vimeo_video_id, status)")
    .eq("public_token", token)
    .maybeSingle();
  if (error || !data) return null;
  const video = Array.isArray(data.personal_videos) ? data.personal_videos[0] : data.personal_videos;
  if (!video || typeof video !== "object") return null;
  const row = video as { vimeo_video_id?: unknown; status?: unknown };
  if (typeof data.person_id !== "string" || typeof data.personal_video_id !== "string") return null;
  if (typeof row.vimeo_video_id !== "string" || typeof row.status !== "string") return null;
  return {
    personId: data.person_id,
    personalVideoId: data.personal_video_id,
    vimeoVideoId: row.vimeo_video_id,
    status: row.status,
  };
}

async function ensureRecipient(personId: string, personalVideoId: string): Promise<string | null> {
  const { data: video, error: videoError } = await supabaseServer
    .from("personal_videos")
    .select("status")
    .eq("id", personalVideoId)
    .maybeSingle();
  if (videoError || video?.status !== "ready") return null;
  const { data: existing } = await supabaseServer
    .from("acquisition_video_recipients")
    .select("public_token")
    .eq("person_id", personId)
    .eq("personal_video_id", personalVideoId)
    .maybeSingle();
  if (typeof existing?.public_token === "string") return existing.public_token;
  const token = newAcquisitionToken();
  const { error } = await supabaseServer.from("acquisition_video_recipients").insert({
    person_id: personId,
    personal_video_id: personalVideoId,
    public_token: token,
  });
  if (!error) return token;
  if ((error as { code?: string }).code !== "23505") return null;
  const { data: again } = await supabaseServer
    .from("acquisition_video_recipients")
    .select("public_token")
    .eq("person_id", personId)
    .eq("personal_video_id", personalVideoId)
    .maybeSingle();
  return typeof again?.public_token === "string" ? again.public_token : null;
}

function warmCopy(request: PassSendRequest): { subject: string; text: string; html: string; filename?: string; content?: string } {
  const name = request.person.firstName ? ` ${request.person.firstName}` : "";
  const unsubscribe = `https://summittmindset.com/api/acquisition/unsubscribe?token=${request.unsubscribeToken}`;
  if (request.action.actionType === "send_asset" && request.asset && request.assetBytes) {
    const label = ACQUISITION_ASSET_FILES[request.asset].label;
    const text = `Hi${name},\n\nYou asked for the ${label}. It is attached.\n\nTyler Summitt\n\nUnsubscribe: ${unsubscribe}`;
    return {
      subject: label,
      text,
      html: `<p>Hi${name},</p><p>You asked for the ${label}. It is attached.</p><p>Tyler Summitt</p><p><a href="${unsubscribe}">Unsubscribe</a></p>`,
      filename: ACQUISITION_ASSET_FILES[request.asset].filename,
      content: request.assetBytes.toString("base64"),
    };
  }
  if (request.action.actionType === "send_video" && request.videoToken) {
    const url = `https://summittmindset.com/for/${request.videoToken}`;
    const text = `Hi${name},\n\nI recorded a short note for you: ${url}\n\nTyler Summitt\n\nUnsubscribe: ${unsubscribe}`;
    return {
      subject: "A short note from Tyler Summitt",
      text,
      html: `<p>Hi${name},</p><p>I recorded a short note for you.</p><p><a href="${url}">Watch the video</a></p><p>Tyler Summitt</p><p><a href="${unsubscribe}">Unsubscribe</a></p>`,
    };
  }
  const url = "https://summittmindset.com/checkout/start";
  const text = `Hi${name},\n\nThe 7-day free trial is here when you want it: ${url}\n\nTyler Summitt\n\nUnsubscribe: ${unsubscribe}`;
  return {
    subject: "Your 7-day free trial",
    text,
    html: `<p>Hi${name},</p><p><a href="${url}">Start the 7-day free trial</a></p><p>Tyler Summitt</p><p><a href="${unsubscribe}">Unsubscribe</a></p>`,
  };
}

async function applyEffect(effect: PassEffect, settings: Settings, now: Date, tokenHash: string | null): Promise<void> {
  const stamp = now.toISOString();
  if (effect.kind === "release") {
    await supabaseServer
      .from("acquisition_actions")
      .update({ status: "scheduled", claim_until: null, updated_at: stamp })
      .eq("id", effect.actionId)
      .eq("status", "claimed");
    return;
  }
  if (effect.kind === "retry") {
    await supabaseServer
      .from("acquisition_actions")
      .update({
        status: "scheduled",
        claim_until: null,
        attempt_count: 1,
        scheduled_at: new Date(now.getTime() + ACQUISITION_RETRY_MS).toISOString(),
        updated_at: stamp,
      })
      .eq("id", effect.actionId)
      .eq("status", "claimed")
      .eq("attempt_count", 0);
    return;
  }
  if (effect.kind === "stop") {
    await supabaseServer
      .from("acquisition_actions")
      .update({ status: effect.status, claim_until: null, updated_at: stamp })
      .eq("id", effect.actionId)
      .eq("status", "claimed");
    const { data } = await supabaseServer
      .from("acquisition_actions")
      .select("person_id")
      .eq("id", effect.actionId)
      .maybeSingle();
    const personId = typeof data?.person_id === "string" ? data.person_id : "";
    if (!personId) return;
    if (effect.status === "suppressed") {
      const person = await findPersonById(personId);
      if (person) {
        const { data: suppression, error } = await supabaseServer
          .from("recovery_suppressions")
          .select("reason")
          .eq("email_normalized", person.email_normalized)
          .maybeSingle();
        if (!error) {
          await applySignal(person, suppression?.reason === "unsubscribe" ? "unsubscribed" : "bounced");
        }
      }
    }
    if (effect.cancelSiblings) await cancelPending(personId);
    return;
  }
  const { data } = await supabaseServer
    .from("acquisition_actions")
    .select("person_id, action_type")
    .eq("id", effect.actionId)
    .maybeSingle();
  if (!data?.person_id || (data.action_type !== "send_asset" && data.action_type !== "send_video" && data.action_type !== "send_trial_followup")) {
    return;
  }
  await supabaseServer
    .from("acquisition_actions")
    .update({
      status: "accepted",
      provider_message_id: effect.providerMessageId,
      claim_until: null,
      token_hash: tokenHash,
      updated_at: stamp,
    })
    .eq("id", effect.actionId)
    .eq("status", "claimed");
  const person = await findPersonById(String(data.person_id));
  if (!person || effect.settle.status !== "accepted") return;
  const updated = await applySignal(person, data.action_type === "send_asset" ? "asset_accepted" : data.action_type === "send_video" ? "video_accepted" : "trial_followup_accepted");
  if (effect.settle.schedule && updated.lifecycle_state !== person.lifecycle_state) {
    const hours = effect.settle.schedule === "send_video" ? settings.videoDelayHours : settings.trialFollowupDelayHours;
    await scheduleAction(updated.id, effect.settle.schedule, new Date(now.getTime() + hours * 60 * 60 * 1000));
  }
  await insertEvent({
    personId: person.id,
    provider: "resend",
    providerEventId: effect.providerMessageId ?? `accepted:${effect.actionId}`,
    eventType: "resend_accepted",
    occurredAt: stamp,
    metadata: { action: data.action_type },
  });
}

export async function runAcquisitionCron(now = new Date()): Promise<{ automation: string; accepted: number; skipped: string }> {
  const settings = await readAcquisitionSettings();
  if (settings.automation !== "pilot" && settings.automation !== "active") {
    return { automation: settings.automation, accepted: 0, skipped: "automation_off" };
  }
  await supabaseServer
    .from("acquisition_actions")
    .update({ status: "uncertain", claim_until: null, updated_at: now.toISOString() })
    .eq("status", "claimed")
    .lt("claim_until", now.toISOString());
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { count, error: countError } = await supabaseServer
    .from("acquisition_actions")
    .select("id", { count: "exact", head: true })
    .in("status", ["accepted", "delivered"])
    .gte("updated_at", start);
  if (countError || count == null) {
    return { automation: settings.automation, accepted: 0, skipped: "cap_unreadable" };
  }
  const { data: dueRows } = await supabaseServer
    .from("acquisition_actions")
    .select("id, person_id, action_type, attempt_count, idempotency_key")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(settings.dailyCap);
  const due = (dueRows ?? []).flatMap((row) => {
    if (row.action_type !== "send_asset" && row.action_type !== "send_video" && row.action_type !== "send_trial_followup") return [];
    if (typeof row.id !== "string" || typeof row.person_id !== "string" || typeof row.idempotency_key !== "string") return [];
    return [{
      id: row.id,
      personId: row.person_id,
      actionType: row.action_type,
      attemptCount: typeof row.attempt_count === "number" ? row.attempt_count : 0,
      idempotencyKey: row.idempotency_key,
    }];
  });
  const tokens = new Map<string, string>();
  const result = await runAcquisitionPass({
    now,
    automation: settings.automation,
    dailyCap: settings.dailyCap,
    acceptedToday: count,
    due,
    claim: async (action) => {
      const { data, error } = await supabaseServer
        .from("acquisition_actions")
        .update({
          status: "claimed",
          claimed_at: now.toISOString(),
          claim_until: new Date(now.getTime() + ACQUISITION_CLAIM_MS).toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", action.id)
        .eq("status", "scheduled")
        .select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },
    person: async (id) => {
      const person = await findPersonById(id);
      if (!person) return null;
      return {
        id: person.id,
        email: person.email_normalized,
        firstName: person.first_name,
        lifecycle: person.lifecycle_state,
        requestedAsset: person.requested_asset,
        clerkUserId: person.clerk_user_id,
      };
    },
    suppression: async (email) => {
      const { data, error } = await supabaseServer
        .from("recovery_suppressions")
        .select("id")
        .eq("email_normalized", email)
        .maybeSingle();
      if (error) return null;
      return Boolean(data?.id);
    },
    clerkSubscribed: async (clerkUserId) => {
      if (!clerkUserId) return false;
      try {
        const user = await getClerkUserOrNull(clerkUserId);
        if (!user) return false;
        return user.public_metadata?.summittSubscribed === true;
      } catch {
        return null;
      }
    },
    assetBytes: (asset) => readAcquisitionAsset(asset),
    videoToken: async (person) => {
      if (!settings.evergreenPersonalVideoId) return null;
      return ensureRecipient(person.id, settings.evergreenPersonalVideoId);
    },
    unsubscribeToken: () => {
      const token = newAcquisitionToken();
      return token;
    },
    send: async (request) => {
      tokens.set(request.action.id, request.unsubscribeToken);
      const key = process.env.RESEND_API_KEY;
      if (!key) return { outcome: "unknown", providerMessageId: null };
      const copy = warmCopy(request);
      try {
        const result = await new Resend(key).emails.send({
          from: RECOVERY_FROM,
          to: request.person.email,
          replyTo: "tyler@summittmindset.com",
          subject: copy.subject,
          text: copy.text,
          html: copy.html,
          headers: {
            "List-Unsubscribe": `<${`https://summittmindset.com/api/acquisition/unsubscribe?token=${request.unsubscribeToken}`}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          ...(copy.filename && copy.content
            ? { attachments: [{ filename: copy.filename, content: copy.content }] }
            : {}),
        }, { idempotencyKey: request.action.idempotencyKey });
        const classified = classifyResendSend({ result: { data: result.data, error: result.error } });
        return { outcome: classified.outcome, providerMessageId: classified.providerMessageId };
      } catch (err) {
        const classified = classifyResendSend({ threw: err });
        return { outcome: classified.outcome, providerMessageId: null };
      }
    },
    apply: async (effect) => {
      const token = tokens.get(effect.kind === "accept" ? effect.actionId : "");
      await applyEffect(effect, settings, now, token ? acquisitionTokenHash(token) : null);
    },
  });
  return { automation: settings.automation, accepted: result.accepted, skipped: result.skipped };
}

export async function unsubscribeAcquisition(token: string): Promise<"done" | "unknown"> {
  const hash = acquisitionTokenHash(token);
  const { data } = await supabaseServer
    .from("acquisition_actions")
    .select("person_id")
    .eq("token_hash", hash)
    .maybeSingle();
  if (typeof data?.person_id !== "string") return "unknown";
  const person = await findPersonById(data.person_id);
  if (!person) return "unknown";
  await rememberSuppression(person.email_normalized, "unsubscribe");
  await insertEvent({
    personId: person.id,
    provider: "resend",
    providerEventId: `unsubscribe:${hash}`,
    eventType: "resend_unsubscribed",
    occurredAt: new Date().toISOString(),
  });
  await applySignal(person, "unsubscribed");
  await cancelPending(person.id);
  return "done";
}

export async function applyAcquisitionResendEvent(event: {
  kind: string;
  providerMessageId?: string | null;
  email?: string | null;
  reason?: "bounce" | "complaint" | "provider";
}): Promise<void> {
  if (!event.providerMessageId && event.kind !== "suppress") return;
  if (event.kind === "delivered" && event.providerMessageId) {
    await supabaseServer
      .from("acquisition_actions")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("provider_message_id", event.providerMessageId)
      .eq("status", "accepted");
    return;
  }
  if (event.kind !== "suppress" || !event.email || !event.reason) return;
  const email = normalizeAcquisitionEmail(event.email);
  if (!email) return;
  await rememberSuppression(email, event.reason);
  const person = await findPersonByEmail(email);
  if (!person) return;
  const stored = await insertEvent({
    personId: person.id,
    provider: "resend",
    providerEventId: `resend:${event.reason}:${event.providerMessageId ?? email}`,
    eventType: event.reason === "complaint" ? "resend_complained" : event.reason === "bounce" ? "resend_bounced" : "resend_suppressed",
    occurredAt: new Date().toISOString(),
  });
  if (stored === "duplicate") return;
  await applySignal(person, event.reason === "complaint" ? "complained" : "bounced");
  await cancelPending(person.id);
}

export async function noteAcquisitionTrial(args: {
  email: string | null;
  clerkUserId: string | null;
  customerId: string | null;
  subscriptionId: string;
  eventId: string;
}): Promise<void> {
  const email = normalizeAcquisitionEmail(args.email);
  let person = email ? await findPersonByEmail(email) : null;
  if (!person) {
    const { data } = await supabaseServer
      .from("acquisition_people")
      .select(PERSON_COLUMNS)
      .eq("stripe_subscription_id", args.subscriptionId)
      .maybeSingle();
    person = asPerson(data as PersonRow | null);
  }
  if (!person) return;
  const stored = await insertEvent({
    personId: person.id,
    provider: "stripe",
    providerEventId: `trial:${args.eventId}`,
    eventType: "trial_started",
    occurredAt: new Date().toISOString(),
    metadata: { subscription_id: args.subscriptionId },
  });
  if (stored === "duplicate") return;
  await applySignal(person, "trial_started", {
    clerk_user_id: args.clerkUserId ?? person.clerk_user_id,
    stripe_customer_id: args.customerId ?? person.stripe_customer_id,
    stripe_subscription_id: args.subscriptionId,
  });
  await cancelPending(person.id);
}

export async function noteAcquisitionClerk(args: {
  email: string | null;
  clerkUserId: string;
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<void> {
  const email = normalizeAcquisitionEmail(args.email);
  if (!email) return;
  const person = await findPersonByEmail(email);
  if (!person) return;
  await supabaseServer
    .from("acquisition_people")
    .update({
      clerk_user_id: args.clerkUserId,
      stripe_customer_id: args.customerId ?? person.stripe_customer_id,
      stripe_subscription_id: args.subscriptionId ?? person.stripe_subscription_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", person.id);
}

export async function noteAcquisitionPaid(args: {
  subscriptionId: string;
  eventId: string;
  clerkUserId: string | null;
}): Promise<void> {
  const { data } = await supabaseServer
    .from("acquisition_people")
    .select(PERSON_COLUMNS)
    .eq("stripe_subscription_id", args.subscriptionId)
    .maybeSingle();
  const person = asPerson(data as PersonRow | null);
  if (!person) return;
  const stored = await insertEvent({
    personId: person.id,
    provider: "stripe",
    providerEventId: `paid:${args.eventId}`,
    eventType: "paid_member",
    occurredAt: new Date().toISOString(),
    metadata: { subscription_id: args.subscriptionId },
  });
  if (stored === "duplicate") return;
  await applySignal(person, "paid_member", {
    clerk_user_id: args.clerkUserId ?? person.clerk_user_id,
  });
  await cancelPending(person.id);
}

export async function noteAcquisitionClosed(args: { subscriptionId: string; eventId: string }): Promise<void> {
  const { data } = await supabaseServer
    .from("acquisition_people")
    .select(PERSON_COLUMNS)
    .eq("stripe_subscription_id", args.subscriptionId)
    .maybeSingle();
  const person = asPerson(data as PersonRow | null);
  if (!person) return;
  const stored = await insertEvent({
    personId: person.id,
    provider: "stripe",
    providerEventId: `closed:${args.eventId}`,
    eventType: "trial_expired",
    occurredAt: new Date().toISOString(),
    metadata: { subscription_id: args.subscriptionId },
  });
  if (stored === "duplicate") return;
  await applySignal(person, "trial_expired");
  await cancelPending(person.id);
}

export async function loadAcquisitionDashboard(): Promise<AcquisitionDashboard> {
  try {
    const settings = await readAcquisitionSettings();
    const { data: people, error } = await supabaseServer
      .from("acquisition_people")
      .select("id, first_name, last_name, lifecycle_state, requested_asset")
      .limit(5000);
    if (error) return emptyAcquisitionDashboard("Acquisition people could not be read. Do not treat that as zero.");
    const { data: actions } = await supabaseServer
      .from("acquisition_actions")
      .select("person_id, action_type, status")
      .in("status", ["scheduled", "claimed", "accepted", "delivered", "blocked", "uncertain"]);
    const { data: events } = await supabaseServer
      .from("acquisition_events")
      .select("person_id, event_type")
      .eq("provider", "personal_video")
      .in("event_type", ["personal_video_visited", "personal_video_played", "personal_video_cta_clicked"]);
    const { data: senders } = await supabaseServer
      .from("acquisition_sender_signals")
      .select("sender_email, connection_status, detail, observed_at")
      .order("observed_at", { ascending: false })
      .limit(20);
    const senderRows: AcquisitionSenderRow[] = (senders ?? []).flatMap((row) => {
      if (typeof row.sender_email !== "string" || typeof row.connection_status !== "string") return [];
      return [{
        senderEmail: row.sender_email,
        connectionStatus: row.connection_status,
        detail: typeof row.detail === "string" ? row.detail : null,
        observedAt: typeof row.observed_at === "string" ? row.observed_at : "",
      }];
    });
    return buildAcquisitionDashboard({
      automation: settings.automation,
      people: (people ?? []).flatMap((row) => {
        if (typeof row.id !== "string" || typeof row.lifecycle_state !== "string") return [];
        return [{
          id: row.id,
          firstName: typeof row.first_name === "string" ? row.first_name : null,
          lastName: typeof row.last_name === "string" ? row.last_name : null,
          lifecycle: row.lifecycle_state as AcquisitionLifecycle,
          requestedAsset: parseAcquisitionAsset(row.requested_asset),
        }];
      }),
      actions: (actions ?? []).flatMap((row) => {
        if (typeof row.person_id !== "string") return [];
        return [{
          personId: row.person_id,
          actionType: String(row.action_type ?? ""),
          status: String(row.status ?? ""),
        }];
      }),
      videoEvents: (events ?? []).flatMap((row) => {
        if (typeof row.person_id !== "string" || typeof row.event_type !== "string") return [];
        return [{ personId: row.person_id, eventType: row.event_type }];
      }),
      senders: senderRows,
    });
  } catch {
    return emptyAcquisitionDashboard("Acquisition people could not be read. Do not treat that as zero.");
  }
}

export async function dryRunInstantlyBackfill(leads: readonly unknown[]): Promise<BackfillPlan> {
  const { data, error } = await supabaseServer.from("acquisition_people").select("email_normalized, lifecycle_state").limit(5000);
  if (error) {
    return {
      readable: false,
      proposals: [],
      skippedNoEmail: 0,
      skippedUnrecognized: 0,
      wouldCreate: 0,
      wouldApply: 0,
      wouldSkipStronger: 0,
      wouldSkipSame: 0,
      interested: 0,
      note: "Existing acquisition people could not be read. Nothing was written.",
    };
  }
  const current = new Map<string, AcquisitionLifecycle>();
  for (const row of data ?? []) {
    if (typeof row.email_normalized === "string" && typeof row.lifecycle_state === "string") {
      current.set(row.email_normalized, row.lifecycle_state as AcquisitionLifecycle);
    }
  }
  return planInstantlyBackfill({ leads, currentByEmail: current });
}

export async function applyInstantlyBackfill(proposals: readonly BackfillProposal[]): Promise<{ written: number }> {
  let written = 0;
  for (const proposal of proposals) {
    const person = await ensurePerson({
      email: proposal.email,
      firstName: proposal.firstName,
      lastName: proposal.lastName,
      campaignId: proposal.campaignId,
      sport: proposal.sport,
      role: proposal.role,
      geography: proposal.geography,
    });
    if (!person) continue;
    const stored = await insertEvent({
      personId: person.id,
      provider: "instantly",
      providerEventId: proposal.providerEventId,
      eventType: "instantly_lead_observed",
      occurredAt: new Date().toISOString(),
      campaignId: proposal.campaignId,
      metadata: {
        interest: proposal.interest,
        lead_status: proposal.leadStatus,
      },
    });
    if (stored === "duplicate") continue;
    const decision = proposal.lifecycle;
    if (person.lifecycle_state === "cold_active" && decision === "cold_active") {
      written += 1;
      continue;
    }
    const signal: AcquisitionSignal | null =
      decision === "cold_no_response" ? "campaign_completed"
      : decision === "asset_requested" ? "interested"
      : decision === "not_interested" ? "not_interested"
      : decision === "unsubscribed" ? "unsubscribed"
      : decision === "suppressed" ? "bounced"
      : null;
    if (!signal) continue;
    const extra = proposal.asset ? { requested_asset: proposal.asset } : {};
    const updated = await applySignal(person, signal, extra);
    if (signal === "unsubscribed") await rememberSuppression(proposal.email, "unsubscribe");
    if (signal === "bounced") await rememberSuppression(proposal.email, "bounce");
    if (updated.lifecycle_state === "asset_requested" && (proposal.asset || updated.requested_asset)) {
      await scheduleAction(updated.id, "send_asset", new Date());
    }
    written += 1;
  }
  return { written };
}

export async function refreshInstantlySenderSignals(now = new Date()): Promise<{ read: number }> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) return { read: 0 };
  let startingAfter = "";
  let read = 0;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.instantly.ai/api/v2/accounts");
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) break;
    const body = await response.json() as { items?: unknown[]; next_starting_after?: unknown };
    const items = Array.isArray(body.items) ? body.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
      if (!email) continue;
      const status = typeof row.status === "number" ? String(row.status) : "unknown";
      const message = row.status_message && typeof row.status_message === "object"
        ? row.status_message as Record<string, unknown>
        : {};
      const detail = typeof message.code === "string"
        ? message.code.slice(0, 180)
        : typeof message.response === "string"
          ? message.response.slice(0, 180)
          : null;
      await rememberSenderSignal({
        sender_email: email,
        sender_account_id: typeof row.id === "string" ? row.id : null,
        connection_status: status.slice(0, 40),
        detail,
        observed_at: now.toISOString(),
        source: "instantly_api",
      });
      read += 1;
    }
    if (typeof body.next_starting_after !== "string" || !body.next_starting_after || items.length === 0) break;
    startingAfter = body.next_starting_after;
  }
  return { read };
}

export async function fetchInstantlyLeads(maxPages = 20): Promise<unknown[]> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) return [];
  const leads: unknown[] = [];
  let startingAfter = "";
  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetch("https://api.instantly.ai/api/v2/leads/list", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      }),
    });
    if (!response.ok) break;
    const body = await response.json() as { items?: unknown[]; next_starting_after?: unknown };
    const items = Array.isArray(body.items) ? body.items : [];
    leads.push(...items);
    if (typeof body.next_starting_after !== "string" || !body.next_starting_after || items.length === 0) break;
    startingAfter = body.next_starting_after;
  }
  return leads;
}
