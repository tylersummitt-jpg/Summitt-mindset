import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/challenge-runtime", () => ({
  runChallengeCron: vi.fn(async () => ({
    success: true,
    processed: 0,
    failed: 0,
    skipped: 0,
    needsAttention: 0,
    legacyDay1Held: 0,
  })),
  enrollChallengeEmail: vi.fn(async () => ({
    ok: true,
    status: 200,
    message: "You're signed up. Your first lesson is on its way.",
  })),
  unsubscribeChallengeToken: vi.fn(async () => "suppressed"),
  reenrollChallengeToken: vi.fn(),
}));

describe("challenge HTTP routes", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    vi.resetModules();
  });

  it("rejects a cron call without the secret", async () => {
    const { GET } = await import("@/app/api/cron/challenge/route");
    const response = await GET(new Request("http://localhost/api/cron/challenge"));
    expect(response.status).toBe(401);
  });

  it("runs the cron when the bearer secret matches and returns no contact data", async () => {
    const { GET } = await import("@/app/api/cron/challenge/route");
    const response = await GET(
      new Request("http://localhost/api/cron/challenge", {
        headers: { authorization: "Bearer test-cron-secret" },
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.processed).toBe(0);
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("signup JSON does not echo the submitted address", async () => {
    const { enrollChallengeEmail } = await import("@/lib/challenge-runtime");
    vi.mocked(enrollChallengeEmail).mockResolvedValueOnce({
      ok: false,
      status: 503,
      message: "We couldn't start your challenge. Please try again.",
    });
    const { POST } = await import("@/app/api/challenge/signup/route");
    const response = await POST(
      new Request("http://localhost/api/challenge/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pat@example.com" }),
      })
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      message: "We couldn't start your challenge. Please try again.",
    });
    expect(JSON.stringify(body)).not.toContain("pat@example.com");
  });
});
