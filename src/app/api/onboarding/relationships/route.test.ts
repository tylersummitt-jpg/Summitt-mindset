import { describe, expect, it } from "vitest";

describe("POST /api/onboarding/relationships (retired)", () => {
  it("returns 410 Gone without writing profile data", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain("retired");
    expect(body.error).toContain("/api/onboarding/identity");
  });
});
