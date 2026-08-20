import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const WIN_REC = path.join(process.cwd(), "src/lib/openai-win-recognition-v1.ts");
const WIN_PERSIST = path.join(process.cwd(), "src/lib/v2-win-persist.ts");
const WIN_WIRE = path.join(process.cwd(), "src/lib/inbound-win-recognition-wire.ts");
const FACTS = path.join(process.cwd(), "src/lib/v3-inbound-relationship-lane.ts");
const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260731120000_v2_win.sql"
);

describe("inbound Win recognition wire / order (Umbrella 1)", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("imports recognition + persist helpers", () => {
    expect(src).toContain("runInboundWinRecognitionForCoachTurn");
    expect(src).toContain("persistInboundRecognizedWinsBeforeSend");
    expect(src).toContain("@/lib/inbound-win-recognition-wire");
  });

  it("runs Win recognition after gated decision and before V3 facts on main path", () => {
    const gatedIdx = src.indexOf("resolveV2InboundGatedDecision");
    const winIdx = src.indexOf(
      "// Shared Win recognition after exclusive route ownership + gated accountability are known."
    );
    const factsIdx = src.indexOf("const inboundFacts = buildInboundV3RelationshipFacts({");
    expect(gatedIdx).toBeGreaterThan(0);
    expect(winIdx).toBeGreaterThan(gatedIdx);
    expect(factsIdx).toBeGreaterThan(winIdx);
    expect(src).toContain("winRecognition: inboundWinRecognitionBundle.facts");
  });

  it("runs Win recognition before open-question V3 draft", () => {
    const winIdx = src.indexOf(
      'resolvedAccountabilityResult: `open_question_answer;deterministic=${eventType}`'
    );
    const factsIdx = src.indexOf("const oqInboundFacts = buildInboundV3RelationshipFacts({");
    const laneIdx = src.indexOf("const openLaneRes = await produceInboundV3RelationshipSms({");
    expect(winIdx).toBeGreaterThan(0);
    expect(factsIdx).toBeGreaterThan(winIdx);
    expect(laneIdx).toBeGreaterThan(factsIdx);
  });

  it("persists accountability before win persist before send on main spine", () => {
    const spineIdx = src.indexOf("// 6) Accountability event spine");
    const sendIdx = src.indexOf("// 7) Job reply");
    expect(spineIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(spineIdx);
    const spine = src.slice(spineIdx, sendIdx);
    const acctIdx = spine.indexOf("tryPersistInboundAccountabilityOutcomeBeforeSend");
    const winIdx = spine.indexOf("maybePersistInboundWinRecognitionBundle");
    expect(acctIdx).toBeGreaterThan(0);
    expect(winIdx).toBeGreaterThan(acctIdx);
    expect(spine).toContain("throwOnPersistError: gatedDecision.should_write_outcome_event");
    expect(spine).toContain("Win persistence after accountability spine; before send");
    expect(spine).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(spine).toContain("confirmedUserYes:");
  });

  it("Win persist failure is caught and does not replace accountability throwOnPersistError", () => {
    expect(src).toContain('console.warn("[win_persist_failed]"');
    expect(src).toMatch(
      /throwOnPersistError:\s*gatedDecision\.should_write_outcome_event/
    );
  });

  it("skips Win recognition only via eligibility (not hard-coded exit/identity skip)", () => {
    expect(src).toContain("isComplianceOrStop: isLikelySmsComplianceOrOptOutTurn(userMessage)");
    expect(src).not.toContain("skipExclusiveLane");
  });

  it("passes win facts into V3 facts type", () => {
    const factsSrc = fs.readFileSync(FACTS, "utf8");
    expect(factsSrc).toContain("win_recognition?: WinRecognitionFactsForV3");
    expect(factsSrc).toContain("buildInboundWinRecognitionLaneGuardrails");
    expect(factsSrc).toContain("may_claim_saved is always false");
  });
});

