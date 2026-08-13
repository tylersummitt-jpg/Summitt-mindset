import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateTwilioInboundTransportGate,
  parseTwilioInboundNumMedia,
} from "@/lib/twilio-inbound-transport";

const ROUTE = path.join(process.cwd(), "src/app/api/twilio/inbound/route.ts");
const TRANSPORT = path.join(process.cwd(), "src/lib/twilio-inbound-transport.ts");

describe("parseTwilioInboundNumMedia", () => {
  it("missing / empty → 0", () => {
    expect(parseTwilioInboundNumMedia(null)).toBe(0);
    expect(parseTwilioInboundNumMedia(undefined)).toBe(0);
    expect(parseTwilioInboundNumMedia("")).toBe(0);
    expect(parseTwilioInboundNumMedia("   ")).toBe(0);
  });

  it("valid positive integers", () => {
    expect(parseTwilioInboundNumMedia("1")).toBe(1);
    expect(parseTwilioInboundNumMedia("2")).toBe(2);
    expect(parseTwilioInboundNumMedia("01")).toBe(1);
  });

  it("invalid / non-numeric → 0", () => {
    expect(parseTwilioInboundNumMedia("abc")).toBe(0);
    expect(parseTwilioInboundNumMedia("1.5")).toBe(0);
    expect(parseTwilioInboundNumMedia("1e2")).toBe(0);
    expect(parseTwilioInboundNumMedia("1abc")).toBe(0);
  });

  it("negative → 0", () => {
    expect(parseTwilioInboundNumMedia("-1")).toBe(0);
    expect(parseTwilioInboundNumMedia("-3")).toBe(0);
  });
});

describe("evaluateTwilioInboundTransportGate", () => {
  it("text-only accepted", () => {
    const g = evaluateTwilioInboundTransportGate({
      messageSid: "SMtext",
      from: "+15551234567",
      body: "Did the run",
      numMedia: 0,
    });
    expect(g.accept).toBe(true);
    expect(g.hasBody).toBe(true);
    expect(g.hasMedia).toBe(false);
    expect(g.imageOnly).toBe(false);
  });

  it("Body + NumMedia accepted as text path (not imageOnly)", () => {
    const g = evaluateTwilioInboundTransportGate({
      messageSid: "SMboth",
      from: "+15551234567",
      body: "Finished my 5K",
      numMedia: 1,
    });
    expect(g.accept).toBe(true);
    expect(g.hasBody).toBe(true);
    expect(g.hasMedia).toBe(true);
    expect(g.imageOnly).toBe(false);
  });

  it("image-only Body empty + NumMedia 1 accepted", () => {
    const g = evaluateTwilioInboundTransportGate({
      messageSid: "MAphoto",
      from: "+15551234567",
      body: "",
      numMedia: 1,
    });
    expect(g.accept).toBe(true);
    expect(g.hasBody).toBe(false);
    expect(g.hasMedia).toBe(true);
    expect(g.imageOnly).toBe(true);
  });

  it("missing Body + NumMedia missing/0 remains invalid", () => {
    expect(
      evaluateTwilioInboundTransportGate({
        messageSid: "SMx",
        from: "+15551234567",
        body: "",
        numMedia: 0,
      }).accept
    ).toBe(false);
  });

  it("invalid NumMedia + empty Body does not accept", () => {
    const n = parseTwilioInboundNumMedia("nope");
    expect(
      evaluateTwilioInboundTransportGate({
        messageSid: "SMx",
        from: "+15551234567",
        body: "",
        numMedia: n,
      }).accept
    ).toBe(false);
  });

  it("negative NumMedia + empty Body does not accept", () => {
    const n = parseTwilioInboundNumMedia("-1");
    expect(
      evaluateTwilioInboundTransportGate({
        messageSid: "SMx",
        from: "+15551234567",
        body: "",
        numMedia: n,
      }).accept
    ).toBe(false);
  });

  it("STOP + media is text path (hasBody), not imageOnly", () => {
    const g = evaluateTwilioInboundTransportGate({
      messageSid: "SMstop",
      from: "+15551234567",
      body: "STOP",
      numMedia: 1,
    });
    expect(g.accept).toBe(true);
    expect(g.imageOnly).toBe(false);
    expect(g.hasBody).toBe(true);
  });

  it("requires MessageSid and From", () => {
    expect(
      evaluateTwilioInboundTransportGate({
        messageSid: null,
        from: "+15551234567",
        body: "hi",
        numMedia: 0,
      }).accept
    ).toBe(false);
    expect(
      evaluateTwilioInboundTransportGate({
        messageSid: "SMx",
        from: "",
        body: "hi",
        numMedia: 0,
      }).accept
    ).toBe(false);
  });
});

