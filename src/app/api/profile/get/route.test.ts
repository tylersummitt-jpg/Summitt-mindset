import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const PROFILE_GET_SELECT =
  "relationship_status, partner_name, children_summary, people_summary, responsibility, work_challenge, physical_state, health_goal, energy_obstacles, pressure_summary, proud_of, best_self_trigger, preferred_name";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const allowlistedProfile = {
  relationship_status: "married",
  partner_name: "Sam",
  children_summary: "Two kids",
  people_summary: "Family",
  responsibility: "Caregiving",
  work_challenge: "Focus",
  physical_state: "Tired",
  health_goal: "Sleep",
  energy_obstacles: "Late nights",
  pressure_summary: "Work load",
  proud_of: "Consistency",
  best_self_trigger: "Morning routine",
  preferred_name: "Alex",
};

const internalOnlyFields = {
  clerk_user_id: "user_1",
  identity_source: "user_edited",
  identity_refresh_due_at: "2026-01-01T00:00:00.000Z",
  active_identity_version_id: "ver_abc",
  life_desires: "legacy",
  ninety_day_vision: "legacy",
  support_area: "legacy",
  financial_goals: "legacy",
};

describe("GET /api/profile/get", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fromMock.mockReturnValue({ select: selectMock });
    selectMock.mockReturnValue({ eq: eqMock });
    eqMock.mockReturnValue({ maybeSingle: maybeSingleMock });
    authMock.mockResolvedValue({ userId: "user_1" });
    maybeSingleMock.mockResolvedValue({ data: allowlistedProfile, error: null });
  });

  it("returns 401 and { ok: false, profile: {} } when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ ok: false, profile: {} });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("calls .select() with the exact life-context allowlist", async () => {
    const { GET } = await import("./route");
    await GET();
    expect(selectMock).toHaveBeenCalledWith(PROFILE_GET_SELECT);
  });

  it("filters by clerk_user_id from Clerk auth", async () => {
    const { GET } = await import("./route");
    await GET();
    expect(fromMock).toHaveBeenCalledWith("user_profiles");
    expect(eqMock).toHaveBeenCalledWith("clerk_user_id", "user_1");
  });

  it("returns allowlisted fields on success", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.profile).toEqual(allowlistedProfile);
  });

  it("does not expose internal or legacy fields in the response", async () => {
    maybeSingleMock.mockResolvedValue({
      data: allowlistedProfile,
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    for (const key of Object.keys(internalOnlyFields)) {
      expect(body.profile).not.toHaveProperty(key);
    }
    const routeSrc = readFileSync("src/app/api/profile/get/route.ts", "utf8");
    expect(routeSrc).not.toMatch(/\.select\(\s*["']\*["']\s*\)/);
    expect(routeSrc).toContain(PROFILE_GET_SELECT);
  });

  it("returns { ok: true, profile: {} } when profile row is missing", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, profile: {} });
  });
});
