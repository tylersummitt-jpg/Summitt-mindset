/**
 * Morning Coaching Brief V1 — structured coaching judgment contract.
 * No production wiring in Phase 2B. No SMS body. No DB mutation.
 */

export const MORNING_COACHING_BRIEF_VERSION = "morning_coaching_brief_v1" as const;

export type MorningBriefContextUse =
  | "relevant"
  | "background"
  | "do_not_force"
  | "unknown";

export type MorningBriefIdentityOrPersonUse =
  | "relevant"
  | "background"
  | "do_not_force"
  | "do_not_use"
  | "unknown";

export type MorningBriefOutcome =
  | "completed"
  | "partial"
  | "missed"
  | "unknown"
  | "no_recent_evidence";

export type MorningBriefEvidenceStrength =
  | "none"
  | "stated_once"
  | "repeated"
  | "verified";

export type MorningBriefGoalAlignment =
  | "aligned"
  | "pending_confirmation"
  | "thread_discussing_unconfirmed_alternative"
  | "possibly_stale"
  | "unknown";

export type MorningBriefGoalRole =
  | "central"
  | "background"
  | "unresolved"
  | "do_not_mention"
  | "unknown";

export type MorningBriefPrimaryMove =
  | "continue_conversation"
  | "answer"
  | "acknowledge_truth"
  | "celebrate"
  | "challenge"
  | "clarify"
  | "support"
  | "offer_perspective"
  | "simplify_next_move"
  | "reconnect"
  | "invite_reentry"
  | "close_loop"
  | "unknown";

export type MorningBriefQuestionPolicy = "none" | "one_useful_question" | "unknown";

export type MorningBriefActionGuidance = "none" | "one_specific_next_step" | "unknown";

export type MorningBriefPressure = "low" | "normal" | "firm" | "unknown";

export type MorningBriefProactiveDecision = "send" | "intentional_space";

export type MorningBriefConfidence = "low" | "medium" | "high";

export type MorningBriefSelectedPerson = {
  name: string;
  relationship: string;
};

export type MorningBriefAnsweredQuestion = {
  question: string;
  answer: string;
};

export type MorningBriefProofClaimsAllowed = {
  completion: boolean;
  miss: boolean;
  partial: boolean;
  proof: boolean;
};

export type MorningBriefPendingGoal = {
  candidate_text: string;
  status: string;
};

export type MorningCoachingBriefV1 = {
  version: typeof MORNING_COACHING_BRIEF_VERSION;
  confidence: MorningBriefConfidence;

  human_situation: {
    most_alive: string | "unknown";
    direct_question_or_need: string | null | "unknown";
    relevant_life_event: string | null | "unknown";
    context_use: MorningBriefContextUse;
    identity_use: MorningBriefIdentityOrPersonUse;
    person_use: MorningBriefIdentityOrPersonUse;
    selected_person: MorningBriefSelectedPerson | null;
    selected_person_reason: string | null | "unknown";
  };

  truth_and_evidence: {
    latest_user_truth: string | null | "unknown";
    outcome: MorningBriefOutcome;
    evidence_note: string | "unknown";
    evidence_strength: MorningBriefEvidenceStrength;
    consistency_supported: boolean;
    proof_claims_allowed: MorningBriefProofClaimsAllowed;
  };

  conversation_continuity: {
    already_acknowledged: string[] | "unknown";
    answered_question: MorningBriefAnsweredQuestion | null | "unknown";
    open_loop: string | null | "unknown";
    stale_or_exhausted_topics: string[] | "unknown";
    do_not_repeat: string[] | "unknown";
  };

  goal_role_today: {
    canonical_goal: string;
    pending_goal: MorningBriefPendingGoal | null;
    goal_alignment: MorningBriefGoalAlignment;
    role: MorningBriefGoalRole;
    note: string | "unknown";
  };

  coaching_direction: {
    primary_move: MorningBriefPrimaryMove;
    question_policy: MorningBriefQuestionPolicy;
    action_guidance: MorningBriefActionGuidance;
    pressure: MorningBriefPressure;
    /**
     * SEND vs INTENTIONAL SPACE. "send" includes normal reentry AND standalone value.
     * Missing/unknown parse as send (never invent SPACE).
     */
    proactive_decision: MorningBriefProactiveDecision;
  };

  boundaries: {
    claims_to_avoid: string[];
    topics_not_to_force: string[];
    unsupported_capabilities: string[];
    goal_authority_boundaries: string[];
    identity_people_boundaries: string[];
    coach_history_is_not_style: string;
  };
};

