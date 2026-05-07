/**
 * Human SMS Brain — OpenAI JSON only. No Supabase. Does not mutate product state.
 */

import OpenAI from "openai";
import { brainCaseInstruction } from "@/lib/v2-human-sms-brain/prompts";
import {
  HUMAN_SMS_BRAIN_PROMPT_VERSION,
  PHASE2_NORMAL_INBOUND_BRAIN_PROMPT_VERSION,
  PHASE3_ADAPTIVE_PROPOSAL_BRAIN_PROMPT_VERSION,
  PHASE4_DAILY_OUTBOUND_BRAIN_PROMPT_VERSION,
  PHASE5A_HUMAN_SMS_BRAIN_PROMPT_VERSION,
  type HumanSmsBrainInput,
  type HumanSmsBrainResult,
} from "@/lib/v2-human-sms-brain/types";

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

const MODEL = "gpt-4o-mini";

const SYSTEM = `You rewrite SMS drafts for Summitt Mindset (Pat Summitt standards): human, direct, SMS-short.
Return ONLY JSON: {"message":"...","confidence":0.0}

Rules:
- One SMS. Prefer under 280 characters.
- Ban weak cheerlead filler: great job, great work, nice work, keep momentum, momentum going, you've got this, keep it up — use concrete proof/next-move language instead (especially after user_yes drafts).
- No banned jargon: contract proposal, candidate, pending resolution, adaptive overlay, recommit (as jargon), same commitment-recommit, I acknowledge your decision, state conflict, guided resolution, mutation.
- Victory Room / victory log: only when MACHINE_DRAFT already includes it OR the read-only line USER_ASKED_VICTORY_OR_PROOF says yes (user asked about proof, logging, or whether something counts)—then you may use those phrases clearly and warmly.
- No therapy voice. No corporate voice.
- Preserve factual meaning from MACHINE_DRAFT; do not invent user facts.
- Do not claim database updates unless MACHINE_DRAFT already states completion—you are rewriting wording only.
`;

