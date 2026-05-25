import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND } from "./sms-voice-ownership-static-policy";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

describe("sms-inbound-coach — proof callout V3 ownership (Slice 2)", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("does not use applyVictoryCalloutAfterSpineInsert or deterministic post-FVG append", () => {
    for (const forbidden of FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND) {
      expect(src).not.toContain(forbidden);
    }
    expect(src).not.toContain("calloutApplied =");
  });

  it("builds proof callout hint before inbound V3 lane", () => {
    expect(src).toContain("buildInboundProofCalloutHint");
    const hintIdx = src.indexOf("const proofCalloutHint = buildInboundProofCalloutHint");
    const laneIdx = src.indexOf("const laneRes = await produceInboundV3RelationshipSms");
    expect(hintIdx).toBeGreaterThan(0);
    expect(laneIdx).toBeGreaterThan(hintIdx);
    expect(src).toContain("proofCalloutHint,");
  });

  it("proof spine insert runs before hint telemetry patch; duplicate skips hint patch", () => {
    const spineBlock = src.slice(src.indexOf("let spineInsertSucceeded = false"));
    const insertIdx = spineBlock.indexOf('from("v2_commitment_event").insert');
    const patchIdx = spineBlock.indexOf("proof_callout_hint_offered_to_model");
    expect(insertIdx).toBeGreaterThan(0);
    expect(patchIdx).toBeGreaterThan(insertIdx);
    expect(spineBlock).toContain("spineInsertSucceeded && !spineInsertDuplicate");
    expect(spineBlock).not.toContain("applyVictoryCalloutAfterSpineInsert");
  });

  it("imports patchVictoryCalloutOnSpineEventBestEffort for hint telemetry only", () => {
    expect(src).toContain("patchVictoryCalloutOnSpineEventBestEffort");
  });

  it("safety short-circuit returns before normal outcome spine", () => {
    const handlerStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    const handlerSlice = src.slice(handlerStart, handlerStart + 3500);
    const safetyIdx = handlerSlice.indexOf("processInboundSmsSafetyShortCircuit");
    const normalIdx = handlerSlice.indexOf("processV2NormalInboundOutcome");
    expect(safetyIdx).toBeGreaterThan(0);
    expect(normalIdx).toBeGreaterThan(safetyIdx);
  });
});