/** Keys that must never appear on a Brief (user-visible SMS copy). */
export const MORNING_BRIEF_FORBIDDEN_COPY_KEYS = [
  "body",
  "sms_body",
  "message",
  "final_message",
  "reply",
] as const;

const MAX_SHORT = 280;
const MAX_MEDIUM = 400;
const MAX_ARRAY = 8;
const MAX_BOUNDARY = 12;
const MAX_BOUNDARY_ITEM = 220;

const CONTEXT_USE = new Set<string>(["relevant", "background", "do_not_force", "unknown"]);
const IDENTITY_PERSON_USE = new Set<string>([
  "relevant",
  "background",
  "do_not_force",
  "do_not_use",
  "unknown",
]);
const OUTCOMES = new Set<string>([
  "completed",
  "partial",
  "missed",
  "unknown",
  "no_recent_evidence",
]);
const EVIDENCE_STRENGTH = new Set<string>(["none", "stated_once", "repeated", "verified"]);
const GOAL_ALIGNMENT = new Set<string>([
  "aligned",
  "pending_confirmation",
  "thread_discussing_unconfirmed_alternative",
  "possibly_stale",
  "unknown",
]);
const GOAL_ROLE = new Set<string>([
  "central",
  "background",
  "unresolved",
  "do_not_mention",
  "unknown",
]);
const PRIMARY_MOVE = new Set<string>([
  "continue_conversation",
  "answer",
  "acknowledge_truth",
  "celebrate",
  "challenge",
  "clarify",
  "support",
  "offer_perspective",
  "simplify_next_move",
  "reconnect",
  "invite_reentry",
  "close_loop",
  "unknown",
]);
const QUESTION_POLICY = new Set<string>(["none", "one_useful_question", "unknown"]);
const ACTION_GUIDANCE = new Set<string>(["none", "one_specific_next_step", "unknown"]);
const PRESSURE = new Set<string>(["low", "normal", "firm", "unknown"]);
const PROACTIVE_DECISION = new Set<string>(["send", "intentional_space"]);
const CONFIDENCE = new Set<string>(["low", "medium", "high"]);

const FORBIDDEN_JARGON = [
  "set_today_rep",
  "wake_up_check",
  "slot_coaching",
  "hallway",
  "lane_stage",
  "writing_brief",
  "human_sms_brain",
  "final_voice_gate",
] as const;

function trimCollapse(value: string, max: number): string {
  const t = value.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function parseEnum<T extends string>(raw: unknown, allowed: Set<string>): T | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!allowed.has(t)) return null;
  return t as T;
}

function parseStringOrUnknown(
  raw: unknown,
  max: number
): string | "unknown" | null {
  if (raw === "unknown") return "unknown";
  if (raw === null) return null;
  if (typeof raw !== "string") return null;
  const t = trimCollapse(raw, max);
  return t.length ? t : null;
}

function parseRequiredStringOrUnknown(raw: unknown, max: number): string | "unknown" | null {
  if (raw === "unknown") return "unknown";
  if (typeof raw !== "string") return null;
  const t = trimCollapse(raw, max);
  return t.length ? t : null;
}

function parseStringArrayOrUnknown(
  raw: unknown,
  maxItems: number,
  maxLen: number
): string[] | "unknown" | null {
  if (raw === "unknown") return "unknown";
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= maxItems) break;
    if (typeof item !== "string") continue;
    const t = trimCollapse(item, maxLen);
    if (t) out.push(t);
  }
  return out;
}

