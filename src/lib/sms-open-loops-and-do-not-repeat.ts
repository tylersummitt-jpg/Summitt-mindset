/**
 * Unified read-only open_loops_and_do_not_repeat builder for Relationship Snapshot v2.
 * Writer guidance only — does not route, mutate state, or authorize sends.
 */

import type { ActivePendingState, ActivePendingStateItemKind } from "@/lib/sms-active-pending-state";
import type { RelationshipMemory7dData } from "@/lib/sms-relationship-memory-7d";
import type {
  RelationshipPacketSection,
  RelationshipPacketStructuredRecentTruth,
} from "@/lib/sms-relationship-packet-v1";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";

export type OpenLoopsRecentExactThreadInput = {
  messages: RecentExactThread72hMessage[];
};

export type OpenLoopsRouteContextInput = {
  surface?: string | null;
  route_purpose?: string | null;
  route_kind?: string | null;
};
import { isNearExactDuplicateSms, normalizeSmsMemoryRepeatText } from "@/lib/sms-memory-anti-repeat";

export const OPEN_LOOPS_AND_DO_NOT_REPEAT_AUTHORITY = "structured_recent_truth" as const;

export const MAX_OPEN_LOOPS = 8;
export const MAX_SATISFIED_ASKS = 8;
export const MAX_DO_NOT_REPEAT_ASKS = 10;
export const MAX_RECENT_UNANSWERED_COACH_QUESTIONS = 5;
export const MAX_DO_NOT_REPEAT_PHRASES = 8;

export type OpenLoopKind =
  | ActivePendingStateItemKind
  | "open_question"
  | "other";

export type OpenLoopSource =
  | "active_pending_state"
  | "turn_understanding"
  | "daily_satisfied_ask_context"
  | "relationship_memory_7d"
  | "recent_exact_thread_72h"
  | "route_facts";

export type SatisfiedAskSource =
  | "turn_understanding"
  | "daily_satisfied_ask_context"
  | "relationship_memory_7d"
  | "recent_exact_thread_72h";

export type OpenLoopItem = {
  kind: OpenLoopKind;
  summary: string;
  evidence_preview?: string | null;
  source: OpenLoopSource;
  active: boolean;
  must_not_claim_resolved?: boolean;
  route_relevance?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
};

export type SatisfiedAskItem = {
  ask_text: string;
  answer_preview?: string | null;
  satisfied_at?: string | null;
  source: SatisfiedAskSource;
  do_not_repeat: boolean;
};

export type PendingPlanProofSection = {
  active: boolean;
  summary: string;
  evidence_preview?: string | null;
};

export type OpenLoopsAndDoNotRepeatData = {
  open_loops: OpenLoopItem[];
  satisfied_asks: SatisfiedAskItem[];
  do_not_repeat_asks: string[];
  do_not_repeat_phrases: string[];
  recent_unanswered_coach_questions: string[];
  pending_plan_proof?: PendingPlanProofSection | null;
  route_relevance?: string | null;
};

export type OpenLoopsAndDoNotRepeatSection = RelationshipPacketSection<OpenLoopsAndDoNotRepeatData>;

export type OpenLoopsAndDoNotRepeatBuildMeta = {
  open_loop_count: number;
  satisfied_ask_count: number;
  do_not_repeat_ask_count: number;
  recent_unanswered_question_count: number;
  open_loops_sources: string[];
  open_loops_truncated: boolean;
};

type ScoredOpenLoop = OpenLoopItem & { _priority: number; _trimProtected: boolean };

