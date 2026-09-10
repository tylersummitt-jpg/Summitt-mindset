import { afterEach, describe, expect, it, vi } from "vitest";

import { listClerkUsersByIds } from "@/lib/clerk-rest";

describe("listClerkUsersByIds", () => {
  const originalKey = process.env.CLERK_SECRET_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env.CLERK_SECRET_KEY = originalKey;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not call Clerk when there are no ids", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.CLERK_SECRET_KEY = "sk_test";

    await expect(listClerkUsersByIds([])).resolves.toEqual([]);
    await expect(listClerkUsersByIds(["", "  "])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests all ids in one Backend API call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "user_a",
          email_addresses: [{ id: "idn_a", email_address: "a@example.com" }],
          primary_email_address_id: "idn_a",
        },
        {
          id: "user_b",
          email_addresses: [{ id: "idn_b", email_address: "b@example.com" }],
          primary_email_address_id: "idn_b",
        },
      ],
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.CLERK_SECRET_KEY = "sk_test";

    const users = await listClerkUsersByIds(["user_a", "user_b", "user_a", ""]);
    expect(users).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    const parsed = new URL(calledUrl);
    expect(parsed.origin + parsed.pathname).toBe("https://api.clerk.com/v1/users");
    expect(parsed.searchParams.getAll("user_id")).toEqual(["user_a", "user_b"]);
    expect(parsed.searchParams.get("limit")).toBe("2");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });

  it("throws when Clerk returns a non-OK status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "rate limited",
    }) as unknown as typeof fetch;
    process.env.CLERK_SECRET_KEY = "sk_test";

    await expect(listClerkUsersByIds(["user_a"])).rejects.toThrow(
      /Failed to list Clerk users by id/
    );
  });
});