function parseStringArray(
  raw: unknown,
  maxItems: number,
  maxLen: number
): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= maxItems) break;
    if (typeof item !== "string") continue;
    const t = trimCollapse(item, maxLen);
    if (t) out.push(t);
  }
  return out;
}

function parseSelectedPerson(raw: unknown): MorningBriefSelectedPerson | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.relationship !== "string") return undefined;
  const name = trimCollapse(o.name, 80);
  const relationship = trimCollapse(o.relationship, 80);
  if (!name || !relationship) return undefined;
  return { name, relationship };
}

function parseAnsweredQuestion(
  raw: unknown
): MorningBriefAnsweredQuestion | null | "unknown" | undefined {
  if (raw === "unknown") return "unknown";
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.question !== "string" || typeof o.answer !== "string") return undefined;
  const question = trimCollapse(o.question, MAX_SHORT);
  const answer = trimCollapse(o.answer, MAX_SHORT);
  if (!question || !answer) return undefined;
  return { question, answer };
}

function parsePendingGoal(raw: unknown): MorningBriefPendingGoal | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.candidate_text !== "string" || typeof o.status !== "string") return undefined;
  const candidate_text = trimCollapse(o.candidate_text, MAX_MEDIUM);
  const status = trimCollapse(o.status, 80);
  if (!candidate_text || !status) return undefined;
  return { candidate_text, status };
}

function parseProofClaims(raw: unknown): MorningBriefProofClaimsAllowed | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.completion !== "boolean" ||
    typeof o.miss !== "boolean" ||
    typeof o.partial !== "boolean" ||
    typeof o.proof !== "boolean"
  ) {
    return null;
  }
  return {
    completion: o.completion,
    miss: o.miss,
    partial: o.partial,
    proof: o.proof,
  };
}

function objectHasForbiddenCopyKeys(root: Record<string, unknown>): boolean {
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    const rec = cur as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (
        (MORNING_BRIEF_FORBIDDEN_COPY_KEYS as readonly string[]).includes(key)
      ) {
        return true;
      }
      stack.push(rec[key]);
    }
  }
  return false;
}

/**
 * Strict parse of a Morning Coaching Brief. Rejects SMS-copy fields and invalid enums.
 */
