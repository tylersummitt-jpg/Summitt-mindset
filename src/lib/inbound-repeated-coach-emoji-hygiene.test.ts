import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { applyOrdinaryInboundRepeatedCoachEmojiHygiene } from "@/lib/inbound-repeated-coach-emoji-hygiene";
import { RECENT_SENT_COACH_EMOJI_LOOKBACK } from "@/lib/morning-tto-repeated-emoji-hygiene";

function coach(body: string) {
  return { sender: "coach" as const, body };
}
function user(body: string) {
  return { sender: "user" as const, body };
}

const ROUTE = join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const TURN = join(process.cwd(), "src/lib/inbound-sol-relationship-turn.ts");
const WRITER = join(process.cwd(), "src/lib/inbound-sol-writer.ts");
const GENERATE = join(process.cwd(), "src/lib/tyler-text-overview-generate.ts");
const WEEKLY = join(process.cwd(), "src/lib/tyler-text-overview-weekly-generate.ts");
const MANUAL = join(process.cwd(), "src/lib/admin-manual-pat-answers.ts");
const HELPER = join(process.cwd(), "src/lib/inbound-repeated-coach-emoji-hygiene.ts");

function solMainBlock(src: string): string {
  const start = src.indexOf("if (\n      isInboundSolMainCoachingBranch");
  const sent = src.indexOf("inbound_sol_main_sent", start);
  expect(start).toBeGreaterThan(0);
  expect(sent).toBeGreaterThan(start);
  return src.slice(start, sent + "inbound_sol_main_sent".length);
}

function goalChangeOwnedBlock(src: string): string {
  const start = src.indexOf("async function sendSolGoalChangeOwnedPendingInboundReply");
  const end = src.indexOf("async function sendSolGoalChangePendingConfirmInboundReply");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

function commitAndSendBlock(src: string): string {
  const start = src.indexOf("async function commitAndSendInboundCoachReply");
  expect(start).toBeGreaterThan(0);
  return src.slice(start);
}

describe("ordinary inbound repeated Coach emoji hygiene", () => {
  it("lookback is the previous 5 successfully sent Coach SMS", () => {
    expect(RECENT_SENT_COACH_EMOJI_LOOKBACK).toBe(5);
  });

  it("1. member uses new emoji; Coach history lacks it → KEEP", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "That's a win. Enjoy it tonight. 🩵",
        exactThreadMessages: [user("Finally got it done 🩵"), coach("How did it go?")],
      })
    ).toBe("That's a win. Enjoy it tonight. 🩵");
  });

  it("2. recent Coach history contains same emoji → STRIP", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "Proud of that finish. 🩵",
        exactThreadMessages: [
          user("Finally got it done 🩵"),
          coach("That's a win. Enjoy it tonight. 🩵"),
          user("Thanks"),
        ],
      })
    ).toBe("Proud of that finish.");
  });

  it("3. prior USER emoji only does not count as Coach repetition", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "That's a win. Enjoy it tonight. 🩵",
        exactThreadMessages: [user("Finally got it done 🩵"), coach("Got it.")],
      })
    ).toBe("That's a win. Enjoy it tonight. 🩵");
  });

  it("4. emoji only outside 5-Coach-message lookback is allowed", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "That's a big win. 🩵",
        exactThreadMessages: [
          coach("Old stamp. 🩵"),
          coach("One."),
          coach("Two."),
          coach("Three."),
          coach("Four."),
          coach("Five."),
        ],
      })
    ).toBe("That's a big win. 🩵");
  });

  it("5. unseen emoji is retained", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "That was strong work. 🙌",
        exactThreadMessages: [coach("Great job today. 🩵")],
      })
    ).toBe("That was strong work. 🙌");
  });

  it("6. no emoji body is unchanged", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "Keep going tomorrow.",
        exactThreadMessages: [coach("Great job today. 🩵")],
      })
    ).toBe("Keep going tomorrow.");
  });

  it("7. multiple emoji: only repeated Coach stamp removed", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "Strong work. 🩵 🙌",
        exactThreadMessages: [coach("Great job today. 🩵")],
      })
    ).toBe("Strong work. 🙌");
  });

  it("8. spacing/punctuation stays clean after strip", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "That's a win 🩵!",
        exactThreadMessages: [coach("Nice 🩵")],
      })
    ).toBe("That's a win!");
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "Keep going. 🩵",
        exactThreadMessages: [coach("Nice 🩵")],
      })
    ).toBe("Keep going.");
  });

  it("empty-after-strip preserves original body", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "🩵",
        exactThreadMessages: [coach("Nice 🩵")],
      })
    ).toBe("🩵");
  });

  it("does not substitute a different emoji", () => {
    const out = applyOrdinaryInboundRepeatedCoachEmojiHygiene({
      body: "Keep going tomorrow. 🩵",
      exactThreadMessages: [coach("Great job today. 🩵")],
    });
    expect(out).toBe("Keep going tomorrow.");
    expect(out).not.toMatch(/💙|🧡|🙌/);
  });

  it("A canary: Brooke-style stamp is stripped", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "Proud of you for getting it done. 🩵",
        exactThreadMessages: [coach("That's a win. Enjoy it tonight. 🩵")],
      })
    ).toBe("Proud of you for getting it done.");
  });

  it("B canary: first natural mirror is kept", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "That's a win. Enjoy it tonight. 🩵",
        exactThreadMessages: [user("Thank you 🩵"), coach("How did lifting go?")],
      })
    ).toBe("That's a win. Enjoy it tonight. 🩵");
  });

  it("C canary: user-only history does not strip", () => {
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: "That's a win. Enjoy it tonight. 🩵",
        exactThreadMessages: [
          user("Finally got it done 🩵"),
          coach("How did it go?"),
          user("Thank you 🩵"),
        ],
      })
    ).toBe("That's a win. Enjoy it tonight. 🩵");
  });

  it("D canary: no repeated emoji, raw body == final body", () => {
    const raw = "Proud you finished before lunch.";
    expect(
      applyOrdinaryInboundRepeatedCoachEmojiHygiene({
        body: raw,
        exactThreadMessages: [user("Done."), coach("How did it go?")],
      })
    ).toBe(raw);
  });
});

