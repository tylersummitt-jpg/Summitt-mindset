import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");

describe("sms-inbound-coach — backup safety guard wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports and defines processInboundSmsSafetyShortCircuit", () => {
    expect(src).toContain('from "@/lib/sms-inbound-safety"');
    expect(src).toContain("async function processInboundSmsSafetyShortCircuit");
  });

  it("runs safety guard after tapback and before processV2NormalInboundOutcome", () => {
    const handlerStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    const handlerSlice = src.slice(handlerStart, handlerStart + 3500);
    const tapbackIdx = handlerSlice.indexOf("isAppleMessengerTapbackLine");
    const safetyIdx = handlerSlice.indexOf("processInboundSmsSafetyShortCircuit");
    const normalIdx = handlerSlice.indexOf("processV2NormalInboundOutcome");
    expect(tapbackIdx).toBeGreaterThanOrEqual(0);
    expect(safetyIdx).toBeGreaterThan(tapbackIdx);
    expect(normalIdx).toBeGreaterThan(safetyIdx);
  });

  it("cancels unsafe jobs and checks outbound before send", () => {
    const fnStart = src.indexOf("async function processInboundSmsSafetyShortCircuit");
    const fnSlice = src.slice(fnStart, fnStart + 2200);
    expect(fnSlice).toContain('status: "cancelled"');
    expect(fnSlice).toContain("inbound_safety_cron_short_circuit");
    expect(fnSlice).toContain("!job.sent_at");
    expect(fnSlice).toContain("!job.outbound_message_sid");
  });
});
