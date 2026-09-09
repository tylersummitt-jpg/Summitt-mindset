import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  applyGoalChangeMachineBodySafety,
  buildAppliedGoalChangeAuthorization,
  buildAuthorizedAppliedGoalAck,
  type SolGoalChangeConfirmationAuthorization,
} from "@/lib/sol-goal-change-confirmation-guard";
import {
  INBOUND_SOL_WRITER_SYSTEM_PROMPT,
  buildInboundSolWriterMessages,
} from "@/lib/inbound-sol-writer";
import { buildSolGoalChangePendingConfirmFallbackBody } from "@/lib/sol-goal-change-pending-confirm";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { InboundCoachingBriefV1 } from "@/lib/inbound-sol-coaching-brief";
import { EMPTY_INBOUND_SOL_WIN_PRESENTATION } from "@/lib/inbound-sol-coaching-brief";
import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";

const ANGELA_PREV = "I will be in bed by 9:30 pm nightly.";
const ANGELA_NEW = "I will be in bed by 10:30 pm nightly.";

function appliedAuth(args: {
  previous: string;
  next: string;
}): SolGoalChangeConfirmationAuthorization {
  return buildAppliedGoalChangeAuthorization({
    previousBehaviorStatement: args.previous,
    previousCommitmentId: "cmt_old",
    activeBehaviorStatement: args.next,
    activeCommitmentId: "cmt_new",
  });
}

function angelaApplied(): SolGoalChangeConfirmationAuthorization {
  return appliedAuth({ previous: ANGELA_PREV, next: ANGELA_NEW });
}

function packet(latest: string, currentGoal: string): InboundRelationshipPacket {
  return {
    version: "inbound_relationship_v1",
    message_for: {
      timezone: "America/Chicago",
      local_date: "2026-09-07",
      local_weekday: "Monday",
      daypart: "inbound",
      current_local_time: "11:00",
    },
    preferred_name: "Angela",
    current_goal: { text: currentGoal },
    current_identity: { text: null },
    personal_context: [],
    hard_state: { pending_goal_change: null, open_coach_question: null },
    latest_inbound_text: latest,
    latest_inbound_message_sid: "SMturn2",
    pending_media_context: {
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    },
    historical_evidence: [],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [
        {
          sender: "coach",
          sent_at_utc: "2026-09-07T15:00:00.000Z",
          sent_at_local: "2026-09-07 11:00",
          local_day_key: "2026-09-07",
          local_weekday: "Monday",
          day_relation_to_message: "same day",
          body: "Do you want 10:30 to replace 9:30 every night going forward?",
        },
        {
          sender: "user",
          sent_at_utc: "2026-09-07T15:01:00.000Z",
          sent_at_local: "2026-09-07 11:01",
          local_day_key: "2026-09-07",
          local_weekday: "Monday",
          day_relation_to_message: "same day",
          body: latest,
        },
      ],
    },
  };
}

function brief(): InboundCoachingBriefV1 {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "high",
    human_situation: {
      most_alive: "Confirmed the new bedtime goal",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "Yes",
      outcome: "unknown",
      evidence_note: "Confirmed goal change",
      evidence_strength: "stated_once",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: false,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    conversation_continuity: {
      already_acknowledged: [],
      answered_question: null,
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: [],
    },
    goal_role_today: {
      canonical_goal: ANGELA_NEW,
      pending_goal: null,
      goal_alignment: "aligned",
      role: "central",
      note: "Goal change applied",
    },
    coaching_direction: {
      primary_move: "acknowledge",
      question_policy: "none",
      action_guidance: "light",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: [],
      topics_not_to_force: [],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "History is not style.",
    },
    inbound: {
      answer_priority: "normal",
      coaching_after_answer: "no",
      requires_pat_personal_knowledge: "unknown",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "related",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "Yes",
      },
      meaningful_win: null,
      pending_photo_relation: { relation: "none", target_win_id: null },
      durable_user_evidence: null,
      win_presentation: EMPTY_INBOUND_SOL_WIN_PRESENTATION,
    },
  };
}

