import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  applyRelationshipExitGatedOverride,
  buildRelationshipExitLaneGuardrails,
  detectSmsRelationshipExitIntent,
} from "@/lib/sms-relationship-exit-intent";
import { isLikelySmsComplianceOrOptOutTurn } from "@/lib/v2-sms-conversation-brain-eligibility";

const REPO = path.join(__dirname, "..", "..");

function routeSrc(): string {
  return fs.readFileSync(path.join(REPO, "src/app/api/cron/sms-inbound-coach/route.ts"), "utf8");
}

describe("Slice D-lite — relationship exit integrity wire", () => {
  it("processV2NormalInboundOutcome wires relationship exit before proof spine", () => {
    const src = routeSrc();
    const fnStart = src.indexOf("async function processV2NormalInboundOutcome");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fnBody = src.slice(fnStart, fnStart + 180_000);
    expect(fnBody).toContain("detectSmsRelationshipExitIntent");
    expect(fnBody).toContain("applyRelationshipExitGatedOverride");
    expect(fnBody).toContain("relationship_exit_integrity");
    expect(fnBody).toContain("buildInboundV3RelationshipExitFacts");
    const overrideIdx = fnBody.indexOf("applyRelationshipExitGatedOverride");
    const proofIdx = fnBody.indexOf("const accountabilityProofMoment =", overrideIdx);
    expect(overrideIdx).toBeGreaterThanOrEqual(0);
    expect(proofIdx).toBeGreaterThan(overrideIdx);
  });

  it("done with texting abandonment triggers exit lane and blocks outcome write", () => {
    const det = detectSmsRelationshipExitIntent("I'm done with texting");
    expect(det.detected).toBe(true);
    expect(det.category).toBe("texting_soft_opt_out");
    expect(det.noOutcomeEvent).toBe(true);
    expect(applyRelationshipExitGatedOverride(det).should_write_outcome_event).toBe(false);
    const intentSrc = fs.readFileSync(
      path.join(REPO, "src/lib/sms-relationship-exit-intent.ts"),
      "utf8"
    );
    expect(intentSrc).toContain("DONE_WITH_TEXTING_ABANDON_RE");
    expect(intentSrc).toContain("done_with_texting_abandonment");
  });

  it("stop texting uses compliance heuristic but relationship exit exempts transactional legacy", () => {
    expect(isLikelySmsComplianceOrOptOutTurn("stop texting me")).toBe(true);
    const det = detectSmsRelationshipExitIntent("stop texting me");
    expect(det.detected).toBe(true);
    expect(det.category).toBe("texting_soft_opt_out");
    const src = routeSrc();
    expect(src).toContain(
      "isLikelySmsComplianceOrOptOutTurn(userMessage) && !relationshipExitLaneActive"
    );
  });

  it("relationship_exit_integrity is a non-outcome gated mode", () => {
    const src = routeSrc();
    expect(src).toContain('"relationship_exit_integrity"');
    expect(src).toContain("applyRelationshipExitGatedOverride");
    const g = applyRelationshipExitGatedOverride(
      detectSmsRelationshipExitIntent("I'm done with this app")
    );
    expect(g.should_write_outcome_event).toBe(false);
  });

  it("V3 guardrails mention do-not-claim cancelled/stopped/completed", () => {
    const g = buildRelationshipExitLaneGuardrails();
    expect(g).toMatch(/cancelled/i);
    expect(g).toMatch(/unsubscribed|opt out/i);
    expect(g).toMatch(/completed/i);
  });

  it("gated override clears final_event_type for spine insert", () => {
    const g = applyRelationshipExitGatedOverride(
      detectSmsRelationshipExitIntent("cancel my subscription")
    );
    expect(g.should_write_outcome_event).toBe(false);
    expect(g.final_event_type).toBeNull();
  });

  it("lane system prompt includes relationship exit guardrails", () => {
    const lane = fs.readFileSync(
      path.join(REPO, "src/lib/v3-inbound-relationship-lane.ts"),
      "utf8"
    );
    expect(lane).toContain("buildRelationshipExitLaneGuardrails");
    expect(lane).toContain("relationship_exit_integrity");
  });

  it("Twilio STOP remains webhook-only in twilio inbound route", () => {
    const twilio = fs.readFileSync(path.join(REPO, "src/app/api/twilio/inbound/route.ts"), "utf8");
    expect(twilio).toContain('if (isStopCommand(body))');
    expect(twilio).toContain("runStopFlow");
  });
});
