import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT } from "@/lib/inbound-sol-brief-interpreter";
import { INBOUND_SOL_WRITER_SYSTEM_PROMPT } from "@/lib/inbound-sol-writer";

const INTERPRETER = path.join(process.cwd(), "src/lib/inbound-sol-brief-interpreter.ts");
const WRITER = path.join(process.cwd(), "src/lib/inbound-sol-writer.ts");
const TURN = path.join(process.cwd(), "src/lib/inbound-sol-relationship-turn.ts");
const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const CHUNKS = path.join(process.cwd(), "src/lib/ask-pat/chunks.ts");

describe("commit 1 Pat personal-knowledge flag — isolation", () => {
  it("interpreter prompt classifies yes vs no vs unknown and forbids retrieval work", () => {
    const p = INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT;
    expect(p).toContain("inbound.requires_pat_personal_knowledge");
    expect(p).toContain("Were you nervous speaking in public?");
    expect(p).toContain("Did you ever struggle with confidence?");
    expect(p).toContain("What was your favorite championship team?");
    expect(p).toContain("How did having Tyler change your coaching?");
    expect(p).toContain("Did you ever lose your temper with a player?");
    expect(p).toContain("How did you become so disciplined?");
    expect(p).toContain("What would you tell me about handling pressure?");
    expect(p).toContain("How do I get more disciplined?");
    expect(p).toContain("I missed my workout.");
    expect(p).toContain("Work was terrible.");
    expect(p).toContain("What time does my morning text come?");
    expect(p).toContain("What did you learn from losing?");
    expect(p).toContain("Do not set yes merely because the text is about leadership");
    expect(p).toContain("You do NOT select a Pat story");
    expect(p).toContain("search books");
    expect(p).toContain("retrieve chunks");
    expect(p).toContain("write SMS");
  });

  it("writer identity and messages stay commit-1 unchanged", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "You are replying to the user's newest real text in one ongoing Coach Pat relationship."
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("You are Coach Pat Summitt");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("PAT_SOURCE_EVIDENCE");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain(
      "requires_pat_personal_knowledge"
    );
    const writer = fs.readFileSync(WRITER, "utf8");
    expect(writer).toContain("writeInboundSolBody");
    expect(writer).not.toContain("embeddings.create");
    expect(writer).not.toContain("getTopRelevantChunks");
    expect(writer).not.toContain("getPatEvidenceForSms");
  });

  it("orchestration still has no retrieval or embedding", () => {
    const turn = fs.readFileSync(TURN, "utf8");
    const interpreter = fs.readFileSync(INTERPRETER, "utf8");
    const route = fs.readFileSync(ROUTE, "utf8");
    for (const src of [turn, interpreter, route]) {
      expect(src).not.toContain("getTopRelevantChunks");
      expect(src).not.toContain("getPatEvidenceForSms");
      expect(src).not.toContain("embeddings.create");
      expect(src).not.toContain("PAT_SOURCE_EVIDENCE");
      expect(src).not.toContain("text-embedding-3-small");
    }
    expect(turn).toContain("await writeInboundSolBody({ packet, brief })");
    expect(turn.split("writeInboundSolBody({").length - 1).toBe(1);
    expect(turn.split("runInboundSolBriefInterpreter({").length - 1).toBe(1);
  });

  it("does not modify Ask Pat chunk helper", () => {
    const chunks = fs.readFileSync(CHUNKS, "utf8");
    expect(chunks).not.toContain("requires_pat_personal_knowledge");
    expect(chunks).toContain("export function getTopRelevantChunks");
  });
});