function normAskKey(text: string): string {
  return normalizeSmsMemoryRepeatText(text)
    .replace(/\?/g, "")
    .replace(/\bthe\b/g, " ")
    .replace(/\ba\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateAsk(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  const ak = normAskKey(a);
  const bk = normAskKey(b);
  if (ak && bk && ak === bk) return true;
  return isNearExactDuplicateSms(a, b);
}

function askMatchesAny(text: string, candidates: string[]): boolean {
  return candidates.some((c) => isNearDuplicateAsk(text, c));
}

function pushUniqueAsk(out: string[], seen: Set<string>, text: string, minLen = 8): boolean {
  const t = text.trim();
  if (t.length < minLen) return false;
  const key = normAskKey(t);
  if (!key) return false;
  if (seen.has(key)) return false;
  for (const existing of seen) {
    if (isNearDuplicateAsk(existing, t)) return false;
  }
  seen.add(key);
  out.push(t.slice(0, 160));
  return true;
}

function dedupeAskList(asks: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ask of asks) {
    pushUniqueAsk(out, seen, ask);
  }
  return out;
}

function extractQuestionClause(coachMessage: string): string | null {
  const msg = coachMessage.trim();
  if (!msg) return null;
  const parts = msg.match(/[^?!.]+[?]/g);
  if (parts?.length) return parts[parts.length - 1]!.trim();
  if (/\?/.test(msg) || /\b(what|when|which|who|how|tell me|give me)\b/i.test(msg)) return msg;
  return null;
}

function isSubstantiveUserMessage(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return false;
  if (/^(stop|start|help|unstop|cancel)$/i.test(t) && t.length <= 12) return false;
  if (/^👍[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*$/u.test(t)) return false;
  const core = t.toLowerCase().replace(/[.!?…]+$/g, "");
  if (["ok", "okay", "k", "got it", "gotit", "sounds good", "👍"].includes(core)) return false;
  return t.length >= 8 || t.split(/\s+/).filter(Boolean).length >= 2;
}

/** Visible/sent coach SMS only — excludes preview, skipped, cancelled, and unknown statuses. */
export function isDeliveredCoachQuestionMessage(m: RecentExactThread72hMessage): boolean {
  if (m.role !== "coach") return false;
  if (!m.body.trim()) return false;
  if (m.is_exact_body === false) return false;
  // recent_exact_thread_72h marks truly sent coach bodies as "sent" only.
  return m.delivery_status === "sent";
}

function resolveRouteRelevance(route?: OpenLoopsRouteContextInput | null): string | null {
  if (!route) return null;
  return route.route_purpose?.trim() || route.route_kind?.trim() || route.surface || null;
}

function mapPendingKindToOpenLoopKind(kind: ActivePendingStateItemKind): OpenLoopKind {
  return kind;
}

function openLoopsFromActivePendingState(
  state: ActivePendingState,
  routeRelevance: string | null
): ScoredOpenLoop[] {
  return state.items
    .filter((item) => item.active)
    .map((item) => ({
      kind: mapPendingKindToOpenLoopKind(item.kind),
      summary: item.summary,
      evidence_preview: item.evidence_preview?.slice(0, 120) ?? null,
      source: "active_pending_state" as const,
      active: true,
      must_not_claim_resolved: item.must_not_claim_resolved,
      route_relevance: routeRelevance,
      created_at: item.created_at ?? null,
      expires_at: item.expires_at ?? null,
      _priority: 100,
      _trimProtected: true,
    }));
}

function openLoopFromStructuredTruth(
  truth: RelationshipPacketStructuredRecentTruth,
  routeRelevance: string | null,
  existingKeys: string[]
): ScoredOpenLoop | null {
  if (!truth.open_question_pending || !truth.latest_open_question?.trim()) return null;
  const q = truth.latest_open_question.trim();
  if (askMatchesAny(q, existingKeys)) return null;
  return {
    kind: "open_question",
    summary: "Open coach question awaiting user answer.",
    evidence_preview: q.slice(0, 160),
    source: "route_facts",
    active: true,
    must_not_claim_resolved: true,
    route_relevance: routeRelevance,
    created_at: null,
    expires_at: null,
    _priority: 75,
    _trimProtected: false,
  };
}

function openLoopsFromMemory7d(
  memory: RelationshipMemory7dData,
  staleAskKeys: string[],
  routeRelevance: string | null
): ScoredOpenLoop[] {
  const out: ScoredOpenLoop[] = [];
  for (const loop of memory.open_loops) {
    const q = loop.question_or_plan?.trim();
    if (!q || askMatchesAny(q, staleAskKeys)) continue;
    out.push({
      kind: "open_question",
      summary: "Background open loop from 7d memory.",
      evidence_preview: q.slice(0, 120),
      source: "relationship_memory_7d",
      active: true,
      must_not_claim_resolved: true,
      route_relevance: routeRelevance,
      created_at: null,
      expires_at: null,
      _priority: 20,
      _trimProtected: false,
    });
  }
  return out;
}

function satisfiedAsksFromTurnUnderstanding(
  truth: RelationshipPacketStructuredRecentTruth
): SatisfiedAskItem[] {
  const tu = truth.turn_understanding;
  if (!tu) return [];
  const out: SatisfiedAskItem[] = [];
  const satisfied = tu.last_ask_satisfied === "yes";
  for (const ask of tu.do_not_repeat_asks ?? []) {
    const t = ask.trim();
    if (!t) continue;
    out.push({
      ask_text: t.slice(0, 160),
      answer_preview: tu.evidence_quotes?.[0]?.slice(0, 120) ?? null,
      satisfied_at: null,
      source: "turn_understanding",
      do_not_repeat: true,
    });
  }
  if (satisfied && out.length === 0 && truth.latest_open_question?.trim()) {
    out.push({
      ask_text: truth.latest_open_question.trim().slice(0, 160),
      answer_preview: truth.latest_answer_after_open_question?.slice(0, 120) ?? tu.evidence_quotes?.[0]?.slice(0, 120) ?? null,
      satisfied_at: null,
      source: "turn_understanding",
      do_not_repeat: true,
    });
  }
  return out;
}

function satisfiedAsksFromDailyContext(
  truth: RelationshipPacketStructuredRecentTruth
): SatisfiedAskItem[] {
  const sac = truth.daily_satisfied_ask_context;
  if (!sac?.has_satisfied_recent_ask) return [];
  const out: SatisfiedAskItem[] = [];
  for (const ask of sac.do_not_repeat_asks ?? []) {
    const t = ask.trim();
    if (!t) continue;
    out.push({
      ask_text: t.slice(0, 160),
      answer_preview: sac.evidence_preview?.slice(0, 120) ?? null,
      satisfied_at: sac.occurred_at,
      source: "daily_satisfied_ask_context",
      do_not_repeat: true,
    });
  }
  return out;
}

function satisfiedAsksFromMemory7d(memory: RelationshipMemory7dData): SatisfiedAskItem[] {
  return memory.direct_answer_history.map((pair) => ({
    ask_text: pair.coach_question.slice(0, 160),
    answer_preview: pair.user_answer.slice(0, 120),
    satisfied_at: pair.at,
    source: "relationship_memory_7d" as const,
    do_not_repeat: true,
  }));
}

function satisfiedAskFromStructuredAnswer(
  truth: RelationshipPacketStructuredRecentTruth
): SatisfiedAskItem | null {
  if (truth.open_question_pending === true) return null;
  const q = truth.latest_open_question?.trim();
  const a = truth.latest_answer_after_open_question?.trim();
  if (!q || !a) return null;
  return {
    ask_text: q.slice(0, 160),
    answer_preview: a.slice(0, 120),
    satisfied_at: null,
    source: "recent_exact_thread_72h",
    do_not_repeat: true,
  };
}

function mergeSatisfiedAsks(items: SatisfiedAskItem[]): SatisfiedAskItem[] {
  const out: SatisfiedAskItem[] = [];
  const sourcePriority: Record<SatisfiedAskSource, number> = {
    turn_understanding: 100,
    daily_satisfied_ask_context: 90,
    recent_exact_thread_72h: 80,
    relationship_memory_7d: 20,
  };
  const sorted = [...items].sort((a, b) => sourcePriority[b.source] - sourcePriority[a.source]);
  for (const item of sorted) {
    if (out.some((existing) => isNearDuplicateAsk(existing.ask_text, item.ask_text))) continue;
    out.push(item);
  }
  return out.slice(0, MAX_SATISFIED_ASKS);
}

function collectDoNotRepeatAsks(args: {
  truth: RelationshipPacketStructuredRecentTruth;
  satisfiedAsks: SatisfiedAskItem[];
}): { asks: string[]; protectedKeys: Set<string> } {
  const protectedKeys = new Set<string>();
  const out: string[] = [];
  const seen = new Set<string>();

  const tuAsks = args.truth.turn_understanding?.do_not_repeat_asks ?? [];
  for (const ask of tuAsks) {
    if (pushUniqueAsk(out, seen, ask)) {
      protectedKeys.add(normAskKey(ask));
    }
  }

  const dailyAsks = args.truth.daily_satisfied_ask_context?.do_not_repeat_asks ?? [];
  for (const ask of dailyAsks) {
    pushUniqueAsk(out, seen, ask);
  }

  for (const sa of args.satisfiedAsks) {
    if (sa.do_not_repeat) pushUniqueAsk(out, seen, sa.ask_text);
  }

  return { asks: dedupeAskList(out), protectedKeys };
}

function trimDoNotRepeatAsks(asks: string[], protectedKeys: Set<string>): string[] {
  if (asks.length <= MAX_DO_NOT_REPEAT_ASKS) return asks;
  const protectedAsks = asks.filter((a) => protectedKeys.has(normAskKey(a)));
  const rest = asks.filter((a) => !protectedKeys.has(normAskKey(a)));
  return [...protectedAsks, ...rest].slice(0, MAX_DO_NOT_REPEAT_ASKS);
}

function trimOpenLoops(loops: ScoredOpenLoop[]): { loops: OpenLoopItem[]; truncated: boolean } {
  if (loops.length <= MAX_OPEN_LOOPS) {
    return { loops: loops.map(stripScore), truncated: false };
  }
  const protectedActive = loops.filter((l) => l._trimProtected && l.active);
  const rest = loops
    .filter((l) => !(l._trimProtected && l.active))
    .sort((a, b) => b._priority - a._priority);
  const merged = [...protectedActive, ...rest].slice(0, MAX_OPEN_LOOPS);
  return { loops: merged.map(stripScore), truncated: loops.length > merged.length };
}

function stripScore(loop: ScoredOpenLoop): OpenLoopItem {
  const { _priority: _p, _trimProtected: _t, ...item } = loop;
  void _p;
  void _t;
  return item;
}

function dedupeOpenLoops(loops: ScoredOpenLoop[]): ScoredOpenLoop[] {
  const out: ScoredOpenLoop[] = [];
  const seenKeys = new Set<string>();
  for (const loop of loops.sort((a, b) => b._priority - a._priority)) {
    const key = normAskKey(loop.evidence_preview ?? loop.summary);
    if (seenKeys.has(key)) continue;
    if (out.some((existing) => {
      const existingKey = normAskKey(existing.evidence_preview ?? existing.summary);
      return existingKey === key;
    })) {
      continue;
    }
    seenKeys.add(key);
    out.push(loop);
  }
  return out;
}

function deliveredCoachQuestionTexts(messages: RecentExactThread72hMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (!isDeliveredCoachQuestionMessage(m)) continue;
    const q = extractQuestionClause(m.body);
    if (q) out.add(normAskKey(q));
    out.add(normAskKey(m.body));
  }
  return out;
}

function coachQuestionWasDelivered(
  question: string,
  deliveredKeys: Set<string> | null
): boolean {
  if (!deliveredKeys || deliveredKeys.size === 0) return false;
  const key = normAskKey(question);
  if (deliveredKeys.has(key)) return true;
  for (const dk of deliveredKeys) {
    if (isNearDuplicateAsk(dk, question)) return true;
  }
  return false;
}

function extractUnansweredFromThread(
  messages: RecentExactThread72hMessage[],
  blockedAsks: string[]
): string[] {
  const unanswered: string[] = [];
  const seen = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!isDeliveredCoachQuestionMessage(m)) continue;
    const q = extractQuestionClause(m.body);
    if (!q || askMatchesAny(q, blockedAsks)) continue;

    let answered = false;
    for (let j = i + 1; j < messages.length; j++) {
      const follow = messages[j]!;
      if (follow.role === "user" && isSubstantiveUserMessage(follow.body)) {
        answered = true;
        break;
      }
    }
    if (answered) continue;
    if (pushUniqueAsk(unanswered, seen, q)) {
      if (unanswered.length >= MAX_RECENT_UNANSWERED_COACH_QUESTIONS) break;
    }
  }
  return unanswered;
}

