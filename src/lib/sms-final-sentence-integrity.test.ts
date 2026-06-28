import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { splitIntoChunks } from "@/lib/twilio";
import {
  dropMalformedTrailingSentence,
  extractFirstCompleteSentence,
  validateFinalSmsSentenceIntegrity,
} from "@/lib/sms-final-sentence-integrity";
import {
  applyUnifiedSmsFinalProductLawGuard,
  FINAL_SENTENCE_INTEGRITY_NO_SEND,
} from "@/lib/sms-final-product-law-guard";

const MALFORMED_COMPLETION =
  "Good on getting it done today! This is a wonderful step in giving each of your kids a genuine compliment every day. Keep up the Good";

describe("validateFinalSmsSentenceIntegrity", () => {
  it("blocks/repairs Keep up the Good tail", () => {
    const result = validateFinalSmsSentenceIntegrity(MALFORMED_COMPLETION);
    expect(result.ok).toBe(true);
    expect(result.repairApplied).toBe(true);
    expect(result.repairedBody).toBe(
      "Good on getting it done today! This is a wonderful step in giving each of your kids a genuine compliment every day."
    );
    expect(detectNoMalformed(result.repairedBody!)).toBe(true);
  });

  it("blocks Keep up the", () => {
    const result = validateFinalSmsSentenceIntegrity("Nice work today. Keep up the");
    expect(result.ok).toBe(true);
    expect(result.repairedBody).toBe("Nice work today.");
  });

  it("blocks dangling and / to / for endings", () => {
    for (const tail of ["and", "to", "for"]) {
      const body = `You made real progress on your calls ${tail}`;
      const result = validateFinalSmsSentenceIntegrity(body);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });

  it("blocks or repairs short sentence-like body without punctuation", () => {
    const result = validateFinalSmsSentenceIntegrity("Good on getting it done today");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_terminal_punctuation");
  });

  it("normal complete SMS passes", () => {
    const ok = validateFinalSmsSentenceIntegrity(
      "Good on getting it done today. That compliment counts."
    );
    expect(ok.ok).toBe(true);
    expect(ok.repairApplied).toBeUndefined();
  });

  it("repair drops only malformed final sentence", () => {
    const repaired = dropMalformedTrailingSentence(MALFORMED_COMPLETION);
    expect(repaired).toBe(
      "Good on getting it done today! This is a wonderful step in giving each of your kids a genuine compliment every day."
    );
    const stillBad = validateFinalSmsSentenceIntegrity(repaired!);
    expect(stillBad.ok).toBe(true);
  });

  it("fallback first sentence is complete with punctuation", () => {
    const fallback = extractFirstCompleteSentence(MALFORMED_COMPLETION);
    expect(fallback).toBe("Good on getting it done today!");
    const v = validateFinalSmsSentenceIntegrity(MALFORMED_COMPLETION);
    expect(v.repairedBody).toContain("Good on getting it done today");
  });

  it("sendSMSChunked does not cut mid-sentence for long complete body", () => {
    const body =
      "First sentence is complete. Second sentence is complete. Third sentence is complete.";
    const chunks = splitIntoChunks(body, 35);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(/[.!?]$/.test(chunk.trim())).toBe(true);
    }
    expect(chunks.join(" ")).toBe(body);
  });
});

describe("applyUnifiedSmsFinalProductLawGuard — sentence integrity choke point", () => {
  it("inbound hard_route_bypass still checks malformed writer body", async () => {
    const result = await applyUnifiedSmsFinalProductLawGuard({
      mode: "hard_route_bypass",
      surface: "inbound",
      candidateBody: MALFORMED_COMPLETION,
    });
    expect(result.shouldSend).toBe(true);
    expect(result.body).not.toMatch(/Keep up the Good$/);
    expect(result.metadata.final_sentence_integrity_repair_applied).toBe(true);
  });

  it("daily surface hard_route_bypass repairs malformed body before Twilio", async () => {
    const result = await applyUnifiedSmsFinalProductLawGuard({
      mode: "hard_route_bypass",
      surface: "daily",
      candidateBody: MALFORMED_COMPLETION,
    });
    expect(result.shouldSend).toBe(true);
    expect(result.body).not.toMatch(/Keep up the Good$/);
    expect(result.checks_run).toContain("final_sentence_integrity");
  });

  it("no-send when body is only malformed fragment", async () => {
    const result = await applyUnifiedSmsFinalProductLawGuard({
      mode: "hard_route_bypass",
      surface: "inbound",
      candidateBody: "Keep up the Good",
    });
    expect(result.shouldSend).toBe(false);
    expect(result.noSendReason).toBe(FINAL_SENTENCE_INTEGRITY_NO_SEND);
  });
});

function detectNoMalformed(body: string): boolean {
  return validateFinalSmsSentenceIntegrity(body).ok;
}