export function parseMorningCoachingBriefV1(
  raw: unknown
): MorningCoachingBriefV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;

  if (objectHasForbiddenCopyKeys(root)) return null;
  if (root.version !== MORNING_COACHING_BRIEF_VERSION) return null;

  const confidence = parseEnum<MorningBriefConfidence>(root.confidence, CONFIDENCE);
  if (!confidence) return null;

  const hs = root.human_situation;
  const te = root.truth_and_evidence;
  const cc = root.conversation_continuity;
  const gr = root.goal_role_today;
  const cd = root.coaching_direction;
  const bd = root.boundaries;

  if (
    !hs ||
    typeof hs !== "object" ||
    Array.isArray(hs) ||
    !te ||
    typeof te !== "object" ||
    Array.isArray(te) ||
    !cc ||
    typeof cc !== "object" ||
    Array.isArray(cc) ||
    !gr ||
    typeof gr !== "object" ||
    Array.isArray(gr) ||
    !cd ||
    typeof cd !== "object" ||
    Array.isArray(cd) ||
    !bd ||
    typeof bd !== "object" ||
    Array.isArray(bd)
  ) {
    return null;
  }

  const human = hs as Record<string, unknown>;
  const truth = te as Record<string, unknown>;
  const continuity = cc as Record<string, unknown>;
  const goal = gr as Record<string, unknown>;
  const coaching = cd as Record<string, unknown>;
  const boundaries = bd as Record<string, unknown>;

  const most_alive = parseRequiredStringOrUnknown(human.most_alive, MAX_MEDIUM);
  if (most_alive == null) return null;

  if (
    !(
      human.direct_question_or_need === null ||
      human.direct_question_or_need === "unknown" ||
      typeof human.direct_question_or_need === "string"
    )
  ) {
    return null;
  }
  const direct_question_or_need = parseStringOrUnknown(
    human.direct_question_or_need,
    MAX_MEDIUM
  );

  if (
    !(
      human.relevant_life_event === null ||
      human.relevant_life_event === "unknown" ||
      typeof human.relevant_life_event === "string"
    )
  ) {
    return null;
  }
  const relevant_life_event = parseStringOrUnknown(human.relevant_life_event, MAX_MEDIUM);

  const context_use = parseEnum<MorningBriefContextUse>(human.context_use, CONTEXT_USE);
  const identity_use = parseEnum<MorningBriefIdentityOrPersonUse>(
    human.identity_use,
    IDENTITY_PERSON_USE
  );
  const person_use = parseEnum<MorningBriefIdentityOrPersonUse>(
    human.person_use,
    IDENTITY_PERSON_USE
  );
  if (!context_use || !identity_use || !person_use) return null;

  const selected_person = parseSelectedPerson(human.selected_person);
  if (selected_person === undefined) return null;

  if (
    !(
      human.selected_person_reason === null ||
      human.selected_person_reason === "unknown" ||
      typeof human.selected_person_reason === "string"
    )
  ) {
    return null;
  }
  const selected_person_reason = parseStringOrUnknown(
    human.selected_person_reason,
    MAX_SHORT
  );

  if (
    !(
      truth.latest_user_truth === null ||
      truth.latest_user_truth === "unknown" ||
      typeof truth.latest_user_truth === "string"
    )
  ) {
    return null;
  }
  const latest_user_truth = parseStringOrUnknown(truth.latest_user_truth, MAX_MEDIUM);

  const outcome = parseEnum<MorningBriefOutcome>(truth.outcome, OUTCOMES);
  if (!outcome) return null;

  const evidence_note = parseRequiredStringOrUnknown(truth.evidence_note, MAX_MEDIUM);
  if (evidence_note == null) return null;

  const evidence_strength = parseEnum<MorningBriefEvidenceStrength>(
    truth.evidence_strength,
    EVIDENCE_STRENGTH
  );
  if (!evidence_strength) return null;

  if (typeof truth.consistency_supported !== "boolean") return null;
  const proof_claims_allowed = parseProofClaims(truth.proof_claims_allowed);
  if (!proof_claims_allowed) return null;

  const already_acknowledged = parseStringArrayOrUnknown(
    continuity.already_acknowledged,
    MAX_ARRAY,
    MAX_SHORT
  );
  if (already_acknowledged == null) return null;

  const answered_question = parseAnsweredQuestion(continuity.answered_question);
  if (answered_question === undefined) return null;

  const open_loop = parseStringOrUnknown(continuity.open_loop, MAX_MEDIUM);
  if (
    continuity.open_loop !== null &&
    continuity.open_loop !== "unknown" &&
    typeof continuity.open_loop !== "string"
  ) {
    return null;
  }

  const stale_or_exhausted_topics = parseStringArrayOrUnknown(
    continuity.stale_or_exhausted_topics,
    MAX_ARRAY,
    MAX_SHORT
  );
  if (stale_or_exhausted_topics == null) return null;

  const do_not_repeat = parseStringArrayOrUnknown(
    continuity.do_not_repeat,
    MAX_ARRAY,
    MAX_SHORT
  );
  if (do_not_repeat == null) return null;

  if (typeof goal.canonical_goal !== "string") return null;
  const canonical_goal = trimCollapse(goal.canonical_goal, MAX_MEDIUM);
  if (!canonical_goal) return null;

  const pending_goal = parsePendingGoal(goal.pending_goal);
  if (pending_goal === undefined) return null;

  const goal_alignment = parseEnum<MorningBriefGoalAlignment>(
    goal.goal_alignment,
    GOAL_ALIGNMENT
  );
  const role = parseEnum<MorningBriefGoalRole>(goal.role, GOAL_ROLE);
  if (!goal_alignment || !role) return null;

  const goal_note = parseRequiredStringOrUnknown(goal.note, MAX_MEDIUM);
  if (goal_note == null) return null;

  const primary_move = parseEnum<MorningBriefPrimaryMove>(
    coaching.primary_move,
    PRIMARY_MOVE
  );
  const question_policy = parseEnum<MorningBriefQuestionPolicy>(
    coaching.question_policy,
    QUESTION_POLICY
  );
  const action_guidance = parseEnum<MorningBriefActionGuidance>(
    coaching.action_guidance,
    ACTION_GUIDANCE
  );
  const pressure = parseEnum<MorningBriefPressure>(coaching.pressure, PRESSURE);
  if (!primary_move || !question_policy || !action_guidance || !pressure) return null;

  // Missing/invalid → send. SPACE is never inferred from a parse gap.
  const proactive_decision: MorningBriefProactiveDecision =
    parseEnum<MorningBriefProactiveDecision>(coaching.proactive_decision, PROACTIVE_DECISION) ??
    "send";

  const claims_to_avoid = parseStringArray(
    boundaries.claims_to_avoid,
    MAX_BOUNDARY,
    MAX_BOUNDARY_ITEM
  );
  const topics_not_to_force = parseStringArray(
    boundaries.topics_not_to_force,
    MAX_BOUNDARY,
    MAX_BOUNDARY_ITEM
  );
  const unsupported_capabilities = parseStringArray(
    boundaries.unsupported_capabilities,
    MAX_BOUNDARY,
    MAX_BOUNDARY_ITEM
  );
  const goal_authority_boundaries = parseStringArray(
    boundaries.goal_authority_boundaries,
    MAX_BOUNDARY,
    MAX_BOUNDARY_ITEM
  );
  const identity_people_boundaries = parseStringArray(
    boundaries.identity_people_boundaries,
    MAX_BOUNDARY,
    MAX_BOUNDARY_ITEM
  );
  if (
    !claims_to_avoid ||
    !topics_not_to_force ||
    !unsupported_capabilities ||
    !goal_authority_boundaries ||
    !identity_people_boundaries
  ) {
    return null;
  }

  if (typeof boundaries.coach_history_is_not_style !== "string") return null;
  const coach_history_is_not_style = trimCollapse(
    boundaries.coach_history_is_not_style,
    MAX_MEDIUM
  );
  if (!coach_history_is_not_style) return null;

  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence,
    human_situation: {
      most_alive,
      direct_question_or_need,
      relevant_life_event,
      context_use,
      identity_use,
      person_use,
      selected_person,
      selected_person_reason,
    },
    truth_and_evidence: {
      latest_user_truth,
      outcome,
      evidence_note,
      evidence_strength,
      consistency_supported: truth.consistency_supported,
      proof_claims_allowed,
    },
    conversation_continuity: {
      already_acknowledged,
      answered_question,
      open_loop,
      stale_or_exhausted_topics,
      do_not_repeat,
    },
    goal_role_today: {
      canonical_goal,
      pending_goal,
      goal_alignment,
      role,
      note: goal_note,
    },
    coaching_direction: {
      primary_move,
      question_policy,
      action_guidance,
      pressure,
      proactive_decision,
    },
    boundaries: {
      claims_to_avoid,
      topics_not_to_force,
      unsupported_capabilities,
      goal_authority_boundaries,
      identity_people_boundaries,
      coach_history_is_not_style,
    },
  };
}

