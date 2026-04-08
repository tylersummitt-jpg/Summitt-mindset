/**
 * Layer B — SMS delivery truth (Supabase `sms_delivery_state` only).
 * Layer A — structural / earned progression stays in Clerk (`currentDay`, streaks, completeDay).
 * Clerk `deliveryDay` is not read or written by this module or the daily SMS cron.
 */
import { supabaseServer } from "@/lib/supabase-server";
import { buildProfileContext } from "@/lib/profile-context";
import {
  compactProfileForPrompt,
  derivePersonalizationTone,
  generatePersonalizedQuoteMessage,
  generateSmsDay2RespondQuestion,
  loadSummariesForQuoteSms,
  type QuotePersonalizationTone,
} from "@/lib/generate-personalized-quote-message";
import { getDisplayNameForUser } from "@/lib/resolve-preferred-name";

/** Coerce DB row to in-memory shape; does not interpret legacy quote-pending quirks (see SQL migration). */
function normalizeDeliveryStateRow(row: Record<string, unknown>): SmsDeliveryStateRow {
  const bucketRaw = row.sms_bucket;
  const bucket: "daily" | "flex" =
    bucketRaw === "flex" ? "flex" : "daily";
  const cycle =
    typeof row.daily_nonresponse_cycle_count === "number" &&
    Number.isFinite(row.daily_nonresponse_cycle_count)
      ? Math.max(0, Math.floor(row.daily_nonresponse_cycle_count))
      : 0;

  const fi = row.flex_cadence_index;
  const flexCadenceIndex =
    typeof fi === "number" && Number.isFinite(fi)
      ? Math.max(0, Math.floor(fi)) % 7
      : 0;

  const d2 = row.day2_special_sent_at;
  const day2SpecialSentAt =
    typeof d2 === "string" && d2.trim().length > 0 ? d2.trim() : null;

  return {
    clerk_user_id: String(row.clerk_user_id ?? ""),
    question_position:
      typeof row.question_position === "number"
        ? row.question_position
        : 1,
    quote_position:
      typeof row.quote_position === "number" ? row.quote_position : 0,
    current_content_type:
      row.current_content_type === "non_response" ? "non_response" : "respond",
    question_attempt_count:
      typeof row.question_attempt_count === "number"
        ? row.question_attempt_count
        : 0,
    daily_nonresponse_cycle_count: cycle,
    sms_bucket: bucket,
    flex_cadence_index: flexCadenceIndex,
    day2_special_sent_at: day2SpecialSentAt,
  };
}

export type SmsDeliveryStateRow = {
  clerk_user_id: string;
  question_position: number;
  quote_position: number;
  /** Last successful outbound SMS modality (respond = MCQ day, non_response = quote / AI follow-up). */
  current_content_type: "respond" | "non_response";
  /**
   * Daily: attempts already completed for the current question (0–2 = next send is another respond;
   * 3 = three respond SMSes done, next outbound is quote). Flex: kept at 0 (no retries).
   */
  question_attempt_count: number;
  /** Completed Daily silent cycles (3 respond sends → non-response sent → question advanced). */
  daily_nonresponse_cycle_count: number;
  /** `daily` until two silent cycles without SMS reply; then `flex`. */
  sms_bucket: "daily" | "flex";
  /** Flex: rolling slot 0–6 (pattern). Daily: unused / keep 0. */
  flex_cadence_index: number;
  /** Set after the one-time program Day 2 freeform SMS is successfully sent. */
  day2_special_sent_at: string | null;
};

type RespondDayQuestionRow = {
  id: number;
  position: number;
  prompt_morning: string;
  prompt_evening: string;
  response_type: string;
  retry_intro_1: string | null;
  retry_intro_2: string | null;
  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
};

/**
 * Clerk `public_metadata.smsTimePreference` only (single source of truth for SMS timing/prompts).
 * Missing, non-string, or whitespace-only → "morning".
 */
export function smsTimePreferenceFromClerkMetadata(
  md: Record<string, unknown>
): string {
  const v = md.smsTimePreference;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : "morning";
}

/**
 * Maps Clerk smsTimePreference to prompt variant.
 * early_morning + morning → morning prompt; midday + evening → evening prompt.
 */
