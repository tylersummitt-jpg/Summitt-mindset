import "server-only";

import { getClerkUserOrNull } from "@/lib/clerk-rest";
import { ACQUISITION_CLAIM_MS } from "@/lib/acquisition/model";
import {
  ONE_THREAD_REPLY_BODY,
  ONE_THREAD_REPLY_CAMPAIGN_ID,
  ONE_THREAD_REPLY_INBOUND_ID,
  ONE_THREAD_REPLY_OUTBOUND_ID,
  ONE_THREAD_REPLY_SUBJECT,
  runOneThreadReply,
  type OneThreadReplyDeps,
  type OneThreadSendGuard,
  type OneThreadSnapshot,
} from "@/lib/acquisition/one-thread-reply";
import { readAcquisitionSettings } from "@/lib/acquisition/store";
import { supabaseServer } from "@/lib/supabase-server";

const CLOSED_SETTINGS: OneThreadSnapshot["settings"] = {
  automation: "unavailable",
  interpretation: "off",
  sending: "off",
  blocklist: "off",
  pilotCampaigns: [],
};

const ABSENT_PERSON: OneThreadSnapshot["person"] = {
  found: false,
  lifecycle: "",
  suppressed: null,
  clerkSubscribed: false,
};

function unreadable(): OneThreadSnapshot {
  return {
    readable: false,
    settings: CLOSED_SETTINGS,
    inbound: null,
    person: ABSENT_PERSON,
    outbound: null,
  };
}

async function readOneThreadSnapshot(): Promise<OneThreadSnapshot> {
  try {
    const settings = await readAcquisitionSettings();
    const inboundQuery = await supabaseServer
      .from("acquisition_messages")
      .select("id, person_id, journey_id, campaign_id, direction, processing_status, processing_error, reply_block, ai_outcome, effect_applied_at, reply_to_provider_message_id, sender_account, lead_email")
      .eq("id", ONE_THREAD_REPLY_INBOUND_ID)
      .eq("direction", "inbound")
      .maybeSingle();
    if (inboundQuery.error) return unreadable();
    const outboundQuery = await supabaseServer
      .from("acquisition_messages")
      .select("processing_status, provider_response_id, processing_error, claim_until")
      .eq("provider", "instantly")
      .eq("direction", "outbound")
      .eq("provider_message_id", ONE_THREAD_REPLY_OUTBOUND_ID)
      .maybeSingle();
    if (outboundQuery.error) return unreadable();
    const row = inboundQuery.data;
    const personId = typeof row?.person_id === "string" ? row.person_id : null;
    let person: OneThreadSnapshot["person"] = ABSENT_PERSON;
    if (personId) {
      const personQuery = await supabaseServer
        .from("acquisition_people")
        .select("lifecycle_state, email_normalized, clerk_user_id")
        .eq("id", personId)
        .maybeSingle();
      if (personQuery.error) return unreadable();
      const email = typeof personQuery.data?.email_normalized === "string" ? personQuery.data.email_normalized : "";
      let suppressed: boolean | null = null;
      if (email) {
        const suppression = await supabaseServer
          .from("recovery_suppressions")
          .select("id")
          .eq("email_normalized", email)
          .maybeSingle();
        if (suppression.error) return unreadable();
        suppressed = Boolean(suppression.data?.id);
      }
      let clerkSubscribed = false;
      const clerkUserId = typeof personQuery.data?.clerk_user_id === "string" ? personQuery.data.clerk_user_id : null;
      if (clerkUserId) {
        try {
          const user = await getClerkUserOrNull(clerkUserId);
          clerkSubscribed = user?.public_metadata?.summittSubscribed === true;
        } catch {
          clerkSubscribed = true;
        }
      }
      person = {
        found: Boolean(personQuery.data),
        lifecycle: typeof personQuery.data?.lifecycle_state === "string" ? personQuery.data.lifecycle_state : "",
        suppressed,
        clerkSubscribed,
      };
    }
    const outbound = outboundQuery.data;
    return {
      readable: true,
      settings: {
        automation: settings.automation,
        interpretation: settings.conversationInterpretation,
        sending: settings.conversationSending,
        blocklist: settings.instantlyBlocklist,
        pilotCampaigns: settings.conversationPilotCampaigns,
      },
      inbound: row ? {
        id: typeof row.id === "string" ? row.id : "",
        campaignId: typeof row.campaign_id === "string" ? row.campaign_id : null,
        direction: typeof row.direction === "string" ? row.direction : "",
        status: typeof row.processing_status === "string" ? row.processing_status : "",
        outcome: typeof row.ai_outcome === "string" ? row.ai_outcome : null,
        error: typeof row.processing_error === "string" ? row.processing_error : null,
        effectApplied: row.effect_applied_at != null,
        replyBlock: typeof row.reply_block === "string" ? row.reply_block : null,
        replyToProviderMessageId: typeof row.reply_to_provider_message_id === "string" ? row.reply_to_provider_message_id : null,
        senderAccount: typeof row.sender_account === "string" ? row.sender_account : null,
        personId,
        journeyId: typeof row.journey_id === "string" ? row.journey_id : null,
        leadEmail: typeof row.lead_email === "string" ? row.lead_email : null,
      } : null,
      person,
      outbound: outbound ? {
        status: typeof outbound.processing_status === "string" ? outbound.processing_status : "",
        providerMessageId: typeof outbound.provider_response_id === "string" ? outbound.provider_response_id : null,
        claimUntil: typeof outbound.claim_until === "string" ? outbound.claim_until : null,
        error: typeof outbound.processing_error === "string" ? outbound.processing_error : null,
      } : null,
    };
  } catch {
    return unreadable();
  }
}

