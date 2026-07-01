import { supabaseServer } from "@/lib/supabase-server";

const TAIL = 20;
const BODY_PREVIEW = 160;
const ERR_PREVIEW = 120;

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Short SMS / error text for list rows. */
export function truncateSmsBody(s: string | null | undefined, max: number = BODY_PREVIEW): string {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "—";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** One-line keys + a few known flags for operator list view. */
export function formatSmsSendEventMetadataSummary(metadata: unknown): string {
  if (metadata == null) return "—";
  if (typeof metadata !== "object" || Array.isArray(metadata)) return "—";
  const m = metadata as Record<string, unknown>;
  const bits: string[] = [];
  const note = m.note;
  if (typeof note === "string" && note.trim()) bits.push(`note=${note.trim()}`);
  const rc = m.retry_count;
  if (typeof rc === "number") bits.push(`retry_count=${rc}`);
  if (m.milestone === true) bits.push("milestone=true");
  if (m.followup_sent === true) bits.push("followup_sent=true");
  if (m.missed_yesterday_sent === true) bits.push("missed_yesterday_sent=true");
  if (m.v2_accountability === true) bits.push("v2_accountability=true");
  if (m.v2_reactivation_nudge === true) bits.push("v2_reactivation_nudge=true");
  const tid = m.v2_template_id;
  if (typeof tid === "number") bits.push(`v2_template_id=${tid}`);
  const err = m.error;
  if (typeof err === "string" && err.trim()) bits.push(`error="${truncateSmsBody(err, 80)}"`);
  const keyList = Object.keys(m);
  const keysPreview = keyList.slice(0, 8).join(", ");
  if (bits.length === 0) return keysPreview ? `keys: ${keysPreview}${keyList.length > 8 ? "…" : ""}` : "—";
  const extra = keyList.length > 8 ? ` · (+${keyList.length - 8} metadata keys)` : "";
  return `${bits.join(" · ")}${extra}`;
}

export function formatInboundJobSummary(args: {
  status: string;
  attempt_count: number;
  message_sid: string;
}): string {
  return `${args.status} · attempts=${args.attempt_count} · sid=${args.message_sid}`;
}

export type OperatorLastOutboundContextView = {
  source: "sms_last_outbound_context";
  sent_at: string;
  message_kind: string;
  time_of_day: string | null;
  twilio_message_sid: string | null;
  body_preview: string;
  full_body: string;
  question_position: number | null;
  delivery_snapshot_json: string;
};

export type OperatorSmsSendEventRowView = {
  source: "sms_send_events";
  created_at: string | null;
  updated_at: string | null;
  day_key: string | null;
  status: string | null;
  message_sid: string | null;
  metadata_summary: string;
  metadata_raw_json: string;
};

export type OperatorSmsInboundMessageRowView = {
  source: "sms_inbound_messages";
  message_sid: string;
  occurred_at: string | null;
  phone_number: string | null;
  body_preview: string;
  raw_body: string;
};

export type OperatorSmsInboundCoachJobRowView = {
  source: "sms_inbound_coach_jobs";
  message_sid: string;
  status: string;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  next_retry_at: string;
  sent_at: string | null;
  outbound_message_sid: string | null;
  last_error_preview: string;
  last_error_full: string | null;
  raw_body_preview: string;
  raw_body_full: string;
  reply_body_preview: string;
  reply_body_full: string | null;
  summary: string;
};

export type OperatorMessagingForensics = {
  last_outbound_context: OperatorLastOutboundContextView | null;
  sms_send_events: OperatorSmsSendEventRowView[];
  sms_inbound_messages: OperatorSmsInboundMessageRowView[];
  sms_inbound_coach_jobs: OperatorSmsInboundCoachJobRowView[];
};

export async function fetchOperatorMessagingForensics(
  clerkUserId: string
): Promise<OperatorMessagingForensics> {
  const [ctxRes, sendsRes, inboundRes, jobsRes] = await Promise.all([
    supabaseServer
      .from("sms_last_outbound_context")
      .select(
        "sent_at, message_kind, time_of_day, twilio_message_sid, full_body, question_position, delivery_snapshot"
      )
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle(),
    supabaseServer
      .from("sms_send_events")
      .select("created_at, day_key, status, message_sid, metadata")
      .eq("clerk_user_id", clerkUserId)
      .order("created_at", { ascending: false })
      .limit(TAIL),
    supabaseServer
      .from("sms_inbound_messages")
      .select("message_sid, phone_number, raw_body, received_at")
      .eq("clerk_user_id", clerkUserId)
      .order("received_at", { ascending: false })
      .limit(TAIL),
    supabaseServer
      .from("sms_inbound_coach_jobs")
      .select(
        "message_sid, status, attempt_count, created_at, updated_at, next_retry_at, sent_at, outbound_message_sid, last_error, raw_body, reply_body"
      )
      .eq("clerk_user_id", clerkUserId)
      .order("created_at", { ascending: false })
      .limit(TAIL),
  ]);

  if (ctxRes.error) {
    console.error("[operator-messaging-forensics] sms_last_outbound_context failed", {
      clerk_user_id: clerkUserId,
      message: ctxRes.error.message,
    });
  }
  if (sendsRes.error) {
    console.error("[operator-messaging-forensics] sms_send_events failed", {
      clerk_user_id: clerkUserId,
      message: sendsRes.error.message,
    });
  }
  if (inboundRes.error) {
    console.error("[operator-messaging-forensics] sms_inbound_messages failed", {
      clerk_user_id: clerkUserId,
      message: inboundRes.error.message,
    });
  }
  if (jobsRes.error) {
    console.error("[operator-messaging-forensics] sms_inbound_coach_jobs failed", {
      clerk_user_id: clerkUserId,
      message: jobsRes.error.message,
    });
  }

  const ctxRow = ctxRes.data as Record<string, unknown> | null;
  let last_outbound_context: OperatorLastOutboundContextView | null = null;
  if (ctxRow && typeof ctxRow.sent_at === "string") {
    const full =
      typeof ctxRow.full_body === "string" ? ctxRow.full_body : "";
    last_outbound_context = {
      source: "sms_last_outbound_context",
      sent_at: ctxRow.sent_at,
      message_kind: typeof ctxRow.message_kind === "string" ? ctxRow.message_kind : "—",
      time_of_day: typeof ctxRow.time_of_day === "string" ? ctxRow.time_of_day : null,
      twilio_message_sid: typeof ctxRow.twilio_message_sid === "string" ? ctxRow.twilio_message_sid : null,
      body_preview: truncateSmsBody(full, BODY_PREVIEW),
      full_body: full,
      question_position: typeof ctxRow.question_position === "number" ? ctxRow.question_position : null,
      delivery_snapshot_json: safeJsonStringify(ctxRow.delivery_snapshot ?? null),
    };
  }

  const sms_send_events: OperatorSmsSendEventRowView[] = (sendsRes.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      source: "sms_send_events",
      created_at: typeof r.created_at === "string" ? r.created_at : null,
      updated_at: null,
      day_key: typeof r.day_key === "string" ? r.day_key : null,
      status: typeof r.status === "string" ? r.status : null,
      message_sid: typeof r.message_sid === "string" ? r.message_sid : null,
      metadata_summary: formatSmsSendEventMetadataSummary(r.metadata),
      metadata_raw_json: safeJsonStringify(r.metadata ?? null),
    };
  });

  const sms_inbound_messages: OperatorSmsInboundMessageRowView[] = (inboundRes.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const raw = typeof r.raw_body === "string" ? r.raw_body : "";
    return {
      source: "sms_inbound_messages",
      message_sid: typeof r.message_sid === "string" ? r.message_sid : "",
      occurred_at: typeof r.received_at === "string" ? r.received_at : null,
      phone_number: typeof r.phone_number === "string" ? r.phone_number : null,
      body_preview: truncateSmsBody(raw, BODY_PREVIEW),
      raw_body: raw,
    };
  });

  const sms_inbound_coach_jobs: OperatorSmsInboundCoachJobRowView[] = (jobsRes.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const messageSid = typeof r.message_sid === "string" ? r.message_sid : "";
    const status = typeof r.status === "string" ? r.status : "—";
    const attemptCount = typeof r.attempt_count === "number" ? r.attempt_count : 0;
    const rawBody = typeof r.raw_body === "string" ? r.raw_body : "";
    const replyFull = typeof r.reply_body === "string" ? r.reply_body : null;
    const errFull = typeof r.last_error === "string" ? r.last_error : null;
    return {
      source: "sms_inbound_coach_jobs",
      message_sid: messageSid,
      status,
      attempt_count: attemptCount,
      created_at: typeof r.created_at === "string" ? r.created_at : "",
      updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
      next_retry_at: typeof r.next_retry_at === "string" ? r.next_retry_at : "",
      sent_at: typeof r.sent_at === "string" ? r.sent_at : null,
      outbound_message_sid: typeof r.outbound_message_sid === "string" ? r.outbound_message_sid : null,
      last_error_preview: truncateSmsBody(errFull, ERR_PREVIEW),
      last_error_full: errFull,
      raw_body_preview: truncateSmsBody(rawBody, BODY_PREVIEW),
      raw_body_full: rawBody,
      reply_body_preview: truncateSmsBody(replyFull, BODY_PREVIEW),
      reply_body_full: replyFull,
      summary: formatInboundJobSummary({
        status,
        attempt_count: attemptCount,
        message_sid: messageSid || "(missing)",
      }),
    };
  });

  return {
    last_outbound_context,
    sms_send_events,
    sms_inbound_messages,
    sms_inbound_coach_jobs,
  };
}
