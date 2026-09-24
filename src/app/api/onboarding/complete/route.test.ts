import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const metadataMock = vi.hoisted(() => vi.fn());
const updateMetadataMock = vi.hoisted(() => vi.fn());
const syncSmsMock = vi.hoisted(() => vi.fn());
const activationMock = vi.hoisted(() => vi.fn());
const seedMock = vi.hoisted(() => vi.fn());
const callOrder = vi.hoisted(() => [] as string[]);

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => metadataMock(...args),
}));
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateMetadataMock(...args),
}));
vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: (...args: unknown[]) => syncSmsMock(...args),
}));
vi.mock("@/lib/onboarding-complete-activation", () => ({
  runSobCompleteOnboardingActivation: (...args: unknown[]) => activationMock(...args),
}));
vi.mock("@/lib/onboarding-victory-milestones", () => ({
  seedOnboardingVictoryMilestones: (...args: unknown[]) => seedMock(...args),
}));

const ROUTE = join(process.cwd(), "src/app/api/onboarding/complete/route.ts");

const consented = {
  smsEnabled: true,
  phoneNumber: "+15555550100",
  smsDisclosureAccepted: true,
};

function post() {
  return new Request("http://localhost/api/onboarding/complete", {
    method: "POST",
    body: JSON.stringify({ timezone: "America/New_York" }),
    headers: { "Content-Type": "application/json" },
  });
}

async function loadPost() {
  const { POST } = await import("./route");
  return POST;
}

describe("POST /api/onboarding/complete", () => {
  const src = readFileSync(ROUTE, "utf8");

  it("requires SMS consent before RPC for new users", () => {
    expect(src).toContain("hasValidSmsConsent");
    expect(src).toContain("SMS consent is required before finishing onboarding");
    expect(src).toContain("runSobCompleteOnboardingActivation");
  });

  it("does not set onboardingCompleted before RPC", () => {
    const activationBlock = src.slice(src.indexOf("runSobCompleteOnboardingActivation"));
    const clerkAfterActivation = activationBlock.indexOf("updateClerkPublicMetadata");
    const onboardingFlag = activationBlock.indexOf("onboardingCompleted: true");
    expect(clerkAfterActivation).toBeGreaterThan(-1);
    expect(onboardingFlag).toBeGreaterThan(-1);
    expect(onboardingFlag).toBeGreaterThan(clerkAfterActivation);
  });

  it("heals sms audience for already-completed users", () => {
    expect(src).toContain("onboardingCompleted === true");
    expect(src).toContain("healSmsAudience");
    expect(src).toContain("syncSmsAudience");
  });

  it("does not inline activate commitment (moved to RPC)", () => {
    expect(src).not.toContain('.update({\n          status: "active"');
  });
});

describe("POST /api/onboarding/complete milestone wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    authMock.mockResolvedValue({ userId: "user_new" });
    metadataMock.mockResolvedValue({ onboardingCompleted: false, ...consented });
    activationMock.mockImplementation(async () => {
      callOrder.push("activation");
      return {
        ok: true,
        commitmentId: "c1",
        seasonId: "s1",
        commitmentWasActivated: true,
        activatedEventInserted: true,
        priorSeasonsArchived: 0,
      };
    });
    updateMetadataMock.mockImplementation(async () => {
      callOrder.push("clerk");
    });
    syncSmsMock.mockImplementation(async () => {
      callOrder.push("sms");
    });
    seedMock.mockImplementation(async () => {
      callOrder.push("seed");
      return { seeded: true, skip: null, completedAt: "2026-09-24T15:10:00.000Z", milestones: [] };
    });
  });

  it("seeds once after activation, Clerk metadata, and SMS heal", async () => {
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seedMock).toHaveBeenCalledTimes(1);
    expect(seedMock).toHaveBeenCalledWith({ clerkUserId: "user_new" });
    expect(callOrder).toEqual(["activation", "clerk", "sms", "seed"]);
  });

  it("still returns success when milestone seeding throws", async () => {
    seedMock.mockRejectedValue(new Error("seed down"));
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateMetadataMock).toHaveBeenCalled();
    expect(activationMock).toHaveBeenCalled();
  });

  it("still returns success when a milestone insert or image fails", async () => {
    seedMock.mockResolvedValue({
      seeded: true,
      skip: null,
      completedAt: "2026-09-24T15:10:00.000Z",
      milestones: [
        {
          milestoneKey: "joined",
          winId: "w1",
          persistence: "inserted",
          image: "attached",
          imageFailure: null,
        },
        {
          milestoneKey: "identity",
          winId: null,
          persistence: "failed",
          image: "not_attached",
          imageFailure: null,
        },
        {
          milestoneKey: "first_goal",
          winId: "w3",
          persistence: "inserted",
          image: "not_attached",
          imageFailure: "decode_failed",
        },
      ],
    });
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("seeds after SMS heal on the already-complete branch", async () => {
    metadataMock.mockResolvedValue({ onboardingCompleted: true, ...consented });
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(activationMock).not.toHaveBeenCalled();
    expect(updateMetadataMock).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["sms", "seed"]);
    expect(seedMock).toHaveBeenCalledWith({ clerkUserId: "user_new" });
  });

  it("still returns success when already-complete seeding throws", async () => {
    metadataMock.mockResolvedValue({ onboardingCompleted: true, ...consented });
    seedMock.mockRejectedValue(new Error("seed down"));
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(syncSmsMock).toHaveBeenCalled();
  });

  it("does not seed when activation fails", async () => {
    activationMock.mockResolvedValue({
      ok: false,
      code: "no_commitment",
      message: "Commitment must be saved before completing onboarding.",
    });
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect(seedMock).not.toHaveBeenCalled();
  });

  it("does not seed when Clerk metadata update throws", async () => {
    updateMetadataMock.mockRejectedValue(new Error("clerk down"));
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(500);
    expect(seedMock).not.toHaveBeenCalled();
  });

  it("does not seed when SMS heal fails", async () => {
    syncSmsMock.mockRejectedValue(new Error("sms down"));
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(500);
    expect(seedMock).not.toHaveBeenCalled();
    expect(updateMetadataMock).toHaveBeenCalled();
  });

  it("does not seed when already-complete SMS heal fails", async () => {
    metadataMock.mockResolvedValue({ onboardingCompleted: true, ...consented });
    syncSmsMock.mockRejectedValue(new Error("sms down"));
    const POST = await loadPost();
    const res = await POST(post());
    expect(res.status).toBe(500);
    expect(seedMock).not.toHaveBeenCalled();
  });
});
