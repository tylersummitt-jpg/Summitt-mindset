import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { computeRecommitBindingText } from "@/lib/v2-adaptive-contract";
import { detectRelationshipCoachingVoiceBlockedReasons } from "@/lib/v3-sms-voice-ownership";
import { detectRelationshipRobotConsentMenuReasons } from "@/lib/relationship-robot-consent-menu";

describe("detectRelationshipRobotConsentMenuReasons", () => {
  it("flags Reply YES/NO menu phrases", () => {
    expect(
      detectRelationshipRobotConsentMenuReasons("Reply YES to confirm or NO to discard.")
    ).toContain("reply_yes_no_menu_language");
    expect(
      detectRelationshipRobotConsentMenuReasons("Reply YES to commit or NO to pause.")
    ).toContain("reply_yes_no_menu_language");
    expect(detectRelationshipRobotConsentMenuReasons("Reply YES or NO if that works.")).toContain(
      "reply_yes_no_menu_language"
    );
    expect(detectRelationshipRobotConsentMenuReasons("YES to confirm.")).toContain(
      "reply_yes_no_menu_language"
    );
  });

  it("flags additional all-caps instruction verbs and naked YES/NO menus", () => {
    expect(detectRelationshipRobotConsentMenuReasons("Text YES if that works.")).toContain(
      "reply_yes_no_menu_language"
    );
    expect(detectRelationshipRobotConsentMenuReasons("Say NO if not.")).toContain(
      "reply_yes_no_menu_language"
    );
    expect(detectRelationshipRobotConsentMenuReasons("Respond YES to keep this.")).toContain(
      "reply_yes_no_menu_language"
    );
    expect(detectRelationshipRobotConsentMenuReasons("Send NO to stop this.")).toContain(
      "reply_yes_no_menu_language"
    );
    expect(detectRelationshipRobotConsentMenuReasons("YES or NO?")).toContain(
      "reply_yes_no_menu_language"
    );
  });

  it("allows natural lowercase yes/no and non-menu coaching", () => {
    expect(detectRelationshipRobotConsentMenuReasons("Tell me yes or no.")).toEqual([]);
    expect(detectRelationshipRobotConsentMenuReasons("Want me to hold you to that?")).toEqual([]);
    expect(detectRelationshipRobotConsentMenuReasons("reply yes if that works.")).toEqual([]);
    expect(detectRelationshipRobotConsentMenuReasons("text yes if that works.")).toEqual([]);
  });

  it("flags binding robot phrases when not exempted by binding verbatim", () => {
    expect(
      detectRelationshipRobotConsentMenuReasons(
        "Same commitment—keep this line for 7 days: Focused on work without distractions."
      )
    ).toContain("same_commitment_keep_this_line_robot_copy");
    expect(
      detectRelationshipRobotConsentMenuReasons(
        "Same focus—keep this line for 7 days: Focused on work without distractions."
      )
    ).toContain("same_commitment_keep_this_line_robot_copy");
    expect(detectRelationshipRobotConsentMenuReasons("Keep this line for 7 days.")).toContain(
      "same_commitment_keep_this_line_robot_copy"
    );
  });

  it("allows binding robot phrase once inside required verbatim binding", () => {
    const binding = computeRecommitBindingText("Focused on work without distractions");
    const body = `Let's make this simple. ${binding} Want me to keep holding you to this same focus for the week?`;
    const reasons = detectRelationshipRobotConsentMenuReasons(body, { bindingVerbatim: binding });
    expect(reasons).not.toContain("same_commitment_keep_this_line_robot_copy");
    expect(reasons).not.toContain("reply_yes_no_menu_language");
  });

  it("flags duplicate binding robot copy outside the verbatim binding", () => {
    const binding = computeRecommitBindingText("Call one person each day");
    const body = `Keep this line for 7 days. ${binding}`;
    const reasons = detectRelationshipRobotConsentMenuReasons(body, { bindingVerbatim: binding });
    expect(reasons).toContain("same_commitment_keep_this_line_robot_copy");
  });
});

describe("detectRelationshipCoachingVoiceBlockedReasons robot menu", () => {
  it("includes robotic_contract_menu_language umbrella when menu copy hits", () => {
    const reasons = detectRelationshipCoachingVoiceBlockedReasons(
      "Reply YES to confirm or NO to discard."
    );
    expect(reasons).toContain("reply_yes_no_menu_language");
    expect(reasons).toContain("robotic_contract_menu_language");
  });

  it("allows natural confirmation without Reply YES/NO", () => {
    const reasons = detectRelationshipCoachingVoiceBlockedReasons(
      "Want me to keep holding you to this same focus for the week?"
    );
    expect(reasons).not.toContain("reply_yes_no_menu_language");
    expect(reasons).not.toContain("robotic_contract_menu_language");
  });

  it("allows lowercase yes/no coaching phrasing", () => {
    const reasons = detectRelationshipCoachingVoiceBlockedReasons("Tell me yes or no.");
    expect(reasons).not.toContain("reply_yes_no_menu_language");
    expect(reasons).not.toContain("robotic_contract_menu_language");
  });
});
