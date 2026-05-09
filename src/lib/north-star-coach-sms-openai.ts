/**
 * Phase 3 — One OpenAI pass for final coaching SMS voice, then deterministic North Star guards.
 */

import OpenAI from "openai";

import type {
  NorthStarCoachChannel,
  NorthStarCoachSmsArgs,
  NorthStarCoachSmsMeta,
  NorthStarCoachSmsResult,
  NorthStarInboundCoachCtx,
} from "@/lib/north-star-coach-sms";
import {
  finalizeNorthStarCoachSms,
  inboundSignalsCompletion,
  NORTH_STAR_SMS_LONG_FORM_MAX_LEN,
} from "@/lib/north-star-coach-sms";

export const NORTH_STAR_OPENAI_FINALIZER_VERSION = "north_star_openai_v1";

const OPENAI_TIMEOUT_MS = 14_000;

/** Reuses SMS Conversation Brain model selection (existing env; no new vars). */
function northStarOpenAiModel(): string {
  return process.env.V2_SMS_CONVERSATION_BRAIN_MODEL?.trim() || "gpt-4o-mini";
}

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

function stripAssistantArtifacts(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^["'`]*|["'`]*$/g, "").trim();
  t = t.replace(/^coach:\s*/i, "").trim();
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/^[-*•]\s+/gm, "");
  return t.replace(/\s+/g, " ").trim();
}

function factPackFromArgs(args: NorthStarCoachSmsArgs): string {
  const pkt = args.contextPacket;
  const lines: string[] = [];

  lines.push(`channel=${args.channel}`);
  if (pkt?.source) lines.push(`packet_source=${pkt.source}`);

  lines.push("");
  lines.push("## Commitment / ask (server truth)");
  lines.push(`behavior_statement=${pkt?.behaviorStatement ?? args.behaviorStatement ?? "(none)"}`);
  lines.push(`effective_ask=${pkt?.effectiveAskText ?? args.effectiveAskText ?? "(none)"}`);
  lines.push(`active_commitment_id=${pkt?.activeCommitmentId ?? "(none)"}`);

  lines.push("");
  lines.push("## Latest inbound (user)");
  lines.push(pkt?.latestInboundRaw ?? args.latestInboundRaw ?? "(none)");

  lines.push("");
  lines.push("## Latest outbound coach preview");
  lines.push(pkt?.latestOutboundBody ?? args.latestOutboundBody ?? "(none)");

  lines.push("");
  lines.push("## Latest open question");
  lines.push(pkt?.latestOpenQuestion ?? "(none)");

  lines.push("");
  lines.push("## Expected reply semantics");
  lines.push(pkt?.expectedReplySemantics ?? "(unknown)");

  const tl = pkt?.recentTranscriptLines?.slice(-10) ?? [];
  lines.push("");
  lines.push("## Recent transcript (newest last; max 10 lines)");
  lines.push(tl.length ? tl.join("\n") : pkt?.recentTranscriptSnippet ?? "(none)");

  lines.push("");
  lines.push("## Spine signals");
  lines.push(`today_completed=${String(pkt?.todayCompleted ?? false)}`);
  lines.push(`latest_outcome_type=${pkt?.latestOutcomeType ?? "(none)"}`);
  lines.push(`final_event_type=${pkt?.finalEventType ?? args.finalEventType ?? "(none)"}`);
  lines.push(`future_intent_hint=${pkt?.futureIntentHint ?? "(none)"}`);
  lines.push(`proof_signal=${String(pkt?.proofSignal ?? false)}`);
  lines.push(`miss_signal=${String(pkt?.missSignal ?? false)}`);
  lines.push(`blocker_signal=${String(pkt?.blockerSignal ?? false)}`);

  lines.push("");
  lines.push("## Blocker / coaching / relationship (non-authoritative prose ok)");
  lines.push(`latest_blocker_preview=${pkt?.latestBlockerPreview ?? "(none)"}`);
  lines.push(`coaching_summary=${pkt?.coachingSummary ?? "(none)"}`);
  lines.push(`relationship_profile=${pkt?.relationshipProfileSummary ?? "(none)"}`);

  lines.push("");
  lines.push("## Identity / life (quote carefully; facts may be partial)");
  lines.push(`identity_anchor=${pkt?.identityAnchorText ?? "(none)"}`);
  lines.push(`people_summary=${pkt?.peopleSummary ?? "(none)"}`);
  lines.push(`life_desires=${pkt?.lifeDesires ?? "(none)"}`);
  lines.push(`pressure_summary=${pkt?.pressureSummary ?? "(none)"}`);

  return lines.join("\n");
}

