import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMaybeSingle, existingMaybeSingle, fromMock, seasonMaybeSingle, pastLimit, state } =
  vi.hoisted(() => {
    const insertMaybeSingle = vi.fn();
    const existingMaybeSingle = vi.fn();
    const seasonMaybeSingle = vi.fn();
    const pastLimit = vi.fn();
    const fromMock = vi.fn();
    const state = { lastInsertRow: null as Record<string, unknown> | null };
    return { insertMaybeSingle, existingMaybeSingle, fromMock, seasonMaybeSingle, pastLimit, state };
  });

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

import {
  isFutureLocalDateKey,
  loadOwnedSeasonForManualWin,
  occurredAtIsoFromLocalDateKey,
  persistManualV2Win,
  validateManualWinInputs,
} from "@/lib/v2-win-manual-persist";
import { countActiveWinsByCommitmentIds } from "@/lib/v2-victory-season-list";
import { mapV2WinRowToPublicDto } from "@/lib/v2-win-public-read";

const REQ = "550e8400-e29b-41d4-a716-446655440000";
const REQ2 = "550e8400-e29b-41d4-a716-446655440001";

function ownedSeason(overrides: Record<string, unknown> = {}) {
  return {
    id: "season-1",
    clerk_user_id: "user_1",
    commitment_id: "c-owned",
    season_name: "Season 2",
    status: "active",
    started_at: "2026-05-01T12:00:00Z",
    ended_at: null,
    goal_snapshot: { behavior_statement: "Lift weights for 30 minutes a day" },
    ...overrides,
  };
}

describe("v2-win-manual-persist validation", () => {
  it("accepts Done / Did the goal! / 80 chars and blank details", () => {
    expect(
      validateManualWinInputs({
        title: "Done",
        details: "",
        occurredOn: "2026-08-01",
        clientRequestId: REQ,
        timeZone: "America/New_York",
      }).ok
    ).toBe(true);
    expect(
      validateManualWinInputs({
        title: "Did the goal!",
        details: null,
        occurredOn: "2026-08-01",
        clientRequestId: REQ,
        timeZone: "UTC",
      }).ok
    ).toBe(true);
    expect(
      validateManualWinInputs({
        title: "a".repeat(80),
        details: "b".repeat(240),
        occurredOn: "2026-08-01",
        clientRequestId: REQ,
        timeZone: "UTC",
      }).ok
    ).toBe(true);
  });

  it("rejects whitespace-only, 81 title, 241 details, future date", () => {
    expect(
      validateManualWinInputs({
        title: "   ",
        occurredOn: "2026-08-01",
        clientRequestId: REQ,
        timeZone: "UTC",
      }).ok
    ).toBe(false);
    expect(
      validateManualWinInputs({
        title: "a".repeat(81),
        occurredOn: "2026-08-01",
        clientRequestId: REQ,
        timeZone: "UTC",
      }).ok
    ).toBe(false);
    expect(
      validateManualWinInputs({
        title: "Done",
        details: "b".repeat(241),
        occurredOn: "2026-08-01",
        clientRequestId: REQ,
        timeZone: "UTC",
      }).ok
    ).toBe(false);
    expect(
      validateManualWinInputs({
        title: "Done",
        occurredOn: "2099-01-01",
        clientRequestId: REQ,
        timeZone: "UTC",
      })
    ).toMatchObject({ ok: false, code: "future_date" });
  });

  it("rejects unsafe content via existing evaluateTextSafetyTier law", () => {
    const r = validateManualWinInputs({
      title: "I want to kill myself",
      occurredOn: "2026-08-01",
      clientRequestId: REQ,
      timeZone: "UTC",
    });
    expect(r).toMatchObject({ ok: false, code: "unsafe_content" });
  });

  it("past dates accepted; future local date helper works", () => {
    expect(isFutureLocalDateKey("2020-01-01", "UTC")).toBe(false);
    expect(isFutureLocalDateKey("2099-12-31", "UTC")).toBe(true);
  });

  it("maps local date key to stable noon ISO (no day drift for UTC)", () => {
    const iso = occurredAtIsoFromLocalDateKey("2026-08-08", "UTC");
    expect(iso).toBe("2026-08-08T12:00:00.000Z");
  });
});

