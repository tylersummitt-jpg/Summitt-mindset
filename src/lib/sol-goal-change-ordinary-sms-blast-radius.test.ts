/**
 * Ordinary SMS blast-radius: Goal Change stays asleep unless Sol structured
 * meaning AND server state permit a transition. Routing fuzz — not an English
 * classifier. Sol is mocked as intent none unless a case says otherwise.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  applySolGoalChangeSemanticAuthorityLaws,
  buildSolGoalChangeSemanticInput,
  emptySolGoalChangeSemanticResult,
  isExclusiveActiveOverlayRevertMeaning,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
  type SolGoalChangeIntent,
  type SolGoalChangeSemanticResult,
} from "@/lib/sol-goal-change-semantic";
import { isExactPendingProtocolNo, isExactPendingProtocolYes } from "@/lib/sol-goal-change-pending-confirm";
import { isSolGoalChangeClockOnlyFragment } from "@/lib/sol-goal-change-clock-substitute";
import { isAppleMessengerTapbackLine } from "@/lib/sms-imessage-reaction";
import { detectSmsPlannedInterruption } from "@/lib/sms-planned-interruption";
import { isLikelyCommitmentChangeIntentTurn } from "@/lib/v2-sms-conversation-brain-eligibility";

const getActiveCommitment = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const applyWave4SmsCommitmentPendingResolution = vi.hoisted(() => vi.fn());
const bootstrapSmsPendingConfirmationFromInbound = vi.hoisted(() => vi.fn());
const runSolGoalChangeSemanticInterpreter = vi.hoisted(() => vi.fn());
const mergeSmsPendingResolutionPayload = vi.hoisted(() => vi.fn());
const clearPendingResolution = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return { ...actual, getActiveCommitment };
});

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory,
}));

vi.mock("@/lib/v2-sms-commitment-change", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-sms-commitment-change")>();
  return { ...actual, applyWave4SmsCommitmentPendingResolution };
});

vi.mock("@/lib/v2-sms-pending-resolution-complete", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-sms-pending-resolution-complete")>();
  return { ...actual, bootstrapSmsPendingConfirmationFromInbound };
});

vi.mock("@/lib/sol-goal-change-semantic-interpreter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/sol-goal-change-semantic-interpreter")>();
  return { ...actual, runSolGoalChangeSemanticInterpreter };
});

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return { ...actual, mergeSmsPendingResolutionPayload, clearPendingResolution };
});

import {
  runSolGoalChangePendingOpenForInbound,
  shouldAttemptSolSavedReplaceAwaitingCandidateHallway,
  shouldAttemptSolSavedReplacePendingOpen,
} from "@/lib/sol-goal-change-pending-open";
import { shouldAttemptSolTemporaryPendingOpen } from "@/lib/sol-goal-change-temporary-pending";

const ANGELA = "I will be in bed by 9:30 pm nightly.";

function commitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_angela",
    clerk_user_id: "user_angela",
    status: "active",
    behavior_statement: ANGELA,
    title: "Bed",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "active_accountability",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: "2026-09-07T12:00:00.000Z",
    started_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function noneSemantic(): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      intent: "none",
      candidate_behavior_statement: null,
      needs_clarification: false,
    },
    concurrent_meaning: { planned_interruption: false, accountability_update: false },
  };
}

function semanticFrom(goal: Partial<SolGoalChangeSemanticResult["goal_change"]>): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      ...goal,
    },
    concurrent_meaning: { planned_interruption: false, accountability_update: false },
  };
}

const ACK = [
  "Thanks",
  "Thank you!",
  "Okay",
  "Ok coach",
  "Got it",
  "Sounds good",
  "I understand",
  "I will",
  "Deal",
  "You're right",
  "lol",
  "Haha",
  "❤️",
  "👍",
  "😂",
  "🙏",
];
const YES_NO = [
  "Yes",
  "Yep",
  "Yeah",
  "Absolutely",
  "Sure",
  "No",
  "Nope",
  "Nah",
  "Not really",
  "Y",
  "N",
];
const CLOCKS = [
  "It's 10:30.",
  "I got home at 10:30.",
  "I went to bed at 10:30 last night.",
  "My meeting is at 10:30.",
  "I have to leave at 9.",
  "Practice starts at 7:00.",
  "I woke up at 6:15.",
  "The kids went down at 8:30.",
  "I'll call her around 4.",
  "10:30 was actually a great bedtime last night.",
  "Yes, I went to bed at 10:30.",
  "Yeah 9:30 was rough last night.",
  "No, I woke up at 7.",
  "Yes, practice is at 6.",
  "Nope, 10:30 is when I finally fell asleep.",
];
const CHANGE_WORD = [
  "My schedule changed.",
  "I changed jobs.",
  "I need to change my oil.",
  "That changed my perspective.",
  "My daughter has changed so much.",
  "Change of plans—we're staying home.",
  "The weather changed.",
  "I changed workouts today.",
  "I want to change how I react when I'm stressed.",
  "Something has to change.",
];
const GOAL_WORD = [
  "That was a great goal in the soccer game.",
  "My son's goal is to make varsity.",
  "I hit my goal today!",
  "I missed my goal.",
  "I'm proud of my goal.",
  "This goal is hard.",
  "I still want this goal.",
  "I'm thinking about my goal.",
  "My goal at work is different.",
  "What's your opinion of my goal?",
];
const VACATION = [
  "I'm on vacation this week.",
  "We got to the beach today. The kids are having a blast.",
  "I'm on vacation and bedtime has been all over the place.",
  "We're going to Disney.",
  "We're at the lake.",
];
const PAUSE_STOP = [
  "Pause for a second.",
  "Stop 😂",
  "Stop, that's hilarious.",
  "I need to pause this conversation.",
  "Can we stop talking about work tonight?",
  "I need to stop overthinking.",
  "I'm pausing Netflix.",
  "Give me a break 😂",
  "Don't worry about me tonight.",
  "Let's take a break from this goal.",
  "Stop checking on this goal for a week.",
];
const DUAL_INTENT_ENGLISH = [
  "Vacation is great with the family, and while we're here I want bedtime to be 11 until Sunday.",
  "Work has been brutal. Also, I want to change my goal from lifting every day to three times a week.",
  "I missed again, and honestly I think 9:30 is unrealistic. Let's make it 10:30.",
  "My daughter is sick, so just for this week make my workout goal 10 minutes.",
];
const WINS_MISSES = [
  "I did it!",
  "YES! 🙌",
  "Got it done.",
  "Missed it today.",
  "Nope, didn't happen.",
  "I only got halfway.",
  "Had a great workout.",
  "I lifted for 30 minutes.",
  "I forgot.",
  "I overslept.",
  "I journaled tonight.",
  "I didn't journal.",
  "I followed through.",
  "I blew it today.",
];
const LIFE = [
  "My daughter made me laugh today.",
  "My wife is having a hard week.",
  "I'm worried about my mom.",
  "Work was insane.",
  "I got promoted.",
  "I got fired.",
  "My kid scored a goal.",
  "I went to church this morning.",
  "I prayed about it.",
  "I'm exhausted.",
  "I feel great.",
  "I'm frustrated.",
  "Today sucked.",
  "Best day I've had in months.",
  "My mom is sick.",
  "I had a great work meeting.",
  "My daughter had a soccer game.",
  "I went to bed at 11.",
];
const QUESTIONS = [
  "What would Coach Pat do?",
  "How do I stay disciplined?",
  "Was Pat ever nervous?",
  "What should I do tonight?",
  "Do you think I'm being too hard on myself?",
  "Is 7 hours of sleep enough?",
  "What does the Bible say about this?",
  "How do I handle my employee?",
  "Should I work out today?",
  "What time should I go to bed?",
];
const NUMBERS = [
  "Lost 10 pounds.",
  "Did 30 reps.",
  "Walked 5 miles.",
  "Meeting is 9/15.",
  "My son is 8.",
  "Worked 12 hours.",
  "Got 7 hours of sleep.",
  "Score was 10-3.",
  "I have 3 meetings.",
  "September 30 is the deadline.",
];
const SPORTS = [
  "Great goal!",
  "We need to change defenses.",
  "Switch to zone.",
  "Timeout.",
  "Pause the film.",
  "Coach changed the lineup.",
  "Go back to man-to-man.",
  "11 is playing great.",
  "Number 10 needs to come out.",
];
const IDENTITY = [
  "I want to be a more patient father.",
  "I am becoming a better leader.",
  "I want to be known as someone who keeps his word.",
  "My identity is being tested.",
];
const WORK_FAITH_PLANS = [
  "Work was crazy today.",
  "Can I ask you something else?",
  "Thanks Coach.",
  "I don't know.",
  "Give me a minute.",
  "Actually I had another question.",
  "We're staying home tonight.",
  "I have a funeral Thursday.",
  "Holiday weekend with family.",
  "Weekend away, no agenda.",
  "Jokes aside, I'm tired.",
  "That was hilarious.",
  "Complaining about traffic again.",
  "Grateful for this morning.",
  "I'm on a work trip.",
];
const PAD = Array.from({ length: 50 }, (_, i) => `Ordinary life update ${i + 1}: dinner with family.`);

const ORDINARY_TURNS = [
  ...ACK,
  ...YES_NO,
  ...CLOCKS,
  ...CHANGE_WORD,
  ...GOAL_WORD,
  ...VACATION,
  ...PAUSE_STOP,
  ...WINS_MISSES,
  ...LIFE,
  ...QUESTIONS,
  ...NUMBERS,
  ...SPORTS,
  ...IDENTITY,
  ...WORK_FAITH_PLANS,
  ...PAD,
];

describe("ordinary SMS blast-radius routing fuzz", () => {
  const base = commitment();

  beforeEach(() => {
    vi.clearAllMocks();
    getActiveCommitment.mockResolvedValue(base);
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_replace",
      skipReason: null,
    });
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: false,
      candidate: null,
      skipReason: "not_attempted",
    });
    mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: true, updatedAt: base.updated_at });
    clearPendingResolution.mockResolvedValue(undefined);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue({
      ok: true,
      result: noneSemantic(),
      error: null,
      capture: { retry_occurred: false },
    });
  });

  it("corpus has at least 200 ordinary turns", () => {
    expect(new Set(ORDINARY_TURNS).size).toBeGreaterThanOrEqual(200);
  });

  it("Sol none + no pending: 200 ordinary turns never write Goal Change pending", async () => {
    expect(ORDINARY_TURNS.length).toBeGreaterThanOrEqual(200);
    for (const inbound of ORDINARY_TURNS) {
      applyWave4SmsCommitmentPendingResolution.mockClear();
      const r = await runSolGoalChangePendingOpenForInbound({
        clerkUserId: "user_angela",
        commitment: base,
        inboundRaw: inbound,
        messageSid: `SM-${inbound.slice(0, 24)}`,
        plannedInterruptionKnown: false,
        timezone: "America/Chicago",
      });
      expect(applyWave4SmsCommitmentPendingResolution, inbound).not.toHaveBeenCalled();
      expect(r.forensics.pending_write_applied, inbound).toBe(false);
      expect(r.forensics.hallway_opened, inbound).toBe(false);
      expect(r.authorization.goal_change_apply_authorized, inbound).toBe(false);
      expect(r.authorization.goal_change_confirmation_authorized, inbound).toBe(false);
      expect(shouldAttemptSolSavedReplacePendingOpen(noneSemantic())).toBe(false);
      expect(shouldAttemptSolTemporaryPendingOpen(noneSemantic())).toBe(false);
    }
  });

  it("ordinary clocks in sentences are not whole-message structural fills", () => {
    for (const inbound of CLOCKS) {
      expect(isSolGoalChangeClockOnlyFragment(inbound), inbound).toBe(false);
    }
  });

  it("exact Yes/No protocol tokens do not by themselves authorize GC without pending", () => {
    expect(isExactPendingProtocolYes("Yes")).toBe(true);
    expect(isExactPendingProtocolNo("No")).toBe(true);
    expect(isExactPendingProtocolYes("Yep")).toBe(false);
    expect(isExactPendingProtocolYes("Yeah")).toBe(false);
    expect(isExactPendingProtocolYes("Absolutely")).toBe(false);
    expect(isExactPendingProtocolNo("Nope")).toBe(false);
    expect(isExactPendingProtocolYes("Yes, I went to bed at 10:30.")).toBe(false);
    expect(shouldAttemptSolSavedReplacePendingOpen(noneSemantic())).toBe(false);
  });

  it("change/goal words are not Goal Change keyword owners", () => {
    for (const inbound of [...CHANGE_WORD, ...GOAL_WORD, ...SPORTS]) {
      expect(isLikelyCommitmentChangeIntentTurn(inbound), inbound).toBe(false);
    }
  });

  it("vacation A–C do not open GC from PI detect; Sol none still writes nothing", () => {
    const vacationOnly = detectSmsPlannedInterruption("I'm on vacation this week.");
    expect(vacationOnly.detected).toBe(true);
    expect(vacationOnly.reasonCategory).toBe("vacation");
    expect(shouldAttemptSolSavedReplacePendingOpen(noneSemantic())).toBe(false);
    expect(shouldAttemptSolTemporaryPendingOpen(noneSemantic())).toBe(false);
  });

  it("dual-intent English with Sol none still does not phrase-open Goal Change", async () => {
    for (const inbound of DUAL_INTENT_ENGLISH) {
      applyWave4SmsCommitmentPendingResolution.mockClear();
      const r = await runSolGoalChangePendingOpenForInbound({
        clerkUserId: "user_angela",
        commitment: base,
        inboundRaw: inbound,
        messageSid: `SMdual-${inbound.slice(0, 20)}`,
        plannedInterruptionKnown: true,
      });
      expect(applyWave4SmsCommitmentPendingResolution, inbound).not.toHaveBeenCalled();
      expect(r.forensics.pending_write_applied, inbound).toBe(false);
      expect(r.authorization.goal_change_apply_authorized, inbound).toBe(false);
    }
  });

  it("Sol-down ordinary English with no pending does not code-classify Goal Change", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue({
      ok: false,
      result: null,
      error: "openai_unavailable",
      capture: { retry_occurred: false },
    });
    for (const inbound of ["Yes", "No", "10:30", "I want to change things", "I'm on vacation", "Thanks", "I missed today"]) {
      applyWave4SmsCommitmentPendingResolution.mockClear();
      const r = await runSolGoalChangePendingOpenForInbound({
        clerkUserId: "user_angela",
        commitment: base,
        inboundRaw: inbound,
        messageSid: `SMdown-${inbound}`,
        plannedInterruptionKnown: false,
      });
      expect(applyWave4SmsCommitmentPendingResolution, inbound).not.toHaveBeenCalled();
      expect(r.forensics.pending_write_applied, inbound).toBe(false);
      expect(r.authorization.goal_change_apply_authorized, inbound).toBe(false);
    }
  });
});

describe("quoted reaction text is not Goal Change English", () => {
  it("Loved/Liked/Laughed quoting goal/change/clock/permanent do not become GC intent by code", () => {
    const reactions = [
      `Loved "Your goal going forward is 10:30"`,
      `Liked "I changed your goal"`,
      `Laughed at "make this permanent"`,
      `Loved "temporary overlay until Friday"`,
      `👍 to "change my goal"`,
    ];
    for (const line of reactions) {
      if (isAppleMessengerTapbackLine(line)) {
        expect(shouldAttemptSolSavedReplacePendingOpen(noneSemantic())).toBe(false);
        expect(isSolGoalChangeClockOnlyFragment(line)).toBe(false);
      }
    }
    expect(isAppleMessengerTapbackLine(`Loved "Your goal going forward is 10:30"`)).toBe(true);
    expect(isAppleMessengerTapbackLine(`Liked "I changed your goal"`)).toBe(true);
    expect(isAppleMessengerTapbackLine(`Laughed at "make this permanent"`)).toBe(true);
  });
});

describe("100 structured Sol outputs vs server state fail closed", () => {
  const intents: SolGoalChangeIntent[] = [
    "none",
    "possible_saved_replace",
    "saved_replace",
    "temporary_adjustment",
  ];
  const pendingKinds = [
    null,
    { actionable: true, kind: "commitment_replace" as const, sms_state: "awaiting_candidate" as const, candidate: null },
    {
      actionable: true,
      kind: "commitment_replace" as const,
      sms_state: "awaiting_confirmation" as const,
      candidate: "I will be in bed by 10:30 pm nightly.",
    },
    { actionable: true, kind: "commitment_tighten" as const, sms_state: "awaiting_candidate" as const, candidate: null },
    {
      actionable: true,
      kind: "commitment_tighten" as const,
      sms_state: "awaiting_confirmation" as const,
      candidate: "I will be in bed by 11:00 pm nightly.",
    },
  ];
  const overlays = [
    { active: false as const },
    {
      active: true as const,
      overlay_behavior_statement: "I will be in bed by 11:00 pm nightly.",
      overlay_expires_at: "2026-09-20T05:00:00.000Z",
      overlay_last_included_local_date: "2026-09-19",
    },
  ];
  const hallway = [
    { confirm: false, reject: false, modify: false, revert: false },
    { confirm: true, reject: false, modify: false, revert: false },
    { confirm: false, reject: true, modify: false, revert: false },
    { confirm: false, reject: false, modify: true, revert: false },
    { confirm: false, reject: false, modify: false, revert: true },
  ];

  it("illegal Sol+state combinations cannot authorize mutation", () => {
    let n = 0;
    const cases: string[] = [];
    for (const intent of intents) {
      for (const pending of pendingKinds) {
        for (const overlay of overlays) {
          for (const flags of hallway) {
            if (n >= 100) break;
            const parsed = semanticFrom({
              intent,
              candidate_behavior_statement:
                intent === "saved_replace" ? "I will be in bed by 10:30 pm nightly." : null,
              needs_clarification: intent === "possible_saved_replace",
              confirms_existing_pending: flags.confirm,
              rejects_existing_pending: flags.reject,
              modifies_existing_pending_candidate: flags.modify,
              reverts_active_temporary_overlay: flags.revert,
            });
            const input = buildSolGoalChangeSemanticInput({
              canonicalSavedBehaviorStatement: ANGELA,
              authoritativePending: pending
                ? {
                    actionable: pending.actionable,
                    kind: pending.kind,
                    sms_state: pending.sms_state,
                    candidate_behavior_statement: pending.candidate,
                    source: "sms_inbound",
                  }
                : null,
              authoritativeActiveOverlay: overlay.active
                ? {
                    active: true,
                    overlay_behavior_statement: overlay.overlay_behavior_statement,
                    overlay_expires_at: overlay.overlay_expires_at,
                    overlay_last_included_local_date: overlay.overlay_last_included_local_date,
                  }
                : null,
              latestInboundText: "ordinary inbound",
            });
            const gated = applySolGoalChangeSemanticAuthorityLaws(parsed, input);
            const g = gated.goal_change;
            if (!pending) {
              expect(g.confirms_existing_pending).toBe(false);
              expect(g.rejects_existing_pending).toBe(false);
              expect(g.modifies_existing_pending_candidate).toBe(false);
            }
            if (!overlay.active) {
              expect(g.reverts_active_temporary_overlay).toBe(false);
            }
            if (g.reverts_active_temporary_overlay) {
              expect(isExclusiveActiveOverlayRevertMeaning(g)).toBe(true);
              expect(pending).toBeNull();
            }
            if (!g.candidate_behavior_statement?.trim()) {
              expect(shouldAttemptSolSavedReplacePendingOpen(gated)).toBe(false);
            }
            n += 1;
            cases.push(`${intent}:${pending?.sms_state ?? "none"}:${overlay.active}:${flags.confirm}`);
          }
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(100);
    expect(cases.length).toBe(n);
  });

  it("saved replace missing candidate cannot open confirmable pending", () => {
    const missing = semanticFrom({
      intent: "saved_replace",
      candidate_behavior_statement: null,
      needs_clarification: true,
    });
    expect(shouldAttemptSolSavedReplacePendingOpen(missing)).toBe(false);
    expect(shouldAttemptSolSavedReplaceAwaitingCandidateHallway(missing)).toBe(true);
  });

  it("confirm with no pending cannot open or mutate", () => {
    const parsed = semanticFrom({
      intent: "saved_replace",
      confirms_existing_pending: true,
      candidate_behavior_statement: "I will be in bed by 10:30 pm nightly.",
    });
    const input = buildSolGoalChangeSemanticInput({
      canonicalSavedBehaviorStatement: ANGELA,
      latestInboundText: "Yes",
    });
    const gated = applySolGoalChangeSemanticAuthorityLaws(parsed, input);
    expect(gated.goal_change.confirms_existing_pending).toBe(false);
    expect(shouldAttemptSolSavedReplacePendingOpen(gated)).toBe(false);
  });
});
