import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYLER_TEXT_OVERVIEW_ENABLED_ENV } from "@/lib/tyler-text-overview-types";

const generateTylerTextOverviewDraftForUser = vi.hoisted(() => vi.fn());
const generateTylerTextOverviewEveningPreviewForUser = vi.hoisted(() => vi.fn());
const loadTylerTextOverviewAudienceRow = vi.hoisted(() => vi.fn());
const generateTylerTextOverviewWeeklyDraftForUser = vi.hoisted(() => vi.fn());
const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  generateTylerTextOverviewDraftForUser,
  generateTylerTextOverviewEveningPreviewForUser,
  loadTylerTextOverviewAudienceRow,
}));

vi.mock("@/lib/tyler-text-overview-weekly-generate", () => ({
  generateTylerTextOverviewWeeklyDraftForUser,
}));

import { refreshUnsentTtoDraftsAfterRelationshipChange } from "@/lib/sol-goal-change-tto-draft-refresh";

type DraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string;
  status: string;
  current_body_to_send: string | null;
  current_body_source: string | null;
  edited_by_tyler: boolean;
};

const USER = "user_angela";
const NOW = new Date("2026-09-08T16:00:00.000Z");
const AUDIENCE = {
  clerk_user_id: USER,
  phone_number: "+1555",
  sms_enabled: true,
  stopped_at: null,
  timezone: "America/New_York",
  summitt_subscribed: true,
};

function draft(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: "d-morning",
    clerk_user_id: USER,
    draft_for_day_key: "2026-09-09",
    send_slot: "morning",
    status: "current",
    current_body_to_send: "OLD MORNING",
    current_body_source: "machine",
    edited_by_tyler: false,
    ...overrides,
  };
}

function installDrafts(
  rows: DraftRow[],
  options: { skipUpdateErrors?: Array<string | null>; queryError?: string } = {}
) {
  let updateAttempts = 0;
  supabaseFrom.mockImplementation((table: string) => {
    const state: { patch?: Record<string, unknown>; id?: string } = {};
    const execute = () => {
      if (state.patch && state.id) {
        const fail = options.skipUpdateErrors?.[updateAttempts++];
        if (typeof fail === "string") {
          return { data: null, error: { message: fail } };
        }
        const row = rows.find((r) => r.id === state.id);
        if (row && row.status === "current") {
          Object.assign(row, state.patch);
        }
        return {
          data:
            row && row.status !== "current"
              ? { id: row.id, status: row.status }
              : null,
          error: null,
        };
      }
      if (state.id) {
        const row = rows.find((r) => r.id === state.id);
        return {
          data: row ? { id: row.id, status: row.status } : null,
          error: null,
        };
      }
      if (options.queryError) {
        return { data: null, error: { message: options.queryError } };
      }
      return {
        data: rows.filter((r) => r.clerk_user_id === USER && r.status === "current"),
        error: null,
      };
    };
    const chain: {
      select: () => unknown;
      eq: (col: string, val: string) => unknown;
      in: () => unknown;
      update: (patch: Record<string, unknown>) => unknown;
      maybeSingle: () => Promise<unknown>;
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      select: () => chain,
      eq: (col: string, val: string) => {
        if (col === "id") state.id = val;
        return chain;
      },
      in: () => chain,
      update: (patch: Record<string, unknown>) => {
        state.patch = patch;
        return chain;
      },
      maybeSingle: () => Promise.resolve(execute()),
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
    };
    expect(table).toBe("sms_daily_drafts");
    return chain;
  });
}