export async function rewriteMachineDraftToHumanSms(input: HumanSmsBrainInput): Promise<HumanSmsBrainResult> {
  const client = getOpenAIClientOrNull();
  if (!client) return { ok: false, reason: "no_openai_client" };

  const draft = input.machineDraft.trim().replace(/\s+/g, " ").slice(0, 900);
  const ctx = input.context ?? {};
  const ni = ctx.normalInbound;
  const ap = ctx.adaptiveProposal;
  const dOut = ctx.dailyOutbound;
  const p5 = ctx.phase5a;
  const lines = [
    `brain_case: ${input.brainCase}`,
    brainCaseInstruction(input.brainCase),
    "",
    `MACHINE_DRAFT (preserve meaning): ${draft}`,
    "",
    ctx.currentBarSummary ? `current_bar_hint: ${ctx.currentBarSummary}` : "",
    ctx.proposalSummary ? `proposal_hint: ${ctx.proposalSummary}` : "",
    ctx.contractKindHint ? `contract_kind_hint: ${ctx.contractKindHint}` : "",
    ...(ni
      ? [
          "",
          "--- SERVER READ-ONLY (do not contradict or re-decide outcome) ---",
          ni.finalEventType ? `authoritative_outcome: ${ni.finalEventType}` : "authoritative_outcome: (non-outcome)",
          ni.serverStrategy ? `server_strategy: ${ni.serverStrategy}` : "",
          ni.gatedMode ? `gated_mode: ${ni.gatedMode}` : "",
          ni.replySource ? `reply_source: ${ni.replySource}` : "",
          ni.replyMode ? `reply_mode: ${ni.replyMode}` : "",
          ni.userReplyPreview ? `user_reply_preview: ${ni.userReplyPreview}` : "",
          ni.effectiveAskPreview ? `effective_ask_preview: ${ni.effectiveAskPreview}` : "",
          ni.behaviorStatementPreview ? `behavior_statement_preview: ${ni.behaviorStatementPreview}` : "",
          ni.latestBlockerPreview ? `latest_blocker_preview: ${ni.latestBlockerPreview}` : "",
          ni.recentSmsContextPreview ? `recent_sms_context_preview: ${ni.recentSmsContextPreview}` : "",
          ni.coachingMemoryPreview ? `coaching_memory_preview: ${ni.coachingMemoryPreview}` : "",
          ni.identityAnchorPreview ? `identity_anchor_preview: ${ni.identityAnchorPreview}` : "",
          ni.userAskedVictoryProof
            ? "USER_ASKED_VICTORY_OR_PROOF: yes — user asked about victory log, proof, or whether something counts; answer plainly; Victory Room language allowed when it fits."
            : "",
        ].filter(Boolean)
      : []),
    ...(ap
      ? [
          "",
          "--- SERVER READ-ONLY (stored proposal binding unchanged in DB; rewrite SMS wording only) ---",
          `proposal_kind: ${ap.proposalKind}`,
          `binding_preview: ${ap.bindingPreview}`,
          `behavior_preview: ${ap.behaviorPreview}`,
          typeof ap.templateId === "number" ? `template_id: ${ap.templateId}` : "",
        ].filter(Boolean)
      : []),
    ...(dOut
      ? [
          "",
          "--- SERVER READ-ONLY (cadence/next_move/commitment unchanged; wording only) ---",
          `daily_purpose: ${dOut.dailyPurpose}`,
          `server_strategy: ${dOut.serverStrategy}`,
          `daily_reply_source_pre: ${dOut.dailyReplySourcePre}`,
          `effective_ask_preview: ${dOut.effectiveAskPreview}`,
          `behavior_preview: ${dOut.behaviorPreview}`,
          dOut.identityAnchorPreview ? `identity_anchor_preview: ${dOut.identityAnchorPreview}` : "",
          dOut.coachingMemoryPreview ? `coaching_memory_preview: ${dOut.coachingMemoryPreview}` : "",
          dOut.recentSmsContextPreview ? `recent_sms_context_preview: ${dOut.recentSmsContextPreview}` : "",
        ].filter(Boolean)
      : []),
    ...(p5
      ? [
          "",
          "--- PHASE 5A SERVER READ-ONLY (wording only; do not change scoring, pivots, or commitment state) ---",
          `phase5a_slice: ${p5.slice}`,
          p5.tetherRoute ? `tether_route: ${p5.tetherRoute}` : "",
          p5.centralTurnPurpose ? `central_turn_purpose: ${p5.centralTurnPurpose}` : "",
          p5.dailyPurpose ? `daily_purpose: ${p5.dailyPurpose}` : "",
          p5.dailyReplySourcePre ? `daily_reply_source_pre: ${p5.dailyReplySourcePre}` : "",
          p5.effectiveAskPreview ? `effective_ask_preview: ${p5.effectiveAskPreview}` : "",
          p5.behaviorPreview ? `behavior_preview: ${p5.behaviorPreview}` : "",
          p5.preservationSnippets?.length
            ? `preservation_required_substrings (keep each in output, verbatim meaning): ${p5.preservationSnippets.join(" || ")}`
            : "",
          p5.appendSegments
            ? `append_segments: wave11=${p5.appendSegments.wave11}, victory=${p5.appendSegments.victory}, commitment_note=${p5.appendSegments.commitment_note}`
            : "",
        ].filter(Boolean)
      : []),
    "",
    `prompt_version: ${input.promptVersion}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const temp =
      input.phase5aCreativeTone === true && input.promptVersion === PHASE5A_HUMAN_SMS_BRAIN_PROMPT_VERSION
        ? 0.42
        : 0.35;

    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: lines },
      ],
      temperature: temp,
      max_tokens: 200,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return { ok: false, reason: "empty_model_output" };

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "invalid_json" };
    }

    const message =
      typeof parsed.message === "string" ? parsed.message.trim().replace(/\n+/g, " ") : "";
    if (!message) return { ok: false, reason: "empty_message" };

    let confidence: number | null = null;
    if (typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)) {
      confidence = Math.min(1, Math.max(0, parsed.confidence));
    }

    return { ok: true, message, confidence };
  } catch (e) {
    console.error("[human-sms-brain] OpenAI failed", e);
    return { ok: false, reason: "openai_error" };
  }
}

export {
  HUMAN_SMS_BRAIN_PROMPT_VERSION,
  PHASE2_NORMAL_INBOUND_BRAIN_PROMPT_VERSION,
  PHASE3_ADAPTIVE_PROPOSAL_BRAIN_PROMPT_VERSION,
  PHASE4_DAILY_OUTBOUND_BRAIN_PROMPT_VERSION,
  PHASE5A_HUMAN_SMS_BRAIN_PROMPT_VERSION,
};
