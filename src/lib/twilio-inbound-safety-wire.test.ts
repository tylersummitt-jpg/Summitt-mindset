import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");

describe("twilio inbound — safety short-circuit wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports sms-inbound-safety", () => {
    expect(src).toContain('from "@/lib/sms-inbound-safety"');
    expect(src).toContain("classifyInboundSmsSafetyTier");
    expect(src).toContain("buildInboundSmsSafetyReplyBody");
  });

  it("runs STOP/HELP/START before safety classifier in POST handler", () => {
    const postStart = src.indexOf("export async function POST");
    const postSlice = src.slice(postStart);
    const stopIdx = postSlice.indexOf("isStopCommand(body)");
    const helpIdx = postSlice.indexOf("isHelpCommand(body)");
    const startIdx = postSlice.indexOf("isStartCommand(body)");
    const safetyIdx = postSlice.indexOf("inboundSafetyTwimlResponse");
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(helpIdx).toBeGreaterThan(stopIdx);
    expect(startIdx).toBeGreaterThan(helpIdx);
    expect(safetyIdx).toBeGreaterThan(startIdx);
  });

  it("duplicate webhook uses fastAck for unsafe without second twiml", () => {
    const dupBlock = src.slice(src.indexOf('if (code === "23505")'));
    expect(dupBlock).toContain("inboundSafetyTwimlResponse");
    expect(dupBlock).toContain("fastAckTwiml()");
  });

  it("does not enqueue coach job on primary safety short-circuit path", () => {
    const safetyReturn = src.indexOf("if (safetyTwiml)");
    const ensureAfter = src.indexOf("ensureCoachJobPresent", safetyReturn);
    expect(safetyReturn).toBeGreaterThanOrEqual(0);
    expect(ensureAfter).toBeGreaterThan(safetyReturn);
    const between = src.slice(safetyReturn, ensureAfter);
    expect(between).toContain("return safetyTwiml");
  });
});

/** Mirrors twilio/inbound normalizeBody + token lists (exact full-body compliance only). */
function normalizeBody(input: string) {
  return (input || "").trim().replace(/\s+/g, " ");
}

function isStopCommand(text: string) {
  const t = normalizeBody(text).toLowerCase();
  return ["stop", "unsubscribe", "cancel", "end"].includes(t);
}

function isHelpCommand(text: string) {
  const t = normalizeBody(text).toLowerCase();
  return ["help", "info"].includes(t);
}

function isStartCommand(text: string) {
  const t = normalizeBody(text).toLowerCase();
  return ["start", "unstop"].includes(t);
}

describe("twilio inbound — exact STOP/HELP/START tokens (P2)", () => {
  it("does not treat contextual stop/help/start phrases as compliance commands", () => {
    expect(isStopCommand("I need to stop smoking this week")).toBe(false);
    expect(isHelpCommand("I need help to stop drinking alcohol")).toBe(false);
    expect(isStartCommand("start waking up at 6am")).toBe(false);
  });

  it("still treats exact tokens as compliance commands", () => {
    expect(isStopCommand("STOP")).toBe(true);
    expect(isHelpCommand("HELP")).toBe(true);
    expect(isStartCommand("START")).toBe(true);
  });
});
