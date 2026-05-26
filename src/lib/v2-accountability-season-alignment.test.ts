import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingleMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: (...args: unknown[]) => maybeSingleMock(...args),
            })),
          })),
        })),
      })),
    })),
  },
}));

describe("hasActiveAccountabilitySeasonForCommitment", () => {
  beforeEach(() => {
    vi.resetModules();
    maybeSingleMock.mockReset();
  });

  it("returns true when Supabase finds an active season id", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "season-1" }, error: null });
    const { hasActiveAccountabilitySeasonForCommitment } = await import(
      "@/lib/v2-accountability-season-alignment"
    );
    const ok = await hasActiveAccountabilitySeasonForCommitment("user_a", "cmt_1");
    expect(ok).toBe(true);
  });

  it("returns false when no row", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { hasActiveAccountabilitySeasonForCommitment } = await import(
      "@/lib/v2-accountability-season-alignment"
    );
    const ok = await hasActiveAccountabilitySeasonForCommitment("user_a", "cmt_1");
    expect(ok).toBe(false);
  });

  it("returns false on Supabase error", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "x" }, error: { message: "boom" } });
    const { hasActiveAccountabilitySeasonForCommitment } = await import(
      "@/lib/v2-accountability-season-alignment"
    );
    const ok = await hasActiveAccountabilitySeasonForCommitment("user_a", "cmt_1");
    expect(ok).toBe(false);
  });
});
