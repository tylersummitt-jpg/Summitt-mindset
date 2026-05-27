/**
 * M2B-5 — Deterministic SMS memory anti-repeat detection + OpenAI repair orchestration.
 */

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";

export type SmsMemoryRepeatViolationReason =
  | "repeated_recent_question"
  | "repeated_answered_open_question"
  | "repeated_do_not_repeat_phrase"
  | null;

export type SmsMemoryRepeatViolation = {
  hasViolation: boolean;
  repeatedPhrases: string[];
  repeatedQuestion: string | null;
  reason: SmsMemoryRepeatViolationReason;
};

const MIN_PHRASE_CHARS = 12;
const MIN_QUESTION_OVERLAP_CHARS = 18;

const COMPLIANCE_PHRASE_PATTERNS = [
  /\breply\s+stop\b/i,
  /\breply\s+help\b/i,
  /\btext\s+stop\b/i,
  /\btext\s+help\b/i,
  /\bunsubscribe\b/i,
  /\bopt\s*out\b/i,
];

const ACKNOWLEDGMENT_PREFIXES = [
  /^you'?re\s+right\b/i,
  /^you\s+are\s+right\b/i,
  /^got\s+it\b/i,
  /^thanks\s+for\b/i,
  /^thank\s+you\s+for\b/i,
  /^i\s+hear\s+you\b/i,
  /^makes\s+sense\b/i,
  /^understood\b/i,
];