export function useEveningPromptForPreference(pref: string | null | undefined): boolean {
  const p = (pref || "morning").toLowerCase().trim();
  return p === "midday" || p === "evening";
}

function pickAdaptiveIntroIndex(attemptNumber: number, tone: string, len: number): number {
  let h = attemptNumber * 7919;
  for (let i = 0; i < tone.length; i++) {
    h = (h + tone.charCodeAt(i) * (i + 3)) | 0;
  }
  return Math.abs(h) % len;
}

/**
 * Tone-aware retry line for daily respond SMS (attempt 1 or 2). Flex does not use retries.
 */
export function getAdaptiveRetryIntro(args: {
  attemptNumber: 1 | 2;
  tone: QuotePersonalizationTone;
}): string {
  const { attemptNumber, tone } = args;

  if (attemptNumber === 1) {
    if (tone === "supportive") {
      const opts = [
        "Let's come back to this — no pressure.",
        "Quick check — just go with what feels right.",
      ] as const;
      return opts[pickAdaptiveIntroIndex(1, tone, opts.length)];
    }
    if (tone === "neutral") {
      const opts = [
        "Quick check —",
        "Let's come back to this — it matters.",
      ] as const;
      return opts[pickAdaptiveIntroIndex(1, tone, opts.length)];
    }
    const opts = [
      "Let's come back to this — this is where growth happens.",
      "Don't skip this — be intentional.",
    ] as const;
    return opts[pickAdaptiveIntroIndex(1, tone, opts.length)];
  }

  if (tone === "supportive") {
    const opts = [
      "Keep it simple — just pick one.",
      "No overthinking — just choose what feels right.",
    ] as const;
    return opts[pickAdaptiveIntroIndex(2, tone, opts.length)];
  }
  if (tone === "neutral") {
    const opts = [
      "Don't overthink it — just pick one.",
      "Just choose one — keep it simple.",
    ] as const;
    return opts[pickAdaptiveIntroIndex(2, tone, opts.length)];
  }
  const opts = [
    "Don't overthink — decide.",
    "Make the call — where do you need to be better?",
  ] as const;
  return opts[pickAdaptiveIntroIndex(2, tone, opts.length)];
}