const NORTH_STAR_SYSTEM_PROMPT = `You are the final SMS voice for Summitt Mindset. You are an AI accountability coach inspired by Pat Summitt's principles — not pretending to be Pat. Be direct, warm-not-soft, specific, emotionally intelligent, and concise.

SMS is one long-running relationship over months of texts, not a daily reminder series. Accountability is the hidden spine; your visible message must feel human and continuous.

RULES:
- Use ONLY the FACT PACK as ground truth. Do not invent completions, commitments, saved state, or database changes.
- If today_completed is true, never ask whether today's rep/hour already happened.
- If the user or open question is about tomorrow/future/stretch, match that timeframe — do not pull back to "today's plan" unless the user is clearly on today.
- Answer normal human questions first; then connect lightly to the bar only if one SMS still fits.
- Turn wins/misses/blockers into proof language or the next useful move — never hollow cheerleading.
- Output exactly ONE SMS body: no markdown, no bullets, no labels, no "Coach:" prefix.
- Never use product/system jargon: no V2, overlay, contract proposal, pending resolution, recommit to this bar, event spine, accountability system.
- Never say "check the app," "open the app," or "use the app" unless the user explicitly asked about app/account/settings/navigation.
- Avoid: "Great job," "Great to hear," "keep momentum," "you've got this," generic "quick check," robotic check-in openers.
- Do not claim something was saved or logged unless the fact pack supports an outcome/proof moment.
- You may say proof language like "that counts," "that's proof" when outcome signals support it.

OUTPUT: Return only the SMS text. Nothing else.`;

const STYLE_EXAMPLES = `Style examples (paraphrase freely; do not copy verbatim):
- Today done + tomorrow plan ("two hours tomorrow"): Good. Today is handled. Tomorrow is the target: two protected hours. What time does the first block start?
- User: "I got it done!": That counts. You did the rep. What made it possible today?
- User pride/focus: That's the win — not just doing it, protecting your focus. That belongs in proof.
- Goal change: Yes. Say whether this is a one-day stretch or the new daily standard, and I'll hold you to the right version.
- Human question: Answer first briefly, then tie to accountability only if natural in one SMS.`;

function buildUserPrompt(args: NorthStarCoachSmsArgs): string {
  const banned = [
    "Great job",
    "Great to hear",
    "keep momentum",
    "you've got this",
    "check the app",
    "Quick check",
    "Today's check-in",
    "recommit to this bar",
    "overlay",
    "pending resolution",
    " V2",
    "contract proposal",
  ];
  return [
    "## Proposed draft from upstream systems (hint only — rewrite into your final SMS)",
    args.proposedBody.trim() || "(empty)",
    "",
    factPackFromArgs(args),
    "",
    "## Do-not-say / banned clichés",
    banned.join(", "),
    "",
    STYLE_EXAMPLES,
  ].join("\n");
}

function enrichMeta(
  base: NorthStarCoachSmsMeta,
  extras: Partial<NorthStarCoachSmsMeta>
): NorthStarCoachSmsMeta {
  return { ...base, ...extras };
}

