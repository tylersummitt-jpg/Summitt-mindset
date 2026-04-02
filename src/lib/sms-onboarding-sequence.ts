/**
 * Deterministic first 6 SMS onboarding messages (steps 0–5) before the normal
 * delivery engine runs. Only `sms_delivery_state.onboarding_step` is advanced here.
 */
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import type { ProfileContext } from "@/lib/profile-context";
import { buildProfileContext } from "@/lib/profile-context";
import { getDisplayNameForUser } from "@/lib/resolve-preferred-name";
import {
  compactProfileForPrompt,
  derivePersonalizationTone,
  generatePersonalizedQuoteMessage,
  generateSmsDay2RespondQuestion,
  loadSummariesForQuoteSms,
} from "@/lib/generate-personalized-quote-message";
import {
  buildRespondSmsBody,
  getAdaptiveQuestionFrame,
  getAdaptiveRetryIntro,
  loadOrCreateSmsDeliveryState,
  smsTimePreferenceFromClerkMetadata,
  useEveningPromptForPreference,
  type SmsDeliveryStateRow,
} from "@/lib/sms-daily-delivery-body";

type RespondDayQuestionRow = {
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

/** Must match strip/quote behavior in sms-daily-delivery-body `formatQuoteForSms`. */
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

async function loadActiveQuestion(
  position: number
): Promise<RespondDayQuestionRow | null> {
  const { data: q, error } = await supabaseServer
    .from("respond_day_questions")
    .select(
      "position, prompt_morning, prompt_evening, response_type, retry_intro_1, retry_intro_2, option_a, option_b, option_c"
    )
    .eq("position", position)
    .eq("active", true)
    .maybeSingle();

  if (error || !q) return null;
  return q as RespondDayQuestionRow;
}

async function buildOnboardingQuoteBody(args: {
  userId: string;
  profile: ProfileContext;
  quoteIndex: number;
}): Promise<{ ok: true; smsBody: string } | { ok: false; error: string }> {
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

  const idx =
    ((args.quoteIndex % quotes.length) + quotes.length) % quotes.length;
  const quote = quotes[idx];
  const quoteText = (quote.quote_text || "").trim();
  if (!quoteText) {
    return { ok: false, error: "empty pat_quotes.quote_text" };
  }

  const [displayName, summaries] = await Promise.all([
    getDisplayNameForUser(args.userId),
    loadSummariesForQuoteSms(args.userId),
  ]);
  const firstName = (displayName && displayName.trim()) || "there";

  const personalized = await generatePersonalizedQuoteMessage({
    quoteText,
    firstName,
    summaries,
    profile: args.profile,
  });

  const formattedQuoteText = formatQuoteForSms(quoteText);
  const smsBody = personalized.trim()
    ? `${formattedQuoteText}\n\n${personalized.trim()}`
    : formattedQuoteText;

  return { ok: true, smsBody };
}

export async function ensureSmsRowAndGetOnboardingStep(
  userId: string
): Promise<
  | { ok: true; step: number; snapshot: SmsDeliveryStateRow }
  | { ok: false; error: string }
> {
  const ensured = await loadOrCreateSmsDeliveryState(userId);
  if (ensured.error || !ensured.data) {
    return { ok: false, error: "sms_delivery_state_load_failed" };
  }

  const { data, error } = await supabaseServer
    .from("sms_delivery_state")
    .select("onboarding_step")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[sms-onboarding-sequence] onboarding_step read failed", {
      userId,
      message: error.message,
    });
    return { ok: false, error: "onboarding_step_read_failed" };
  }

  const s = data?.onboarding_step as unknown;
  const step =
    typeof s === "number" && Number.isFinite(s)
      ? Math.max(0, Math.floor(s))
      : 0;
  return { ok: true, step, snapshot: ensured.data };
}

export async function buildOnboardingSms(args: {
  step: number;
  userId: string;
  timezone?: string | null;
  profile?: ProfileContext | null;
}): Promise<
  { ok: true; smsBody: string } | { ok: false; error: string }
> {
  const step = Math.floor(args.step);
  if (step < 0 || step > 5) {
    return { ok: false, error: `invalid onboarding step ${args.step}` };
  }

  const profile =
    args.profile ?? (await buildProfileContext(args.userId));

  const md = await getClerkPublicMetadata(args.userId);
  const mdRecord = md as Record<string, unknown>;
  const smsTimePreference = smsTimePreferenceFromClerkMetadata(mdRecord);

  switch (step) {
    case 0: {
      const evening = useEveningPromptForPreference(smsTimePreference);
      const displayName = await getDisplayNameForUser(args.userId);
      const firstName = (displayName && displayName.trim()) || "there";
      const customMain = await generateSmsDay2RespondQuestion({
        firstName,
        profile,
        eveningPrompt: evening,
      });
      if (!customMain.trim()) {
        return { ok: false, error: "onboarding_ai_question_empty" };
      }
      const q = await loadActiveQuestion(1);
      if (!q) {
        return { ok: false, error: "no active respond_day_questions for position 1" };
      }
      const smsBody = buildRespondSmsBody({
        question: q,
        smsTimePreference,
        questionAttemptCountBeforeSend: 0,
        customMainPrompt: customMain,
      });
      return { ok: true, smsBody };
    }
    case 1: {
      return buildOnboardingQuoteBody({
        userId: args.userId,
        profile,
        quoteIndex: 0,
      });
    }
    case 2: {
      const q = await loadActiveQuestion(1);
      if (!q) {
        return { ok: false, error: "no active respond_day_questions for position 1" };
      }
      const summaries = await loadSummariesForQuoteSms(args.userId);
      const profileBlock = compactProfileForPrompt(profile);
      const summariesBlock = summaries.trim() || "none";
      const tone = derivePersonalizationTone(summariesBlock, profileBlock);
      const adaptiveQuestionFrame = getAdaptiveQuestionFrame({
        tone,
        summariesBlock,
      });
      const smsBody = buildRespondSmsBody({
        question: q,
        smsTimePreference,
        questionAttemptCountBeforeSend: 0,
        adaptiveQuestionFrame,
      });
      return { ok: true, smsBody };
    }
    case 3:
    case 4: {
      const q = await loadActiveQuestion(1);
      if (!q) {
        return { ok: false, error: "no active respond_day_questions for position 1" };
      }
      const summaries = await loadSummariesForQuoteSms(args.userId);
      const profileBlock = compactProfileForPrompt(profile);
      const summariesBlock = summaries.trim() || "none";
      const tone = derivePersonalizationTone(summariesBlock, profileBlock);
      const attemptNumber = step === 3 ? (1 as const) : (2 as const);
      const adaptiveRetryIntro = getAdaptiveRetryIntro({
        attemptNumber,
        tone,
      });
      const smsBody = buildRespondSmsBody({
        question: q,
        smsTimePreference,
        questionAttemptCountBeforeSend: attemptNumber,
        adaptiveRetryIntro,
      });
      return { ok: true, smsBody };
    }
    case 5: {
      const { count } = await supabaseServer
        .from("pat_quotes")
        .select("id", { count: "exact", head: true })
        .eq("active", true);
      const quoteIndex =
        typeof count === "number" && count > 1 ? 1 : 0;
      return buildOnboardingQuoteBody({
        userId: args.userId,
        profile,
        quoteIndex,
      });
    }
    default:
      return { ok: false, error: `unhandled step ${step}` };
  }
}
