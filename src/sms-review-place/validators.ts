import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import { detectRelationshipRobotConsentMenuReasons } from "@/lib/relationship-robot-consent-menu";
import { detectTemporalWordingViolations } from "@/lib/sms-temporal-wording-validator";
import type { TemporalContractV1 } from "@/lib/sms-temporal-contract-v1";
import { validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { detectFinalVoiceBlockedReasons } from "@/lib/v3-sms-voice-ownership";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import { looksLikeRawJsonSms } from "@/sms-review-place/sms-output";
import type {
  SmsReviewHardFlag,
  SmsReviewRunRow,
  SmsReviewScenario,
  SmsReviewSoftReviewFields,
} from "@/sms-review-place/types";

const FAKE_PROOF_PATTERNS = [
  /\b(?:saved|logged|stored|recorded)\s+(?:this|that)\s+as\s+proof\b/i,
  /\b(?:saved|logged|stored)\s+(?:as\s+)?proof\b/i,
  /\blogged\s+that\s+as\s+proof\b/i,
  /\bi\s+saved\s+this\s+as\s+proof\b/i,
  /\bthat\s+proof\s+is\s+in\s+(?:your\s+)?victory\s*room\b/i,
];

const FAKE_VICTORY_PATTERNS = [
  /\b(?:logged|saved|added)\s+(?:that\s+)?(?:to\s+)?(?:your\s+)?victory\s*room\b/i,
  /\b(?:logged|saved)\s+that\s+as\s+proof\s+in\s+victory\s*room\b/i,
  /\badded\s+this\s+to\s+your\s+victory\s*room\b/i,
  /\bsaved\s+that\s+to\s+(?:your\s+)?victory\s*room\b/i,
  /\bvictory\s*room\s*—\s*great\b/i,
];

const GENERIC_MOMENTUM_RE =
  /\b(you'?ve got this|keep crushing|keep momentum|make today count|amazing!!)\b/i;
const COMPLETION_AS_WIN_RE =
  /\b(great job|nailed it|you did it|full win|completed)\b/i;

export type ValidatorInput = {
  scenario: SmsReviewScenario;
  lane: SmsReviewRunRow["lane"];
  laneBody: string;
  laneShouldSend: boolean;
  laneNoSendReason: string | null;
  finalBody: string;
  finalBodyRaw: string | null;
  finalShouldSend: boolean;
  finalSkipReason: string | null;
  blockedReasons: string[];
  latestUserReply: string | null;
  dailyFacts?: DailyV3RelationshipFacts | null;
  inboundFacts?: InboundV3RelationshipFacts | null;
  temporalContract?: TemporalContractV1 | null;
  laneSkipped: boolean;
  /** Mock lane bodies when lane no-sends but scenario tests coach copy. */
  supplementalCoachBodies?: string[];
  proofClaimSavedAllowed?: boolean;
};

function normalizeForRepeat(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coachQuestionRepeatedInBody(body: string, questions: string[]): boolean {
  const normBody = normalizeForRepeat(body);
  if (!normBody) return false;

  for (const q of questions) {
    if (!q?.trim()) continue;
    const normQ = normalizeForRepeat(q);
    if (normQ.length < 10) continue;
    if (normBody === normQ) return true;

    const overlapLen = Math.max(20, Math.floor(normQ.length * 0.85));
    const slice = normQ.slice(0, Math.min(normQ.length, overlapLen));
    if (slice.length >= 15 && normBody.includes(slice)) return true;
  }
  return false;
}

function collectInspectableTexts(input: ValidatorInput): string[] {
  const texts = new Set<string>();
  const primary = (input.finalShouldSend ? input.finalBody : input.laneBody).trim();
  if (primary) texts.add(primary);
  if (input.laneBody.trim()) texts.add(input.laneBody.trim());
  if (input.finalBody.trim()) texts.add(input.finalBody.trim());
  if (input.finalBodyRaw?.trim()) texts.add(input.finalBodyRaw.trim());

  for (const extra of input.supplementalCoachBodies ?? []) {
    if (extra?.trim()) texts.add(extra.trim());
  }

  return [...texts];
}

function textMatchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function evaluateHardFlags(input: ValidatorInput): SmsReviewHardFlag[] {
  const flags: SmsReviewHardFlag[] = [];

  if (input.laneSkipped) {
    return flags;
  }

  if (!input.laneShouldSend && !input.laneNoSendReason?.trim()) {
    flags.push("no_send_without_reason");
  }
  if (!input.finalShouldSend && input.laneShouldSend && !input.finalSkipReason?.trim()) {
    flags.push("no_send_without_reason");
  }

  const rawFinal = input.finalBodyRaw?.trim() ?? "";
  if (input.finalShouldSend && rawFinal && looksLikeRawJsonSms(rawFinal)) {
    flags.push("json_final_body");
  }

  const inspectTexts = collectInspectableTexts(input);
  const proofSavedAllowed = input.proofClaimSavedAllowed === true;

  for (const text of inspectTexts) {
    if (!proofSavedAllowed) {
      if (textMatchesAnyPattern(text, FAKE_PROOF_PATTERNS)) flags.push("fake_proof_claim");
      if (textMatchesAnyPattern(text, FAKE_VICTORY_PATTERNS)) flags.push("fake_victory_room_claim");
    }

    const temporal =
      input.temporalContract ??
      input.dailyFacts?.temporal_contract ??
      input.inboundFacts?.temporal_contract;
    if (temporal && text) {
      const violations = detectTemporalWordingViolations(text, {
        temporal_contract: temporal,
        referenced_events: temporal.referenced_events ?? [],
        mode: input.lane === "inbound" ? "inbound" : input.lane === "weekly" ? "weekly" : "daily",
      });
      if (violations.length > 0) flags.push("temporal_wording_violation");
    }

    const human = validateHumanVisibleSms(text, { channel: "normal_inbound", maxChars: 320 });
    if (!human.ok) {
      const reason = human.reason ?? "";
      if (reason.includes("robotic") || reason.includes("menu")) {
        flags.push("phone_tree_language");
      }
      if (reason.includes("generic") || reason.includes("momentum")) {
        flags.push("generic_momentum");
      }
    }

    if (GENERIC_MOMENTUM_RE.test(text)) flags.push("generic_momentum");

    const coachQs =
      input.dailyFacts?.thread_memory.last_5_coach_questions ??
      input.inboundFacts?.thread.memory_packet?.last_5_coach_questions ??
      [];
    if (coachQuestionRepeatedInBody(text, coachQs)) flags.push("repeated_question");

    const robot = detectRelationshipRobotConsentMenuReasons(text);
    if (robot.length > 0) flags.push("phone_tree_language");

    const blocked = [...input.blockedReasons, ...detectFinalVoiceBlockedReasons(text)];
    if (blocked.some((r) => r.includes("praise") || r.includes("warm"))) {
      flags.push("warm_praise_overuse");
    }

    if (input.dailyFacts?.accountability.pending_plan_proof?.active && COMPLETION_AS_WIN_RE.test(text)) {
      flags.push("praises_plan_as_proof");
    }

    const event =
      input.inboundFacts?.v2_accountability.deterministic_classifier_event ??
      (input.latestUserReply ? classifyV2InboundReply(input.latestUserReply).eventType : null);

    if (event === "user_partial" && /\b(full win|completed|nailed|you did it)\b/i.test(text)) {
      flags.push("partial_treated_as_win");
    }
    if (event === "user_no" && /\b(great job|nailed|you did it|completed the)\b/i.test(text)) {
      flags.push("missed_marked_completed");
    }

    if (
      input.scenario.id === "stale-goal" &&
      /\bmorning focus\b/i.test(text) &&
      !/\bwind-down|screens after 9\b/i.test(text)
    ) {
      flags.push("stale_goal");
    }
  }

  return [...new Set(flags)];
}

export function buildSoftReviewFields(): SmsReviewSoftReviewFields {
  return {
    feels_known: null,
    responds_to_latest: null,
    specific_to_current_goal: null,
    one_useful_next_move: null,
    warm_not_soft: null,
    serious_pat: null,
    not_robotic: null,
    not_generic: null,
    invites_reply: null,
    useful_after_miss: null,
    useful_after_win: null,
    useful_after_blocker: null,
  };
}

export type ScenarioPassInput = {
  hard_flags: SmsReviewHardFlag[];
  lane: SmsReviewRunRow["lane"];
  lane_skipped_reason: string | null;
  final_should_send: boolean;
  final_body: string;
  final_body_raw: string | null;
  lane_should_send: boolean;
  expect_clean: boolean;
  expect_hard_flags: SmsReviewHardFlag[];
};

function isHumanReadableSmsBody(body: string): boolean {
  const t = body.trim();
  if (t.length <= 10) return false;
  if (looksLikeRawJsonSms(t)) return false;
  return true;
}

export function scenarioPass(scenario: SmsReviewScenario, row: ScenarioPassInput): boolean {
  const { hard_flags: hardFlags } = row;

  if (row.lane === "classifier") {
    if (row.lane_skipped_reason !== "classifier_only") return false;
    if (scenario.expectHardFlags?.length) {
      return scenario.expectHardFlags.some((f) => hardFlags.includes(f));
    }
    return hardFlags.length === 0;
  }

  if (scenario.expectHardFlags?.length) {
    return scenario.expectHardFlags.some((f) => hardFlags.includes(f));
  }

  if (scenario.expectClean || row.expect_clean) {
    if (hardFlags.length > 0) return false;
    if (!row.lane_should_send) return false;
    if (!row.final_should_send) return false;
    if (!isHumanReadableSmsBody(row.final_body)) return false;
    if (row.final_body_raw && looksLikeRawJsonSms(row.final_body_raw)) return false;
    return true;
  }

  return hardFlags.length === 0;
}