function recentUnansweredCoachQuestions(args: {
  truth: RelationshipPacketStructuredRecentTruth;
  thread?: OpenLoopsRecentExactThreadInput | null;
  blockedAsks: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const deliveredKeys = args.thread?.messages?.length
    ? deliveredCoachQuestionTexts(args.thread.messages)
    : null;

  if (args.thread?.messages?.length) {
    for (const q of extractUnansweredFromThread(args.thread.messages, args.blockedAsks)) {
      pushUniqueAsk(out, seen, q);
    }
  }

  if (args.truth.open_question_pending && args.truth.latest_open_question?.trim()) {
    const q = args.truth.latest_open_question.trim();
    if (coachQuestionWasDelivered(q, deliveredKeys)) {
      pushUniqueAsk(out, seen, q);
    }
  }

  for (const q of args.truth.last_5_coach_questions ?? []) {
    if (askMatchesAny(q, args.blockedAsks)) continue;
    if (!coachQuestionWasDelivered(q, deliveredKeys)) continue;
    if (args.truth.open_question_pending === false && args.truth.latest_answer_after_open_question) {
      if (isNearDuplicateAsk(q, args.truth.latest_open_question ?? "")) continue;
    }
    pushUniqueAsk(out, seen, q);
    if (out.length >= MAX_RECENT_UNANSWERED_COACH_QUESTIONS) break;
  }

  return out
    .filter((q) => !askMatchesAny(q, args.blockedAsks))
    .slice(0, MAX_RECENT_UNANSWERED_COACH_QUESTIONS);
}

function resolvePendingPlanProof(activePending: ActivePendingState): PendingPlanProofSection | null {
  const item = activePending.items.find((i) => i.kind === "pending_plan_proof" && i.active);
  if (!item) return null;
  return {
    active: true,
    summary: item.summary,
    evidence_preview: item.evidence_preview?.slice(0, 120) ?? null,
  };
}

export function buildOpenLoopsAndDoNotRepeat(args: {
  structuredRecentTruth: RelationshipPacketStructuredRecentTruth;
  activePendingState: ActivePendingState;
  relationshipMemory7d?: RelationshipMemory7dData | null;
  recentExactThread72h?: OpenLoopsRecentExactThreadInput | null;
  routeContext?: OpenLoopsRouteContextInput | null;
}): { section: OpenLoopsAndDoNotRepeatSection; meta: OpenLoopsAndDoNotRepeatBuildMeta } {
  const routeRelevance = resolveRouteRelevance(args.routeContext);
  const truth = args.structuredRecentTruth;

  const satisfiedRaw: SatisfiedAskItem[] = [
    ...satisfiedAsksFromTurnUnderstanding(truth),
    ...satisfiedAsksFromDailyContext(truth),
    ...(() => {
      const fromAnswer = satisfiedAskFromStructuredAnswer(truth);
      return fromAnswer ? [fromAnswer] : [];
    })(),
    ...(args.relationshipMemory7d ? satisfiedAsksFromMemory7d(args.relationshipMemory7d) : []),
  ];
  const satisfiedAsks = mergeSatisfiedAsks(satisfiedRaw);

  const staleAskTexts = satisfiedAsks.filter((s) => s.do_not_repeat).map((s) => s.ask_text);
  const { asks: doNotRepeatAsksRaw, protectedKeys } = collectDoNotRepeatAsks({
    truth,
    satisfiedAsks,
  });
  const doNotRepeatAsks = trimDoNotRepeatAsks(doNotRepeatAsksRaw, protectedKeys);

  const blockedAsks = [...doNotRepeatAsks, ...staleAskTexts];

  const pendingKeys = args.activePendingState.items
    .filter((i) => i.active && i.evidence_preview)
    .map((i) => i.evidence_preview!);

  let scoredLoops = dedupeOpenLoops([
    ...openLoopsFromActivePendingState(args.activePendingState, routeRelevance),
    ...(() => {
      const fromTruth = openLoopFromStructuredTruth(truth, routeRelevance, [
        ...blockedAsks,
        ...pendingKeys,
      ]);
      return fromTruth ? [fromTruth] : [];
    })(),
    ...(args.relationshipMemory7d
      ? openLoopsFromMemory7d(args.relationshipMemory7d, blockedAsks, routeRelevance)
      : []),
  ]);

  if (args.recentExactThread72h?.messages?.length && blockedAsks.length > 0) {
    scoredLoops = scoredLoops.map((loop) => {
      if (loop.source !== "relationship_memory_7d") return loop;
      const key = loop.evidence_preview ?? loop.summary;
      if (askMatchesAny(key, blockedAsks)) {
        return { ...loop, active: false, must_not_claim_resolved: true };
      }
      return loop;
    }).filter((loop) => {
      if (loop.source === "relationship_memory_7d" && !loop.active) return false;
      return true;
    });
  }

  const { loops: openLoops, truncated } = trimOpenLoops(scoredLoops);

  const doNotRepeatPhrases = (truth.do_not_repeat_phrases ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, MAX_DO_NOT_REPEAT_PHRASES);

  const recentUnanswered = recentUnansweredCoachQuestions({
    truth,
    thread: args.recentExactThread72h,
    blockedAsks,
  });

  const pendingPlanProof = resolvePendingPlanProof(args.activePendingState);

  const sourcesUsed = [...new Set(openLoops.map((l) => l.source))];

  const section: OpenLoopsAndDoNotRepeatSection = {
    authority: OPEN_LOOPS_AND_DO_NOT_REPEAT_AUTHORITY,
    data: {
      open_loops: openLoops,
      satisfied_asks: satisfiedAsks,
      do_not_repeat_asks: doNotRepeatAsks,
      do_not_repeat_phrases: doNotRepeatPhrases,
      recent_unanswered_coach_questions: recentUnanswered,
      ...(pendingPlanProof ? { pending_plan_proof: pendingPlanProof } : {}),
      ...(routeRelevance ? { route_relevance: routeRelevance } : {}),
    },
  };

  const meta: OpenLoopsAndDoNotRepeatBuildMeta = {
    open_loop_count: openLoops.length,
    satisfied_ask_count: satisfiedAsks.length,
    do_not_repeat_ask_count: doNotRepeatAsks.length,
    recent_unanswered_question_count: recentUnanswered.length,
    open_loops_sources: sourcesUsed,
    open_loops_truncated: truncated,
  };

  return { section, meta };
}

export function buildOpenLoopsAndDoNotRepeatPromptGuidance(): string {
  return `
OPEN_LOOPS_AND_DO_NOT_REPEAT (writer guidance — final stale/near-duplicate guards still enforce separately):
- current_turn and recent_exact_thread_72h beat older open_loops from relationship_memory_7d.
- satisfied_asks must not be re-asked; honor do_not_repeat_asks and do_not_repeat_phrases.
- do_not_repeat_asks are guidance only — server final guard still blocks stale/near-duplicate sends.
- active_pending_state open loops may be referenced, but do not claim resolved unless server state confirms.
- relationship_memory_7d open loops are lower authority than recent exact answers and turn_understanding.
- recent_unanswered_coach_questions lists coach asks still awaiting a substantive user reply.
- pending_plan_proof active means forward plan given — proof of execution still pending.`;
}