describe("static anti-regression — no keyword Win classifier", () => {
  const rec = fs.readFileSync(WIN_REC, "utf8");
  const persist = fs.readFileSync(WIN_PERSIST, "utf8");
  const wire = fs.readFileSync(WIN_WIRE, "utf8");
  const route = fs.readFileSync(ROUTE, "utf8");
  const migration = fs.readFileSync(MIGRATION, "utf8");

  it("does not add env flag / shadow mode for Win recognition", () => {
    expect(rec).not.toMatch(/WIN_RECOGNITION_ENABLED|FEATURE_.*WIN|shadow.?mode/i);
    expect(wire).not.toMatch(/process\.env\.[A-Z0-9_]*WIN/);
    expect(route).not.toMatch(/WIN_RECOGNITION_ENABLED/);
  });

  it("does not use user_yes as fallback Win authority", () => {
    expect(rec).toMatch(/Does not use accountability user_yes as fallback/);
    expect(rec).not.toMatch(/if\s*\(.*user_yes.*\)\s*\{[\s\S]{0,120}has_win:\s*true/);
    expect(persist).not.toMatch(/event_type === ["']user_yes["'].*insert/);
  });

  it("does not invent a keyword/regex meaning engine for Wins", () => {
    expect(rec).not.toMatch(/\/\\b(proud|courage|won)\\b\//);
    expect(rec).not.toMatch(/KEYWORD_WIN|WIN_PHRASE|detectWinFromKeywords/);
    expect(wire).not.toMatch(/detectWinFromKeywords|WIN_PHRASE_RE/);
  });

  it("does not append a hard-coded canned Win SMS", () => {
    expect(route).not.toMatch(/That's a Win!|Win detected\.|added to your Victory Room/);
    expect(route).not.toMatch(/body\s*\+=\s*[`'"].*Victory Room/);
  });

  it("avoids logging raw SMS body / supporting quote / full model output", () => {
    expect(rec).not.toMatch(/console\.(log|warn|error)\([^\)]*inboundMessage/);
    expect(wire).toContain("[win_recognition_result]");
    expect(wire).not.toMatch(/display_body|raw_body/);
    expect(persist).not.toMatch(/console\.(log|warn).*supporting_quote/);
    expect(persist).not.toMatch(/console\.(log|warn).*display_body/);
  });

  it("migration keeps whole-life Wins nullable and ON DELETE SET NULL for commitment", () => {
    expect(migration).toContain("commitment_id UUID NULL REFERENCES public.v2_commitment (id) ON DELETE SET NULL");
    expect(migration).toContain(
      "source_message_id UUID NULL REFERENCES public.sms_inbound_messages (id) ON DELETE SET NULL"
    );
    expect(migration).not.toMatch(/IF EXISTS[\s\S]{0,200}v2_win_source_message_id_fkey/);
    expect(migration).toContain("source_type IN ('sms_inbound', 'system_event')");
    expect(migration).toContain("candidate_ordinal IN (0, 1)");
  });

  it("wire exposes accountability merge persist path", () => {
    expect(wire).toContain("persistInboundWinsWithAccountability");
    expect(wire).toContain("confirmedUserYes");
    expect(wire).toContain("confirmedUserYesWinContextFromPersistResult");
    expect(wire).toContain("inboundMessage");
    expect(persist).toContain("buildAccountabilityWinIdempotencyKey");
    expect(persist).toContain("persistInboundWinsWithAccountability");
    expect(persist).toContain("acc_yes");
    expect(persist).toContain("classifyWinCandidatesEquivalenceV1");
    expect(persist).toContain("hideStaleRecognitionCompletionWinForAccountability");
  });

  it("C1 correlation is scheduled after successful persist, not before", () => {
    expect(wire).toContain("scheduleC1IfWinsDurable");
    const persistFn = wire.slice(
      wire.indexOf("export async function persistInboundRecognizedWinsBeforeSend")
    );
    const firstPersist = persistFn.indexOf("await persistInboundWinsWithAccountability");
    const firstHook = persistFn.indexOf("scheduleC1IfWinsDurable");
    expect(firstPersist).toBeGreaterThan(0);
    expect(firstHook).toBeGreaterThan(firstPersist);
    expect(persistFn).not.toContain("await tryCorrelateAwaitingInboundMmsForMessageSid");
  });

  it("confirmedUserYes helper only accepts inserted/duplicate user_yes", () => {
    expect(wire).toContain('args.eventType !== "user_yes"');
    expect(wire).toContain('args.persistStatus !== "inserted" && args.persistStatus !== "duplicate"');
  });
});

describe("inbound Win recognition — specialized lane coverage", () => {
  const src = fs.readFileSync(ROUTE, "utf8");

  it("shared post-gated Win recognition exists for pivot/arc/main reuse", () => {
    expect(src).toContain("Shared Win recognition after exclusive route ownership");
    expect(src).toContain("if (!inboundWinRecognitionBundle)");
  });

  it("transactional facts package runs Win recognition for pending/refresh/memory/contract/handoff", () => {
    const fnStart = src.indexOf("async function buildTransactionalInboundLaneFactsPackage");
    const fnEnd = src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend");
    expect(fnStart).toBeGreaterThan(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fn = src.slice(fnStart, fnEnd);
    expect(fn).toContain("runInboundWinRecognitionForCoachTurn");
    expect(fn).toContain("winRecognition: winRecognition.facts");
    expect(fn).toContain("return { facts, contextPacket: northStarPkt, winRecognition }");
  });

  it("transactional send helper persists Wins before Twilio send", () => {
    const fnStart = src.indexOf("async function persistInboundV3RelationshipLaneReplyReadyAndSend");
    const nextFn = src.indexOf("\nasync function ", fnStart + 10);
    const fn = src.slice(fnStart, nextFn > fnStart ? nextFn : fnStart + 25000);
    expect(fn).toContain("winRecognition?: InboundWinRecognitionBundle");
    expect(fn).toContain("maybePersistInboundWinRecognitionBundle");
    const persistIdx = fn.indexOf("maybePersistInboundWinRecognitionBundle");
    const sendIdx = fn.indexOf("commitAndSendInboundCoachReply");
    expect(persistIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(persistIdx);
  });

  it("central pivot and arc attach shared Win facts before draft", () => {
    expect(src).toContain("const pivotFacts = buildInboundV3RelationshipFacts({");
    const pivot = src.slice(
      src.indexOf("const pivotFacts = buildInboundV3RelationshipFacts({"),
      src.indexOf("const pivotLaneRes = await produceInboundV3RelationshipSms({")
    );
    expect(pivot).toContain("winRecognition: inboundWinRecognitionBundle.facts");
    const arc = src.slice(
      src.indexOf("const arcInboundFacts = buildInboundV3RelationshipFacts({"),
      src.indexOf("const arcLaneRes = await produceInboundV3RelationshipSms({")
    );
    expect(arc).toContain("winRecognition: inboundWinRecognitionBundle.facts");
  });

  it("blocker capture runs its own Win recognition before draft", () => {
    const blkStart = src.indexOf("async function processV2BlockerCapture");
    const nextFn = src.indexOf("\nasync function ", blkStart + 10);
    const blk = src.slice(blkStart, nextFn > blkStart ? nextFn : blkStart + 50000);
    expect(blk).toContain("blockerWinRecognition = await runInboundWinRecognitionForCoachTurn");
    expect(blk).toContain("winRecognition: blockerWinRecognition.facts");
  });

  it("safety/STOP/tapback still skip Win recognition via eligibility helpers", () => {
    const wireSrc = fs.readFileSync(WIN_WIRE, "utf8");
    expect(wireSrc).toContain("shouldRunWinRecognitionForInbound");
    expect(wireSrc).toContain("isTapback");
    expect(wireSrc).toContain("isSafetyOrCrisisOwned");
    expect(wireSrc).toContain("isComplianceOrStop");
    const handlerStart = src.indexOf("async function handleV2SmsInboundCoachJob");
    const safetyIdx = src.indexOf("await processInboundSmsSafetyShortCircuit(", handlerStart);
    const normalIdx = src.indexOf("await processV2NormalInboundOutcome(", handlerStart);
    expect(safetyIdx).toBeGreaterThan(handlerStart);
    expect(normalIdx).toBeGreaterThan(safetyIdx);
    expect(src).toContain("tapback_suppressed");
  });

  it("relationship-exit / identity-edit no longer hard-skip Win recognition", () => {
    expect(src).not.toContain("skipExclusiveLane");
    expect(src).not.toContain("relationshipExitLaneActive ||\n        identityEditLaneActive ||");
  });
});