describe("Slice 4 post-apply writer context", () => {
  it("9–10: applied writer state includes previous/new goals, ids, pending cleared", () => {
    const auth = angelaApplied();
    const user = String(
      buildInboundSolWriterMessages(packet("Yes", ANGELA_NEW), brief(), null, auth)[1]
        ?.content ?? ""
    );
    expect(user).toContain("GOAL_CHANGE_CONFIRMATION_STATE");
    expect(user).toContain("GOAL_CHANGE_APPLIED_COACHING_NOTE");
    expect(user).toContain('"goal_change_apply_authorized":true');
    expect(user).toContain('"goal_change_confirmation_authorized":false');
    expect(user).toContain('"pending_cleared":true');
    expect(user).toContain('"pending_state":null');
    expect(user).toContain(ANGELA_PREV);
    expect(user).toContain(ANGELA_NEW);
    expect(user).toContain("cmt_old");
    expect(user).toContain("cmt_new");
    expect(user).toContain('"previous_saved_goal"');
    expect(user).toContain('"new_saved_goal"');
    expect(user).toContain('"verified_applied":true');
    expect(user).toContain("Yes");
    expect(user).toContain("Do you want 10:30 to replace 9:30");
  });

  it("does not attach applied coaching note unless apply authorized", () => {
    const user = String(
      buildInboundSolWriterMessages(packet("Yes", ANGELA_PREV), brief())[1]?.content ?? ""
    );
    expect(user).not.toContain("GOAL_CHANGE_APPLIED_COACHING_NOTE");
  });
});

describe("Slice 4 writer prompt — applied Coach Pat law", () => {
  it("requires relationship voice, no re-ask, no internals, no invented motivation", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "The saved-goal change is already done. This is still the same ongoing coaching relationship"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Do NOT re-ask confirmation after apply");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Are you sure?");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Should I lock that in?");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "Do NOT mention database, Supabase, RPC, canonical row, pending state, commitment id"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Do not invent why they changed");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "You must NOT speak the old goal as if it is still active"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Orient toward making that goal real");
  });
});

