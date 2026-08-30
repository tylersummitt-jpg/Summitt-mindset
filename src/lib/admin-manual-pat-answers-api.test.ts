import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireTylerAdminMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: (...args: unknown[]) => requireTylerAdminMock(...args),
}));

vi.mock("@/lib/admin-manual-pat-answers", () => ({
  listManualPatAnswers: (...args: unknown[]) => listMock(...args),
  saveManualPatDraft: (...args: unknown[]) => saveMock(...args),
  sendManualPatCoachReply: (...args: unknown[]) => sendMock(...args),
}));

describe("admin manual Pat answers API auth", () => {
  beforeEach(() => {
    requireTylerAdminMock.mockReset();
    listMock.mockReset();
    saveMock.mockReset();
    sendMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("1: non-admin GET is denied", async () => {
    const err = Object.assign(new Error("FORBIDDEN"), { status: 403 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { GET } = await import("@/app/api/admin/manual-pat-answers/route");
    const res = await GET();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("1: non-admin PATCH is denied", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { PATCH } = await import("@/app/api/admin/manual-pat-answers/[messageSid]/route");
    const res = await PATCH(
      new Request("http://localhost/api/admin/manual-pat-answers/SMpark1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply_body: "Yes." }),
      }),
      { params: Promise.resolve({ messageSid: "SMpark1" }) }
    );
    expect(res.status).toBe(401);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("1: non-admin POST send is denied", async () => {
    const err = Object.assign(new Error("FORBIDDEN"), { status: 403 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { POST } = await import(
      "@/app/api/admin/manual-pat-answers/[messageSid]/send/route"
    );
    const res = await POST(new Request("http://localhost/api/admin/manual-pat-answers/SMpark1/send", {
      method: "POST",
    }), { params: Promise.resolve({ messageSid: "SMpark1" }) });
    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("admin GET lists rows", async () => {
    requireTylerAdminMock.mockResolvedValue({ userId: "tyler" });
    listMock.mockResolvedValue([{ messageSid: "SMpark1", question: "Did you?" }]);
    const { GET } = await import("@/app/api/admin/manual-pat-answers/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.rows).toHaveLength(1);
  });
});
