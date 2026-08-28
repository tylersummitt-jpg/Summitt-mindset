import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("@/lib/onboarding-input-safety", () => ({
  evaluateTextSafetyTier: (text: string) => {
    if (/\bkill\b/i.test(text)) {
      return { tier: "block" as const, reason: "Please keep this focused on your real life." };
    }
    return { tier: "allow" as const, reason: null };
  },
}));

import {
  applyUserVictoryWinEdit,
  detailsFieldFromWin,
  loadOwnedActiveWinForEdit,
  USER_EDITED_PRESENTATION_GUARD,
} from "@/lib/v2-win-user-edit";
import {
  buildEditWinHref,
  editWinOriginHref,
  parseEditWinOrigin,
} from "@/lib/v2-win-edit-origin";

const UPDATED = "2026-08-09T12:00:00.000Z";

function baseWin(overrides: Record<string, unknown> = {}) {
  return {
    id: "win-1",
    clerk_user_id: "user_1",
    source_type: "manual",
    display_title: "Done",
    display_body: "Done",
    occurred_at: "2026-08-08T16:00:00.000Z",
    commitment_id: null,
    supporting_quote: null,
    action_fact: "Done",
    why_meaningful: null,
    relationship_type: "whole_life",
    status: "active",
    updated_at: UPDATED,
    user_edited_at: null,
    source_message_sid: null,
    source_message_id: null,
    source_event_id: null,
    candidate_ordinal: 0,
    idempotency_key: "win_v1:manual:user_1:req",
    recognition_mode: "user_identified",
    schema_version: "win_v1",
    model_confidence: null,
    ...overrides,
  };
}

function mockWinLoad(win: Record<string, unknown> | null) {
  fromMock.mockImplementation((table: string) => {
    if (table === "v2_win") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: win, error: null }),
          }),
        }),
      };
    }
    if (table === "user_accountability_season") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
            in: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      };
    }
    return {};
  });
}

function mockSeasonOwned(season: {
  id: string;
  clerk_user_id: string;
  commitment_id: string;
  status: string;
} | null) {
  const prev = fromMock.getMockImplementation();
  fromMock.mockImplementation((table: string) => {
    if (table === "user_accountability_season") {
      return {
        select: () => ({
          eq: (_col: string, val: string) => {
            // loadOwnedSeasonForManualWin: .eq("id", seasonId).maybeSingle()
            if (_col === "id") {
              return {
                maybeSingle: async () => ({
                  data:
                    season && season.id === val
                      ? {
                          ...season,
                          season_name: "Season 1",
                          started_at: "2026-01-01T00:00:00Z",
                          ended_at: null,
                          goal_snapshot: null,
                        }
                      : null,
                  error: null,
                }),
              };
            }
            // findOwnedSeasonIdByCommitment chain
            return {
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: season ? { id: season.id } : null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          },
        }),
      };
    }
    if (typeof prev === "function") return prev(table);
    return {};
  });
}

describe("v2-win-edit-origin", () => {
  it("parses bounded origins and rejects arbitrary return URLs", () => {
    expect(parseEditWinOrigin("all-wins")).toEqual({ kind: "all-wins" });
    expect(parseEditWinOrigin("season:11111111-1111-4111-8111-111111111111")).toEqual({
      kind: "season",
      seasonId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parseEditWinOrigin("https://evil.example/x")).toEqual({ kind: "victory-room" });
    expect(editWinOriginHref({ kind: "victory-room" })).toBe("/dashboard/victory-room");
    expect(buildEditWinHref("w1", { kind: "all-wins" })).toContain(
      "/dashboard/victory-room/wins/w1/edit?from=all-wins"
    );
  });
});

describe("v2-win-user-edit migration shape", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260809120000_v2_win_user_edit.sql"),
    "utf8"
  );

  it("adds nullable user_edited_at and revision table with cascade + service-role RPC", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS user_edited_at TIMESTAMPTZ NULL");
    expect(sql).toContain("CREATE TABLE public.v2_win_revision");
    expect(sql).toContain("REFERENCES public.v2_win (id) ON DELETE CASCADE");
    expect(sql).toContain("editor_source IN ('user')");
    expect(sql).toContain("REVOKE ALL ON TABLE public.v2_win_revision FROM anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.v2_win_revision FROM authenticated");
    expect(sql).toContain("REVOKE ALL ON TABLE public.v2_win_revision FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL ON TABLE public.v2_win_revision FROM service_role");
    expect(sql).toContain(
      "GRANT SELECT, INSERT ON TABLE public.v2_win_revision TO service_role"
    );
    // Privilege sequence: strip service_role ALL, then grant SELECT/INSERT only.
    const revokeService = sql.indexOf(
      "REVOKE ALL ON TABLE public.v2_win_revision FROM service_role"
    );
    const grantSelectInsert = sql.indexOf(
      "GRANT SELECT, INSERT ON TABLE public.v2_win_revision TO service_role"
    );
    expect(revokeService).toBeGreaterThan(-1);
    expect(grantSelectInsert).toBeGreaterThan(revokeService);
    expect(sql).not.toMatch(
      /GRANT\s+(UPDATE|DELETE|TRUNCATE|ALL)\b[\s\S]{0,80}v2_win_revision/i
    );
    expect(sql).not.toMatch(
      /GRANT\s+[^\n]*\b(UPDATE|DELETE|TRUNCATE)\b[^\n]*ON TABLE public\.v2_win_revision[^\n]*TO service_role/i
    );
    expect(sql).toContain("v2_apply_user_win_edit_mutation");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.v2_apply_user_win_edit_mutation");
    expect(sql).toContain("TO service_role");
    // Early stale conflict still returns before revision INSERT.
    expect(sql).toContain("v_row.updated_at IS DISTINCT FROM p_expected_updated_at");
    expect(sql).toContain("RETURN QUERY SELECT 'conflict'::TEXT, v_row.updated_at, NULL::UUID");
    // RETURNS TABLE exposes updated_at as an OUT var — UPDATE WHERE must be table-qualified.
    expect(sql).toContain("AND public.v2_win.updated_at = p_expected_updated_at");
    expect(sql).not.toMatch(/AND\s+updated_at\s*=\s*p_expected_updated_at/);
    // Post-revision impossible UPDATE miss must RAISE (rollback), not RETURN.
    expect(sql).toContain("RAISE EXCEPTION 'v2_win_edit_conflict_after_revision'");
    expect(sql).toContain("USING ERRCODE = '40001'");
    expect(sql).not.toContain("Should be unreachable after FOR UPDATE + expected match; treat as conflict.");
    expect(sql).not.toContain("UPDATE public.v2_commitment_event");
    expect(USER_EDITED_PRESENTATION_GUARD).toMatch(/user_edited_at IS NOT NULL/);
  });
});