export function normalizeSmsMemoryRepeatText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\breply\s+stop[\s\S]*$/i, "")
    .replace(/\breply\s+help[\s\S]*$/i, "")
    .replace(/[^\w\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isComplianceOrTinyPhrase(phrase: string): boolean {
  const p = phrase.trim();
  if (p.length < MIN_PHRASE_CHARS) return true;
  if (COMPLIANCE_PHRASE_PATTERNS.some((re) => re.test(p))) return true;
  return false;
}

function coachQuestionTextsFromEntries(entries: Array<{ text?: string } | string> | undefined): string[] {
  if (!entries?.length) return [];
  const out: string[] = [];
  for (const e of entries) {
    const t = typeof e === "string" ? e.trim() : typeof e?.text === "string" ? e.text.trim() : "";
    if (t) out.push(t);
  }
  return out;
}

function extractQuestionClausesFromBody(body: string): string[] {
  const stripped = body
    .replace(/\bReply STOP to opt out[\s\S]*$/i, "")
    .replace(/\bReply HELP for help\.?[\s\S]*$/i, "")
    .trim();
  const clauses = stripped.match(/[^?!.]+[?]/g) ?? [];
  if (clauses.length) return clauses.map((c) => c.trim()).filter(Boolean);
  if (/\?/.test(stripped)) return [stripped];
  return [];
}

function wordOverlapRatio(a: string, b: string): number {
  const aWords = normalizeSmsMemoryRepeatText(a)
    .split(" ")
    .filter((w) => w.length > 3);
  const bWords = new Set(
    normalizeSmsMemoryRepeatText(b)
      .split(" ")
      .filter((w) => w.length > 3)
  );
  if (!aWords.length || !bWords.size) return 0;
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap += 1;
  return overlap / aWords.length;
}

function isProtectedByRequiredVerbatim(candidateNorm: string, required: string[]): boolean {
  for (const rv of required) {
    const rvn = normalizeSmsMemoryRepeatText(rv);
    if (rvn.length >= MIN_PHRASE_CHARS && candidateNorm.includes(rvn)) return true;
  }
  return false;
}

function phraseAppearsInCandidate(candidateNorm: string, phrase: string): boolean {
  const pn = normalizeSmsMemoryRepeatText(phrase);
  if (pn.length < MIN_PHRASE_CHARS) return false;
  if (candidateNorm.includes(pn)) return true;
  if (pn.length >= MIN_QUESTION_OVERLAP_CHARS && wordOverlapRatio(candidateNorm, pn) >= 0.45) {
    return /\?/.test(candidateNorm) || /\b(what|when|which|who|how|tell me|did you)\b/i.test(candidateNorm);
  }
  return false;
}

function isAcknowledgmentWithoutReask(candidate: string, priorQuestion: string): boolean {
  const t = candidate.trim();
  if (/\?/.test(t)) return false;
  if (!ACKNOWLEDGMENT_PREFIXES.some((re) => re.test(t))) return false;
  const pq = normalizeSmsMemoryRepeatText(priorQuestion);
  const cn = normalizeSmsMemoryRepeatText(t);
  if (pq.length >= MIN_PHRASE_CHARS && cn.includes(pq.slice(0, Math.min(48, pq.length)))) {
    return true;
  }
  return wordOverlapRatio(t, priorQuestion) >= 0.35 && !/\b(what|when|which|who|how)\b/i.test(t);
}

export function detectSmsMemoryRepeatViolation(args: {
  candidateBody: string;
  lastCoachQuestions?: Array<{ text?: string } | string>;
  doNotRepeatPhrases?: string[];
  answeredOpenQuestion?: string | null;
  latestAnswerText?: string | null;
  requiredVerbatimSubstrings?: string[];
  routePurpose?: string | null;
}): SmsMemoryRepeatViolation {
  const candidate = args.candidateBody.trim();
  if (!candidate) {
    return { hasViolation: false, repeatedPhrases: [], repeatedQuestion: null, reason: null };
  }

  const candidateNorm = normalizeSmsMemoryRepeatText(candidate);
  const required = (args.requiredVerbatimSubstrings ?? []).filter((s) => s.trim().length > 0);

  if (required.length > 0 && isProtectedByRequiredVerbatim(candidateNorm, required)) {
    const onlyBinding =
      required.some((rv) => candidate.includes(rv.trim())) &&
      !extractQuestionClausesFromBody(candidate).some((q) => {
        const qn = normalizeSmsMemoryRepeatText(q);
        return !required.some((rv) => normalizeSmsMemoryRepeatText(rv).includes(qn) || qn.includes(normalizeSmsMemoryRepeatText(rv)));
      });
    if (onlyBinding) {
      return { hasViolation: false, repeatedPhrases: [], repeatedQuestion: null, reason: null };
    }
  }

  const repeatedPhrases: string[] = [];
  let repeatedQuestion: string | null = null;
  let reason: SmsMemoryRepeatViolationReason = null;

  const coachQs = coachQuestionTextsFromEntries(args.lastCoachQuestions);
  const answeredQ = args.answeredOpenQuestion?.trim() ?? null;
  const latestAnswer = args.latestAnswerText?.trim() ?? null;

  if (answeredQ && latestAnswer) {
    const clauses = extractQuestionClausesFromBody(candidate);
    const targets = clauses.length ? clauses : [candidate];
    for (const clause of targets) {
      if (isAcknowledgmentWithoutReask(candidate, answeredQ)) continue;
      if (phraseAppearsInCandidate(normalizeSmsMemoryRepeatText(clause), answeredQ)) {
        repeatedQuestion = answeredQ;
        reason = "repeated_answered_open_question";
        repeatedPhrases.push(answeredQ.slice(0, 280));
        break;
      }
    }
  }

  if (!reason) {
    for (const q of coachQs) {
      if (isComplianceOrTinyPhrase(q)) continue;
      if (required.some((rv) => normalizeSmsMemoryRepeatText(q).includes(normalizeSmsMemoryRepeatText(rv)))) {
        continue;
      }
      if (isAcknowledgmentWithoutReask(candidate, q)) continue;
      if (phraseAppearsInCandidate(candidateNorm, q)) {
        repeatedQuestion = q;
        reason = "repeated_recent_question";
        repeatedPhrases.push(q.slice(0, 280));
        break;
      }
    }
  }

  if (!reason) {
    for (const phrase of args.doNotRepeatPhrases ?? []) {
      const p = phrase.trim();
      if (isComplianceOrTinyPhrase(p)) continue;
      if (required.some((rv) => normalizeSmsMemoryRepeatText(p).includes(normalizeSmsMemoryRepeatText(rv)))) {
        continue;
      }
      if (phraseAppearsInCandidate(candidateNorm, p)) {
        reason = "repeated_do_not_repeat_phrase";
        repeatedPhrases.push(p.slice(0, 280));
        if (!repeatedQuestion && p.includes("?")) repeatedQuestion = p;
      }
    }
  }

  return {
    hasViolation: reason != null,
    repeatedPhrases: [...new Set(repeatedPhrases)],
    repeatedQuestion,
    reason,
  };
}

/** True when OpenAI lane repair is for memory anti-repeat (not generic voice compress). */
export function isMemoryRepeatRepairBlockedReason(blockedReasons: string[]): boolean {
  return blockedReasons.some((r) => r === "memory_repeat_question" || /\bmemory_repeat\b/i.test(r));
}

export function buildMemoryAntiRepeatRepairInstruction(args: {
  repeatedQuestion?: string | null;
  repeatedPhrases: string[];
  latestAnswerText?: string | null;
  reason: SmsMemoryRepeatViolationReason;
}): string {
  const parts = [
    "The user already answered or was already asked this coach question recently.",
    "Do NOT paraphrase the repeated question. Do NOT ask the same thing in different words.",
    "Change the coaching move while preserving the same user facts, current goal, and accountability purpose.",
    "Write one natural, concise SMS that moves the relationship forward.",
    "Keep natural memory callbacks when they advance the thread (e.g. referencing when something tends to slip, or what they said last time) — but do not re-ask the same question frame.",
    "Do not mention memory, projection, databases, or internal systems.",
    "If a prior user answer is available, build on it — do not re-ask for the same information.",
    "Frame-shift guidance (change the move, not the wording): planning/reflection question → proof or completion check; \"what will you do?\" → honest follow-through such as whether one small thing happened; abstract self-care/reflection → concrete accountability tied to the current goal; answered open question → build on the answer instead of re-asking; repeated open question → shorter honesty check (yes/no/partial) when appropriate; silence/reentry → ask for truth, not another plan.",
    "Return strict JSON with keys: body, used_strategy, safety_notes.",
  ];
  if (args.reason === "repeated_answered_open_question" && args.latestAnswerText?.trim()) {
    parts.push(`Use this prior user answer as ground truth: "${args.latestAnswerText.trim().slice(0, 220)}".`);
  }
  if (args.repeatedQuestion?.trim()) {
    parts.push(`Do not repeat this coach question: "${args.repeatedQuestion.trim().slice(0, 200)}".`);
  }
  if (args.repeatedPhrases.length) {
    parts.push(
      `Avoid these repeated phrases: ${args.repeatedPhrases
        .slice(0, 4)
        .map((p) => `"${p.slice(0, 80)}"`)
        .join("; ")}.`
    );
  }
  return parts.join(" ");
}

const INBOUND_MEMORY_REPEAT_GUARD_ROUTES = new Set<string>([
  "normal_inbound_reply",
  "open_question_answer",
  "commitment_change_context",
  "conversation_brain_unavailable",
]);

const DAILY_MEMORY_REPEAT_GUARD_ROUTE_KINDS = new Set<string>([
  "main_active_accountability",
  "low_pressure_reactivation",
]);

const WEEKLY_MEMORY_REPEAT_GUARD_ROUTE_PURPOSES = new Set<string>(["weekly_proof_v2"]);

export function shouldRunInboundMemoryRepeatGuard(facts: InboundV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return false;
  if (facts.route_purpose === "adaptive_proposal_consent_accept") return false;
  if (facts.route_purpose === "adaptive_proposal_consent_decline") return false;
  if (facts.route_purpose === "adaptive_proposal_consent_noop_ack") return false;
  if (facts.route_purpose === "adaptive_proposal_consent_clarification") return false;
  if (facts.contract_consent_facts != null) return false;
  return INBOUND_MEMORY_REPEAT_GUARD_ROUTES.has(facts.route_purpose);
}

export function shouldRunDailyMemoryRepeatGuard(facts: DailyV3RelationshipFacts): boolean {
  if (facts.constraints.required_verbatim_substrings?.length) return false;
  if (facts.route_kind === "contract_prompt") return false;
  if (facts.route_kind === "pending_resolution") return false;
  if (facts.route_kind === "refresh_identity") return false;
  if (facts.route_kind === "refresh_commitment") return false;
  return DAILY_MEMORY_REPEAT_GUARD_ROUTE_KINDS.has(facts.route_kind);
}

export function shouldRunWeeklyMemoryRepeatGuard(facts: WeeklyV3OutboundFacts): boolean {
  if (facts.constraints?.required_verbatim_substrings?.length) return false;
  if (facts.route.legacy_weekly_branch) return false;
  return WEEKLY_MEMORY_REPEAT_GUARD_ROUTE_PURPOSES.has(facts.route.route_purpose);
}

export function buildAntiRepeatDetectArgsFromWeeklyFacts(
  facts: WeeklyV3OutboundFacts,
  candidateBody: string
): Parameters<typeof detectSmsMemoryRepeatViolation>[0] {
  const coachQuestions: string[] = [
    ...facts.thread.last_5_coach_questions,
    facts.thread.latest_open_question,
  ].filter((t): t is string => Boolean(t?.trim()));

  for (const line of facts.thread.recent_transcript_lines ?? []) {
    const m = /^\s*Coach:\s*(.+)$/i.exec(line);
    if (m?.[1]?.trim()) coachQuestions.push(m[1].trim());
  }

  return {
    candidateBody,
    lastCoachQuestions: coachQuestions,
    doNotRepeatPhrases: facts.thread.do_not_repeat_hints,
    answeredOpenQuestion: facts.thread.latest_open_question,
    latestAnswerText: facts.thread.latest_answer_after_open_question,
    requiredVerbatimSubstrings: facts.constraints?.required_verbatim_substrings,
    routePurpose: facts.route.route_purpose,
  };
}

export function buildAntiRepeatDetectArgsFromInboundFacts(
  facts: InboundV3RelationshipFacts,
  candidateBody: string
): Parameters<typeof detectSmsMemoryRepeatViolation>[0] {
  const mp = facts.thread.memory_packet;
  const coachQuestions: string[] = [
    ...(mp?.last_5_coach_questions ?? []),
    facts.thread.latest_open_question,
    mp?.latest_open_question_guess,
    facts.thread.most_recent_coach_question,
  ].filter((t): t is string => Boolean(t?.trim()));

  for (const line of facts.thread.recent_transcript_lines ?? []) {
    const m = /^\s*Coach:\s*(.+)$/i.exec(line);
    if (m?.[1]?.trim()) coachQuestions.push(m[1].trim());
  }

  const dnr = [
    ...(mp?.do_not_repeat_phrases ?? []),
    ...facts.thread.do_not_repeat_hints.map((h) => h.replace(/^[^:]+:\s*/i, "").trim()).filter(Boolean),
  ];

  return {
    candidateBody,
    lastCoachQuestions: coachQuestions,
    doNotRepeatPhrases: dnr,
    answeredOpenQuestion:
      facts.thread.latest_open_question ?? mp?.latest_open_question ?? mp?.latest_open_question_guess ?? null,
    latestAnswerText:
      facts.thread.latest_answer_after_open_question ??
      mp?.latest_answer_after_open_question ??
      mp?.latest_answer_after_open_question_guess ??
      facts.thread.most_recent_substantive_prior_user_message ??
      null,
    requiredVerbatimSubstrings: facts.constraints.required_verbatim_substrings,
    routePurpose: facts.route_purpose,
  };
}

export function buildAntiRepeatDetectArgsFromDailyFacts(
  facts: DailyV3RelationshipFacts,
  candidateBody: string
): Parameters<typeof detectSmsMemoryRepeatViolation>[0] {
  const tm = facts.thread_memory;
  return {
    candidateBody,
    lastCoachQuestions: tm.last_5_coach_questions ?? [],
    doNotRepeatPhrases: tm.do_not_repeat_hints ?? [],
    answeredOpenQuestion: tm.latest_open_question ?? null,
    latestAnswerText: tm.latest_answer_after_open_question ?? null,
    requiredVerbatimSubstrings: facts.constraints.required_verbatim_substrings,
    routePurpose: facts.route_kind,
  };
}

export type MemoryRepeatGuardResult =
  | { outcome: "ok"; body: string; metadata: Record<string, unknown> }
  | { outcome: "no_send"; noSendReason: string; metadata: Record<string, unknown> };

export async function applySmsMemoryAntiRepeatGuard(args: {
  routeKind: "inbound" | "daily" | "weekly";
  routePurpose: string;
  body: string;
  factsJson: unknown;
  detectInput: Parameters<typeof detectSmsMemoryRepeatViolation>[0];
  enabled: boolean;
  validateAfterRepair: (body: string) => Promise<{ ok: true } | { ok: false; noSendReason: string; extraMeta?: Record<string, unknown> }>;
  additionalRepairInstruction?: string | null;
  noSendReason?: string;
}): Promise<MemoryRepeatGuardResult> {
  const baseMeta = (original: string, violation: SmsMemoryRepeatViolation): Record<string, unknown> => ({
    memory_repeat_guard_attempted: true,
    memory_repeat_guard_succeeded: false,
    memory_repeat_guard_reason: violation.reason,
    repeated_phrases: violation.repeatedPhrases,
    repeated_question: violation.repeatedQuestion,
    memory_repeat_original_body_preview: original.length > 220 ? `${original.slice(0, 219)}…` : original,
    memory_repeat_repaired_body_preview: null,
    memory_repeat_no_send_reason: null,
  });

  if (!args.enabled) {
    return { outcome: "ok", body: args.body, metadata: {} };
  }

  const original = args.body.trim();
  const firstViolation = detectSmsMemoryRepeatViolation({ ...args.detectInput, candidateBody: original });

  if (!firstViolation.hasViolation) {
    return { outcome: "ok", body: original, metadata: { memory_repeat_guard_attempted: false } };
  }

  const repairInstruction = buildMemoryAntiRepeatRepairInstruction({
    repeatedQuestion: firstViolation.repeatedQuestion,
    repeatedPhrases: firstViolation.repeatedPhrases,
    latestAnswerText: args.detectInput.latestAnswerText ?? null,
    reason: firstViolation.reason,
  });
  const extraRepair = args.additionalRepairInstruction?.trim();
  const repairOut = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: args.routeKind === "weekly" ? "weekly" : args.routeKind,
    routePurpose: args.routePurpose,
    originalBody: original,
    blockedReasons: ["memory_repeat_question"],
    factsJson: args.factsJson,
    systemInstruction: extraRepair ? `${repairInstruction}\n${extraRepair}` : repairInstruction,
  });

  const blockedNoSendReason = args.noSendReason ?? "thread_memory_repeat_blocked";

  if (!repairOut?.body?.trim()) {
    return {
      outcome: "no_send",
      noSendReason: blockedNoSendReason,
      metadata: {
        ...baseMeta(original, firstViolation),
        memory_repeat_no_send_reason: "repair_failed",
      },
    };
  }

  let repaired = repairOut.body.replace(/^["']|["']$/g, "").trim();
  const afterRepairViolation = detectSmsMemoryRepeatViolation({ ...args.detectInput, candidateBody: repaired });
  if (afterRepairViolation.hasViolation) {
    return {
      outcome: "no_send",
      noSendReason: blockedNoSendReason,
      metadata: {
        ...baseMeta(original, afterRepairViolation),
        memory_repeat_guard_reason: firstViolation.reason,
        memory_repeat_no_send_reason: "still_repeated_after_repair",
        memory_repeat_repaired_body_preview: repaired.length > 220 ? `${repaired.slice(0, 219)}…` : repaired,
      },
    };
  }

  const postValidate = await args.validateAfterRepair(repaired);
  if (!postValidate.ok) {
    return {
      outcome: "no_send",
      noSendReason: postValidate.noSendReason,
      metadata: {
        ...baseMeta(original, firstViolation),
        memory_repeat_no_send_reason: "post_repair_validation_failed",
        memory_repeat_repaired_body_preview: repaired.length > 220 ? `${repaired.slice(0, 219)}…` : repaired,
        ...postValidate.extraMeta,
      },
    };
  }

  return {
    outcome: "ok",
    body: repaired,
    metadata: {
      memory_repeat_guard_attempted: true,
      memory_repeat_guard_succeeded: true,
      memory_repeat_guard_reason: firstViolation.reason,
      repeated_phrases: [],
      repeated_question: null,
      memory_repeat_original_body_preview: original.length > 220 ? `${original.slice(0, 219)}…` : original,
      memory_repeat_repaired_body_preview: repaired.length > 220 ? `${repaired.slice(0, 219)}…` : repaired,
      memory_repeat_no_send_reason: null,
      ...repairOut.metadata,
    },
  };
}