function formatUnknownish(value: string | null | "unknown"): string {
  if (value === "unknown") return "unknown";
  if (value == null) return "none";
  return value;
}

function formatStringList(value: string[] | "unknown"): string {
  if (value === "unknown") return "unknown";
  if (!value.length) return "none";
  return value.map((x) => `- ${x}`).join("\n");
}

/**
 * Plain-language Brief for a future final writer.
 * Not wired to production in Phase 2B. No hallway/slot jargon.
 */
export function renderMorningCoachingBriefPlainLanguage(
  brief: MorningCoachingBriefV1
): string {
  const hs = brief.human_situation;
  const te = brief.truth_and_evidence;
  const cc = brief.conversation_continuity;
  const gr = brief.goal_role_today;
  const cd = brief.coaching_direction;
  const bd = brief.boundaries;

  const selectedPersonLine = hs.selected_person
    ? `${hs.selected_person.name} (${hs.selected_person.relationship}); reason: ${formatUnknownish(hs.selected_person_reason)}`
    : "none";

  const answered =
    cc.answered_question === "unknown"
      ? "unknown"
      : cc.answered_question == null
        ? "none"
        : `Q: ${cc.answered_question.question} / A: ${cc.answered_question.answer}`;

  const pending =
    gr.pending_goal == null
      ? "none"
      : `${gr.pending_goal.candidate_text} (${gr.pending_goal.status})`;

  const proof = te.proof_claims_allowed;

  const lines = [
    "MORNING COACHING BRIEF",
    `Confidence: ${brief.confidence}`,
    "",
    "HUMAN SITUATION",
    `Most alive: ${hs.most_alive}`,
    `Direct question or need: ${formatUnknownish(hs.direct_question_or_need)}`,
    `Relevant life event: ${formatUnknownish(hs.relevant_life_event)}`,
    `Context use: ${hs.context_use}`,
    `Identity use: ${hs.identity_use}`,
    `Person use: ${hs.person_use}`,
    `Selected person: ${selectedPersonLine}`,
    "",
    "TRUTH AND EVIDENCE",
    `Latest user truth: ${formatUnknownish(te.latest_user_truth)}`,
    `Outcome: ${te.outcome}`,
    `Evidence note: ${te.evidence_note}`,
    `Evidence strength: ${te.evidence_strength}`,
    `Consistency supported: ${te.consistency_supported ? "yes" : "no"}`,
    `Proof claims allowed: completion=${proof.completion}; miss=${proof.miss}; partial=${proof.partial}; proof=${proof.proof}`,
    "",
    "CONVERSATION CONTINUITY",
    `Already acknowledged:\n${formatStringList(cc.already_acknowledged)}`,
    `Answered question: ${answered}`,
    `Open loop: ${formatUnknownish(cc.open_loop)}`,
    `Stale or exhausted topics:\n${formatStringList(cc.stale_or_exhausted_topics)}`,
    `Do not repeat:\n${formatStringList(cc.do_not_repeat)}`,
    "",
    "GOAL ROLE TODAY",
    `Canonical goal: ${gr.canonical_goal}`,
    `Pending goal: ${pending}`,
    `Goal alignment: ${gr.goal_alignment}`,
    `Role today: ${gr.role}`,
    `Note: ${gr.note}`,
    "",
    "COACHING DIRECTION",
    `Primary move: ${cd.primary_move}`,
    `Question policy: ${cd.question_policy}`,
    `Action guidance: ${cd.action_guidance}`,
    `Pressure: ${cd.pressure}`,
    `Proactive decision: ${cd.proactive_decision}`,
    "",
    "BOUNDARIES",
    `Claims to avoid:\n${formatStringList(bd.claims_to_avoid)}`,
    `Topics not to force:\n${formatStringList(bd.topics_not_to_force)}`,
    `Unsupported capabilities:\n${formatStringList(bd.unsupported_capabilities)}`,
    `Goal authority boundaries:\n${formatStringList(bd.goal_authority_boundaries)}`,
    `Identity and people boundaries:\n${formatStringList(bd.identity_people_boundaries)}`,
    `Coach history note: ${bd.coach_history_is_not_style}`,
  ];

  return lines.join("\n");
}

/** True when plain renderer text contains forbidden internal jargon. */
export function morningBriefPlainLanguageContainsForbiddenJargon(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_JARGON.some((token) => lower.includes(token));
}