function pickQuestionFrameIndex(tone: string, len: number): number {
  let h = 5381;
  for (let i = 0; i < tone.length; i++) {
    h = (h * 33 + tone.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % len;
}

/** Index 0 = shorter / more direct; index 1 = softer for supportive frames. */
const FRAME_MEMORY_SOFT_SIGNALS = ["tired", "low energy", "struggling"] as const;

/** Index 1 = stronger line within challenging / neutral pairs. */
const FRAME_MEMORY_STRONG_SIGNALS = ["momentum", "consistent", "showing up"] as const;

function frameMemoryBias(summariesBlock: string): "soft" | "strong" | null {
  const text = (summariesBlock || "").toLowerCase();
  const soft = FRAME_MEMORY_SOFT_SIGNALS.some((s) => text.includes(s));
  const strong = FRAME_MEMORY_STRONG_SIGNALS.some((s) => text.includes(s));
  if (soft && !strong) return "soft";
  if (strong && !soft) return "strong";
  return null;
}

/** Short framing line before the main question (daily first attempt only). */
export function getAdaptiveQuestionFrame(args: {
  tone: QuotePersonalizationTone;
  summariesBlock: string;
}): string {
  const { tone } = args;
  const bias = frameMemoryBias(args.summariesBlock);

  if (tone === "supportive") {
    const opts = [
      "Keep it simple today.",
      "No pressure — just focus on what matters.",
    ] as const;
    let idx: number;
    if (bias === "soft") idx = 1;
    else if (bias === "strong") idx = 0;
    else idx = 1;
    return opts[idx];
  }

  if (tone === "neutral") {
    const opts = ["", "Take a moment and check in."] as const;
    let idx: number;
    if (bias === "soft") idx = 0;
    else if (bias === "strong") idx = 1;
    else idx = pickQuestionFrameIndex(tone, opts.length);
    return opts[idx];
  }

  const opts = ["Lean into this.", "This is where growth happens."] as const;
  let idx: number;
  if (bias === "soft") idx = 0;
  else if (bias === "strong") idx = 1;
  else idx = 1;
  return opts[idx];
}

/** Locked flex pattern: slots 2 and 5 = respond; others = non_response. */
function flexSlotModality(flexCadenceIndex: number): "respond" | "non_response" {
  const slot = ((flexCadenceIndex % 7) + 7) % 7;
  if (slot === 2 || slot === 5) return "respond";
  return "non_response";
}

const SMS_DELIVERY_STATE_SELECT =
  "clerk_user_id, question_position, quote_position, current_content_type, question_attempt_count, daily_nonresponse_cycle_count, sms_bucket, flex_cadence_index, day2_special_sent_at";

function buildSanityPatch(row: Record<string, unknown>): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const ct = row.current_content_type;
  if (ct !== "respond" && ct !== "non_response") {
    patch.current_content_type = "respond";
  }
  const sb = row.sms_bucket;
  if (sb !== "daily" && sb !== "flex") {
    patch.sms_bucket = "daily";
  }
  const qa = row.question_attempt_count;
  if (typeof qa !== "number" || !Number.isFinite(qa) || qa < 0) {
    patch.question_attempt_count = 0;
  }
  const cy = row.daily_nonresponse_cycle_count;
  if (typeof cy !== "number" || !Number.isFinite(cy) || cy < 0) {
    patch.daily_nonresponse_cycle_count = 0;
  }
  if (Object.keys(patch).length === 0) return null;
  patch.updated_at = new Date().toISOString();
  return patch;
}

async function selfHealDeliveryStateAfterLoad(
  clerkUserId: string,
  rowRecord: Record<string, unknown>
): Promise<SmsDeliveryStateRow> {
  let record = rowRecord;

  const sanityPatch = buildSanityPatch(record);
  if (sanityPatch) {
    const { error: sanErr } = await supabaseServer
      .from("sms_delivery_state")
      .update(sanityPatch)
      .eq("clerk_user_id", clerkUserId);

    if (sanErr) {
      console.error("[sms_delivery_state] self-heal sanity patch failed", {
        clerkUserId,
        error: sanErr.message,
      });
    } else {
      const { data: refreshed, error: reErr } = await supabaseServer
        .from("sms_delivery_state")
        .select(SMS_DELIVERY_STATE_SELECT)
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();

      if (reErr) {
        console.error("[sms_delivery_state] self-heal refresh after sanity failed", {
          clerkUserId,
          error: reErr.message,
        });
      } else if (refreshed) {
        record = refreshed as Record<string, unknown>;
      }
    }
  }

  const normalized = normalizeDeliveryStateRow(record);

  return normalized;
}

export async function loadOrCreateSmsDeliveryState(
  clerkUserId: string
): Promise<{ data: SmsDeliveryStateRow | null; error: string | null }> {
  const { data: existing, error: selErr } = await supabaseServer
    .from("sms_delivery_state")
    .select(SMS_DELIVERY_STATE_SELECT)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (selErr) {
    return { data: null, error: selErr.message };
  }

  if (existing) {
    const healed = await selfHealDeliveryStateAfterLoad(
      clerkUserId,
      existing as Record<string, unknown>
    );
    return { data: healed, error: null };
  }

  const insert = {
    clerk_user_id: clerkUserId,
    question_position: 1,
    quote_position: 0,
    current_content_type: "respond" as const,
    question_attempt_count: 0,
    daily_nonresponse_cycle_count: 0,
    sms_bucket: "daily" as const,
    flex_cadence_index: 0,
  };

  const { data: created, error: insErr } = await supabaseServer
    .from("sms_delivery_state")
    .insert(insert)
    .select(SMS_DELIVERY_STATE_SELECT)
    .maybeSingle();

  if (!insErr && created) {
    const healed = await selfHealDeliveryStateAfterLoad(
      clerkUserId,
      created as Record<string, unknown>
    );
    return { data: healed, error: null };
  }

  const code = (insErr as { code?: string })?.code;
  if (code === "23505") {
    const { data: raced } = await supabaseServer
      .from("sms_delivery_state")
      .select(SMS_DELIVERY_STATE_SELECT)
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    if (raced) {
      const healed = await selfHealDeliveryStateAfterLoad(
        clerkUserId,
        raced as Record<string, unknown>
      );
      return { data: healed, error: null };
    }
  }

  return { data: null, error: insErr?.message ?? "sms_delivery_state insert failed" };
}

/** Build respond SMS; daily retries may use adaptive intros instead of DB retry fields. */
export function buildRespondSmsBody(args: {
  question: RespondDayQuestionRow;
  smsTimePreference: string | null | undefined;
  questionAttemptCountBeforeSend: number;
  /** Daily first attempt only: prepended before the question when non-empty. */
  adaptiveQuestionFrame?: string;
  /** When set for attempt 1 or 2, prepended instead of retry_intro_1 / retry_intro_2. */
  adaptiveRetryIntro?: string;
  /** When set, replaces the DB morning/evening prompt line. */
  customMainPrompt?: string | null;
}): string {
  const evening = useEveningPromptForPreference(args.smsTimePreference);
  const custom = args.customMainPrompt?.trim();
  let base = custom
    ? custom
    : (evening ? args.question.prompt_evening : args.question.prompt_morning).trim();

  const n = args.questionAttemptCountBeforeSend;
  if (n === 0) {
    const frame = args.adaptiveQuestionFrame?.trim();
    if (frame) {
      base = `${frame}\n\n${base}`;
    }
  }

  const adaptive = args.adaptiveRetryIntro?.trim();
  if ((n === 1 || n === 2) && adaptive) {
    base = `${adaptive}\n\n${base}`;
  } else if (n === 1 && args.question.retry_intro_1?.trim()) {
    base = `${args.question.retry_intro_1.trim()}\n\n${base}`;
  } else if (n === 2 && args.question.retry_intro_2?.trim()) {
    base = `${args.question.retry_intro_2.trim()}\n\n${base}`;
  }

  if (args.question.response_type === "multiple_choice") {
    const optionRows = [
      { label: "A" as const, value: (args.question.option_a || "").trim() },
      { label: "B" as const, value: (args.question.option_b || "").trim() },
      { label: "C" as const, value: (args.question.option_c || "").trim() },
    ];
    const rendered = optionRows
      .filter((o) => o.value.length > 0)
      .map((o) => `${o.label}) ${o.value}`);
    if (rendered.length > 0) {
      base = `${base}\n\n${rendered.join("\n")}`;
    }
  }

  return base.trim();
}

function formatQuoteForSms(quoteText: string): string {
  let s = (quoteText || "").trim();
  if (!s) return "";

  const straight = '"';
  const openSmart = "\u201C";
  const closeSmart = "\u201D";

  let prev = "";
  while (s !== prev) {
    prev = s;
    if (s.length >= 2 && s.startsWith(straight) && s.endsWith(straight)) {
      s = s.slice(1, -1).trim();
      continue;
    }
    if (s.length >= 2 && s.startsWith(openSmart) && s.endsWith(closeSmart)) {
      s = s.slice(1, -1).trim();
      continue;
    }
  }

  if (!s) return "";

  return `${openSmart}${s}${closeSmart}`;
}

/** Non-MCQ fallback when OpenAI returns nothing for the one-time Day 2 special. */
export function buildDay2SpecialFallbackBody(firstName: string): string {
  const n = (firstName || "").trim();
  const hasName = n.length > 0 && n.toLowerCase() !== "there";
  if (hasName) {
    return `${n}, what is one way you want to show up stronger today — mentally, physically, or in how you lead?`;
  }
  return "What is one way you want to show up stronger today — mentally, physically, or in how you lead?";
}

export async function buildSmsBodyFromDeliveryState(args: {
  clerkUserId: string;
  state: SmsDeliveryStateRow;
  smsTimePreference: string | null | undefined;
  /** Clerk program day when known (daily SMS cron). When 2 and `day2_special_sent_at` is null, a one-time freeform Day 2 special runs first. */
  currentDay?: number | null;
}): Promise<
  | {
      ok: true;
      smsBody: string;
      day2SpecialUsed: boolean;
      sentPatQuoteId?: string;
      sentRespondQuestionId?: string;
    }
  | { ok: false; error: string }
> {
  if (args.currentDay === 2 && !args.state.day2_special_sent_at) {
    const evening = useEveningPromptForPreference(args.smsTimePreference);
    const [displayName, profile] = await Promise.all([
      getDisplayNameForUser(args.clerkUserId),
      buildProfileContext(args.clerkUserId),
    ]);
    const firstName = (displayName && displayName.trim()) || "there";
    let body = (await generateSmsDay2RespondQuestion({
      firstName,
      profile,
      eveningPrompt: evening,
    })).trim();
    if (!body) {
      body = buildDay2SpecialFallbackBody(firstName);
    }
    return { ok: true, smsBody: body, day2SpecialUsed: true };
  }

  const isFlex = args.state.sms_bucket === "flex";
  /**
   * What to generate next: flex follows slot cadence only. Daily uses DB fields where
   * current_content_type is the last message category that was successfully sent:
   * - respond + question_attempt_count >= 3 → exhausted 3 respond SMSes; next is quote.
   * - non_response → last send was quote; next is the following question (respond).
   */
  const effectiveContentType: "respond" | "non_response" = isFlex
    ? flexSlotModality(args.state.flex_cadence_index)
    : args.state.current_content_type === "non_response"
      ? "respond"
      : args.state.current_content_type === "respond" &&
          args.state.question_attempt_count >= 3
        ? "non_response"
        : "respond";

  if (effectiveContentType === "respond") {
    const { data: rows, error } = await supabaseServer
      .from("respond_day_questions")
      .select(
        "id, position, prompt_morning, prompt_evening, response_type, retry_intro_1, retry_intro_2, option_a, option_b, option_c"
      )
      .eq("position", args.state.question_position)
      .eq("active", true)
      .order("id", { ascending: true });

    if (error) {
      return { ok: false, error: `respond_day_questions: ${error.message}` };
    }
    const questions = rows ?? [];
    if (questions.length === 0) {
      return {
        ok: false,
        error: `no active respond_day_questions for position ${args.state.question_position}`,
      };
    }

    let idx = 0;

    if (isFlex) {
      const { data: lastOutbound } = await supabaseServer
        .from("sms_last_outbound_context")
        .select("message_kind, delivery_snapshot")
        .eq("clerk_user_id", args.clerkUserId)
        .maybeSingle();

      let lastSentQuestionId: string | null = null;
      if (lastOutbound?.message_kind === "question") {
        const snap = lastOutbound.delivery_snapshot;
        if (snap && typeof snap === "object" && snap !== null) {
          const raw = (snap as Record<string, unknown>).sent_respond_question_id;
          if (typeof raw === "string" && raw.trim().length > 0) {
            lastSentQuestionId = raw.trim();
          }
        }
      }

      if (lastSentQuestionId !== null) {
        const currentId = String(questions[idx].id);
        if (currentId === lastSentQuestionId) {
          if (questions.length === 1) {
            return {
              ok: false,
              error:
                "respond_day_questions: cannot avoid consecutive duplicate Flex question with only one active question at this position",
            };
          }
          idx = (idx + 1) % questions.length;
        }
      }
    }

    const q = questions[idx];

    const attemptForIntros = isFlex ? 0 : args.state.question_attempt_count;

    let adaptiveRetryIntro: string | undefined;
    let adaptiveQuestionFrame: string | undefined;

    if (
      !isFlex &&
      (attemptForIntros === 0 ||
        attemptForIntros === 1 ||
        attemptForIntros === 2)
    ) {
      const [profile, summaries] = await Promise.all([
        buildProfileContext(args.clerkUserId),
        loadSummariesForQuoteSms(args.clerkUserId),
      ]);
      const profileBlock = compactProfileForPrompt(profile);
      const summariesBlock = summaries.trim() || "none";
      const tone = derivePersonalizationTone(summariesBlock, profileBlock);

      if (attemptForIntros === 0) {
        adaptiveQuestionFrame = getAdaptiveQuestionFrame({
          tone,
          summariesBlock,
        });
      } else {
        adaptiveRetryIntro = getAdaptiveRetryIntro({
          attemptNumber: attemptForIntros as 1 | 2,
          tone,
        });
      }
    }

    const smsBody = buildRespondSmsBody({
      question: q as RespondDayQuestionRow,
      smsTimePreference: args.smsTimePreference,
      questionAttemptCountBeforeSend: attemptForIntros,
      adaptiveQuestionFrame,
      adaptiveRetryIntro,
    });

    const sentRespondQuestionId = String(q.id);

    return { ok: true, smsBody, day2SpecialUsed: false, sentRespondQuestionId };
  }

  const { data: quotes, error: qErr } = await supabaseServer
    .from("pat_quotes")
    .select("id, quote_text")
    .eq("active", true)
    .order("position", { ascending: true });

  if (qErr) {
    return { ok: false, error: `pat_quotes: ${qErr.message}` };
  }
  if (!quotes?.length) {
    return { ok: false, error: "no active pat_quotes" };
  }

  let idx =
    ((args.state.quote_position % quotes.length) + quotes.length) % quotes.length;

  const { data: lastOutbound } = await supabaseServer
    .from("sms_last_outbound_context")
    .select("message_kind, delivery_snapshot")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  let lastSentPatQuoteId: string | null = null;
  if (lastOutbound?.message_kind === "quote") {
    const snap = lastOutbound.delivery_snapshot;
    if (snap && typeof snap === "object" && snap !== null) {
      const raw = (snap as Record<string, unknown>).sent_pat_quote_id;
      if (typeof raw === "string" && raw.trim().length > 0) {
        lastSentPatQuoteId = raw.trim();
      }
    }
  }

  if (lastSentPatQuoteId !== null) {
    const currentId = String(quotes[idx].id);
    if (currentId === lastSentPatQuoteId) {
      if (quotes.length === 1) {
        return {
          ok: false,
          error:
            "pat_quotes: cannot avoid consecutive duplicate Pat quote with only one active quote",
        };
      }
      idx = (idx + 1) % quotes.length;
    }
  }

  const quote = quotes[idx];
  const sentPatQuoteId = String(quote.id);
  const quoteText = (quote.quote_text || "").trim();
  if (!quoteText) {
    return { ok: false, error: "empty pat_quotes.quote_text" };
  }

  const [displayName, profile, summaries] = await Promise.all([
    getDisplayNameForUser(args.clerkUserId),
    buildProfileContext(args.clerkUserId),
    loadSummariesForQuoteSms(args.clerkUserId),
  ]);
  const firstName = (displayName && displayName.trim()) || "there";

  const personalized = await generatePersonalizedQuoteMessage({
    quoteText,
    firstName,
    summaries,
    profile,
  });

  const formattedQuoteText = formatQuoteForSms(quoteText);

  const smsBody = personalized.trim()
    ? `${formattedQuoteText}\n\n${personalized.trim()}`
    : formattedQuoteText;

  return { ok: true, smsBody, day2SpecialUsed: false, sentPatQuoteId };
}

/**
 * After a successful Twilio send: advance delivery state per product rules.
 * Re-reads the DB row first so mutations use current positions/attempts even if
 * load-time self-heal changed the row after the outbound body was built. Branch
 * choice and flex slot follow `sentSnapshot` (the state used when generating the send).
 */
export async function applySmsDeliveryStateAfterSuccessfulSend(
  sentSnapshot: SmsDeliveryStateRow,
  context?: { day2SpecialSent?: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: freshRow, error: freshErr } = await supabaseServer
    .from("sms_delivery_state")
    .select(SMS_DELIVERY_STATE_SELECT)
    .eq("clerk_user_id", sentSnapshot.clerk_user_id)
    .maybeSingle();

  let base: SmsDeliveryStateRow;
  if (freshErr || !freshRow) {
    if (freshErr) {
      console.error(
        "[applySmsDeliveryStateAfterSuccessfulSend] re-read failed; using sent snapshot",
        { clerk_user_id: sentSnapshot.clerk_user_id, error: freshErr.message }
      );
    } else {
      console.error(
        "[applySmsDeliveryStateAfterSuccessfulSend] re-read missing row; using sent snapshot",
        { clerk_user_id: sentSnapshot.clerk_user_id }
      );
    }
    base = sentSnapshot;
  } else {
    base = normalizeDeliveryStateRow(freshRow as Record<string, unknown>);
  }

  const userId = sentSnapshot.clerk_user_id;

  if (context?.day2SpecialSent) {
    if (base.day2_special_sent_at) {
      return { ok: true };
    }
    const nowIso = new Date().toISOString();
    if (sentSnapshot.sms_bucket === "flex") {
      const slot =
        ((sentSnapshot.flex_cadence_index % 7) + 7) % 7;
      const wasRespond = slot === 2 || slot === 5;
      const sentContentType: "respond" | "non_response" = wasRespond
        ? "respond"
        : "non_response";
      const nextCadence =
        ((sentSnapshot.flex_cadence_index + 1) % 7 + 7) % 7;

      const payload: {
        flex_cadence_index: number;
        current_content_type: "respond" | "non_response";
        question_position?: number;
        quote_position?: number;
        question_attempt_count?: number;
        day2_special_sent_at: string;
      } = {
        flex_cadence_index: nextCadence,
        current_content_type: sentContentType,
        day2_special_sent_at: nowIso,
      };

      if (wasRespond) {
        payload.question_position = base.question_position + 1;
        payload.question_attempt_count = 0;
      } else {
        payload.quote_position = base.quote_position + 1;
      }

      const { error } = await supabaseServer
        .from("sms_delivery_state")
        .update(payload)
        .eq("clerk_user_id", userId);

      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true };
    }

    const { error } = await supabaseServer
      .from("sms_delivery_state")
      .update({
        day2_special_sent_at: nowIso,
        question_attempt_count: 3,
        current_content_type: "respond",
      })
      .eq("clerk_user_id", userId);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  if (sentSnapshot.sms_bucket === "flex") {
    const slot =
      ((sentSnapshot.flex_cadence_index % 7) + 7) % 7;
    const wasRespond = slot === 2 || slot === 5;
    const sentContentType: "respond" | "non_response" = wasRespond
      ? "respond"
      : "non_response";
    const nextCadence =
      ((sentSnapshot.flex_cadence_index + 1) % 7 + 7) % 7;

    const payload: {
      flex_cadence_index: number;
      current_content_type: "respond" | "non_response";
      question_position?: number;
      quote_position?: number;
      question_attempt_count?: number;
    } = {
      flex_cadence_index: nextCadence,
      current_content_type: sentContentType,
    };

    if (wasRespond) {
      payload.question_position = base.question_position + 1;
      payload.question_attempt_count = 0;
    } else {
      payload.quote_position = base.quote_position + 1;
    }

    const { error } = await supabaseServer
      .from("sms_delivery_state")
      .update(payload)
      .eq("clerk_user_id", userId);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  const wasActuallyQuote =
    sentSnapshot.sms_bucket !== "flex" &&
    sentSnapshot.current_content_type === "respond" &&
    sentSnapshot.question_attempt_count >= 3;

  if (wasActuallyQuote) {
    const payload: {
      quote_position: number;
      question_position: number;
      current_content_type: "respond";
      question_attempt_count: number;
      sms_bucket?: "daily" | "flex";
    } = {
      quote_position: base.quote_position + 1,
      question_position: base.question_position + 1,
      current_content_type: "respond",
      question_attempt_count: 0,
    };

    if (base.quote_position === 1) {
      payload.sms_bucket = "flex";
    }

    const { error } = await supabaseServer
      .from("sms_delivery_state")
      .update(payload)
      .eq("clerk_user_id", userId);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  if (sentSnapshot.current_content_type === "respond") {
    let nextAttempts = base.question_attempt_count + 1;
    let nextQuestionPos = base.question_position;

    const bucket = base.sms_bucket ?? "daily";
    let nextCycleCount = base.daily_nonresponse_cycle_count ?? 0;

    let exhaustedTripleRespond = false;
    if (nextAttempts >= 3) {
      exhaustedTripleRespond = true;
      nextAttempts = 3;
      if (bucket === "daily") {
        nextCycleCount = nextCycleCount + 1;
      }
    }

    const sentContentType: "respond" = "respond";

    const payload: {
      question_attempt_count: number;
      current_content_type: "respond" | "non_response";
      question_position: number;
      daily_nonresponse_cycle_count?: number;
    } = {
      question_attempt_count: nextAttempts,
      current_content_type: sentContentType,
      question_position: nextQuestionPos,
    };

    if (exhaustedTripleRespond) {
      payload.daily_nonresponse_cycle_count = nextCycleCount;
    }

    const { error } = await supabaseServer
      .from("sms_delivery_state")
      .update(payload)
      .eq("clerk_user_id", userId);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  const sentQuoteContentType: "non_response" = "non_response";

  const { error } = await supabaseServer
    .from("sms_delivery_state")
    .update({
      current_content_type: sentQuoteContentType,
      question_position: base.question_position + 1,
      quote_position: base.quote_position + 1,
      question_attempt_count: 0,
    })
    .eq("clerk_user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
