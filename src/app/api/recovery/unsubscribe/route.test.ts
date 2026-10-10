import { beforeEach, describe, expect, it, vi } from "vitest";

import { recoveryTokenHash } from "@/lib/recovery-engine";

vi.mock("server-only", () => ({}));

const writes: Array<{ table: string; op: "insert" | "update"; payload: unknown; filters: unknown[] }> = [];
let messageRow: { id: string; enrollment_id: string } | null = null;
let enrollmentEmail: string | null = null;

function builder(table: string, row: unknown) {
  const filters: unknown[] = [];
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return api;
    },
    in(column: string, value: unknown) {
      filters.push([column, value]);
      return api;
    },
    insert(payload: unknown) {
      writes.push({ table, op: "insert", payload, filters: [...filters] });
      return Promise.resolve({ error: null });
    },
    update(payload: unknown) {
      writes.push({ table, op: "update", payload, filters });
      return api;
    },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return api;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "recovery_messages") return builder(table, messageRow);
      if (table === "recovery_enrollments") return builder(table, enrollmentEmail ? { email_normalized: enrollmentEmail } : null);
      return builder(table, null);
    },
  },
}));

describe("recovery unsubscribe", () => {
  beforeEach(() => {
    writes.length = 0;
    messageRow = null;
    enrollmentEmail = null;
  });

  it("rejects a missing token without writing", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("https://summittmindset.com/api/recovery/unsubscribe"));
    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("rejects an unknown token without changing another person", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("https://summittmindset.com/api/recovery/unsubscribe?token=not-a-real-token", { method: "POST" }));
    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("suppresses only the enrollment that owns a valid token", async () => {
    messageRow = { id: "message-1", enrollment_id: "enrollment-1" };
    enrollmentEmail = "person@example.com";
    const token = "recipient-token";
    const { GET } = await import("./route");
    const response = await GET(new Request(`https://summittmindset.com/api/recovery/unsubscribe?token=${token}`));
    expect(response.status).toBe(200);
    expect(writes).toEqual([
      {
        table: "recovery_suppressions",
        op: "insert",
        payload: {
          email_normalized: "person@example.com",
          reason: "unsubscribe",
          token_hash: recoveryTokenHash(token),
        },
        filters: [],
      },
      {
        table: "recovery_enrollments",
        op: "update",
        payload: { status: "stopped", stop_reason: "unsubscribe" },
        filters: [["id", "enrollment-1"], ["status", "active"]],
      },
      {
        table: "recovery_messages",
        op: "update",
        payload: { status: "canceled" },
        filters: [["enrollment_id", "enrollment-1"], ["status", ["scheduled", "claimed"]]],
      },
    ]);
  });
});
