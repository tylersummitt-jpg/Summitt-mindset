import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const validateCronSecretMock = vi.hoisted(() => vi.fn());
const kickPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cron-auth", () => ({
  validateCronSecretRequest: validateCronSecretMock,
}));

vi.mock("@/lib/victory-media/kick-inbound-media-pipeline", () => ({
  kickInboundMediaPipeline: kickPipelineMock,
}));

import { GET } from "@/app/api/cron/victory-media/route";

const ZERO_RESULT = {
  b1Attempted: 0,
  b1Succeeded: 0,
  b2Attempted: 0,
  b2Succeeded: 0,
  normalized: 0,
  c1Attempted: 0,
};

const WORK_RESULT = {
  b1Attempted: 1,
  b1Succeeded: 1,
  b2Attempted: 1,
  b2Succeeded: 1,
  normalized: 1,
  c1Attempted: 0,
};

function cronRequest(): Request {
  return new Request("http://localhost/api/cron/victory-media");
}

describe("GET /api/cron/victory-media", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.VICTORY_MEDIA_MMS_INGEST_ENABLED;
  });

  it("rejects unauthorized requests without calling the pipeline", async () => {
    validateCronSecretMock.mockReturnValue(false);
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(kickPipelineMock).not.toHaveBeenCalled();
  });

  it("authorized request calls the pipeline exactly once", async () => {
    validateCronSecretMock.mockReturnValue(true);
    kickPipelineMock.mockResolvedValue(WORK_RESULT);
    const res = await GET(cronRequest());
    expect(res.status).toBe(200);
    expect(kickPipelineMock).toHaveBeenCalledTimes(1);
    expect(kickPipelineMock).toHaveBeenCalledWith();
  });

  it("pipeline success returns only the safe worker summary", async () => {
    validateCronSecretMock.mockReturnValue(true);
    kickPipelineMock.mockResolvedValue(WORK_RESULT);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await GET(cronRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      wake_source: "cron_victory_media",
      ...WORK_RESULT,
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        "b1Attempted",
        "b1Succeeded",
        "b2Attempted",
        "b2Succeeded",
        "c1Attempted",
        "normalized",
        "ok",
        "wake_source",
      ].sort()
    );
    expect(info).toHaveBeenCalledWith("[victory-media/cron] kick done", {
      wake_source: "cron_victory_media",
      ...WORK_RESULT,
    });
    info.mockRestore();
  });

  it("empty queue (zero attempts) is still success", async () => {
    validateCronSecretMock.mockReturnValue(true);
    kickPipelineMock.mockResolvedValue(ZERO_RESULT);
    const res = await GET(cronRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      wake_source: "cron_victory_media",
      ...ZERO_RESULT,
    });
    expect(kickPipelineMock).toHaveBeenCalledTimes(1);
  });

  it("pipeline throw returns 500 and does not retry in-route", async () => {
    validateCronSecretMock.mockReturnValue(true);
    kickPipelineMock.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(cronRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "pipeline_failed" });
    expect(kickPipelineMock).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("does not depend on the MMS ingest flag", async () => {
    process.env.VICTORY_MEDIA_MMS_INGEST_ENABLED = "false";
    validateCronSecretMock.mockReturnValue(true);
    kickPipelineMock.mockResolvedValue(ZERO_RESULT);
    const res = await GET(cronRequest());
    expect(res.status).toBe(200);
    expect(kickPipelineMock).toHaveBeenCalledTimes(1);
  });
});

describe("victory-media cron wire", () => {
  const routeSrc = readFileSync(
    join(process.cwd(), "src/app/api/cron/victory-media/route.ts"),
    "utf8"
  );
  const vercel = JSON.parse(
    readFileSync(join(process.cwd(), "vercel.json"), "utf8")
  ) as { crons: Array<{ path: string; schedule: string }> };

  it("reuses shared cron auth and calls the existing pipeline once", () => {
    expect(routeSrc).toContain("validateCronSecretRequest");
    expect(routeSrc).toContain("kickInboundMediaPipeline");
    expect(routeSrc).toContain("await kickInboundMediaPipeline()");
    expect((routeSrc.match(/kickInboundMediaPipeline\(/g) ?? []).length).toBe(1);
    expect(routeSrc).not.toContain("processInboundMediaJobB1");
    expect(routeSrc).not.toContain("processInboundMediaJobB2");
    expect(routeSrc).not.toContain("tryCorrelateInboundMmsC1Job");
    expect(routeSrc).not.toMatch(/\bwhile\s*\(/);
    expect(routeSrc).not.toContain("maxDuration");
  });

  it("is not gated by MMS ingest and is not a pending_semantics processor", () => {
    expect(routeSrc).not.toContain("VICTORY_MEDIA_MMS_INGEST_ENABLED");
    expect(routeSrc).not.toContain("isVictoryMediaMmsIngestEnabled");
    expect(routeSrc).not.toContain("pending_semantics");
    expect(routeSrc).not.toContain("Slice D");
  });

  it("does not send SMS, call OpenAI, write canonical media, or use vision", () => {
    expect(routeSrc).not.toContain("sendSMS");
    expect(routeSrc).not.toContain("sendSMSChunked");
    expect(routeSrc).not.toMatch(/\bopenai\b/i);
    expect(routeSrc).not.toMatch(/\bvision\b/i);
    expect(routeSrc).not.toContain("finalizeVictoryWinMedia");
    expect(routeSrc).not.toContain("v2_win_media");
    expect(routeSrc).not.toContain("sharp");
    expect(routeSrc).not.toContain("from(\"v2_win_media\")");
  });

  it("schedules /api/cron/victory-media every minute and preserves existing crons", () => {
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/victory-media",
      schedule: "* * * * *",
    });
    expect(
      vercel.crons.filter((c) => c.path === "/api/cron/victory-media")
    ).toHaveLength(1);
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/daily-sms",
      schedule: "*/5 * * * *",
    });
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/evening-sms",
      schedule: "*/5 * * * *",
    });
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/weekly-sms",
      schedule: "*/5 * * * *",
    });
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/challenge",
      schedule: "0 * * * *",
    });
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/sms-inbound-coach",
      schedule: "* * * * *",
    });
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/quotes-book-fulfillment",
      schedule: "0 15 * * *",
    });
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/account-deletions",
      schedule: "*/5 * * * *",
    });
  });
});