describe("Slice 4 applied body safety", () => {
  it("1: applied clock goal natural acknowledgment is allowed", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "Got it, Angela. 10:30 is your goal going forward. Now let's make that one real.",
      authorization: angelaApplied(),
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toContain("10:30");
    expect(r.body).not.toMatch(/database|supabase|rpc|canonical|pending state/i);
  });

  it("2: applied writer claiming the wrong clock is blocked", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "11:00 is your new goal.",
      authorization: angelaApplied(),
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("wrong_applied_goal_change_claim");
    expect(r.body).toContain("10:30");
    expect(r.body).not.toContain("11:00");
  });

  it("3: applied writer re-asking confirmation is replaced with truthful ack, not a new ask", () => {
    for (const body of [
      "Do you want 10:30 to replace 9:30 going forward?",
      "Are you sure?",
      "Should I lock that in?",
      "Want to make that your new goal?",
    ]) {
      const r = applyGoalChangeMachineBodySafety({
        body,
        authorization: angelaApplied(),
      });
      expect(r.blocked).toBe(true);
      expect(r.reason).toBe("post_apply_goal_change_reask");
      expect(r.body).toBe(buildAuthorizedAppliedGoalAck(angelaApplied()));
      expect(r.body.toLowerCase()).not.toContain("do you want");
      expect(r.body.toLowerCase()).not.toContain("are you sure");
    }
  });

  it("4: applied writer mentioning DB/RPC/internal state is blocked", () => {
    for (const body of [
      "Your canonical row is now 10:30.",
      "The RPC updated your goal to 10:30.",
      "Supabase now has 10:30.",
      "Pending state is cleared and commitment id cmt_new is active.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({
        body,
        authorization: angelaApplied(),
      });
      expect(r.blocked).toBe(true);
      expect(r.reason).toBe("goal_change_internal_mechanics_leak");
      expect(r.body).not.toMatch(/rpc|supabase|canonical|commitment id|pending state/i);
    }
  });

  it("5: non-clock fitness goal acknowledgment is allowed; invented days blocked", () => {
    const auth = appliedAuth({
      previous: "I will work out five days per week.",
      next: "I will work out four days per week.",
    });
    const ok = applyGoalChangeMachineBodySafety({
      body: "Got it. Four days a week is the standard now. Let's make it sustainable.",
      authorization: auth,
    });
    expect(ok.blocked).toBe(false);
    const wrong = applyGoalChangeMachineBodySafety({
      body: "Your new goal is six days.",
      authorization: auth,
    });
    expect(wrong.blocked).toBe(true);
    expect(wrong.reason).toBe("wrong_applied_goal_change_claim");
    expect(wrong.body.toLowerCase()).toContain("four");
  });

  it("6: reading goal acknowledgment is allowed; invented page count blocked", () => {
    const auth = appliedAuth({
      previous: "I will read 20 pages every night.",
      next: "I will read 10 pages every night.",
    });
    const ok = applyGoalChangeMachineBodySafety({
      body: "Got it. 10 pages every night going forward.",
      authorization: auth,
    });
    expect(ok.blocked).toBe(false);
    const historical = applyGoalChangeMachineBodySafety({
      body: "You moved from 20 pages to 10. Let's make those 10 count.",
      authorization: auth,
    });
    expect(historical.blocked).toBe(false);
    const wrong = applyGoalChangeMachineBodySafety({
      body: "Your new goal is 15 pages every night.",
      authorization: auth,
    });
    expect(wrong.blocked).toBe(true);
    expect(wrong.body).toContain("10 pages");
  });

  it("7: weekday alcohol goal acknowledgment is allowed; invented weekday blocked", () => {
    const auth = appliedAuth({
      previous: "No alcohol Monday through Friday.",
      next: "No alcohol Monday through Thursday.",
    });
    const ok = applyGoalChangeMachineBodySafety({
      body: "Got it. No alcohol Monday through Thursday. That's the bar now.",
      authorization: auth,
    });
    expect(ok.blocked).toBe(false);
    const wrong = applyGoalChangeMachineBodySafety({
      body: "Saturday is your new alcohol boundary.",
      authorization: auth,
    });
    expect(wrong.blocked).toBe(true);
    expect(wrong.body.toLowerCase()).toContain("thursday");
  });

  it("I: Angela post-apply canary qualities — natural 10:30 ack is allowed", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "Got it, Angela. 10:30 is your goal going forward. Now let's make that one real.",
      authorization: angelaApplied(),
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toMatch(/10:30/);
    expect(r.body.toLowerCase()).not.toContain("do you want");
    expect(r.body.toLowerCase()).not.toContain("are you sure");
    expect(r.body.toLowerCase()).not.toMatch(/database|supabase|rpc|canonical|mutation/);
  });

  it("historical clock comparison is allowed; invented clock still blocked", () => {
    const auth = angelaApplied();
    for (const body of [
      "9:30 wasn't working. 10:30 is the bar now.",
      "You're moving from 9:30 to 10:30.",
      "You're moving from 9:30 to 10:30. Let's make 10:30 real.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: auth });
      expect(r.blocked).toBe(false);
      expect(r.body).toBe(body);
    }
    const invented = applyGoalChangeMachineBodySafety({
      body: "11:00 is your goal now.",
      authorization: auth,
    });
    expect(invented.blocked).toBe(true);
    expect(invented.reason).toBe("wrong_applied_goal_change_claim");
    expect(invented.body).toContain("10:30");
    expect(invented.body).not.toContain("11:00");
  });

  it("historical quantity comparison is allowed; invented quantity still blocked", () => {
    const auth = appliedAuth({
      previous: "I will work out five days per week.",
      next: "I will work out four days per week.",
    });
    for (const body of [
      "Four days is the goal now.",
      "You moved from five days to four. Let's make those four count.",
      "Five wasn't sustainable. Four is the standard now.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: auth });
      expect(r.blocked).toBe(false);
      expect(r.body).toBe(body);
    }
    const invented = applyGoalChangeMachineBodySafety({
      body: "Your new goal is six days.",
      authorization: auth,
    });
    expect(invented.blocked).toBe(true);
    expect(invented.reason).toBe("wrong_applied_goal_change_claim");
    expect(invented.body.toLowerCase()).toContain("four");
    expect(invented.body.toLowerCase()).not.toContain("six");
  });

  it("historical weekday comparison is allowed; invented weekday still blocked", () => {
    const auth = appliedAuth({
      previous: "No alcohol Monday through Friday.",
      next: "No alcohol Monday through Thursday.",
    });
    for (const body of [
      "Thursday is the new line.",
      "You changed it from Friday to Thursday.",
      "Friday was the old boundary; Thursday is the one we're using now.",
    ]) {
      const r = applyGoalChangeMachineBodySafety({ body, authorization: auth });
      expect(r.blocked).toBe(false);
      expect(r.body).toBe(body);
    }
    const invented = applyGoalChangeMachineBodySafety({
      body: "Saturday is the new alcohol line.",
      authorization: auth,
    });
    expect(invented.blocked).toBe(true);
    expect(invented.reason).toBe("wrong_applied_goal_change_claim");
    expect(invented.body.toLowerCase()).toContain("thursday");
    expect(invented.body.toLowerCase()).not.toContain("saturday");
  });

  it("token seatbelt does not classify historical vs current English: still 9:30 is not a token veto", () => {
    const r = applyGoalChangeMachineBodySafety({
      body: "Your goal is still 9:30.",
      authorization: angelaApplied(),
    });
    expect(r.blocked).toBe(false);
    expect(r.body).toBe("Your goal is still 9:30.");
    expect(r.reason).toBeNull();
  });
});

