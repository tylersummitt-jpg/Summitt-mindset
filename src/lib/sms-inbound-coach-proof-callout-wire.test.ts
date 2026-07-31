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

  it("proof spine persist runs before hint telemetry patch on main path", () => {
    const spineBlock = src.slice(src.indexOf("// 6) Accountability event spine"));
    const persistIdx = spineBlock.indexOf("tryPersistInboundAccountabilityOutcomeBeforeSend");
    const patchIdx = spineBlock.indexOf("proof_callout_hint_offered_to_model");
    expect(persistIdx).toBeGreaterThan(0);
    expect(patchIdx).toBeGreaterThan(persistIdx);
    expect(spineBlock).toContain("spineInsertSucceeded");
    expect(spineBlock).not.toContain("applyVictoryCalloutAfterSpineInsert");
  });

  it("imports patchVictoryCalloutOnSpineEventBestEffort for hint telemetry only", () => {
    expect(src).toContain("patchVictoryCalloutOnSpineEventBestEffort");
  });

  it("safety short-circuit returns before normal outcome spine", () => {
    // Contract: inside handleV2SmsInboundCoachJob, safety short-circuit runs before
    // processV2NormalInboundOutcome. Do not use a fixed character window — the handler
    // prologue (reconcile / tapback / blocker gate) is larger than 3500 chars.
    const handlerStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    expect(handlerStart).toBeGreaterThan(0);
    const safetyCallIdx = src.indexOf("await processInboundSmsSafetyShortCircuit(", handlerStart);
    const normalCallIdx = src.indexOf("await processV2NormalInboundOutcome(", handlerStart);
    expect(safetyCallIdx).toBeGreaterThan(handlerStart);
    expect(normalCallIdx).toBeGreaterThan(safetyCallIdx);
  });
});
