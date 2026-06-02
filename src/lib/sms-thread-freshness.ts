/**
 * Recent-thread freshness facts + lightweight stale-thread post-validate (Phase 1 + 2).
 * Server-owned heuristics only — no DB writes, no hard-coded final SMS.
 */

import type { InboundPriorMemoryRepeatNoSendContext } from "@/lib/inbound-completion-memory-repeat-escalation";
import {
  isInboundReportedCompletionForAntiGhost,
  type InboundMeaningFacts,
} from "@/lib/inbound-relationship-meaning";
import { looksLikeReportedCompletion } from "@/lib/pending-plan-proof";
import {
  buildRepairRelationshipSnapshotV1,
  DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS,
  serializeRepairSnapshotForOpenAI,
  trimRepairSnapshotToBudget,
} from "@/lib/sms-relationship-repair-snapshot-v1";
import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";

export type ThreadFreshnessTemporalFrame = "today" | "tomorrow" | "unclear";

export type ThreadFreshnessCompletedAction = {
  text: string;
  evidence: string;
};

export type ThreadFreshnessFacts = {
  completed_actions: ThreadFreshnessCompletedAction[];
  do_not_reask_topics: string[];
  active_temporal_frame: ThreadFreshnessTemporalFrame;
  temporal_anchors: string[];
  recent_user_plan_or_schedule: string | null;
  recent_user_completion: string | null;
};

export type ThreadFreshnessViolation = {
  reason: string;
  detail: string;
};

const COMPLETION_PHRASE_RE =
  /\b(did that|have done|already did|did it|got it done|made it happen|so did that|successful)\b/i;

const PLAN_SCHEDULE_RE =
  /\b(early afternoon|early morning|at lunch|before calling|text before|tomorrow|this morning|after work|after practice)\b/i;

const TEMPORAL_ANCHOR_PATTERNS: Array<{ anchor: string; re: RegExp }> = [
  { anchor: "lunch", re: /\blunch\b/i },
  { anchor: "early afternoon", re: /\bearly afternoon\b/i },
  { anchor: "early morning", re: /\bearly morning\b/i },
  { anchor: "tomorrow", re: /\btomorrow\b/i },
  { anchor: "today", re: /\btoday\b/i },
  { anchor: "morning", re: /\bmorning\b/i },
  { anchor: "stretch", re: /\bstretch(ing)?\b/i },
  { anchor: "calls", re: /\bcalls?\b/i },
];

function normSpace(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function parseTranscriptLines(lines: string[]): Array<{ role: "Coach" | "User"; text: string }> {
  const out: Array<{ role: "Coach" | "User"; text: string }> = [];
  for (const line of lines) {
    const coach = /^\s*Coach:\s*(.+)$/i.exec(line);
    if (coach?.[1]?.trim()) {
      out.push({ role: "Coach", text: coach[1].trim() });
      continue;
    }
    const user = /^\s*User:\s*(.+)$/i.exec(line);
    if (user?.[1]?.trim()) {
      out.push({ role: "User", text: user[1].trim() });
    }
  }
  return out;
}

function threadLinesFromArgs(args: {
  recentExactThreadText?: string | null;
  recentTranscriptLines?: string[];
}): Array<{ role: "Coach" | "User"; text: string }> {
  const exact = args.recentExactThreadText?.trim();
  if (exact) {
    return parseTranscriptLines(exact.split("\n").filter(Boolean));
  }
  return parseTranscriptLines(args.recentTranscriptLines ?? []);
}

function extractTemporalAnchors(texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    for (const { anchor, re } of TEMPORAL_ANCHOR_PATTERNS) {
      if (re.test(t)) found.add(anchor);
    }
  }
  return [...found];
}

function inferTopicFromCoachContext(coachTexts: string[], userEvidence: string): string | null {
  const ctx = coachTexts.join(" ").toLowerCase();
  const userLow = userEvidence.toLowerCase();
  if (/\blunch\b/.test(ctx) || /\blunch\b/.test(userLow)) {
    if (/\bstretch/.test(ctx)) return "five-minute stretch at lunch";
    return "lunch stretch";
  }
  if (/\bstretch/.test(ctx)) return "stretching";
  if (/\bcalls?\b/.test(ctx)) return "calls";
  return null;
}

function looksLikeConservativeCompletion(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 4) return false;
  if (looksLikeReportedCompletion(t)) return true;
  if (COMPLETION_PHRASE_RE.test(t)) return true;
  if (/^\s*successful\s*$/i.test(t)) return true;
  return false;
}

