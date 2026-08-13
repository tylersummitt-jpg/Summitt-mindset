import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const ENQUEUE = path.join(
  process.cwd(),
  "src/lib/victory-media/enqueue-inbound-media-jobs.ts"
);
const PARSE = path.join(process.cwd(), "src/lib/victory-media/parse-inbound-mms-media.ts");
const FLAGS = path.join(process.cwd(), "src/lib/victory-media/mms-ingest-flags.ts");

describe("twilio inbound — MMS A2 enqueue wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const enqueueSrc = fs.readFileSync(ENQUEUE, "utf8");
  const parseSrc = fs.readFileSync(PARSE, "utf8");
  const flagsSrc = fs.readFileSync(FLAGS, "utf8");

  it("imports maybeEnqueue helper and uses flag helper pattern", () => {
    expect(src).toContain("maybeEnqueueInboundMediaJobsFromTwilioParams");
    expect(flagsSrc).toContain('process.env.VICTORY_MEDIA_MMS_INGEST_ENABLED === "true"');
  });

  it("signature verification still precedes transport gate and identity", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const sigIdx = post.indexOf("verifyTwilioSignature");
    const gateIdx = post.indexOf("evaluateTwilioInboundTransportGate");
    const identityIdx = post.indexOf('from("sms_identities")');
    expect(sigIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeGreaterThan(sigIdx);
    expect(identityIdx).toBeGreaterThan(gateIdx);
  });

  it("image-only requires shared media eligibility before enqueue; still fastAck / no coach", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const ownedMarker = "No fabricated Body, no sms_inbound_messages, no coach job";
    const imageBlock = post.slice(
      post.indexOf(ownedMarker),
      post.indexOf('from("sms_inbound_messages")')
    );
    expect(imageBlock).toContain("canEnqueueInboundMedia");
    expect(imageBlock).toContain("isInboundMediaEnqueueAllowedByAccountDeletion");
    expect(imageBlock).toContain("getClerkPublicMetadata");
    expect(imageBlock).toContain("maybeEnqueueInboundMediaJobsFromTwilioParams");
    expect(imageBlock).toContain("return fastAckTwiml()");
    expect(imageBlock).not.toContain("ensureCoachJobPresent");
    expect(imageBlock).not.toContain('from("sms_inbound_messages")');
  });

  it("Body+photo uses same canEnqueueInboundMedia before media enqueue", () => {
    expect(src).toContain('from "@/lib/victory-media/mms-ingest-eligibility"');
    expect(src).toContain("canEnqueueInboundMedia");
    const post = src.slice(src.indexOf("export async function POST"));
    const lastMedia = post.lastIndexOf("maybeEnqueueInboundMediaJobsFromTwilioParams");
    const eligibilityBefore = post.lastIndexOf("canEnqueueInboundMedia", lastMedia);
    expect(eligibilityBefore).toBeGreaterThanOrEqual(0);
    expect(eligibilityBefore).toBeLessThan(lastMedia);
  });

  it("unresolved account deletion gates media enqueue without blocking coach call site", () => {
    expect(src).toContain("isInboundMediaEnqueueAllowedByAccountDeletion");
    const post = src.slice(src.indexOf("export async function POST"));
    const lastCoach = post.lastIndexOf("ensureCoachJobPresent");
    const deletionGate = post.lastIndexOf(
      "isInboundMediaEnqueueAllowedByAccountDeletion",
      lastCoach
    );
    const mediaBeforeCoach = post.lastIndexOf(
      "maybeEnqueueInboundMediaJobsFromTwilioParams",
      lastCoach
    );
    expect(deletionGate).toBeGreaterThanOrEqual(0);
    expect(deletionGate).toBeLessThan(mediaBeforeCoach);
    expect(mediaBeforeCoach).toBeLessThan(lastCoach);
    // Coach still invoked after media gate (deletion must not return early here).
    const betweenGateAndCoach = post.slice(deletionGate, lastCoach + 40);
    expect(betweenGateAndCoach).not.toMatch(
      /isInboundMediaEnqueueAllowedByAccountDeletion[\s\S]*return NextResponse\.json/
    );
  });

  it("reuses hasUnresolvedAccountDeletionRequest via deletion gate helper (no second query invent)", () => {
    const gatePath = path.join(
      process.cwd(),
      "src/lib/victory-media/mms-ingest-deletion-gate.ts"
    );
    const gateSrc = fs.readFileSync(gatePath, "utf8");
    expect(gateSrc).toContain('from "@/lib/account-deletion/deletion-guards"');
    expect(gateSrc).toContain("hasUnresolvedAccountDeletionRequest");
    expect(gateSrc).not.toContain("account_deletion_requests");
  });

  it("stopped identity short-circuits before media enqueue on body path", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const primaryStopCheck = post.lastIndexOf(
      "identity.sms_enabled !== true || typeof identity.stopped_at === \"string\""
    );
    const lastMedia = post.lastIndexOf("maybeEnqueueInboundMediaJobsFromTwilioParams");
    expect(primaryStopCheck).toBeGreaterThanOrEqual(0);
    expect(primaryStopCheck).toBeLessThan(lastMedia);
  });

  it("account deletion START revival remains separate from media gate", () => {
    expect(src).toContain("hasUnresolvedAccountDeletionRequest");
    const post = src.slice(src.indexOf("export async function POST"));
    const imageBlock = post.slice(
      post.indexOf("No fabricated Body, no sms_inbound_messages, no coach job"),
      post.indexOf('from("sms_inbound_messages")')
    );
    // Image-only uses shared media deletion gate helper, not inline START helper.
    expect(imageBlock).toContain("isInboundMediaEnqueueAllowedByAccountDeletion");
    expect(imageBlock).not.toContain("hasUnresolvedAccountDeletionRequest");
  });

  it("unknown identity image-only still fastAckTwiml before media enqueue", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const unknownBlock = post.slice(
      post.indexOf("if (!identity?.clerk_user_id)"),
      post.indexOf("const userId = identity.clerk_user_id")
    );
    expect(unknownBlock).toContain("transport.imageOnly");
    expect(unknownBlock).toContain("return fastAckTwiml()");
    expect(unknownBlock).not.toContain("maybeEnqueueInboundMediaJobsFromTwilioParams");
  });

  it("STOP/HELP/START return before media enqueue on body path", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    // Primary (non-duplicate) command block sits after sms_inbound_messages insert success.
    const afterInsert = post.slice(post.indexOf("if (isStopCommand(body))"));
    const stopIdx = afterInsert.indexOf("if (isStopCommand(body))");
    const helpIdx = afterInsert.indexOf("if (isHelpCommand(body))");
    const startIdx = afterInsert.indexOf("if (isStartCommand(body))");
    const safetyIdx = afterInsert.indexOf("inboundSafetyTwimlResponse");
    const mediaIdx = afterInsert.indexOf("maybeEnqueueInboundMediaJobsFromTwilioParams");
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(helpIdx).toBeGreaterThan(stopIdx);
    expect(startIdx).toBeGreaterThan(helpIdx);
    expect(safetyIdx).toBeGreaterThan(startIdx);
    expect(mediaIdx).toBeGreaterThan(safetyIdx);
  });

  it("safety return precedes media enqueue (no media on crisis consume)", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const safetyReturn = post.indexOf("return safetyTwiml");
    const mediaAfter = post.indexOf("maybeEnqueueInboundMediaJobsFromTwilioParams", safetyReturn);
    expect(safetyReturn).toBeGreaterThanOrEqual(0);
    expect(mediaAfter).toBeGreaterThan(safetyReturn);
    const between = post.slice(safetyReturn, mediaAfter);
    expect(between).not.toContain("maybeEnqueueInboundMediaJobsFromTwilioParams");
  });

  it("Body+photo coach path: media enqueue before coach, failure cannot skip coach call site", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    // Last ensureCoachJobPresent is primary path
    const lastCoach = post.lastIndexOf("ensureCoachJobPresent");
    const mediaBeforeCoach = post.lastIndexOf(
      "maybeEnqueueInboundMediaJobsFromTwilioParams",
      lastCoach
    );
    expect(mediaBeforeCoach).toBeGreaterThanOrEqual(0);
    expect(mediaBeforeCoach).toBeLessThan(lastCoach);
  });

  it("does not fetch MediaUrl / download / OpenAI / finalize in A2 modules", () => {
    expect(enqueueSrc).not.toMatch(/fetch\s*\(/);
    expect(enqueueSrc).not.toContain("OpenAI");
    expect(enqueueSrc).not.toContain("finalizeVictoryWinMedia");
    expect(enqueueSrc).not.toContain("normalizeVictory");
    expect(parseSrc).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/fetch\(\s*['`]https:\/\/api\.twilio\.com/);
  });

  it("insert uses pending_download and never stores MediaUrl column", () => {
    expect(enqueueSrc).toContain('status: "pending_download"');
    expect(enqueueSrc).toContain("expires_at: null");
    expect(enqueueSrc).not.toContain("media_url");
    expect(enqueueSrc).toContain("23505");
  });

  it("STOP/HELP/START parsers and TwiML copy unchanged", () => {
    expect(src).toContain('return ["stop", "unsubscribe", "cancel", "end"].includes(t)');
    expect(src).toContain(
      "You have been unsubscribed. Reply START to rejoin."
    );
    expect(src).toContain(
      "Summitt Mindset: Pat texts you about your commitment—reply honestly to those check-ins. Reply STOP to opt out."
    );
    expect(src).toContain(
      "Welcome back. Text check-ins are on; Pat will text you about your commitment. Reply STOP to opt out anytime."
    );
  });
});