describe("applyUserVictoryWinEdit", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("accepts Done / A and updates manual action_fact via RPC", async () => {
    mockWinLoad(baseWin());
    rpcMock.mockResolvedValue({
      data: [{ result: "applied", updated_at: "2026-08-09T13:00:00.000Z", revision_id: "rev-1" }],
      error: null,
    });

    const result = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "A",
      details: null,
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("updated");
    expect(result.revision_id).toBe("rev-1");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const args = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_display_title).toBe("A");
    expect(args.p_display_body).toBe("A");
    expect(args.p_action_fact).toBe("A");
    expect(args.p_supporting_quote).toBeNull();
  });

  it("rejects blank title, 81-char title, 241 details, future date, unsafe content", async () => {
    mockWinLoad(baseWin());
    const blank = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "   ",
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.code).toBe("validation");

    const longTitle = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "x".repeat(81),
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(longTitle.ok).toBe(false);

    const longDetails = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Done",
      details: "y".repeat(241),
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(longDetails.ok).toBe(false);

    const future = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Done",
      occurredOn: "2099-01-01",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.code).toBe("future_date");

    const unsafe = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "I will kill this",
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) expect(unsafe.code).toBe("unsafe_content");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("no-op when values unchanged — no RPC / revision", async () => {
    mockWinLoad(baseWin());
    const result = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Done",
      details: null,
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("noop");
    expect(result.revision_id).toBeNull();
    expect(result.user_edited_at).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns conflict on stale expected_updated_at without RPC when precheck fails", async () => {
    mockWinLoad(baseWin({ updated_at: "2026-08-09T14:00:00.000Z" }));
    const result = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Changed",
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("conflict");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns conflict when RPC reports conflict (no false success)", async () => {
    mockWinLoad(baseWin());
    rpcMock.mockResolvedValue({
      data: [{ result: "conflict", updated_at: UPDATED, revision_id: null }],
      error: null,
    });
    const result = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Changed",
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
  });

  it("rejects foreign/hidden Win", async () => {
    mockWinLoad(baseWin({ clerk_user_id: "other" }));
    const foreign = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "X",
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("not_found");

    mockWinLoad(baseWin({ status: "hidden" }));
    const hidden = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "X",
      occurredOn: "2026-08-08",
      seasonId: null,
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.code).toBe("not_found");
  });

  it("SMS presentation edit keeps action_fact and clears supporting_quote", async () => {
    mockWinLoad(
      baseWin({
        source_type: "sms_inbound",
        display_title: "Consistent Weight Lifting",
        display_body: "You lifted again.",
        action_fact: "Lifted weights for 30 minutes",
        supporting_quote: "I lifted weights again today!",
        why_meaningful: "Protected the bar",
        relationship_type: "goal",
        commitment_id: "c-old",
        recognition_mode: "coach_recognized",
        source_message_sid: "SM1",
      })
    );
    // season lookup for load may run; season attach
    mockSeasonOwned({
      id: "s2",
      clerk_user_id: "user_1",
      commitment_id: "c-new",
      status: "active",
    });
    // re-mock win after season mock overwrote from
    const win = baseWin({
      source_type: "sms_inbound",
      display_title: "Consistent Weight Lifting",
      display_body: "You lifted again.",
      action_fact: "Lifted weights for 30 minutes",
      supporting_quote: "I lifted weights again today!",
      why_meaningful: "Protected the bar",
      relationship_type: "goal",
      commitment_id: "c-old",
      recognition_mode: "coach_recognized",
      source_message_sid: "SM1",
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_win") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: win, error: null }),
            }),
          }),
        };
      }
      if (table === "user_accountability_season") {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              if (col === "id") {
                return {
                  maybeSingle: async () => ({
                    data:
                      val === "s2"
                        ? {
                            id: "s2",
                            clerk_user_id: "user_1",
                            commitment_id: "c-new",
                            season_name: "Season 2",
                            status: "active",
                            started_at: "2026-01-01T00:00:00Z",
                            ended_at: null,
                            goal_snapshot: null,
                          }
                        : null,
                    error: null,
                  }),
                };
              }
              return {
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: { id: "s-old" }, error: null }),
                      }),
                    }),
                  }),
                }),
              };
            },
          }),
        };
      }
      return {};
    });

    rpcMock.mockResolvedValue({
      data: [{ result: "applied", updated_at: "2026-08-09T15:00:00.000Z", revision_id: "rev-sms" }],
      error: null,
    });

    const result = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Got my workout done",
      details: "Felt strong today.",
      occurredOn: "2026-08-08",
      seasonId: "s2",
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(result.ok).toBe(true);
    const args = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_action_fact).toBe("Lifted weights for 30 minutes");
    expect(args.p_supporting_quote).toBeNull();
    expect(args.p_commitment_id).toBe("c-new");
    expect(args.p_display_title).toBe("Got my workout done");
  });

  it("date/season-only edit preserves supporting_quote", async () => {
    const win = baseWin({
      source_type: "sms_inbound",
      display_title: "Lift",
      display_body: "Lift body",
      supporting_quote: "kept going",
      action_fact: "Lift fact",
      commitment_id: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_win") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: win, error: null }),
            }),
          }),
        };
      }
      if (table === "user_accountability_season") {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              if (col === "id") {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: "s1",
                      clerk_user_id: "user_1",
                      commitment_id: "c1",
                      season_name: "Season 1",
                      status: "completed",
                      started_at: "2026-01-01T00:00:00Z",
                      ended_at: "2026-04-01T00:00:00Z",
                      goal_snapshot: null,
                    },
                    error: null,
                  }),
                };
              }
              return {
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              };
            },
          }),
        };
      }
      return {};
    });
    rpcMock.mockResolvedValue({
      data: [{ result: "applied", updated_at: "2026-08-09T16:00:00.000Z", revision_id: "rev-2" }],
      error: null,
    });

    const result = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Lift",
      details: "Lift body",
      occurredOn: "2026-08-07",
      seasonId: "s1",
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(result.ok).toBe(true);
    const args = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_supporting_quote).toBe("kept going");
    expect(args.p_action_fact).toBe("Lift fact");
    expect(args.p_commitment_id).toBe("c1");
  });

  it("rejects foreign Season", async () => {
    mockWinLoad(baseWin());
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_win") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: baseWin(), error: null }),
            }),
          }),
        };
      }
      if (table === "user_accountability_season") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    const result = await applyUserVictoryWinEdit({
      clerkUserId: "user_1",
      winId: "win-1",
      title: "Done",
      occurredOn: "2026-08-08",
      seasonId: "missing",
      expectedUpdatedAt: UPDATED,
      timeZone: "UTC",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("season_not_found");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("detailsFieldFromWin blanks when body equals title", () => {
    expect(detailsFieldFromWin({ displayTitle: "Done", displayBody: "Done" })).toBe("");
    expect(detailsFieldFromWin({ displayTitle: "Done", displayBody: "More" })).toBe("More");
  });

  it("loadOwnedActiveWinForEdit returns null for foreign user", async () => {
    mockWinLoad(baseWin({ clerk_user_id: "other" }));
    const row = await loadOwnedActiveWinForEdit({ clerkUserId: "user_1", winId: "win-1" });
    expect(row).toBeNull();
  });

  it("edit load keeps stored display_body for unedited sms_inbound (card hiding is public-read only)", async () => {
    mockWinLoad(
      baseWin({
        source_type: "sms_inbound",
        display_title: "Consistent Weight Lifting",
        display_body: "Tyler, you lifted weights again today, showing your commitment.",
        supporting_quote: "I lifted weights again today!",
        user_edited_at: null,
      })
    );
    const row = await loadOwnedActiveWinForEdit({ clerkUserId: "user_1", winId: "win-1" });
    expect(row?.displayTitle).toBe("Consistent Weight Lifting");
    expect(row?.displayBody).toBe(
      "Tyler, you lifted weights again today, showing your commitment."
    );
    expect(row?.supportingQuote).toBe("I lifted weights again today!");
    expect(row?.userEditedAt).toBeNull();
  });
});
