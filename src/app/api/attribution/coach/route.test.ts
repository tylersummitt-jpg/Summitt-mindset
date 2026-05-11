import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const getClerkPublicMetadataMock = vi.fn();
const updateClerkPublicMetadataMock = vi.fn();

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) =>
    getClerkPublicMetadataMock(...args),
}));

vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) =>
    updateClerkPublicMetadataMock(...args),
}));

describe("POST /api/attribution/coach", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ userId: "usercoach1" });
    getClerkPublicMetadataMock.mockResolvedValue({});
    updateClerkPublicMetadataMock.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(401);
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
  });

  it("patches acquisitionSource coach when metadata empty", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({});
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, updated: true });
    expect(updateClerkPublicMetadataMock).toHaveBeenCalledWith("usercoach1", {
      acquisitionSource: "coach",
    });
  });

  it("no-op when already coach", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({ acquisitionSource: "coach" });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
  });

  it("no-op when non-empty non-coach acquisitionSource", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({ acquisitionSource: "partner" });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
  });

  it("no-op when weird non-string acquisitionSource", async () => {
    getClerkPublicMetadataMock.mockResolvedValue({ acquisitionSource: 123 });
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: true });
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
  });
});
