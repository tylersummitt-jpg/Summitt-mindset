/**
 * Deterministic OpenAI chat completion mocks for SMS Review Place lanes.
 * Update when lane JSON schema changes (see v3-*-relationship-lane tests).
 */

type LaneJson = Record<string, unknown>;

function completionFromJson(obj: LaneJson) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(obj),
        },
      },
    ],
  };
}

const GOOD_DAILY: LaneJson = {
  should_send: true,
  body: "What time are you protecting for the deep work block today?",
  no_send_reason: null,
  turn_purpose: "daily_check",
  voice_confidence: 0.82,
  used_facts: ["commitment", "thread"],
  safety_notes: [],
};

const GOOD_INBOUND: LaneJson = {
  should_send: true,
  body: "Got it — what made it stick today?",
  no_send_reason: null,
  turn_purpose: "inbound_ack",
  voice_confidence: 0.8,
  used_facts: ["thread", "commitment"],
  safety_notes: [],
  rejected_times_obeyed: true,
  split_messages_handled: true,
};

const RESPONSES: Record<string, LaneJson> = {
  "consistent-winner:daily": GOOD_DAILY,
  "consistent-winner:inbound": {
    ...GOOD_INBOUND,
    body: "Nice — what helped you protect the block before noon?",
  },
  "repeated-miss-no-shame:daily": {
    ...GOOD_DAILY,
    body: "Thanks for telling the truth — what got in the way of the ten minutes?",
    turn_purpose: "miss_recovery",
  },
  "repeated-miss-no-shame:inbound": {
    ...GOOD_INBOUND,
    body: "I hear you — what got in the way of the ten minutes last night?",
    turn_purpose: "miss_recovery",
  },
  "partial-not-win:inbound": {
    ...GOOD_INBOUND,
    body: "Almost — what stopped the full hour?",
    turn_purpose: "partial_followup",
  },
  "blocker-heavy:inbound": {
    ...GOOD_INBOUND,
    body: "Kids sick makes sense — what's one small movement you could still do?",
    turn_purpose: "blocker_pivot",
  },
  "vague-reply:inbound": {
    ...GOOD_INBOUND,
    body: "No worries — was it zero calls or you lost count?",
    turn_purpose: "clarify",
  },
  "time-ref-yesterday:daily": {
    ...GOOD_DAILY,
    body: "What time are you protecting for the deep-work block?",
  },
  "time-ref-yesterday:inbound": {
    ...GOOD_INBOUND,
    body: "Got it — what's the honest next step on the block?",
  },
  "warm-praise-overuse:bad": {
    should_send: true,
    body: "You're amazing!! Keep crushing it!! Did you hydrate today?",
    no_send_reason: null,
    turn_purpose: "daily_check",
    voice_confidence: 0.9,
    used_facts: [],
    safety_notes: [],
  },
  "repeated-question-risk:bad": {
    should_send: true,
    body: "Did the two hours happen today?",
    no_send_reason: null,
    turn_purpose: "daily_check",
    voice_confidence: 0.7,
    used_facts: [],
    safety_notes: [],
  },
  "proof-victory-allowed:inbound": {
    ...GOOD_INBOUND,
    body: "Strong standup — worth saving as proof in Victory Room if you want.",
  },
  "proof-victory-forbidden:bad": {
    ...GOOD_INBOUND,
    body: "Logged that as proof in Victory Room — great job!",
  },
  "stale-goal:inbound": {
    ...GOOD_INBOUND,
    body: "For no screens after 9pm — did the wind-down happen, or did something interrupt it?",
  },
  "open-question-answered:inbound": {
    ...GOOD_INBOUND,
    body: "Good — lock in the strength session once Brooke's workout wraps.",
  },
  "plan-not-proof:daily": {
    ...GOOD_DAILY,
    body: "Before a new ask — did yesterday's after-workout plan actually happen?",
    turn_purpose: "close_plan_loop",
  },
  "time-ref-yesterday:bad": {
    should_send: true,
    body: "Did the two hours happen today?",
    no_send_reason: null,
    turn_purpose: "daily_check",
    voice_confidence: 0.75,
    used_facts: [],
    safety_notes: [],
  },
  "strategy-card-single-miss:inbound": {
    ...GOOD_INBOUND,
    body: "What got in the way of the block today?",
    turn_purpose: "miss_recovery",
  },
  "strategy-card-plan-ack-good:inbound": {
    ...GOOD_INBOUND,
    body: "We'll hold that plan for the deep work block.",
    turn_purpose: "plan_ack",
  },
  "strategy-card-completion:inbound": {
    ...GOOD_INBOUND,
    body: "What helped you protect the full two hours?",
    turn_purpose: "completion_ack",
  },
  "strategy-card-partial:inbound": {
    ...GOOD_INBOUND,
    body: "Almost — what stopped the full movement block?",
    turn_purpose: "partial_followup",
  },
  "strategy-card-blocker-known:inbound": {
    ...GOOD_INBOUND,
    body: "Kids sick makes sense — what's one small call you could still make?",
    turn_purpose: "blocker_pivot",
  },
  "strategy-card-satisfied-ask:inbound": {
    ...GOOD_INBOUND,
    body: "Got it — what's the honest next step on the study block tonight?",
    turn_purpose: "forward_move",
  },
  "strategy-card-proof-forbidden:inbound": {
    ...GOOD_INBOUND,
    body: "What is tomorrow's first move on the block?",
    turn_purpose: "completion_ack",
  },
  "strategy-card-active-pending:inbound": {
    ...GOOD_INBOUND,
    body: "Not yet — want to try the smaller rep today or hold the original ask?",
    turn_purpose: "pending_followup",
  },
  default: GOOD_DAILY,
};

/** Deterministic mock lane `.body` for validators when the lane no-sends. */
export function peekMockLaneBody(key: string): string | null {
  const json = RESPONSES[key];
  if (!json) return null;
  const body = json.body;
  return typeof body === "string" ? body : null;
}

/**
 * Resolve mock OpenAI response for a scenario step key.
 */
export function resolveMockOpenAiResponse(key: string, _request?: unknown): {
  choices: { message: { content: string } }[];
} {
  const json = RESPONSES[key] ?? RESPONSES.default;
  return completionFromJson(json);
}