describe("ordinary inbound repeated Coach emoji hygiene wire", () => {
  const src = readFileSync(ROUTE, "utf8");
  const turn = readFileSync(TURN, "utf8");
  const writer = readFileSync(WRITER, "utf8");
  const generate = readFileSync(GENERATE, "utf8");
  const weekly = readFileSync(WEEKLY, "utf8");
  const manual = readFileSync(MANUAL, "utf8");
  const helper = readFileSync(HELPER, "utf8");
  const main = solMainBlock(src);
  const owned = goalChangeOwnedBlock(src);
  const send = commitAndSendBlock(src);

  it("9/10. ordinary Sol-main persist and telemetry use the hygiened body", () => {
    expect(src).toContain(
      'from "@/lib/inbound-repeated-coach-emoji-hygiene"'
    );
    expect(main).toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    const hygieneIdx = main.indexOf("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    const persistIdx = main.lastIndexOf("reply_body: inboundReplyBody");
    const telemetryIdx = main.lastIndexOf("replyBody: inboundReplyBody");
    expect(hygieneIdx).toBeGreaterThan(0);
    expect(persistIdx).toBeGreaterThan(hygieneIdx);
    expect(telemetryIdx).toBeGreaterThan(hygieneIdx);
    expect(main).toContain("exactThreadMessages: solTurn.packet?.exact_thread.messages");
    expect(main).toContain("body: solTurn.body");
  });

  it("10. Twilio send uses stored reply_body, not a second transform", () => {
    expect(send).toContain("const bodyToSend = (latestForSend.reply_body || \"\").trim() || replyBody");
    expect(send).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(send).not.toContain("applyRepeatedCoachEmojiHygiene");
  });

  it("11. writer capture/raw_response stays on the turn writer, not the hygiened body", () => {
    expect(turn).toContain("written.capture");
    expect(turn).toContain("inbound_sol_body_preview: previewInboundText(guarded.body)");
    expect(turn).toContain("inbound_sol_body_hash: hashInboundText(guarded.body)");
    expect(turn).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(turn).not.toContain("applyRepeatedCoachEmojiHygiene");
    expect(writer).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(writer).not.toContain("applyRepeatedCoachEmojiHygiene");
  });

  it("12. reply_ready CAS miss sends stored body without re-hygiene", () => {
    const persistIdx = main.lastIndexOf("reply_body: inboundReplyBody");
    const miss = main.slice(persistIdx);
    expect(miss).toContain("if (!persistedSol)");
    expect(miss).toContain("j2?.reply_body?.trim()");
    expect(miss).toContain("commitAndSendInboundCoachReply(j2, userId, solThreadMemory)");
    const missHygiene = miss.indexOf("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(missHygiene).toBe(-1);
  });

  it("13. Goal Change-owned pending reply path is untouched", () => {
    expect(owned).toContain("runInboundSolRelationshipTurn");
    expect(owned).toContain("reply_body: body");
    expect(owned).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(owned).not.toContain("inboundReplyBody");
    expect(owned).not.toContain("applyRepeatedCoachEmojiHygiene");
  });

  it("14. manual Pat is unchanged", () => {
    expect(manual).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(manual).not.toContain("applyRepeatedCoachEmojiHygiene");
    expect(manual).not.toContain("inbound-repeated-coach-emoji-hygiene");
  });

  it("15. Morning/Evening/Weekly generate are untouched", () => {
    expect(generate).toContain("hygienedMorningEveningSmsBody");
    expect(generate).toContain("applyRepeatedCoachEmojiHygiene");
    expect(generate).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(generate).not.toContain("inbound-repeated-coach-emoji-hygiene");
    expect(weekly).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(weekly).not.toContain("applyRepeatedCoachEmojiHygiene");
    expect(weekly).not.toContain("inbound-repeated-coach-emoji-hygiene");
  });

  it("16. photo_requested still comes from Sol turn, not hygiene", () => {
    expect(main).toContain("photoRequested: solTurn.photoRequested === true");
    expect(helper).not.toContain("photo_requested");
    expect(helper).not.toContain("photoRequested");
  });

  it("17. block-only no-send path does not run hygiene", () => {
    const noSend = main.indexOf("if (!solTurn.shouldSend || !solTurn.body?.trim())");
    const hygieneIdx = main.indexOf("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(noSend).toBeGreaterThan(0);
    expect(hygieneIdx).toBeGreaterThan(noSend);
    const noSendBlock = main.slice(noSend, hygieneIdx);
    expect(noSendBlock).toContain("inbound_sol_main_no_send");
    expect(noSendBlock).toContain("manual_pat_answer_needed");
    expect(noSendBlock).not.toContain("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
  });

  it("does not hygiene the Goal Change writer-failure fallback body", () => {
    const fallback = main.indexOf("inbound_sol_main_pending_ask_fallback");
    const hygieneIdx = main.indexOf("applyOrdinaryInboundRepeatedCoachEmojiHygiene");
    expect(fallback).toBeGreaterThan(0);
    expect(hygieneIdx).toBeGreaterThan(fallback);
    expect(main.slice(fallback, hygieneIdx)).not.toContain(
      "applyOrdinaryInboundRepeatedCoachEmojiHygiene"
    );
  });
});