describe("refreshUnsentTtoDraftsAfterRelationshipChange", () => {
  let rows: DraftRow[];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    rows = [];
    loadTylerTextOverviewAudienceRow.mockResolvedValue(AUDIENCE);
    generateTylerTextOverviewDraftForUser.mockImplementation(async (args: { draftForDayKey: string }) => {
      const row = rows.find(
        (r) =>
          r.send_slot === "morning" &&
          r.status === "current" &&
          r.draft_for_day_key === args.draftForDayKey
      );
      if (row) row.current_body_to_send = "FRESH MORNING";
      return { ok: true, body: "FRESH MORNING", currentDraftProtected: false };
    });
    generateTylerTextOverviewEveningPreviewForUser.mockImplementation(
      async (args: { draftForDayKey?: string }) => {
        const row = rows.find(
          (r) =>
            r.send_slot === "evening_checkin" &&
            r.draft_for_day_key === (args.draftForDayKey ?? r.draft_for_day_key)
        );
        if (row) row.current_body_to_send = "FRESH EVENING";
        return { ok: true, body: "FRESH EVENING", currentDraftProtected: false };
      }
    );
    generateTylerTextOverviewWeeklyDraftForUser.mockImplementation(async () => {
      const row = rows.find((r) => r.send_slot === "weekly_review" && r.status === "current");
      if (row) row.current_body_to_send = "FRESH WEEKLY";
      return { ok: true, draftForDayKey: "2026-09-06", currentDraftProtected: false };
    });
  });

  it("A: saved Goal Change path refreshes current unsent Morning draft", async () => {
    rows = [draft()];
    installDrafts(rows);
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(true);
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
    expect(rows[0]?.current_body_to_send).toBe("FRESH MORNING");
    expect(r.outcomes).toEqual([
      {
        draftId: "d-morning",
        sendSlot: "morning",
        draftForDayKey: "2026-09-09",
        status: "refreshed",
      },
    ]);
  });

  it("B: refreshes current unsent Evening draft", async () => {
    rows = [
      draft({
        id: "d-evening",
        send_slot: "evening_checkin",
        draft_for_day_key: "2026-09-08",
        current_body_to_send: "OLD EVENING",
      }),
    ];
    installDrafts(rows);
    await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(generateTylerTextOverviewEveningPreviewForUser).toHaveBeenCalledTimes(1);
    expect(rows[0]?.current_body_to_send).toBe("FRESH EVENING");
  });

  it("C: refreshes current unsent Weekly draft", async () => {
    rows = [
      draft({
        id: "d-weekly",
        send_slot: "weekly_review",
        draft_for_day_key: "2026-09-06",
        current_body_to_send: "OLD WEEKLY",
      }),
    ];
    installDrafts(rows);
    await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(generateTylerTextOverviewWeeklyDraftForUser).toHaveBeenCalledTimes(1);
    expect(rows[0]?.current_body_to_send).toBe("FRESH WEEKLY");
  });

  it("D-F: one helper refreshes all relevant unsent M/E/W drafts", async () => {
    rows = [
      draft(),
      draft({
        id: "d-evening",
        send_slot: "evening_checkin",
        draft_for_day_key: "2026-09-08",
        current_body_to_send: "OLD EVENING",
      }),
      draft({
        id: "d-weekly",
        send_slot: "weekly_review",
        draft_for_day_key: "2026-09-06",
        current_body_to_send: "OLD WEEKLY",
      }),
    ];
    installDrafts(rows);
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
    expect(generateTylerTextOverviewEveningPreviewForUser).toHaveBeenCalledTimes(1);
    expect(generateTylerTextOverviewWeeklyDraftForUser).toHaveBeenCalledTimes(1);
    expect(r.outcomes.map((o) => o.status)).toEqual(["refreshed", "refreshed", "refreshed"]);
    expect(rows.map((row) => row.current_body_to_send)).toEqual([
      "FRESH MORNING",
      "FRESH EVENING",
      "FRESH WEEKLY",
    ]);
  });

  it("K: already-sent draft is untouched", async () => {
    const sent = draft({
      id: "d-sent",
      status: "sent",
      current_body_to_send: "SENT BODY",
    });
    rows = [sent, draft({ id: "d-current" })];
    installDrafts(rows);
    await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(sent.current_body_to_send).toBe("SENT BODY");
    expect(sent.status).toBe("sent");
    expect(generateTylerTextOverviewDraftForUser).toHaveBeenCalledTimes(1);
  });

  it("L: helper never writes historical/superseded generation rows", async () => {
    rows = [draft()];
    installDrafts(rows);
    await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    for (const call of supabaseFrom.mock.calls) {
      expect(call[0]).toBe("sms_daily_drafts");
      expect(call[0]).not.toBe("sms_daily_draft_generations");
    }
  });

  it("M: Tyler-protected draft is not overwritten", async () => {
    rows = [
      draft({
        id: "d-tyler",
        current_body_to_send: "TYLER MANUAL BODY",
        current_body_source: "tyler_edit",
        edited_by_tyler: true,
      }),
    ];
    installDrafts(rows);
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(generateTylerTextOverviewDraftForUser).not.toHaveBeenCalled();
    expect(rows[0]?.current_body_to_send).toBe("TYLER MANUAL BODY");
    expect(r.outcomes[0]?.status).toBe("protected");
  });

  it("N: regeneration does not pass a stale commitment snapshot", async () => {
    rows = [draft(), draft({ id: "d-e", send_slot: "evening_checkin", draft_for_day_key: "2026-09-08" })];
    installDrafts(rows);
    await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    const morningArgs = generateTylerTextOverviewDraftForUser.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(morningArgs).toMatchObject({
      audienceUser: AUDIENCE,
      now: NOW,
      draftForDayKey: "2026-09-09",
      generationReason: "manual_regenerate",
      protectTylerProvenanceOnly: true,
    });
    expect(morningArgs).not.toHaveProperty("commitment");
    expect(morningArgs).not.toHaveProperty("behavior_statement");
    expect(morningArgs).not.toHaveProperty("packet");
    const eveningArgs = generateTylerTextOverviewEveningPreviewForUser.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(eveningArgs).not.toHaveProperty("commitment");
    expect(eveningArgs).not.toHaveProperty("behavior_statement");
    expect(generateTylerTextOverviewWeeklyDraftForUser).not.toHaveBeenCalled();
  });

  it("O: generation throw marks the unsent draft unusable and does not throw", async () => {
    rows = [draft()];
    installDrafts(rows);
    generateTylerTextOverviewDraftForUser.mockRejectedValue(new Error("writer down"));
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(true);
    expect(rows[0]?.status).toBe("skipped");
    expect(r.outcomes[0]?.status).toBe("skipped_unusable");
  });

  it("P: exact-send body is the newly persisted draft body", async () => {
    rows = [draft()];
    installDrafts(rows);
    await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(rows[0]?.current_body_to_send).toBe("FRESH MORNING");
  });

  it("generation ok:false marks current unsent draft skipped so stale cannot send", async () => {
    rows = [draft()];
    installDrafts(rows);
    generateTylerTextOverviewDraftForUser.mockResolvedValue({ ok: false, reason: "comms_prefs" });
    await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(rows[0]?.status).toBe("skipped");
    expect(rows[0]?.current_body_to_send).toBe("OLD MORNING");
  });

  it("C: generator failure + skip succeeds → stale body non-sendable", async () => {
    rows = [draft()];
    installDrafts(rows);
    generateTylerTextOverviewDraftForUser.mockResolvedValue({ ok: false, reason: "comms_prefs" });
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.outcomes[0]?.status).toBe("skipped_unusable");
    expect(rows[0]?.status).toBe("skipped");
    expect(rows[0]?.current_body_to_send).toBe("OLD MORNING");
  });

  it("D: generator failure + first skip attempt fails + retry succeeds", async () => {
    rows = [draft()];
    installDrafts(rows, { skipUpdateErrors: ["transient"] });
    generateTylerTextOverviewDraftForUser.mockRejectedValue(new Error("writer down"));
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.outcomes[0]?.status).toBe("skipped_unusable");
    expect(rows[0]?.status).toBe("skipped");
  });

  it("E: generator failure + all skip attempts fail → explicit unresolved failure", async () => {
    rows = [draft()];
    installDrafts(rows, { skipUpdateErrors: ["db1", "db2", "db3"] });
    generateTylerTextOverviewDraftForUser.mockRejectedValue(new Error("writer down"));
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("stale_draft_could_not_be_disabled");
    }
    expect(r.outcomes[0]?.status).toBe("stale_draft_could_not_be_disabled");
    expect(rows[0]?.status).toBe("current");
    expect(rows[0]?.current_body_to_send).toBe("OLD MORNING");
  });

  it("F: helper must not report skipped/safe when row remains current", async () => {
    rows = [draft()];
    installDrafts(rows, { skipUpdateErrors: ["db1", "db2", "db3"] });
    generateTylerTextOverviewDraftForUser.mockResolvedValue({ ok: false, reason: "insert_failed" });
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.outcomes.map((o) => o.status)).not.toContain("skipped_unusable");
    expect(r.outcomes.map((o) => o.status)).not.toContain("refreshed");
    expect(rows[0]?.status).toBe("current");
  });

  it("H: partial slot failure stays isolated", async () => {
    rows = [
      draft(),
      draft({
        id: "d-evening",
        send_slot: "evening_checkin",
        draft_for_day_key: "2026-09-08",
        current_body_to_send: "OLD EVENING",
      }),
    ];
    installDrafts(rows);
    generateTylerTextOverviewEveningPreviewForUser.mockRejectedValue(new Error("evening down"));
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.outcomes).toEqual([
      {
        draftId: "d-morning",
        sendSlot: "morning",
        draftForDayKey: "2026-09-09",
        status: "refreshed",
      },
      {
        draftId: "d-evening",
        sendSlot: "evening_checkin",
        draftForDayKey: "2026-09-08",
        status: "skipped_unusable",
      },
    ]);
    expect(rows[0]?.current_body_to_send).toBe("FRESH MORNING");
    expect(rows[0]?.status).toBe("current");
    expect(rows[1]?.status).toBe("skipped");
    expect(rows[1]?.current_body_to_send).toBe("OLD EVENING");
  });

  it("query failure does not claim refresh succeeded", async () => {
    rows = [draft()];
    installDrafts(rows, { queryError: "current_unsent_tto_drafts_query_failed" });
    const r = await refreshUnsentTtoDraftsAfterRelationshipChange({ clerkUserId: USER, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("query_failed");
    }
    expect(r.outcomes).toEqual([]);
    expect(generateTylerTextOverviewDraftForUser).not.toHaveBeenCalled();
    expect(rows[0]?.status).toBe("current");
    expect(rows[0]?.current_body_to_send).toBe("OLD MORNING");
  });
});