async function storeApprovedDraft(guard: OneThreadSendGuard): Promise<number> {
  const { data, error } = await supabaseServer
    .from("acquisition_messages")
    .update({
      draft_subject: ONE_THREAD_REPLY_SUBJECT,
      draft_body: ONE_THREAD_REPLY_BODY,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ONE_THREAD_REPLY_INBOUND_ID)
    .eq("direction", "inbound")
    .eq("campaign_id", ONE_THREAD_REPLY_CAMPAIGN_ID)
    .eq("processing_status", "interpreted")
    .eq("ai_outcome", "ask_question")
    .is("processing_error", null)
    .not("effect_applied_at", "is", null)
    .is("reply_block", null)
    .eq("reply_to_provider_message_id", guard.replyToProviderMessageId)
    .eq("sender_account", guard.senderAccount)
    .eq("person_id", guard.personId)
    .eq("lead_email", guard.leadEmail)
    .select("id");
  if (error || !Array.isArray(data)) return 0;
  return data.length;
}

async function claimOneThreadOutbound(guard: OneThreadSendGuard): Promise<"claimed" | "duplicate" | "error"> {
  const now = new Date();
  const { error } = await supabaseServer.from("acquisition_messages").insert({
    person_id: guard.personId,
    journey_id: guard.journeyId,
    campaign_id: ONE_THREAD_REPLY_CAMPAIGN_ID,
    direction: "outbound",
    provider: "instantly",
    provider_message_id: ONE_THREAD_REPLY_OUTBOUND_ID,
    reply_to_provider_message_id: guard.replyToProviderMessageId,
    sender_account: guard.senderAccount,
    lead_email: guard.leadEmail,
    subject: ONE_THREAD_REPLY_SUBJECT,
    body_text: ONE_THREAD_REPLY_BODY,
    occurred_at: now.toISOString(),
    processing_status: "processing",
    claim_until: new Date(now.getTime() + ACQUISITION_CLAIM_MS).toISOString(),
    attempt_count: 1,
  });
  if (!error) return "claimed";
  if ((error as { code?: string }).code === "23505") return "duplicate";
  return "error";
}

const recordOneThreadAttempt: OneThreadReplyDeps["record"] = async (patch, expectedStatus) => {
  const { data, error } = await supabaseServer
    .from("acquisition_messages")
    .update({
      ...patch,
      claim_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "instantly")
    .eq("direction", "outbound")
    .eq("provider_message_id", ONE_THREAD_REPLY_OUTBOUND_ID)
    .eq("processing_status", expectedStatus)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
};

export async function sendAuthorizedOneThreadReply(): Promise<Awaited<ReturnType<typeof runOneThreadReply>>> {
  return runOneThreadReply({
    now: new Date(),
    apiKey: process.env.INSTANTLY_API_KEY?.trim() || null,
    read: readOneThreadSnapshot,
    storeDraft: storeApprovedDraft,
    claim: claimOneThreadOutbound,
    record: recordOneThreadAttempt,
  });
}