describe("Slice 4 Sol-writer-failure fallback", () => {
  it("8: fallback uses reloaded new goal, does not re-ask, does not invent", () => {
    const auth = angelaApplied();
    const body = buildSolGoalChangePendingConfirmFallbackBody(auth);
    expect(body).toBe(buildAuthorizedAppliedGoalAck(auth));
    expect(body).toContain(ANGELA_NEW.replace(/\.+$/, ""));
    expect(body.toLowerCase()).not.toContain("do you want");
    expect(body.toLowerCase()).not.toContain("are you sure");
    expect(body.toLowerCase()).not.toMatch(/database|supabase|rpc|canonical|mutation/);
    const guarded = applyGoalChangeMachineBodySafety({ body, authorization: auth });
    expect(guarded.blocked).toBe(false);
  });
});

describe("Slice 7D temp applied writer truth", () => {
  const tempApplied: SolGoalChangeConfirmationAuthorization = {
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: false,
    temporary_adjustment_confirmation_authorized: false,
    temporary_adjustment_apply_authorized: true,
    candidate_behavior_statement: ANGELA_NEW,
    temporary_candidate_behavior_statement: ANGELA_NEW,
    canonical_behavior_statement: ANGELA_PREV,
    pending_state: null,
    previous_behavior_statement: null,
    previous_commitment_id: null,
    active_commitment_id: "cmt_angela",
    pending_cleared: true,
    temporary_last_included_local_date: "2026-09-13",
    temporary_expires_at: "2026-09-14T04:00:00.000Z",
  };

  it("attaches TEMPORARY_OVERLAY_APPLIED_COACHING_NOTE only when temp apply is proven", () => {
    const user = String(
      buildInboundSolWriterMessages(packet("Yes", ANGELA_NEW), brief(), null, tempApplied)[1]
        ?.content ?? ""
    );
    expect(user).toContain("TEMPORARY_OVERLAY_APPLIED_COACHING_NOTE");
    expect(user).toContain('"verified_temporary_overlay_applied":true');
    expect(user).toContain(`"canonical_current_goal":"${ANGELA_PREV}"`);
    expect(user).toContain(`"temporary_effective_ask":"${ANGELA_NEW}"`);
    expect(user).toContain('"last_included_local_date":"2026-09-13"');
    expect(user).toContain('"pending_cleared":true');
    expect(user).toContain('"goal_change_apply_authorized":false');
    expect(user).toContain('"temporary_adjustment_apply_authorized":true');
    expect(user).not.toContain("GOAL_CHANGE_APPLIED_COACHING_NOTE");
  });

  it("does not attach temp applied note for temp confirmation (ask, do not assert)", () => {
    const confirm: SolGoalChangeConfirmationAuthorization = {
      ...tempApplied,
      temporary_adjustment_apply_authorized: false,
      temporary_adjustment_confirmation_authorized: true,
      pending_cleared: false,
      pending_state: "awaiting_confirmation",
    };
    const user = String(
      buildInboundSolWriterMessages(packet("10:30 through Sunday", ANGELA_PREV), brief(), null, confirm)[1]
        ?.content ?? ""
    );
    expect(user).not.toContain("TEMPORARY_OVERLAY_APPLIED_COACHING_NOTE");
    expect(user).not.toContain("GOAL_CHANGE_APPLIED_COACHING_NOTE");
    expect(user).toContain('"temporary_adjustment_confirmation_authorized":true');
    expect(user).toContain('"temporary_adjustment_apply_authorized":false');
    expect(user).toContain(`"canonical_behavior_statement":"${ANGELA_PREV}"`);
  });

  it("saved apply still uses saved note, not temp overlay note", () => {
    const user = String(
      buildInboundSolWriterMessages(packet("Yes", ANGELA_NEW), brief(), null, angelaApplied())[1]
        ?.content ?? ""
    );
    expect(user).toContain("GOAL_CHANGE_APPLIED_COACHING_NOTE");
    expect(user).not.toContain("TEMPORARY_OVERLAY_APPLIED_COACHING_NOTE");
  });

  it("proposal presence is not apply authorization in default writer state", () => {
    const user = String(buildInboundSolWriterMessages(packet("Yes", ANGELA_PREV), brief())[1]?.content ?? "");
    expect(user).not.toContain("TEMPORARY_OVERLAY_APPLIED_COACHING_NOTE");
    expect(user).not.toContain("GOAL_CHANGE_APPLIED_COACHING_NOTE");
    expect(user).toContain('"goal_change_apply_authorized":false');
  });
});