describe("v2-win-manual-persist season ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockImplementation((table: string) => {
      if (table === "user_accountability_season") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: seasonMaybeSingle,
              order: () => ({
                limit: () => ({
                  maybeSingle: seasonMaybeSingle,
                }),
              }),
              in: () => ({
                order: () => ({
                  limit: pastLimit,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
  });

  it("returns owned season and rejects foreign/missing", async () => {
    seasonMaybeSingle.mockResolvedValue({ data: ownedSeason(), error: null });
    const owned = await loadOwnedSeasonForManualWin({
      clerkUserId: "user_1",
      seasonId: "season-1",
    });
    expect(owned?.commitment_id).toBe("c-owned");

    seasonMaybeSingle.mockResolvedValue({
      data: ownedSeason({ clerk_user_id: "other" }),
      error: null,
    });
    expect(
      await loadOwnedSeasonForManualWin({ clerkUserId: "user_1", seasonId: "season-1" })
    ).toBeNull();

    seasonMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(
      await loadOwnedSeasonForManualWin({ clerkUserId: "user_1", seasonId: "missing" })
    ).toBeNull();
  });
});

describe("persistManualV2Win", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.lastInsertRow = null;
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_win") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.lastInsertRow = row;
            return {
              select: () => ({
                maybeSingle: insertMaybeSingle,
              }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: existingMaybeSingle,
            }),
          }),
        };
      }
      return {};
    });
  });

  it("persists Overall manual Win with required provenance law", async () => {
    insertMaybeSingle.mockResolvedValue({ data: { id: "win-overall" }, error: null });
    const r = await persistManualV2Win({
      clerkUserId: "user_1",
      clientRequestId: REQ,
      title: "Done",
      details: null,
      occurredOn: "2026-08-01",
      timeZone: "UTC",
      season: null,
    });
    expect(r).toMatchObject({ ok: true, status: "inserted", id: "win-overall" });
    const row = state.lastInsertRow!;
    expect(row.source_type).toBe("manual");
    expect(row.recognition_mode).toBe("user_identified");
    expect(row.candidate_ordinal).toBe(0);
    expect(row.commitment_id).toBeNull();
    expect(row.relationship_type).toBe("whole_life");
    expect(row.source_message_sid).toBeNull();
    expect(row.source_message_id).toBeNull();
    expect(row.source_event_id).toBeNull();
    expect(row.supporting_quote).toBeNull();
    expect(row.why_meaningful).toBeNull();
    expect(row.model_confidence).toBeNull();
    expect(row.celebration_appropriate).toBe(false);
    expect(row.user_expressed_pride).toBe(false);
    expect(row.identity_related).toBe(false);
    expect(row.sensitivity_caution).toBe(false);
    expect(row.display_title).toBe("Done");
    expect(row.display_body).toBe("Done");
    expect(row.action_fact).toBe("Done");
    expect(row.idempotency_key).toBe(`win_v1:manual:user_1:${REQ}`);
    expect(row.schema_version).toBe("win_v1");
  });

  it("persists Season-attached manual Win from owned commitment_id", async () => {
    insertMaybeSingle.mockResolvedValue({ data: { id: "win-season" }, error: null });
    const r = await persistManualV2Win({
      clerkUserId: "user_1",
      clientRequestId: REQ,
      title: "Lifted",
      details: "Full set",
      occurredOn: "2026-01-01", // outside season window — still allowed
      timeZone: "UTC",
      season: { seasonId: "season-1", commitmentId: "c-owned" },
    });
    expect(r.ok).toBe(true);
    const row = state.lastInsertRow!;
    expect(row.commitment_id).toBe("c-owned");
    expect(row.relationship_type).toBe("goal");
    expect(row.display_body).toBe("Full set");
    // No season date-range check in persist path
    const persistSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-manual-persist.ts"),
      "utf8"
    );
    expect(persistSrc).not.toMatch(/started_at.*occurred|ended_at.*occurred|inside.*season/i);
  });

  it("idempotent same client_request_id returns existing", async () => {
    insertMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    existingMaybeSingle.mockResolvedValue({ data: { id: "win-existing" }, error: null });
    const r = await persistManualV2Win({
      clerkUserId: "user_1",
      clientRequestId: REQ,
      title: "Done",
      occurredOn: "2026-08-01",
      timeZone: "UTC",
    });
    expect(r).toMatchObject({ ok: true, status: "existing", id: "win-existing" });
  });

  it("different client_request_id creates distinct keys", async () => {
    insertMaybeSingle.mockResolvedValue({ data: { id: "w1" }, error: null });
    await persistManualV2Win({
      clerkUserId: "user_1",
      clientRequestId: REQ,
      title: "One",
      occurredOn: "2026-08-01",
      timeZone: "UTC",
    });
    const key1 = state.lastInsertRow!.idempotency_key;
    await persistManualV2Win({
      clerkUserId: "user_1",
      clientRequestId: REQ2,
      title: "Two",
      occurredOn: "2026-08-01",
      timeZone: "UTC",
    });
    const key2 = state.lastInsertRow!.idempotency_key;
    expect(key1).not.toBe(key2);
  });
});

