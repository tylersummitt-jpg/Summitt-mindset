import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const CONFIRM = path.join(process.cwd(), "src/lib/sol-goal-change-pending-confirm.ts");
const OPEN = path.join(process.cwd(), "src/lib/sol-goal-change-pending-open.ts");

describe("Slice 3 exclusive pending confirmation seam", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const confirm = fs.readFileSync(CONFIRM, "utf8");
  const open = fs.readFileSync(OPEN, "utf8");
  const pendingFnStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(
    pendingFnStart,
    src.indexOf("async function processV2CoachingRefreshInbound")
  );

  it("owns replace confirmation before tryHandleSmsInboundPendingResolution", () => {
    const slice3 = pendingBlock.indexOf("await runSolGoalChangePendingConfirmForInbound");
    const leftover = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    expect(slice3).toBeGreaterThan(0);
    expect(leftover).toBeGreaterThan(slice3);
    const between = pendingBlock.slice(slice3, leftover);
    expect(between).toContain("if (slice3.handled)");
    expect(between).toContain("return true");
    expect(between).toContain("runSolGoalChangeAwaitingCandidateForInbound");
  });

  it("reuses the existing canonical Goal Change helper, not a forked RPC", () => {
    expect(confirm).toContain("applyCanonicalGoalChangeWithSeasonMutation");
    expect(confirm).toContain('memoryReasonCode: "sms_pending_resolution_replace"');
    expect(confirm).toContain("getActiveCommitment");
    expect(src).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
    expect(open).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
  });

  it("does not fall through Slice 3 handled turns into leftover pending V3 apply", () => {
    const handledIdx = pendingBlock.indexOf("if (slice3.handled)");
    const handledBlock = pendingBlock.slice(handledIdx, pendingBlock.indexOf("const pendBefore"));
    expect(handledBlock).toContain("sendSolGoalChangePendingConfirmInboundReply");
    expect(handledBlock).not.toContain("tryHandleSmsInboundPendingResolution");
  });

  it("prefers Sol relationship writer after confirm consequence", () => {
    expect(src).toContain("sendSolGoalChangePendingConfirmInboundReply");
    expect(src).toContain('decisionReason: "sol_goal_change_pending_confirm"');
    expect(src).toContain("exclusiveLaneOwnsTurn: true");
    expect(src).toContain("goalChangeConfirmationAuthorization: authorization");
  });
});