describe("stale M/E/W Goal Change draft refresh source law", () => {
  const refreshSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-tto-draft-refresh.ts"),
    "utf8"
  );
  const confirmSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-pending-confirm.ts"),
    "utf8"
  );
  const tempConfirmSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-temporary-confirm.ts"),
    "utf8"
  );
  const revertSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-temporary-revert.ts"),
    "utf8"
  );
  const openSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-pending-open.ts"),
    "utf8"
  );
  const pendingSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-temporary-pending.ts"),
    "utf8"
  );
  const replaceSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-temporary-replace.ts"),
    "utf8"
  );

  it("Q: no inbound English parsing added", () => {
    expect(refreshSrc).not.toMatch(/parseSmsConfirmation|inboundRaw|Yes but|Never mind/);
    expect(refreshSrc).not.toContain("runSolGoalChangeSemanticInterpreter");
  });

  it("reuses existing M/E/W generators and persist paths", () => {
    expect(refreshSrc).toContain("generateTylerTextOverviewDraftForUser");
    expect(refreshSrc).toContain("generateTylerTextOverviewEveningPreviewForUser");
    expect(refreshSrc).toContain("generateTylerTextOverviewWeeklyDraftForUser");
    expect(refreshSrc).toContain("protectTylerProvenanceOnly: true");
    expect(refreshSrc).not.toContain("from(SMS_DAILY_DRAFT_GENERATIONS_TABLE");
  });

  it("call sites are proof-gated one-liners with no per-slot TTO logic", () => {
    expect(confirmSrc).toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(tempConfirmSrc).toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(revertSrc).toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(replaceSrc).not.toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(openSrc).not.toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(pendingSrc).not.toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(confirmSrc).not.toContain("generateTylerTextOverviewDraftForUser");
    expect(tempConfirmSrc).not.toContain("generateTylerTextOverviewEveningPreviewForUser");
    expect(revertSrc).not.toContain("generateTylerTextOverviewWeeklyDraftForUser");
    expect(confirmSrc).not.toContain("evening_checkin");
    expect(tempConfirmSrc).not.toContain("weekly_review");
    expect(revertSrc).not.toContain("SMS_DAILY_PRODUCTION_SEND_SLOT");
  });

  it("exact-send is still persisted current_body_to_send; helper does not rewrite at send", () => {
    expect(refreshSrc).not.toMatch(/final_body_sent|smsBody/);
    const morningSend = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    const eveningSend = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/evening-sms/route.ts"),
      "utf8"
    );
    const weeklySend = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts"),
      "utf8"
    );
    expect(morningSend).not.toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(eveningSend).not.toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(weeklySend).not.toContain("refreshUnsentTtoDraftsAfterRelationshipChange");
    expect(morningSend).not.toContain("stale_draft_could_not_be_disabled");
  });

  it("J: no send-time rewrite; K: no inbound NLP / Sol changes", async () => {
    expect(refreshSrc).not.toContain("runSolGoalChangeSemanticInterpreter");
    expect(refreshSrc).not.toMatch(/parseSmsConfirmation|inboundRaw|Yes but|Never mind/);
    expect(confirmSrc).not.toMatch(/final_body_sent\s*=/);
    expect(tempConfirmSrc).not.toContain("smsBody =");
    expect(revertSrc).not.toContain("if (!cleared.alreadyCleared)");
    expect(revertSrc).toContain("await refreshTtoDraftsAfterProvenRevert");
  });
});