function looksLikePlanOrSchedule(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (PLAN_SCHEDULE_RE.test(t)) return true;
  if (/\b(i will|i'll|plan to|going to|text before)\b/i.test(t)) return true;
  return false;
}

function inferTemporalFrame(lines: Array<{ role: "Coach" | "User"; text: string }>): ThreadFreshnessTemporalFrame {
  const recent = lines.slice(-8);
  let coachTomorrow = false;
  let userToday = false;
  let userTomorrow = false;
  let coachToday = false;

  for (const { role, text } of recent) {
    const low = text.toLowerCase();
    if (role === "Coach") {
      if (/\btomorrow\b/.test(low)) coachTomorrow = true;
      if (/\btoday\b/.test(low) && !/\btomorrow\b/.test(low)) coachToday = true;
    } else {
      if (/\btoday\b/.test(low) && !/\btomorrow\b/.test(low)) userToday = true;
      if (/\btomorrow\b/.test(low)) userTomorrow = true;
      if (/\bearly afternoon\b/.test(low) || /\bearly morning\b/.test(low)) {
        if (coachTomorrow) userTomorrow = true;
      }
    }
  }

  if (userToday && !coachTomorrow) return "today";
  if (coachTomorrow || userTomorrow) return "tomorrow";
  if (coachToday && !userTomorrow) return "today";
  return "unclear";
}

export function deriveRecentThreadFreshnessFacts(args: {
  recentExactThreadText?: string | null;
  recentTranscriptLines?: string[];
  last5UserAnswers?: string[];
  latestUserInbound?: string | null;
  latestCoachQuestion?: string | null;
  accountabilityDayKey?: string | null;
}): ThreadFreshnessFacts {
  const lines = threadLinesFromArgs(args);
  const userLines = lines.filter((l) => l.role === "User").map((l) => l.text);
  const coachLines = lines.filter((l) => l.role === "Coach").map((l) => l.text);

  if (args.last5UserAnswers?.length) {
    for (const a of args.last5UserAnswers) {
      const t = a?.trim();
      if (t && !userLines.includes(t)) userLines.push(t);
    }
  }
  if (args.latestUserInbound?.trim() && !userLines.includes(args.latestUserInbound.trim())) {
    userLines.push(args.latestUserInbound.trim());
  }

  const completed_actions: ThreadFreshnessCompletedAction[] = [];
  const do_not_reask_topics: string[] = [];
  let recent_user_completion: string | null = null;
  let recent_user_plan_or_schedule: string | null = null;

  for (let i = userLines.length - 1; i >= 0; i--) {
    const text = userLines[i]!;
    if (!looksLikeConservativeCompletion(text)) continue;
    const topic =
      inferTopicFromCoachContext(coachLines.slice(-3), text) ??
      (/\blunch\b/i.test(text) ? "lunch stretch" : null);
    const actionText = topic ?? text.slice(0, 80);
    completed_actions.push({ text: actionText, evidence: text.slice(0, 220) });
    if (topic) do_not_reask_topics.push(topic);
    if (/\blunch\b/i.test(text) && /\bstretch/.test(coachLines.join(" "))) {
      do_not_reask_topics.push("lunch stretch");
    }
    recent_user_completion = text.slice(0, 220);
    break;
  }

  for (let i = userLines.length - 1; i >= 0; i--) {
    const text = userLines[i]!;
    if (!looksLikePlanOrSchedule(text)) continue;
    let score = 1;
    if (/\bearly (morning|afternoon)\b/i.test(text)) score += 3;
    if (/\btomorrow\b/i.test(text)) score += 2;
    if (/\bat lunch\b/i.test(text)) score += 2;
    if (!recent_user_plan_or_schedule || score > 0) {
      recent_user_plan_or_schedule = text.slice(0, 220);
      if (score >= 3) break;
    }
  }

  const uniqueTopics = [...new Set(do_not_reask_topics.map((t) => t.trim()).filter(Boolean))];
  const temporal_anchors = extractTemporalAnchors([
    ...userLines.slice(-4),
    ...coachLines.slice(-4),
    args.latestCoachQuestion ?? "",
  ]);
  let active_temporal_frame = inferTemporalFrame(lines);
  if (active_temporal_frame === "unclear" && temporal_anchors.includes("tomorrow")) {
    active_temporal_frame = "tomorrow";
  }

  return {
    completed_actions,
    do_not_reask_topics: uniqueTopics.slice(0, 8),
    active_temporal_frame,
    temporal_anchors: temporal_anchors.slice(0, 10),
    recent_user_plan_or_schedule,
    recent_user_completion,
  };
}

export function buildThreadFreshnessPromptGuidance(): string {
  return `
THREAD_FRESHNESS (read thread_freshness in facts JSON — beats summaries and generic commitment context):
- Recent exact thread + thread_freshness beat coaching_memory_snippet and stale summaries when they conflict.
- If thread_freshness.completed_actions lists an action the user already did, do NOT ask whether they will do it again.
- If thread_freshness.do_not_reask_topics contains a topic, do NOT re-ask that same topic in different words.
- If thread_freshness.active_temporal_frame is tomorrow, do NOT say "today" unless the user explicitly moved back to today in the recent thread.
- If active_temporal_frame is today, do NOT shift to tomorrow unless the user introduced tomorrow.
- Distinguish completed action vs plan vs intention — do not praise a plan as proof.
- Continue from the latest user answer; do not restart an already-closed loop.`;
}

function topicWords(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

export function bodyReasksFreshnessTopic(body: string, topic: string): boolean {
  const questionSegments = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /\?/.test(s));
  if (!questionSegments.length) return false;

  const tn = topic.toLowerCase().trim();
  const words = topicWords(topic);
  if (!words.length && tn.length < 8) return false;

  for (const segment of questionSegments) {
    const bn = segment.toLowerCase();
    if (tn.length >= 8 && bn.includes(tn)) return true;
    if (!words.length) continue;
    let overlap = 0;
    for (const w of words) if (bn.includes(w)) overlap += 1;
    if (overlap >= Math.min(2, words.length)) return true;
  }
  return false;
}

export function detectThreadFreshnessViolations(
  body: string,
  freshness: ThreadFreshnessFacts | null | undefined
): ThreadFreshnessViolation | null {
  if (!freshness) return null;
  const t = body.trim();
  if (!t) return null;

  for (const topic of freshness.do_not_reask_topics) {
    if (bodyReasksFreshnessTopic(t, topic)) {
      return {
        reason: "reasked_do_not_reask_topic",
        detail: `Body re-asks topic "${topic.slice(0, 80)}" already addressed in recent thread.`,
      };
    }
  }

  for (const action of freshness.completed_actions) {
    if (bodyReasksFreshnessTopic(t, action.text)) {
      return {
        reason: "reasked_completed_action",
        detail: `Body re-asks completed action "${action.text.slice(0, 80)}" (evidence: "${action.evidence.slice(0, 100)}").`,
      };
    }
  }

  const frame = freshness.active_temporal_frame;
  const hasToday = /\b(for )?today\b/i.test(t);
  const hasTomorrow = /\btomorrow\b/i.test(t);

  if (frame === "tomorrow" && hasToday && !hasTomorrow) {
    return {
      reason: "temporal_today_when_thread_is_tomorrow",
      detail: 'Body uses "today" but recent thread temporal frame is tomorrow.',
    };
  }

  if (frame === "today" && hasTomorrow && !hasToday && !freshness.temporal_anchors.includes("tomorrow")) {
    return {
      reason: "temporal_tomorrow_when_thread_is_today",
      detail: 'Body uses "tomorrow" but recent thread temporal frame is today.',
    };
  }

  if (/^it sounds like\b/i.test(t) && /\?/.test(t)) {
    const contradiction =
      (frame === "tomorrow" && hasToday) ||
      freshness.do_not_reask_topics.some((topic) => bodyReasksFreshnessTopic(t, topic)) ||
      freshness.completed_actions.some((a) => bodyReasksFreshnessTopic(t, a.text));
    if (contradiction) {
      return {
        reason: "generic_mirror_with_thread_contradiction",
        detail: 'Body opens with "It sounds like..." while contradicting recent thread freshness.',
      };
    }
  }

  return null;
}

function extractInboundFreshnessRepairEscalation(factsJson: unknown): {
  priorNoSend: InboundPriorMemoryRepeatNoSendContext | null;
  latestInboundText: string | null;
  inboundMeaning: InboundMeaningFacts | null;
} {
  if (factsJson == null || typeof factsJson !== "object") {
    return { priorNoSend: null, latestInboundText: null, inboundMeaning: null };
  }
  const root = factsJson as Record<string, unknown>;
  const thread = root.thread;
  const latestInboundText =
    thread != null && typeof thread === "object"
      ? typeof (thread as Record<string, unknown>).coalesced_inbound_text === "string"
        ? ((thread as Record<string, unknown>).coalesced_inbound_text as string).trim() || null
        : null
      : null;
  const inboundMeaning =
    root.inbound_meaning != null && typeof root.inbound_meaning === "object"
      ? (root.inbound_meaning as InboundMeaningFacts)
      : null;
  const ctx = root.memory_repeat_escalation;
  if (ctx != null && typeof ctx === "object" && (ctx as InboundPriorMemoryRepeatNoSendContext).escalation_attempt === true) {
    return { priorNoSend: ctx as InboundPriorMemoryRepeatNoSendContext, latestInboundText, inboundMeaning };
  }
  return { priorNoSend: null, latestInboundText, inboundMeaning };
}

export function buildThreadFreshnessRepairInstruction(args: {
  violation: ThreadFreshnessViolation;
  freshness: ThreadFreshnessFacts;
  originalBody: string;
  priorNoSend?: InboundPriorMemoryRepeatNoSendContext | null;
  latestInboundText?: string | null;
  inboundMeaning?: InboundMeaningFacts | null;
}): string {
  const parts = [
    "THREAD_FRESHNESS_REPAIR: Your draft contradicts the recent SMS thread.",
    `Violation: ${args.violation.reason} — ${args.violation.detail}`,
    `Blocked draft (do not paraphrase): "${args.originalBody.slice(0, 220)}".`,
    `Active temporal frame: ${args.freshness.active_temporal_frame}.`,
  ];
  if (args.freshness.completed_actions.length) {
    parts.push(
      `User already completed: ${args.freshness.completed_actions
        .slice(0, 2)
        .map((a) => `"${a.text}" (${a.evidence.slice(0, 80)})`)
        .join("; ")}.`
    );
  }
  if (args.freshness.do_not_reask_topics.length) {
    parts.push(`Do not re-ask topics: ${args.freshness.do_not_reask_topics.join(", ")}.`);
  }
  if (args.freshness.recent_user_plan_or_schedule) {
    parts.push(
      `Recent user plan/schedule: "${args.freshness.recent_user_plan_or_schedule.slice(0, 160)}".`
    );
  }
  const reportedCompletion =
    isInboundReportedCompletionForAntiGhost(args.inboundMeaning) ||
    (args.inboundMeaning == null &&
      args.latestInboundText?.trim() &&
      /\b(did|done|completed|got it done|finished)\b/i.test(args.latestInboundText));
  if (args.latestInboundText?.trim() && reportedCompletion) {
    parts.push(
      `Latest inbound completion/proof (ground truth): "${args.latestInboundText.trim().slice(0, 220)}".`,
      "Acknowledge the completed behavior truthfully — do not re-ask whether they did it.",
      "Move to one honest next step. Do NOT mention Victory Room unless proof permission explicitly allows it."
    );
    if (args.inboundMeaning?.persistence_decision === "ack_only") {
      parts.push(
        "Do NOT claim today's accountability is complete or that proof was saved for today — past completion only."
      );
    }
  } else if (args.inboundMeaning?.relationship_meaning === "miss") {
    parts.push("User reported a miss — do not congratulate; help recover with one honest next step.");
  } else if (args.inboundMeaning?.relationship_meaning === "plan_made") {
    parts.push("User made a plan — do not treat as proof; help choose the first concrete move.");
  } else if (args.inboundMeaning?.relationship_meaning === "partial_attempt") {
    parts.push("Partial attempt — identify blocker or next move; do not score as full completion.");
  }
  if (args.priorNoSend?.escalation_attempt === true) {
    parts.push(
      "PRIOR_NO_SEND_ESCALATION: The same user message was recently ghosted by thread_memory_repeat_blocked.",
      `Prior no-send at ${args.priorNoSend.prior_cancelled_at}.`,
      "You MUST send a non-repetitive proof-ack reply now — do not re-ask the completed behavior."
    );
    if (args.priorNoSend.repeated_question_preview?.trim()) {
      parts.push(
        `Do not repeat: "${args.priorNoSend.repeated_question_preview.trim().slice(0, 180)}".`
      );
    }
  }
  parts.push(
    "Write ONE short SMS that moves forward without contradicting the thread. Change the coaching move — do not paraphrase the blocked draft.",
    "Return strict JSON with keys: body, safety_notes."
  );
  return parts.join(" ");
}

export type ThreadFreshnessGuardResult =
  | { outcome: "ok"; body: string; metadata: Record<string, unknown> }
  | { outcome: "no_send"; noSendReason: string; metadata: Record<string, unknown> };

export async function applyThreadFreshnessGuard(args: {
  routeKind: "inbound" | "daily";
  routePurpose: string;
  body: string;
  factsJson: unknown;
  freshness: ThreadFreshnessFacts | null | undefined;
  enabled: boolean;
}): Promise<ThreadFreshnessGuardResult> {
  const baseMeta = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    thread_freshness_used: Boolean(args.freshness),
    thread_freshness_active_temporal_frame: args.freshness?.active_temporal_frame ?? null,
    thread_freshness_completed_action_count: args.freshness?.completed_actions.length ?? 0,
    thread_freshness_violation_detected: false,
    thread_freshness_violation_reason: null,
    thread_freshness_repair_attempted: false,
    thread_freshness_repair_succeeded: false,
    ...extra,
  });

  if (!args.enabled || !args.freshness) {
    return { outcome: "ok", body: args.body, metadata: baseMeta() };
  }

  const original = args.body.trim();
  let violation = detectThreadFreshnessViolations(original, args.freshness);
  if (!violation) {
    return { outcome: "ok", body: original, metadata: baseMeta() };
  }

  const blockedReasons = [`thread_freshness_${violation.reason}`];
  const builtSnapshot = buildRepairRelationshipSnapshotV1({
    repairKind: "thread_freshness",
    routeKind: args.routeKind,
    routePurpose: args.routePurpose,
    blockedBody: original,
    blockedReasons,
    laneFacts: args.factsJson,
    freshness: args.freshness,
    freshnessViolation: violation,
  });
  const { snapshot: repairSnapshot, truncated: snapshotTruncated } = trimRepairSnapshotToBudget(
    builtSnapshot,
    DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS
  );
  const { meta: snapshotMeta } = serializeRepairSnapshotForOpenAI(repairSnapshot);

  const { priorNoSend, latestInboundText, inboundMeaning } =
    extractInboundFreshnessRepairEscalation(args.factsJson);

  const repairOut = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: args.routeKind,
    routePurpose: args.routePurpose,
    originalBody: original,
    blockedReasons,
    repairSnapshot,
    systemInstruction: buildThreadFreshnessRepairInstruction({
      violation,
      freshness: args.freshness,
      originalBody: original,
      priorNoSend,
      latestInboundText,
      inboundMeaning,
    }),
  });

  if (!repairOut?.body?.trim()) {
    return {
      outcome: "no_send",
      noSendReason: "thread_freshness_stale_blocked",
      metadata: baseMeta({
        thread_freshness_violation_detected: true,
        thread_freshness_violation_reason: violation.reason,
        thread_freshness_repair_attempted: true,
        thread_freshness_repair_succeeded: false,
        ...snapshotMeta,
        repair_snapshot_truncated: snapshotTruncated || snapshotMeta.repair_snapshot_truncated,
      }),
    };
  }

  const repaired = repairOut.body.replace(/^["']|["']$/g, "").trim();
  const afterViolation = detectThreadFreshnessViolations(repaired, args.freshness);
  if (afterViolation) {
    return {
      outcome: "no_send",
      noSendReason: "thread_freshness_stale_blocked",
      metadata: baseMeta({
        thread_freshness_violation_detected: true,
        thread_freshness_violation_reason: afterViolation.reason,
        thread_freshness_repair_attempted: true,
        thread_freshness_repair_succeeded: false,
        thread_freshness_repaired_body_preview:
          repaired.length > 220 ? `${repaired.slice(0, 219)}…` : repaired,
        ...snapshotMeta,
        repair_snapshot_truncated: snapshotTruncated || snapshotMeta.repair_snapshot_truncated,
      }),
    };
  }

  return {
    outcome: "ok",
    body: repaired,
    metadata: baseMeta({
      thread_freshness_violation_detected: true,
      thread_freshness_violation_reason: violation.reason,
      thread_freshness_repair_attempted: true,
      thread_freshness_repair_succeeded: true,
      thread_freshness_repaired_body_preview:
        repaired.length > 220 ? `${repaired.slice(0, 219)}…` : repaired,
      ...snapshotMeta,
      repair_snapshot_truncated: snapshotTruncated || snapshotMeta.repair_snapshot_truncated,
    }),
  };
}