describe("manual Win Overall + Season count integration", () => {
  it("public mapper includes manual overall row fields without special card type", () => {
    const dto = mapV2WinRowToPublicDto({
      id: "m1",
      occurred_at: "2026-08-08T12:00:00.000Z",
      display_title: "Done",
      display_body: "Done",
      supporting_quote: null,
      sensitivity_caution: false,
      celebration_appropriate: false,
      commitment_id: null,
      status: "active",
    });
    expect(dto.displayTitle).toBe("Done");
    expect(dto.commitmentId).toBeNull();
  });

  it("season count query includes active commitment-linked rows (manual or otherwise)", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{ commitment_id: "c-owned" }, { commitment_id: "c-owned" }, { commitment_id: "other" }],
      error: null,
    });
    fromMock.mockReturnValue({
      select: () => ({
        in: () => ({
          eq,
        }),
      }),
    });
    const counts = await countActiveWinsByCommitmentIds(["c-owned", "other"]);
    expect(counts.get("c-owned")).toBe(2);
    expect(counts.get("other")).toBe(1);
    expect(eq).toHaveBeenCalledWith("status", "active");
  });

  it("candidate_ordinal=0 is not treated as SMS-only origin in production persist", () => {
    const persistSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-persist.ts"),
      "utf8"
    );
    expect(persistSrc).toContain('source_type: "sms_inbound"');
    expect(persistSrc).not.toMatch(/candidate_ordinal\s*===\s*0[\s\S]{0,40}sms/);
    const manualSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-manual-persist.ts"),
      "utf8"
    );
    expect(manualSrc).toContain('source_type: "manual"');
    expect(manualSrc).toContain("candidate_ordinal: 0");
    expect(manualSrc).not.toContain("openai-win-recognition");
    expect(manualSrc).not.toContain("persistInboundWinsWithAccountability");
    expect(manualSrc).not.toContain("OpenAI(");
  });
});

describe("manual source_type migration", () => {
  it("only expands v2_win_source_type_chk to include manual", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260808120000_v2_win_source_type_manual.sql"),
      "utf8"
    );
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS v2_win_source_type_chk");
    expect(sql).toContain("ADD CONSTRAINT v2_win_source_type_chk");
    expect(sql).toContain("source_type IN ('sms_inbound', 'system_event', 'manual')");
    expect(sql).not.toContain("ALTER COLUMN");
    expect(sql).not.toMatch(/\bENABLE ROW LEVEL SECURITY\b|\bPOLICY\b|\bGRANT\b|\bREVOKE\b/);
    expect(sql).not.toContain("season_id");
    expect(sql).not.toContain("UPDATE ");
    expect(sql).not.toContain("candidate_ordinal");
    expect(sql).toMatch(/No RLS\/grants\/index changes/);
  });
});
