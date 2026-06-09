/**
 * SMS Review Place — internal types only (not imported by production SMS routes).
 */

export type SmsReviewRunMode = "mock" | "real_openai";

export type SmsReviewLane = "daily" | "inbound" | "weekly" | "classifier";

export type SmsReviewPersona = {
  id: string;
  preferredName: string;
  clerkUserId: string;
  identityLabel: string;
};

export type SmsReviewScenarioStep = {
  lane: SmsReviewLane;
  /** Key for resolveMockOpenAiResponse; defaults to `${scenarioId}:${lane}`. */
  mockKey?: string;
  /** Inbound or classifier user message for this step. */
  userReply?: string;
};

/** Phase 4.2 — Strategy Card metadata assertions (not final SMS copy). */
export type StrategyCardExpectations = {
  expectCardPresent: boolean;
  allowedMoveTypes?: string[];
  forbiddenMoveTypes?: string[];
  allowedClaims?: Partial<
    Record<"completion" | "miss" | "partial" | "proof" | "victory_room" | "state_changed", boolean>
  >;
  mustNotDoIncludes?: RegExp[];
  mustDoIncludes?: RegExp[];
  avoidRepeatingIncludes?: RegExp[];
  /** When true (default), assert North Star + FVG ran for coaching lanes. */
  expectFinalGuardRan?: boolean;
};

export type SmsReviewScenario = {
  id: string;
  personaId: string;
  enabled: boolean;
  timezone: string;
  goalTitle: string;
  behaviorStatement: string;
  effectiveAsk: string;
  /** Human-readable thread summary for reports. */
  threadSummary: string;
  /** Transcript lines for inbound / thread memory. */
  transcriptLines?: string[];
  memorySummary: string;
  expectedBehavior: string;
  bugCategory: string;
  steps: SmsReviewScenarioStep[];
  /** If set, at least one of these hard flags is expected (negative test). */
  expectHardFlags?: SmsReviewHardFlag[];
  /** If true, expect zero hard flags for this scenario. */
  expectClean?: boolean;
  /** Phase 4.2 — inbound-normal Strategy Card invariants. */
  strategyCard?: StrategyCardExpectations;
  deferredReason?: string;
};

export type SmsReviewHardFlag =
  | "fake_proof_claim"
  | "fake_victory_room_claim"
  | "temporal_wording_violation"
  | "phone_tree_language"
  | "repeated_question"
  | "generic_momentum"
  | "warm_praise_overuse"
  | "no_send_without_reason"
  | "praises_plan_as_proof"
  | "partial_treated_as_win"
  | "missed_marked_completed"
  | "boundary_leak_into_coaching"
  | "stale_goal"
  | "json_final_body";

export type SmsReviewSoftReviewFields = {
  feels_known: string | null;
  responds_to_latest: string | null;
  specific_to_current_goal: string | null;
  one_useful_next_move: string | null;
  warm_not_soft: string | null;
  serious_pat: string | null;
  not_robotic: string | null;
  not_generic: string | null;
  invites_reply: string | null;
  useful_after_miss: string | null;
  useful_after_win: string | null;
  useful_after_blocker: string | null;
};

export type SmsReviewRunRow = {
  scenario_id: string;
  persona_id: string;
  step_index: number;
  lane: SmsReviewLane;
  simulated_local_iso: string;
  accountability_day_key: string | null;
  current_goal: string;
  latest_user_reply: string | null;
  thread_summary: string;
  memory_summary: string;
  relationship_packet_version: string | null;
  relationship_packet_truncated: boolean | null;
  lane_body: string;
  lane_should_send: boolean;
  lane_no_send_reason: string | null;
  north_star_body: string;
  final_body: string;
  /** Raw final when FVG returned JSON-shaped text (diagnostic). */
  final_body_raw: string | null;
  final_should_send: boolean;
  final_skip_reason: string | null;
  blocked_reasons: string[];
  hard_flags: SmsReviewHardFlag[];
  soft_review: SmsReviewSoftReviewFields;
  expected_behavior: string;
  bug_category: string;
  expect_clean: boolean;
  expect_hard_flags: SmsReviewHardFlag[];
  pass: boolean;
  lane_skipped_reason: string | null;
  classifier_results: Record<string, unknown> | null;
  /** Phase 4.2 — Strategy Card lane metadata (null when not applicable). */
  strategy_card_move_type: string | null;
  strategy_card_validation_status: string | null;
  strategy_card_violations: string[];
  strategy_card_pass: boolean | null;
  human_notes: string;
  run_mode: SmsReviewRunMode;
};

export type SmsReviewScenarioFilterSummary = {
  scenario: string | null;
  persona: string | null;
  limit: number | null;
  all: boolean;
};

export type SmsReviewReportSummary = {
  generated_at: string;
  run_mode: SmsReviewRunMode;
  scenario_count: number;
  step_count: number;
  pass_count: number;
  fail_count: number;
  hard_flag_counts: Partial<Record<SmsReviewHardFlag, number>>;
  no_send_count: number;
  json_final_body_count: number;
  expect_clean_failures: string[];
  expect_hard_flag_misses: string[];
  fixtures_only: boolean;
  no_twilio: boolean;
  no_db_writes: boolean;
  not_production_replay: boolean;
  openai_live: boolean;
  manual_local_internal_only: boolean;
  scenario_filter: SmsReviewScenarioFilterSummary;
  advisory_review: boolean;
};
