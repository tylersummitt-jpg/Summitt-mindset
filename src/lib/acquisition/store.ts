import "server-only";

import { Resend } from "resend";

import {
  assignInterestFulfillment,
  loadBundleFiles,
  parseAcquisitionOffers,
  parsePromisedAssetKeys,
  readAcquisitionAssetReport,
  resourceLabels,
  resolveCampaignPromise,
  resolveSendAssets,
  type AcquisitionFileKey,
  type AcquisitionOffer,
} from "@/lib/acquisition/assets";
import {
  bindAcceptanceToOffer,
  buildConversationInterpreterInput,
  conversationCalendar,
  conversationOwnsCampaign,
  decideConversationEffect,
  inboundInterpretationError,
  inboundPersistencePlan,
  initialInboundStatus,
  nextClaimDecision,
  providerLabelMayApplyLifecycle,
  threadReplyAuthorization,
  reviewConversationDraft,
  reviewConversationSubject,
  runAcquisitionConversationInterpreter,
  type ConversationOutcome,
} from "@/lib/acquisition/conversation";
import { loadInterpreterKnowledge } from "@/lib/acquisition/email-knowledge.server";
import { inboundIdsBlockedByEmailAnswers, reconcileAcquisitionEmailAnswers } from "@/lib/acquisition/email-manual-answer.server";
import { outboundSendPlan, postInstantlyThreadReply, reconcileInstantlyReply, replyRowFromAttempt } from "@/lib/acquisition/instantly-reply";
import {
  instantlyBlocklistEnabled,
  instantlyBlockReasonForSuppression,
  instantlyBlockSourceId,
} from "@/lib/acquisition/instantly-block";
import { deliverPendingInstantlyBlocks, ensureInstantlyBlock, reconcileMissingInstantlyBlocks } from "@/lib/acquisition/instantly-block.server";
import {
  continueAfterInstantlyPage,
  continueAfterRangePage,
  INSTANTLY_PAGE_CAP,
  INSTANTLY_PAGE_SIZE,
  parseInstantlyListPayload,
  planInstantlyBackfill,
  type BackfillPlan,
  type BackfillProposal,
  type CampaignName,
  type ExistingBackfillPerson,
  type InstantlyBackfillSource,
} from "@/lib/acquisition/backfill";
import {
  buildAcquisitionDashboard,
  emptyAcquisitionDashboard,
  type AcquisitionDashboard,
  type AcquisitionSenderRow,
} from "@/lib/acquisition/dashboard";
import { instantlyPersonMetadata, normalizeInstantlyWebhook, type InstantlyNormalized } from "@/lib/acquisition/instantly";
import {
  ACQUISITION_CLAIM_MS,
  ACQUISITION_RETRY_MS,
  acquisitionTokenHash,
  newAcquisitionToken,
  normalizeAcquisitionEmail,
  parseAcquisitionAsset,
  reduceLiveSignal,
  salesEmailMustStop,
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
  "id, email_normalized, first_name, last_name, lifecycle_state, requested_asset, offer_key, clerk_user_id, stripe_customer_id, stripe_subscription_id, source_campaign, source_sender, sport, role, geography, close_reason";

type PersonRow = {
  id: string;
  email_normalized: string;
  first_name: string | null;
  last_name: string | null;
  lifecycle_state: AcquisitionLifecycle;
  requested_asset: AcquisitionAsset | null;
  offer_key: string | null;
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
  offers: Map<string, AcquisitionOffer>;
  conversationInterpretation: "off" | "pilot";
  conversationSending: "off" | "on";
  conversationPilotCampaigns: string[];
  instantlyBlocklist: "off" | "on";
};

const SETTINGS_COLUMNS_WITHOUT_BLOCKLIST = "automation_status, video_delay_hours, trial_followup_delay_hours, daily_send_cap, evergreen_personal_video_id, campaign_assets, offers, conversation_interpretation, conversation_sending, conversation_pilot_campaigns";
const SETTINGS_COLUMNS = `${SETTINGS_COLUMNS_WITHOUT_BLOCKLIST}, instantly_blocklist`;
const LEGACY_SETTINGS_COLUMNS = "automation_status, video_delay_hours, trial_followup_delay_hours, daily_send_cap, evergreen_personal_video_id, campaign_assets, offers";

function parsePilotCampaigns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id.length < 1 || id.length > 80 || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

function settingsFromRow(data: Record<string, unknown>, conversationReady: boolean, blocklistReady: boolean): Settings {
  const status = data.automation_status;
  const automation: AcquisitionAutomation =
    status === "off" || status === "pilot" || status === "active" || status === "paused" ? status : "unavailable";
  const interpretation = data.conversation_interpretation === "pilot" ? "pilot" : "off";
  const sending = data.conversation_sending === "on" ? "on" : "off";
  return {
    automation,
    videoDelayHours: typeof data.video_delay_hours === "number" ? data.video_delay_hours : 24,
    trialFollowupDelayHours: typeof data.trial_followup_delay_hours === "number" ? data.trial_followup_delay_hours : 72,
    dailyCap: typeof data.daily_send_cap === "number" ? data.daily_send_cap : 25,
    evergreenPersonalVideoId: typeof data.evergreen_personal_video_id === "string" ? data.evergreen_personal_video_id : null,
    campaignAssets: data.campaign_assets && typeof data.campaign_assets === "object" ? data.campaign_assets as Record<string, unknown> : {},
    offers: parseAcquisitionOffers(data.offers),
    conversationInterpretation: conversationReady ? interpretation : "off",
    conversationSending: conversationReady ? sending : "off",
    conversationPilotCampaigns: conversationReady ? parsePilotCampaigns(data.conversation_pilot_campaigns) : [],
    instantlyBlocklist: blocklistReady && instantlyBlocklistEnabled(data.instantly_blocklist) ? "on" : "off",
  };
}

const SETTINGS_UNAVAILABLE: Settings = {
  automation: "unavailable",
  videoDelayHours: 24,
  trialFollowupDelayHours: 72,
  dailyCap: 25,
  evergreenPersonalVideoId: null,
  campaignAssets: {},
  offers: new Map(),
  conversationInterpretation: "off",
  conversationSending: "off",
  conversationPilotCampaigns: [],
  instantlyBlocklist: "off",
};

function asPerson(row: PersonRow | null): PersonRow | null {
  if (!row || typeof row.id !== "string") return null;
  const offerKey = typeof row.offer_key === "string" ? row.offer_key.trim() : "";
  return { ...row, offer_key: offerKey || null, requested_asset: parseAcquisitionAsset(row.requested_asset) };
}

export async function readAcquisitionSettings(): Promise<Settings> {
  const first = await supabaseServer
    .from("acquisition_settings")
    .select(SETTINGS_COLUMNS)
    .eq("id", "default")
    .maybeSingle();
  if (!first.error && first.data) return settingsFromRow(first.data as Record<string, unknown>, true, true);
  const message = first.error?.message ?? "";
  const missingConversationColumns = message.includes("conversation_interpretation")
    || message.includes("conversation_sending")
    || message.includes("conversation_pilot_campaigns");
  if (message.includes("instantly_blocklist") && !missingConversationColumns) {
    const withoutBlocklist = await supabaseServer
      .from("acquisition_settings")
      .select(SETTINGS_COLUMNS_WITHOUT_BLOCKLIST)
      .eq("id", "default")
      .maybeSingle();
    if (!withoutBlocklist.error && withoutBlocklist.data) {
      return settingsFromRow(withoutBlocklist.data as Record<string, unknown>, true, false);
    }
  }
  if (missingConversationColumns) {
    const legacy = await supabaseServer
      .from("acquisition_settings")
      .select(LEGACY_SETTINGS_COLUMNS)
      .eq("id", "default")
      .maybeSingle();
    if (!legacy.error && legacy.data) return settingsFromRow(legacy.data as Record<string, unknown>, false, false);
  }
  return SETTINGS_UNAVAILABLE;
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

async function rememberSuppression(
  email: string,
  reason: "unsubscribe" | "complaint" | "bounce" | "provider",
): Promise<{ ok: boolean }> {
  const { error } = await supabaseServer.from("recovery_suppressions").insert({
    email_normalized: email,
    reason,
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[acquisition] suppression was not stored");
  }
  const blockReason = instantlyBlockReasonForSuppression(reason);
  if (!blockReason) return { ok: true };
  const block = await ensureInstantlyBlock({
    email,
    personId: null,
    reason: blockReason,
    sourceEventId: instantlyBlockSourceId(`suppression:${blockReason}`, email),
  });
  if (block.outcome === "not_stored") return { ok: false };
  return { ok: true };
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

export function acquisitionActionIdempotencyKey(
  personId: string,
  action: AcquisitionActionType,
  journeyId: string | null,
): string {
  return journeyId
    ? `acquisition:${personId}:${journeyId}:${action}`
    : `acquisition:${personId}:${action}`;
}

async function scheduleAction(
  personId: string,
  action: AcquisitionActionType,
  when: Date,
  scope?: {
    journeyId: string;
    promise?: { offerKey: string | null; label: string | null; assets: AcquisitionFileKey[] } | null;
  },
): Promise<void> {
  const journeyId = scope?.journeyId ?? null;
  const promise = journeyId && action === "send_asset" ? scope?.promise ?? null : null;
  const { error } = await supabaseServer.from("acquisition_actions").insert({
    person_id: personId,
    action_type: action,
    status: "scheduled",
    journey_id: journeyId,
    idempotency_key: acquisitionActionIdempotencyKey(personId, action, journeyId),
    promised_offer_key: promise?.offerKey ?? null,
    promised_label: promise?.label ?? null,
    promised_assets: promise?.assets ?? null,
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
  lifecycle?: AcquisitionLifecycle;
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
      lifecycle_state: args.lifecycle ?? "cold_active",
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

function readJourneyPersistResult(data: unknown): { status: "inserted"; journeyId: string | null } | { status: "duplicate" } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as { result?: unknown; journey_id?: unknown };
  if (row.result === "duplicate") return { status: "duplicate" };
  if (row.result !== "inserted") return null;
  if (row.journey_id == null) return { status: "inserted", journeyId: null };
  if (typeof row.journey_id === "string" && row.journey_id.length > 0) return { status: "inserted", journeyId: row.journey_id };
  return null;
}

async function persistInstantlyPersonEvent(args: {
  personId: string;
  providerEventId: string;
  eventType: string;
  occurredAt: string;
  campaignId: string | null;
  sender: string | null;
  metadata: Record<string, unknown>;
}): Promise<{ status: "inserted"; journeyId: string | null } | { status: "duplicate" } | { status: "failed" }> {
  const { data, error } = await supabaseServer.rpc("acquisition_persist_instantly_person_event_result", {
    p_person_id: args.personId,
    p_provider_event_id: args.providerEventId,
    p_event_type: args.eventType,
    p_occurred_at: args.occurredAt,
    p_campaign_id: args.campaignId,
    p_sender: args.sender,
    p_metadata: args.metadata,
  });
  if (error) return { status: "failed" };
  return readJourneyPersistResult(data) ?? { status: "failed" };
}

async function provenJourneyId(
  personId: string,
  campaignId: string | null,
  known: string | null,
  eventStatus: "inserted" | "duplicate",
): Promise<{ ok: true; journeyId: string | null } | { ok: false }> {
  if (eventStatus === "inserted") return { ok: true, journeyId: known };
  if (!campaignId) return { ok: true, journeyId: null };
  const { data, error } = await supabaseServer
    .from("acquisition_journeys")
    .select("id")
    .eq("person_id", personId)
    .eq("campaign_id", campaignId);
  if (error || !Array.isArray(data)) return { ok: false };
  if (data.length !== 1 || typeof data[0]?.id !== "string") return { ok: true, journeyId: null };
  return { ok: true, journeyId: data[0].id };
}

async function ensureInboundReply(args: {
  personId: string;
  email: string;
  event: Extract<InstantlyNormalized, { kind: "person" }>;
  journeyId: string | null;
  aiOwns: boolean;
}): Promise<"inserted" | "duplicate" | "failed"> {
  const status = initialInboundStatus({
    hasBody: Boolean(args.event.replyText),
    truncated: args.event.replyTextTruncated,
    aiOwns: args.aiOwns,
  });
  const replyBlock = !args.event.providerMessageId
    ? "missing_reply_target"
    : !args.event.sender
      ? "missing_account"
      : !args.event.replySubject
        ? "missing_subject"
        : null;
  const { error } = await supabaseServer.from("acquisition_messages").insert({
    person_id: args.personId,
    journey_id: args.journeyId,
    direction: "inbound",
    provider: "instantly",
    provider_message_id: args.event.providerMessageId ?? args.event.providerEventId,
    reply_to_provider_message_id: args.event.providerMessageId,
    campaign_id: args.event.campaignId,
    sender_account: args.event.sender,
    lead_email: args.email,
    subject: args.event.replySubject,
    body_text: args.event.replyText ?? "",
    occurred_at: args.event.occurredAt,
    processing_status: status.status,
    processing_error: status.error,
    reply_block: replyBlock,
  });
  if (!error) return "inserted";
  if ((error as { code?: string }).code === "23505") return "duplicate";
  return "failed";
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
  const stored = await persistInstantlyPersonEvent({
    personId: person.id,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    campaignId: event.campaignId,
    sender: event.sender,
    metadata: instantlyPersonMetadata(event),
  });
  if (stored.status === "failed") return { ok: false as const };
  const settings = await readAcquisitionSettings();
  let message: "inserted" | "duplicate" | "failed" | "skipped" = "skipped";
  let journeyId = stored.status === "inserted" ? stored.journeyId : null;
  if (event.eventType === "reply_received") {
    const journey = await provenJourneyId(
      person.id,
      event.campaignId,
      stored.status === "inserted" ? stored.journeyId : null,
      stored.status,
    );
    if (!journey.ok) return { ok: false as const };
    journeyId = journey.journeyId;
    message = await ensureInboundReply({
      personId: person.id,
      email,
      event,
      journeyId,
      aiOwns: conversationOwnsCampaign({
        interpretation: settings.conversationInterpretation,
        pilotCampaigns: settings.conversationPilotCampaigns,
        campaignId: event.campaignId,
      }),
    });
  }
  const plan = inboundPersistencePlan({ event: stored.status, message });
  if (plan === "retry") return { ok: false as const };
  const blockReason =
    event.signal === "unsubscribed" ? "unsubscribe" as const
    : event.signal === "bounced" ? "bounce" as const
    : event.signal === "complained" ? "complaint" as const
    : null;
  if (plan === "already_recorded") {
    if (!blockReason) return { ok: true as const, duplicate: true };
    const block = await rememberSuppression(email, blockReason);
    if (!block.ok) return { ok: false as const };
    return { ok: true as const, duplicate: true };
  }
  const labelMayApply = providerLabelMayApplyLifecycle({
    interpretation: settings.conversationInterpretation,
    pilotCampaigns: settings.conversationPilotCampaigns,
    campaignId: event.campaignId,
  });
  if ((event.signal === "interested" || event.signal === "not_interested") && !labelMayApply) {
    return { ok: true as const };
  }
  const fulfillment = event.signal === "interested"
    ? assignInterestFulfillment({
        currentOfferKey: person.offer_key,
        currentAsset: person.requested_asset,
        campaignValue: event.campaignId ? settings.campaignAssets[event.campaignId] : null,
        offers: settings.offers,
      })
    : null;
  const extra: Record<string, unknown> = {};
  if (event.closeReason) extra.close_reason = event.closeReason;
  if (!journeyId && fulfillment?.assetToStore) extra.requested_asset = fulfillment.assetToStore;
  if (!journeyId && fulfillment?.offerKeyToStore) extra.offer_key = fulfillment.offerKeyToStore;
  const updated = await applySignal(person, event.signal, extra);
  if (blockReason) {
    const block = await rememberSuppression(email, blockReason);
    if (!block.ok) return { ok: false as const };
  }
  // Outside the pilot, lead_not_interested remains a global stop. Inside the pilot it does not.
  if (salesEmailMustStop(updated.lifecycle_state)) return { ok: true as const };
  if (event.signal === "interested" && journeyId) {
    const promise = resolveCampaignPromise({
      campaignValue: event.campaignId ? settings.campaignAssets[event.campaignId] : null,
      offers: settings.offers,
    });
    if (promise) {
      await scheduleAction(updated.id, "send_asset", now, { journeyId, promise });
    }
    return { ok: true as const };
  }
  const canSendAsset = Boolean(
    fulfillment?.hasFulfillment || person.requested_asset || person.offer_key
  );
  if (!journeyId && updated.lifecycle_state === "asset_requested" && canSendAsset) {
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

function warmCopy(request: PassSendRequest): {
  subject: string;
  text: string;
  html: string;
  attachments: Array<{ filename: string; content: string }>;
} {
  const name = request.person.firstName ? ` ${request.person.firstName}` : "";
  const unsubscribe = `https://summittmindset.com/api/acquisition/unsubscribe?token=${request.unsubscribeToken}`;
  if (request.action.actionType === "send_asset" && request.attachments.length > 0) {
    const label = request.attachments.length === 1
      ? request.attachments[0].label
      : request.offerLabel ?? request.attachments.map((file) => file.label).join(" and ");
    const attached = request.attachments.length === 1 ? "It is attached." : "They are attached.";
    const text = `Hi${name},\n\nYou asked for the ${label}. ${attached}\n\nTyler Summitt\n\nUnsubscribe: ${unsubscribe}`;
    return {
      subject: label,
      text,
      html: `<p>Hi${name},</p><p>You asked for the ${label}. ${attached}</p><p>Tyler Summitt</p><p><a href="${unsubscribe}">Unsubscribe</a></p>`,
      attachments: request.attachments.map((file) => ({
        filename: file.filename,
        content: file.bytes.toString("base64"),
      })),
    };
  }
  if (request.action.actionType === "send_video" && request.videoToken) {
    const url = `https://summittmindset.com/for/${request.videoToken}`;
    const text = `Hi${name},\n\nI recorded a short note for you: ${url}\n\nTyler Summitt\n\nUnsubscribe: ${unsubscribe}`;
    return {
      subject: "A short note from Tyler Summitt",
      text,
      html: `<p>Hi${name},</p><p>I recorded a short note for you.</p><p><a href="${url}">Watch the video</a></p><p>Tyler Summitt</p><p><a href="${unsubscribe}">Unsubscribe</a></p>`,
      attachments: [],
    };
  }
  const url = "https://summittmindset.com/checkout/start";
  const text = `Hi${name},\n\nThe 7-day free trial is here when you want it: ${url}\n\nTyler Summitt\n\nUnsubscribe: ${unsubscribe}`;
  return {
    subject: "Your 7-day free trial",
    text,
    html: `<p>Hi${name},</p><p><a href="${url}">Start the 7-day free trial</a></p><p>Tyler Summitt</p><p><a href="${unsubscribe}">Unsubscribe</a></p>`,
    attachments: [],
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
    .select("person_id, action_type, journey_id")
    .eq("id", effect.actionId)
    .maybeSingle();
  if (!data?.person_id || (data.action_type !== "send_asset" && data.action_type !== "send_video" && data.action_type !== "send_trial_followup")) {
    return;
  }
  const journeyId = typeof data.journey_id === "string" ? data.journey_id : null;
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
  if (effect.settle.schedule && (journeyId || updated.lifecycle_state !== person.lifecycle_state)) {
    const hours = effect.settle.schedule === "send_video" ? settings.videoDelayHours : settings.trialFollowupDelayHours;
    await scheduleAction(
      updated.id,
      effect.settle.schedule,
      new Date(now.getTime() + hours * 60 * 60 * 1000),
      journeyId ? { journeyId } : undefined,
    );
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

type InboundWork = {
  id: string;
  personId: string;
  journeyId: string | null;
  campaignId: string | null;
  subject: string | null;
  body: string;
  occurredAt: string;
  status: string;
  claimUntil: string | null;
  attemptCount: number;
  outcome: ConversationOutcome | null;
  reason: string | null;
  draftSubject: string | null;
  draftBody: string | null;
  effectApplied: boolean;
};

function asOutcome(value: unknown): ConversationOutcome | null {
  if (
    value === "accept_offer" ||
    value === "ask_question" ||
    value === "referral" ||
    value === "offer_decline" ||
    value === "unsubscribe" ||
    value === "complaint" ||
    value === "ambiguous" ||
    value === "needs_human"
  ) {
    return value;
  }
  return null;
}

async function loadInboundWork(now: Date): Promise<InboundWork[]> {
  const select = "id, person_id, journey_id, campaign_id, subject, body_text, occurred_at, processing_status, claim_until, attempt_count, ai_outcome, ai_reason, draft_subject, draft_body, effect_applied_at";
  const [pending, failed, expired] = await Promise.all([
    supabaseServer.from("acquisition_messages").select(select).eq("direction", "inbound").eq("processing_status", "pending").limit(5),
    supabaseServer.from("acquisition_messages").select(select).eq("direction", "inbound").eq("processing_status", "failed").is("effect_applied_at", null).limit(5),
    supabaseServer.from("acquisition_messages").select(select).eq("direction", "inbound").eq("processing_status", "processing").lt("claim_until", now.toISOString()).limit(5),
  ]);
  const rows = [...(pending.data ?? []), ...(failed.data ?? []), ...(expired.data ?? [])];
  const seen = new Set<string>();
  const work: InboundWork[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || seen.has(row.id) || typeof row.person_id !== "string" || typeof row.body_text !== "string") continue;
    seen.add(row.id);
    work.push({
      id: row.id,
      personId: row.person_id,
      journeyId: typeof row.journey_id === "string" ? row.journey_id : null,
      campaignId: typeof row.campaign_id === "string" ? row.campaign_id : null,
      subject: typeof row.subject === "string" ? row.subject : null,
      body: row.body_text,
      occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : now.toISOString(),
      status: typeof row.processing_status === "string" ? row.processing_status : "",
      claimUntil: typeof row.claim_until === "string" ? row.claim_until : null,
      attemptCount: typeof row.attempt_count === "number" ? row.attempt_count : 0,
      outcome: asOutcome(row.ai_outcome),
      reason: typeof row.ai_reason === "string" ? row.ai_reason : null,
      draftSubject: typeof row.draft_subject === "string" ? row.draft_subject : null,
      draftBody: typeof row.draft_body === "string" ? row.draft_body : null,
      effectApplied: row.effect_applied_at != null,
    });
  }
  return work;
}

async function claimInbound(row: InboundWork, now: Date, increment: boolean): Promise<boolean> {
  const patch: Record<string, unknown> = {
    processing_status: "processing",
    claimed_at: now.toISOString(),
    claim_until: new Date(now.getTime() + ACQUISITION_CLAIM_MS).toISOString(),
    updated_at: now.toISOString(),
  };
  if (increment) patch.attempt_count = row.attemptCount + 1;
  let query = supabaseServer.from("acquisition_messages").update(patch).eq("id", row.id);
  query = row.status === "processing"
    ? query.eq("processing_status", "processing").lt("claim_until", now.toISOString())
    : query.eq("processing_status", row.status);
  const { data, error } = await query.select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function finishInbound(id: string, patch: Record<string, unknown>, now: Date): Promise<boolean> {
  const { data, error } = await supabaseServer.from("acquisition_messages").update({
    ...patch,
    claim_until: null,
    updated_at: now.toISOString(),
  }).eq("id", id).eq("processing_status", "processing").select("id");
  if (error || !Array.isArray(data) || data.length !== 1) {
    console.error("[acquisition] inbound effect was not stored", { id, reason: "not_stored" });
    return false;
  }
  return true;
}

export async function processAcquisitionConversations(now = new Date(), known?: Settings): Promise<{
  skipped: string;
  interpreted: number;
  failed: number;
  sent: number;
}> {
  const settings = known ?? await readAcquisitionSettings();
  const interpret = settings.conversationInterpretation === "pilot";
  const sending = settings.conversationSending === "on";
  if (!interpret && !sending) {
    return { skipped: "conversation_off", interpreted: 0, failed: 0, sent: 0 };
  }
  const work = interpret ? await loadInboundWork(now) : [];
  let interpreted = 0;
  let failed = 0;
  let sent = 0;
  for (const row of work) {
    const decision = nextClaimDecision({
      status: row.status,
      claimUntil: row.claimUntil,
      attemptCount: row.attemptCount,
      outcome: row.outcome,
      effectApplied: row.effectApplied,
      now,
    });
    if (decision === "leave") continue;
    if (decision === "give_up") {
      if (row.status !== "failed") {
        await supabaseServer.from("acquisition_messages").update({
          processing_status: "failed",
          processing_error: "model_failed",
          claim_until: null,
          updated_at: now.toISOString(),
        }).eq("id", row.id);
      }
      failed += 1;
      continue;
    }
    const claimed = await claimInbound(row, now, decision === "claim");
    if (!claimed) continue;
    const knowledgePromise = resolveCampaignPromise({
      campaignValue: row.campaignId ? settings.campaignAssets[row.campaignId] : null,
      offers: settings.offers,
    });
    const loadedKnowledge = await loadInterpreterKnowledge({
      campaignId: row.campaignId,
      offerKey: knowledgePromise?.offerKey ?? null,
    });
    if (!loadedKnowledge.ok) {
      await finishInbound(row.id, {
        processing_status: "failed",
        processing_error: "knowledge_unreadable",
      }, now);
      failed += 1;
      continue;
    }
    const approvedKnowledge = loadedKnowledge.knowledge;
    let outcome = row.outcome;
    let reason = row.reason;
    let draftSubject = row.draftSubject;
    let draftBody = row.draftBody;
    let draftRejected = false;
    if (!outcome) {
      const person = await findPersonById(row.personId);
      if (!person || !row.body.trim()) {
        await finishInbound(row.id, { processing_status: "blocked", processing_error: "missing_body" }, now);
        failed += 1;
        continue;
      }
      const promise = knowledgePromise;
      const historyQuery = supabaseServer
        .from("acquisition_messages")
        .select("direction, body_text, occurred_at, processing_error")
        .eq("person_id", row.personId)
        .neq("id", row.id)
        .order("occurred_at", { ascending: true })
        .limit(4);
      const { data: prior } = row.journeyId
        ? await historyQuery.eq("journey_id", row.journeyId)
        : row.campaignId
          ? await historyQuery.eq("campaign_id", row.campaignId)
          : { data: [] };
      const history = (prior ?? []).flatMap((item) => {
        if ((item.direction !== "inbound" && item.direction !== "outbound") || typeof item.body_text !== "string" || !item.body_text.trim()) return [];
        if (item.processing_error === "body_exceeds_cap" || item.processing_error === "missing_body") return [];
        const complete = item.body_text.length <= 4000;
        return [{
          direction: item.direction,
          body: complete ? item.body_text : item.body_text.slice(0, 4000),
          occurred_at: typeof item.occurred_at === "string" ? item.occurred_at : row.occurredAt,
          body_complete: complete,
        }];
      });
      const { data: actions } = row.journeyId
        ? await supabaseServer
          .from("acquisition_actions")
          .select("action_type, status, promised_label")
          .eq("person_id", row.personId)
          .eq("journey_id", row.journeyId)
        : { data: [] };
      const fulfillment = (actions ?? []).flatMap((action) => {
        if (typeof action.action_type !== "string" || typeof action.status !== "string") return [];
        return [{
          action_type: action.action_type,
          status: action.status,
          label: typeof action.promised_label === "string" ? action.promised_label : null,
        }];
      });
      const interpretedResult = await runAcquisitionConversationInterpreter({
        input: buildConversationInterpreterInput({
          firstName: person.first_name,
          role: person.role,
          sport: person.sport,
          geography: person.geography,
          lifecycle: person.lifecycle_state,
          campaignId: row.campaignId,
          journeyId: row.journeyId,
          offerLabel: promise?.label ?? null,
          offerAssets: promise?.assets ?? null,
          history,
          fulfillment,
          subject: row.subject,
          body: row.body,
          occurredAt: row.occurredAt,
          approvedKnowledge: approvedKnowledge.statements,
          knowledgeConflicts: approvedKnowledge.conflicts,
          today: conversationCalendar(now),
        }),
      });
      if (!interpretedResult.ok) {
        await finishInbound(row.id, { processing_status: "failed", processing_error: interpretedResult.error }, now);
        failed += 1;
        continue;
      }
      const bound = bindAcceptanceToOffer(interpretedResult.parsed, [
        ...(promise?.label ? [promise.label] : []),
        ...resourceLabels(promise?.assets ?? []),
      ]);
      outcome = bound.outcome;
      reason = bound.reason;
      draftSubject = bound.draftSubject;
      draftBody = bound.draftBody;
      draftRejected = bound.draftRejected;
    }
    const person = await findPersonById(row.personId);
    if (!person || !outcome) {
      await finishInbound(row.id, { processing_status: "failed", processing_error: "model_failed" }, now);
      failed += 1;
      continue;
    }
    const { data: suppression, error: suppressionError } = await supabaseServer
      .from("recovery_suppressions")
      .select("id")
      .eq("email_normalized", person.email_normalized)
      .maybeSingle();
    const promise = resolveCampaignPromise({
      campaignValue: row.campaignId ? settings.campaignAssets[row.campaignId] : null,
      offers: settings.offers,
    });
    const effect = decideConversationEffect({
      outcome,
      journeyId: row.journeyId,
      hasPromise: Boolean(promise),
      stopped: salesEmailMustStop(person.lifecycle_state),
      suppressed: suppressionError ? null : Boolean(suppression?.id),
    });
    if (effect.type === "retry") {
      await finishInbound(row.id, {
        processing_status: "failed",
        processing_error: effect.error,
        ai_outcome: outcome,
        ai_reason: reason,
      }, now);
      failed += 1;
      continue;
    }
    if (effect.type === "schedule_asset" && promise && row.journeyId) {
      await scheduleAction(person.id, "send_asset", now, { journeyId: row.journeyId, promise });
      const key = acquisitionActionIdempotencyKey(person.id, "send_asset", row.journeyId);
      const { data: action } = await supabaseServer
        .from("acquisition_actions")
        .select("id")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (!action?.id) {
        await finishInbound(row.id, {
          processing_status: "failed",
          processing_error: "effect_unconfirmed",
          ai_outcome: outcome,
          ai_reason: reason,
          draft_subject: draftSubject,
          draft_body: draftBody,
        }, now);
        failed += 1;
        continue;
      }
    }
    if (effect.type === "global_unsubscribe" || effect.type === "global_complaint") {
      const stopReason = effect.type === "global_unsubscribe" ? "unsubscribe" : "complaint";
      const signal = effect.type === "global_unsubscribe" ? "unsubscribed" : "complained";
      const block = await rememberSuppression(person.email_normalized, stopReason);
      await applySignal(person, signal);
      if (!block.ok) {
        await finishInbound(row.id, {
          processing_status: "failed",
          processing_error: "effect_unconfirmed",
          ai_outcome: outcome,
          ai_reason: reason,
        }, now);
        failed += 1;
        continue;
      }
    }
    const reviewedBody = reviewConversationDraft(draftBody, {
      allowLeadershipKit: approvedKnowledge.allowLeadershipKit,
    });
    const reviewedSubject = reviewConversationSubject(draftSubject, row.subject);
    const stored = await finishInbound(row.id, {
      processing_status: "interpreted",
      processing_error: inboundInterpretationError({
        effectError: effect.type === "record" ? effect.error : null,
        draftRejected,
        draftBody,
        reviewedBody,
      }),
      ai_outcome: outcome,
      ai_reason: reason,
      draft_subject: outcome === "accept_offer" || outcome === "ask_question" ? reviewedSubject : null,
      draft_body: outcome === "accept_offer" || outcome === "ask_question" ? reviewedBody : null,
      effect_applied_at: now.toISOString(),
    }, now);
    if (!stored) {
      failed += 1;
      continue;
    }
    interpreted += 1;
  }
  try {
    await reconcileAcquisitionEmailAnswers(now);
  } catch (err) {
    console.error("[acquisition] email manual answers unavailable", {
      reason: err instanceof Error ? err.message : "email_answers_unavailable",
    });
  }
  if (sending) {
    const { data: ready } = await supabaseServer
      .from("acquisition_messages")
      .select("id")
      .eq("direction", "inbound")
      .eq("processing_status", "interpreted")
      .in("ai_outcome", ["accept_offer", "ask_question"])
      .not("draft_body", "is", null)
      .limit(5);
    const readyIds = (ready ?? []).flatMap((row) => typeof row.id === "string" ? [row.id] : []);
    let blockedIds = new Set<string>();
    let holdFailed = false;
    try {
      blockedIds = await inboundIdsBlockedByEmailAnswers(readyIds);
    } catch (err) {
      holdFailed = true;
      console.error("[acquisition] email answer hold unreadable", {
        reason: err instanceof Error ? err.message : "email_answer_hold_unreadable",
      });
    }
    if (!holdFailed) {
      for (const id of readyIds) {
        if (blockedIds.has(id)) continue;
        const result = await deliverAcquisitionThreadReply({ inboundMessageId: id });
        if (result.state === "accepted") sent += 1;
      }
    }
  }
  return { skipped: "processed", interpreted, failed, sent };
}

export async function deliverAcquisitionThreadReply(args: {
  inboundMessageId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ state: string; reason?: string; providerMessageId?: string | null }> {
  const settings = await readAcquisitionSettings();
  if (settings.conversationSending !== "on") return { state: "blocked", reason: "sending_off" };
  const { data: inbound } = await supabaseServer
    .from("acquisition_messages")
    .select("id, person_id, journey_id, campaign_id, provider_message_id, reply_to_provider_message_id, sender_account, subject, draft_subject, draft_body, lead_email, ai_outcome")
    .eq("id", args.inboundMessageId)
    .eq("direction", "inbound")
    .maybeSingle();
  if (!inbound || typeof inbound.id !== "string" || typeof inbound.person_id !== "string") {
    return { state: "blocked", reason: "missing_reply_target" };
  }
  const localId = `outbound:${inbound.id}`;
  const now = new Date();
  const { data: existing } = await supabaseServer
    .from("acquisition_messages")
    .select("processing_status, provider_response_id, processing_error, claim_until")
    .eq("provider", "instantly")
    .eq("direction", "outbound")
    .eq("provider_message_id", localId)
    .maybeSingle();
  const plan = outboundSendPlan(existing ? {
    status: typeof existing.processing_status === "string" ? existing.processing_status : "",
    providerMessageId: typeof existing.provider_response_id === "string" ? existing.provider_response_id : null,
    claimUntil: typeof existing.claim_until === "string" ? existing.claim_until : null,
  } : null, now);
  if (plan === "leave") {
    return existing?.processing_status === "sent" && typeof existing.provider_response_id === "string"
      ? { state: "accepted", providerMessageId: existing.provider_response_id }
      : { state: typeof existing?.processing_status === "string" ? existing.processing_status : "blocked", reason: typeof existing?.processing_error === "string" ? existing.processing_error : "provider_error" };
  }
  if (plan === "reconcile") {
    const reconciled = await reconcileInstantlyReply({
      apiKey: process.env.INSTANTLY_API_KEY ?? null,
      providerMessageId: typeof existing?.provider_response_id === "string" ? existing.provider_response_id : null,
      fetchImpl: args.fetchImpl,
    });
    const patch = replyRowFromAttempt(reconciled);
    await supabaseServer.from("acquisition_messages").update({ ...patch, updated_at: now.toISOString() })
      .eq("provider_message_id", localId)
      .eq("direction", "outbound")
      .eq("processing_status", existing?.processing_status ?? "");
    return reconciled.state === "accepted"
      ? { state: "accepted", providerMessageId: reconciled.providerMessageId }
      : { state: reconciled.state, reason: reconciled.reason, providerMessageId: reconciled.state === "uncertain" ? reconciled.providerMessageId : null };
  }
  const { error: claimError } = await supabaseServer.from("acquisition_messages").insert({
    person_id: inbound.person_id,
    journey_id: inbound.journey_id ?? null,
    campaign_id: inbound.campaign_id ?? null,
    direction: "outbound",
    provider: "instantly",
    provider_message_id: localId,
    reply_to_provider_message_id: inbound.reply_to_provider_message_id ?? null,
    sender_account: inbound.sender_account ?? null,
    lead_email: inbound.lead_email,
    subject: inbound.draft_subject ?? inbound.subject ?? null,
    body_text: typeof inbound.draft_body === "string" ? inbound.draft_body : "",
    occurred_at: now.toISOString(),
    processing_status: "processing",
    claim_until: new Date(now.getTime() + ACQUISITION_CLAIM_MS).toISOString(),
    attempt_count: 1,
  });
  if (claimError) return { state: "blocked", reason: (claimError as { code?: string }).code === "23505" ? "duplicate_send" : "provider_error" };
  const person = await findPersonById(inbound.person_id);
  const suppressed = person
    ? await supabaseServer.from("recovery_suppressions").select("id").eq("email_normalized", person.email_normalized).maybeSingle()
    : { data: null, error: { message: "missing" } };
  let clerkSubscribed = false;
  if (person?.clerk_user_id) {
    try {
      const user = await getClerkUserOrNull(person.clerk_user_id);
      clerkSubscribed = user?.public_metadata?.summittSubscribed === true;
    } catch {
      clerkSubscribed = true;
    }
  }
  const decision = threadReplyAuthorization({
    sending: settings.conversationSending,
    outcome: asOutcome(inbound.ai_outcome),
    draftBody: typeof inbound.draft_body === "string" ? inbound.draft_body : null,
    replyToProviderMessageId: typeof inbound.reply_to_provider_message_id === "string" ? inbound.reply_to_provider_message_id : null,
    senderAccount: typeof inbound.sender_account === "string" ? inbound.sender_account : null,
    stopped: !person || clerkSubscribed || salesEmailMustStop(person.lifecycle_state),
    suppressed: suppressed.error ? null : Boolean(suppressed.data?.id),
  });
  if (!decision.send) {
    const processingError = decision.reason === "missing_draft"
      ? "missing_body"
      : decision.reason === "outcome" || decision.reason === "sending_off"
        ? "ineligible"
        : decision.reason;
    await supabaseServer.from("acquisition_messages").update({
      processing_status: "blocked",
      processing_error: processingError,
      claim_until: null,
      updated_at: new Date().toISOString(),
    }).eq("provider_message_id", localId).eq("direction", "outbound").eq("processing_status", "processing");
    return { state: "blocked", reason: decision.reason };
  }
  const attempt = await postInstantlyThreadReply({
    apiKey: process.env.INSTANTLY_API_KEY ?? null,
    sending: "on",
    eligible: true,
    eaccount: typeof inbound.sender_account === "string" ? inbound.sender_account : null,
    replyToUuid: typeof inbound.reply_to_provider_message_id === "string" ? inbound.reply_to_provider_message_id : null,
    subject: typeof inbound.draft_subject === "string" ? inbound.draft_subject : null,
    text: typeof inbound.draft_body === "string" ? inbound.draft_body : null,
    fetchImpl: args.fetchImpl,
  });
  const patch = replyRowFromAttempt(attempt);
  await supabaseServer.from("acquisition_messages").update({ ...patch, claim_until: null, updated_at: new Date().toISOString() })
    .eq("provider_message_id", localId)
    .eq("direction", "outbound")
    .eq("processing_status", "processing");
  return attempt.state === "accepted"
    ? { state: "accepted", providerMessageId: attempt.providerMessageId }
    : { state: attempt.state, reason: attempt.reason, providerMessageId: attempt.state === "uncertain" ? attempt.providerMessageId : null };
}

export async function runAcquisitionCron(now = new Date()): Promise<{
  automation: string;
  accepted: number;
  skipped: string;
  assets?: Awaited<ReturnType<typeof readAcquisitionAssetReport>>;
}> {
  const settings = await readAcquisitionSettings();
  try {
    const repaired = await reconcileMissingInstantlyBlocks({ now });
    if (!repaired.readable || !repaired.complete || repaired.failed > 0 || repaired.deferred > 0) {
      console.warn("[acquisition] instantly block reconciliation incomplete", {
        readable: repaired.readable,
        complete: repaired.complete,
        stored: repaired.stored,
        failed: repaired.failed,
        deferred: repaired.deferred,
      });
    }
  } catch {
    console.error("[acquisition] instantly block reconciliation failed", {
      reason: "reconciliation_failed",
    });
  }
  try {
    await deliverPendingInstantlyBlocks({
      enabled: settings.instantlyBlocklist === "on",
      apiKey: process.env.INSTANTLY_API_KEY ?? null,
      now,
    });
  } catch (err) {
    console.error("[acquisition] instantly block drain failed", {
      reason: err instanceof Error ? err.message : "block_drain_failed",
    });
  }
  const converse = async () => {
    if (settings.conversationInterpretation !== "pilot" && settings.conversationSending !== "on") return;
    try {
      await processAcquisitionConversations(now, settings);
    } catch (err) {
      console.error("[acquisition] conversation processing failed", {
        reason: err instanceof Error ? err.message : "processing_failed",
      });
    }
  };
  if (settings.automation !== "pilot" && settings.automation !== "active") {
    await converse();
    return {
      automation: settings.automation,
      accepted: 0,
      skipped: "automation_off",
      assets: await readAcquisitionAssetReport(),
    };
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
    await converse();
    return { automation: settings.automation, accepted: 0, skipped: "cap_unreadable" };
  }
  const { data: dueRows } = await supabaseServer
    .from("acquisition_actions")
    .select("id, person_id, action_type, attempt_count, idempotency_key, journey_id, promised_assets, promised_label")
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
      journeyId: typeof row.journey_id === "string" ? row.journey_id : null,
      promisedAssets: row.promised_assets ?? null,
      promisedLabel: typeof row.promised_label === "string" ? row.promised_label : null,
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
        offerKey: person.offer_key,
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
    assetFiles: async (person, action) => {
      if (action.journeyId) {
        const keys = parsePromisedAssetKeys(action.promisedAssets);
        if (!keys) return null;
        const files = await loadBundleFiles(keys);
        if (!files) return null;
        return { label: action.promisedLabel, files };
      }
      const resolved = resolveSendAssets({
        offerKey: person.offerKey,
        requestedAsset: person.requestedAsset,
        offers: settings.offers,
      });
      if (!resolved) return null;
      const files = await loadBundleFiles(resolved.assets);
      if (!files) return null;
      return { label: resolved.label, files };
    },
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
          ...(copy.attachments.length > 0 ? { attachments: copy.attachments } : {}),
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
  await converse();
  return { automation: settings.automation, accepted: result.accepted, skipped: result.skipped };
}

export async function unsubscribeAcquisition(token: string): Promise<"done" | "unknown" | "block_unconfirmed"> {
  const hash = acquisitionTokenHash(token);
  const { data } = await supabaseServer
    .from("acquisition_actions")
    .select("person_id")
    .eq("token_hash", hash)
    .maybeSingle();
  if (typeof data?.person_id !== "string") return "unknown";
  const person = await findPersonById(data.person_id);
  if (!person) return "unknown";
  const block = await rememberSuppression(person.email_normalized, "unsubscribe");
  await insertEvent({
    personId: person.id,
    provider: "resend",
    providerEventId: `unsubscribe:${hash}`,
    eventType: "resend_unsubscribed",
    occurredAt: new Date().toISOString(),
  });
  await applySignal(person, "unsubscribed");
  await cancelPending(person.id);
  if (!block.ok) {
    console.warn("[acquisition] instantly block intent remains unconfirmed");
    return "block_unconfirmed";
  }
  return "done";
}

export async function applyAcquisitionResendEvent(event: {
  kind: string;
  providerMessageId?: string | null;
  email?: string | null;
  reason?: "bounce" | "complaint" | "provider";
}): Promise<boolean> {
  if (!event.providerMessageId && event.kind !== "suppress") return true;
  if (event.kind === "delivered" && event.providerMessageId) {
    await supabaseServer
      .from("acquisition_actions")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("provider_message_id", event.providerMessageId)
      .eq("status", "accepted");
    return true;
  }
  if (event.kind !== "suppress" || !event.email || !event.reason) return true;
  const email = normalizeAcquisitionEmail(event.email);
  if (!email) return true;
  const block = await rememberSuppression(email, event.reason);
  const person = await findPersonByEmail(email);
  if (!person) return block.ok;
  const stored = await insertEvent({
    personId: person.id,
    provider: "resend",
    providerEventId: `resend:${event.reason}:${event.providerMessageId ?? email}`,
    eventType: event.reason === "complaint" ? "resend_complained" : event.reason === "bounce" ? "resend_bounced" : "resend_suppressed",
    occurredAt: new Date().toISOString(),
  });
  if (stored === "duplicate") return block.ok;
  await applySignal(person, event.reason === "complaint" ? "complained" : "bounced");
  await cancelPending(person.id);
  if (!block.ok) console.warn("[acquisition] instantly block intent remains unconfirmed");
  return block.ok;
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
  let blockUnconfirmed = false;
  if (stored !== "failed") {
    const block = await ensureInstantlyBlock({
      email: person.email_normalized,
      personId: person.id,
      reason: "trial_started",
      sourceEventId: instantlyBlockSourceId("stripe:trial", args.eventId),
    });
    blockUnconfirmed = block.outcome === "not_stored";
  }
  if (blockUnconfirmed) console.warn("[acquisition] instantly block intent remains unconfirmed");
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
  let blockUnconfirmed = false;
  if (stored !== "failed") {
    const block = await ensureInstantlyBlock({
      email: person.email_normalized,
      personId: person.id,
      reason: "paid_member",
      sourceEventId: instantlyBlockSourceId("stripe:paid", args.eventId),
    });
    blockUnconfirmed = block.outcome === "not_stored";
  }
  if (blockUnconfirmed) console.warn("[acquisition] instantly block intent remains unconfirmed");
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
      .select("id, first_name, last_name, lifecycle_state, requested_asset, offer_key")
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
          offerKey: typeof row.offer_key === "string" && row.offer_key.trim() ? row.offer_key.trim() : null,
          offerLabel: typeof row.offer_key === "string"
            ? settings.offers.get(row.offer_key.trim())?.label ?? null
            : null,
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

async function readPeopleForBackfill(): Promise<{
  ok: boolean;
  complete: boolean;
  error: string | null;
  rows: Map<string, ExistingBackfillPerson>;
}> {
  const rows = new Map<string, ExistingBackfillPerson>();
  const pageSize = 1000;
  const pageCap = 50;
  for (let page = 0; page < pageCap; page += 1) {
    const from = page * pageSize;
    const { data, error } = await supabaseServer
      .from("acquisition_people")
      .select("email_normalized, lifecycle_state, requested_asset, source_campaign")
      .order("email_normalized", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { ok: false, complete: false, error: "people_read_failed", rows };
    const batch = data ?? [];
    for (const row of batch) {
      if (typeof row.email_normalized === "string" && typeof row.lifecycle_state === "string") {
        rows.set(row.email_normalized, {
          lifecycle: row.lifecycle_state as AcquisitionLifecycle,
          requestedAsset: parseAcquisitionAsset(row.requested_asset),
          sourceCampaign: typeof row.source_campaign === "string" && row.source_campaign.trim()
            ? row.source_campaign.trim()
            : null,
        });
      }
    }
    const decision = continueAfterRangePage({
      pageNumber: page + 1,
      pageCap,
      rowCount: batch.length,
      pageSize,
    });
    if (!decision.continue) return { ok: true, complete: decision.complete, error: decision.error, rows };
  }
  return { ok: true, complete: false, error: "people_page_cap", rows };
}

export async function dryRunInstantlyBackfill(source: InstantlyBackfillSource): Promise<BackfillPlan> {
  const people = await readPeopleForBackfill();
  const plan = planInstantlyBackfill({
    leads: source.leads,
    currentByEmail: people.rows,
    campaigns: source.campaigns,
    fetched: source.fetched,
    pages: source.pages,
    paginationComplete: source.paginationComplete,
    apiError: source.apiError,
    campaignNamesLoaded: source.campaignNamesLoaded,
    campaignError: source.campaignError,
  });
  if (!people.ok || !people.complete) {
    return {
      ...plan,
      readable: people.ok,
      complete: false,
      proposals: [],
      note: people.ok
        ? "Canonical people read stopped early. Nothing was written, and execute must not run on this report."
        : "Existing acquisition people could not be read. Nothing was written.",
    };
  }
  return plan;
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
      lifecycle: proposal.lifecycle,
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
        historical_fulfillment: proposal.historicalFulfillment,
        schedules_warm_email: false,
      },
    });
    if (stored === "duplicate") continue;
    const decision = proposal.lifecycle;
    if (decision === "unsubscribed") await rememberSuppression(proposal.email, "unsubscribe");
    if (decision === "suppressed") await rememberSuppression(proposal.email, "bounce");
    if (person.lifecycle_state === decision) {
      if (proposal.asset && !person.requested_asset) {
        await supabaseServer
          .from("acquisition_people")
          .update({ requested_asset: proposal.asset, updated_at: new Date().toISOString() })
          .eq("id", person.id);
      }
      written += 1;
      continue;
    }
    const signal: AcquisitionSignal | null =
      decision === "cold_no_response" ? "campaign_completed"
      : decision === "reply_needs_review" ? "reply_received"
      : decision === "asset_requested" ? "interested"
      : decision === "not_interested" ? "not_interested"
      : decision === "unsubscribed" ? "unsubscribed"
      : decision === "suppressed" ? "bounced"
      : null;
    if (!signal) continue;
    const extra = proposal.asset ? { requested_asset: proposal.asset } : {};
    const updated = await applySignal(person, signal, extra);
    if (updated.lifecycle_state !== decision) continue;
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

async function readInstantlyPages(
  key: string,
  url: string,
  method: "GET" | "POST",
): Promise<{ items: unknown[]; pages: number; complete: boolean; error: string | null }> {
  const items: unknown[] = [];
  let requestCursor: string | null = null;
  let pages = 0;
  for (;;) {
    const response = method === "POST"
      ? await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: INSTANTLY_PAGE_SIZE,
          ...(requestCursor ? { starting_after: requestCursor } : {}),
        }),
      })
      : await fetch(`${url}${url.includes("?") ? "&" : "?"}limit=${INSTANTLY_PAGE_SIZE}${requestCursor ? `&starting_after=${encodeURIComponent(requestCursor)}` : ""}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    if (!response.ok) return { items, pages, complete: false, error: `http_${response.status}` };
    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      return { items, pages, complete: false, error: "invalid_json" };
    }
    const parsed = parseInstantlyListPayload(body);
    if (!parsed.ok) return { items, pages, complete: false, error: "invalid_shape" };
    const pageItems = parsed.items;
    items.push(...pageItems);
    pages += 1;
    const decision = continueAfterInstantlyPage({
      pageNumber: pages,
      pageCap: INSTANTLY_PAGE_CAP,
      itemCount: pageItems.length,
      nextCursor: parsed.nextCursor,
      requestCursor,
    });
    if (!decision.continue) return { items, pages, complete: decision.complete, error: decision.error };
    requestCursor = parsed.nextCursor;
  }
}

export async function fetchInstantlyBackfillSource(): Promise<InstantlyBackfillSource> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) {
    return {
      leads: [],
      campaigns: [],
      fetched: 0,
      pages: 0,
      paginationComplete: false,
      apiError: "missing_api_key",
      campaignNamesLoaded: false,
      campaignError: "missing_api_key",
    };
  }
  const leads = await readInstantlyPages(key, "https://api.instantly.ai/api/v2/leads/list", "POST");
  const campaigns = await readInstantlyPages(key, "https://api.instantly.ai/api/v2/campaigns", "GET");
  const names: CampaignName[] = [];
  for (const item of campaigns.items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    names.push({
      id: row.id.trim(),
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 180) : null,
      status: typeof row.status === "number" ? row.status : null,
    });
  }
  return {
    leads: leads.items,
    campaigns: names,
    fetched: leads.items.length,
    pages: leads.pages,
    paginationComplete: leads.complete,
    apiError: leads.error,
    campaignNamesLoaded: campaigns.complete && !campaigns.error,
    campaignError: campaigns.error,
  };
}