describe("twilio inbound route — MMS A1 transport wire", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  const transportSrc = fs.readFileSync(TRANSPORT, "utf8");

  it("imports transport helpers", () => {
    expect(src).toContain('from "@/lib/twilio-inbound-transport"');
    expect(src).toContain("parseTwilioInboundNumMedia");
    expect(src).toContain("evaluateTwilioInboundTransportGate");
  });

  it("signature verification still precedes Body/NumMedia gate", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const sigIdx = post.indexOf("verifyTwilioSignature");
    const gateIdx = post.indexOf("evaluateTwilioInboundTransportGate");
    expect(sigIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeGreaterThan(sigIdx);
  });

  it("signature algorithm / raw body acquisition unchanged", () => {
    expect(src).toContain("const rawBody = await req.text()");
    expect(src).toContain("const params = new URLSearchParams(rawBody)");
    expect(src).toContain("createHmac(\"sha1\", TWILIO_AUTH_TOKEN)");
    expect(src).toContain("crypto.timingSafeEqual");
  });

  it("replaces Body-required gate with transport.accept", () => {
    expect(src).not.toContain("if (!messageSid || !from || !body)");
    expect(src).toContain("if (!transport.accept || !messageSid)");
  });

  it("image-only returns fastAckTwiml before sms_inbound_messages / coach job", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    // Owned image-only path (after identity) — not the unknown-phone fastAck branch.
    const ownedImageOnlyMarker = "No fabricated Body, no sms_inbound_messages, no coach job";
    const imageOnlyIdx = post.indexOf(ownedImageOnlyMarker);
    const messagesIdx = post.indexOf('from("sms_inbound_messages")');
    const coachIdx = post.indexOf("ensureCoachJobPresent");
    expect(imageOnlyIdx).toBeGreaterThanOrEqual(0);
    expect(messagesIdx).toBeGreaterThan(imageOnlyIdx);
    expect(coachIdx).toBeGreaterThan(imageOnlyIdx);
    const imageBlock = post.slice(imageOnlyIdx, messagesIdx);
    expect(imageBlock).toContain("return fastAckTwiml()");
    expect(imageBlock).toContain("if (transport.imageOnly)");
    expect(imageBlock).not.toContain("ensureCoachJobPresent");
    expect(imageBlock).not.toContain('from("sms_inbound_messages")');
    expect(imageBlock).not.toContain("OpenAI");
  });

  it("does not fabricate inbound Body for image-only", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const ownedImageOnlyMarker = "No fabricated Body, no sms_inbound_messages, no coach job";
    const imageBlock = post.slice(
      post.indexOf(ownedImageOnlyMarker),
      post.indexOf('from("sms_inbound_messages")')
    );
    expect(imageBlock).not.toMatch(/raw_body:\s*["']/);
    expect(imageBlock).not.toMatch(/body\s*=\s*["'][^"']+["']/);
  });

  it("route does not fetch MediaUrl or write media jobs inline", () => {
    expect(src).not.toContain("MediaUrl");
    expect(src).not.toContain("MediaContentType");
    expect(src).not.toContain("v2_inbound_media_job");
    expect(src).not.toMatch(/fetch\(\s*['`]https:\/\/api\.twilio\.com/);
  });

  it("STOP/HELP/START parsers and TwiML copy unchanged", () => {
    expect(src).toContain('return ["stop", "unsubscribe", "cancel", "end"].includes(t)');
    expect(src).toContain('return ["start", "unstop"].includes(t)');
    expect(src).toContain('return ["help", "info"].includes(t)');
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

  it("STOP/HELP/START still run on hasBody path before safety / coach", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    const afterImageOnly = post.slice(post.indexOf("if (transport.imageOnly)"));
    const stopIdx = afterImageOnly.indexOf("isStopCommand(body)");
    const helpIdx = afterImageOnly.indexOf("isHelpCommand(body)");
    const startIdx = afterImageOnly.indexOf("isStartCommand(body)");
    const safetyIdx = afterImageOnly.indexOf("inboundSafetyTwimlResponse");
    const coachIdx = afterImageOnly.indexOf("ensureCoachJobPresent");
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(helpIdx).toBeGreaterThan(stopIdx);
    expect(startIdx).toBeGreaterThan(helpIdx);
    expect(safetyIdx).toBeGreaterThan(startIdx);
    expect(coachIdx).toBeGreaterThan(safetyIdx);
  });

  it("transport helper has no media download / OpenAI / Win logic", () => {
    expect(transportSrc).not.toContain("OpenAI");
    expect(transportSrc).not.toContain("MediaUrl");
    expect(transportSrc).not.toContain("v2_inbound_media_job");
    expect(transportSrc).not.toContain("v2_win");
    expect(transportSrc).not.toContain("fetch(");
  });
});