function clipCombinedForSuffix(combined: string, max: number): string {
  const t = combined.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Visible copy already finalized upstream (central brain / Phase 5a / deterministic templates). Not V3 — keep deterministic North Star only (no duplicate OpenAI finalizer). Telemetry must not imply V3 refined these bodies. */
const UPSTREAM_HUMANIZED_NON_V3_REPLY_SOURCES = new Set([
  "central_brain_pivot_visible",
  "arc_clarify_ambiguous_short_visible",
  "central_brain_blocker_pivot_visible",
  "blocker_ack_visible_non_v3",
]);

function shouldAttemptOpenAi(args: NorthStarCoachSmsArgs): boolean {
  if (!getOpenAIClientOrNull()) return false;
  if (!args.proposedBody?.trim()) return false;
  if (args.contextPacket == null) return false;
  /** V3 SMS Brain already ran OpenAI; apply deterministic North Star guards only. */
  const v3OwnedSources = new Set([
    "v3_sms_brain",
    "v3_deterministic_fallback",
    "v3_daily_check_in",
    "v3_daily_deterministic_fallback",
    "v3_answer_to_open_question",
    "v3_refined_prior_draft",
    "v3_refresh_refined",
    "v3_memory_confirmation_refined",
    "v3_contract_consent_refined",
    "v3_adaptive_proposal_refined",
    "v3_weekly_proof_refined",
    "v3_followup_sms_refined",
    "v3_missed_yesterday_sms_refined",
    "v3_winback_refined",
    "v3_inactivity_rescue_refined",
    "v3_machine_deterministic_fallback",
  ]);
  if (args.replySource && v3OwnedSources.has(args.replySource)) return false;
  if (args.replySource && UPSTREAM_HUMANIZED_NON_V3_REPLY_SOURCES.has(args.replySource)) return false;
  return true;
}

export async function finalizeNorthStarCoachSmsAsync(
  args: NorthStarCoachSmsArgs
): Promise<NorthStarCoachSmsResult> {
  const baseExtras: Partial<NorthStarCoachSmsMeta> = {
    contextPacketUsed: Boolean(args.contextPacket),
    finalizerVersion: NORTH_STAR_OPENAI_FINALIZER_VERSION,
  };

  if (!shouldAttemptOpenAi(args)) {
    const r = finalizeNorthStarCoachSms(args);
    return {
      visibleBody: r.visibleBody,
      meta: enrichMeta(r.meta, {
        ...baseExtras,
        openaiAttempted: false,
        openaiFailedReason: null,
      }),
    };
  }

  const model = northStarOpenAiModel();
  const client = getOpenAIClientOrNull()!;
  let raw = "";
  let failReason: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.35,
        max_tokens: 450,
        messages: [
          { role: "system", content: NORTH_STAR_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(args) },
        ],
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    raw = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failReason = msg.includes("abort") ? "openai_timeout" : `openai_error:${msg.slice(0, 160)}`;
    console.warn("[north-star-openai] OpenAI finalizer failed", { channel: args.channel, failReason });
  }

  if (failReason || !raw) {
    const r = finalizeNorthStarCoachSms(args);
    return {
      visibleBody: r.visibleBody,
      meta: enrichMeta(r.meta, {
        ...baseExtras,
        openaiAttempted: true,
        openaiFailedReason: failReason ?? "empty_model_output",
        north_star_openai_model: model,
        source: "openai_failed_deterministic_fallback",
      }),
    };
  }

  const draft = stripAssistantArtifacts(raw);
  if (!draft) {
    const r = finalizeNorthStarCoachSms(args);
    return {
      visibleBody: r.visibleBody,
      meta: enrichMeta(r.meta, {
        ...baseExtras,
        openaiAttempted: true,
        openaiFailedReason: "empty_after_strip",
        north_star_openai_model: model,
        source: "openai_failed_deterministic_fallback",
      }),
    };
  }

  const gated = finalizeNorthStarCoachSms({
    ...args,
    proposedBody: draft,
  });

  return {
    visibleBody: gated.visibleBody,
    meta: enrichMeta(gated.meta, {
      ...baseExtras,
      openaiAttempted: true,
      openaiFailedReason: null,
      north_star_openai_model: model,
      source: "openai_finalized",
    }),
  };
}

export async function finalizeNorthStarCoachSmsPreservingSuffixAsync(args: {
  proposedFullBody: string;
  suffixToPreserve: string;
} & Omit<NorthStarCoachSmsArgs, "proposedBody">): Promise<NorthStarCoachSmsResult> {
  const suf = args.suffixToPreserve.trim();
  let coaching = args.proposedFullBody.trimEnd();
  while (coaching.endsWith(suf)) {
    coaching = coaching.slice(0, -suf.length).trimEnd();
  }
  const { proposedFullBody: _full, suffixToPreserve: _sufKey, ...gateArgs } = args;
  void _full;
  void _sufKey;

  const inner = await finalizeNorthStarCoachSmsAsync({
    ...gateArgs,
    proposedBody: coaching,
  });

  const combined = `${inner.visibleBody.trimEnd()}\n\n${suf}`;
  const max = args.maxLen ?? NORTH_STAR_SMS_LONG_FORM_MAX_LEN;
  const visibleBody = clipCombinedForSuffix(combined, max);

  return {
    visibleBody,
    meta: {
      ...inner.meta,
      originalBody: args.proposedFullBody.trim(),
      blockedReasons: [
        ...inner.meta.blockedReasons,
        ...(suf ? ["compliance_suffix_preserved_unchanged"] : []),
      ],
    },
  };
}

export async function finalizeNorthStarInboundCoachReplyAsync(args: {
  proposedBody: string;
  ctx: NorthStarInboundCoachCtx;
  channel?: NorthStarCoachChannel;
}): Promise<NorthStarCoachSmsResult> {
  const { ctx } = args;
  const pkt = ctx.contextPacket;
  const inferredDone =
    ctx.alreadyCompletedToday === true ||
    ctx.finalEventType === "user_yes" ||
    inboundSignalsCompletion(ctx.userMessage) ||
    pkt?.todayCompleted === true;

  return finalizeNorthStarCoachSmsAsync({
    proposedBody: args.proposedBody,
    channel: args.channel ?? "inbound_coach_reply",
    latestInboundRaw: ctx.userMessage,
    latestOutboundBody: ctx.lastOutboundSmsPreview ?? null,
    effectiveAskText: ctx.effectiveBehavior,
    behaviorStatement: ctx.behaviorStatement,
    finalEventType: ctx.finalEventType ?? undefined,
    replySource: ctx.replySource ?? undefined,
    alreadyCompletedToday: inferredDone,
    contextPacket: ctx.contextPacket,
  });
}
