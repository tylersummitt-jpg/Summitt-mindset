/**
 * deleteAllVictoryMediaForUser — mocked Storage only (no live Supabase).
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  deleteAllVictoryMediaForUser,
  type VictoryMediaUserPrefixStorage,
} from "@/lib/victory-media/delete-all-victory-media-for-user";

type Entry = { name: string; id: string | null };

function memoryStorage(initialFiles: string[]): VictoryMediaUserPrefixStorage & {
  files: Set<string>;
  listCalls: Array<{ path: string; offset: number; limit: number; bucket: string }>;
  removeCalls: string[][];
} {
  const files = new Set(initialFiles);
  const listCalls: Array<{
    path: string;
    offset: number;
    limit: number;
    bucket: string;
  }> = [];
  const removeCalls: string[][] = [];

  function childrenOf(folderPath: string): Entry[] {
    const prefix = folderPath ? `${folderPath}/` : "";
    const names = new Map<string, Entry>();
    for (const path of files) {
      if (prefix && !path.startsWith(prefix)) continue;
      if (!prefix && path.includes("/")) {
        const top = path.split("/")[0]!;
        if (!names.has(top)) names.set(top, { name: top, id: null });
        continue;
      }
      const rest = prefix ? path.slice(prefix.length) : path;
      if (!rest) continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        names.set(rest, { name: rest, id: `id-${path}` });
      } else {
        const folder = rest.slice(0, slash);
        if (!names.has(folder)) names.set(folder, { name: folder, id: null });
      }
    }
    return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    files,
    listCalls,
    removeCalls,
    async list({ bucket, path, limit, offset }) {
      listCalls.push({ bucket, path, limit, offset });
      const all = childrenOf(path);
      return { entries: all.slice(offset, offset + limit) };
    },
    async remove({ bucket, paths }) {
      expect(bucket).toBe(VICTORY_MEDIA_BUCKET);
      removeCalls.push([...paths]);
      for (const p of paths) files.delete(p);
    },
  };
}

describe("deleteAllVictoryMediaForUser", () => {
  it("1. empty user prefix -> success", async () => {
    const storage = memoryStorage([]);
    const result = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      { storage }
    );
    expect(result).toEqual({
      ok: true,
      found: 0,
      deleted: 0,
      alreadyEmpty: true,
    });
  });

  it("2–6. master/card, media folders, temp, nested, mms-temp", async () => {
    const media = "770e8400-e29b-41d4-a716-446655440020";
    const media2 = "770e8400-e29b-41d4-a716-446655440021";
    const upload = "660e8400-e29b-41d4-a716-446655440001";
    const job = "550e8400-e29b-41d4-a716-446655440099";
    const storage = memoryStorage([
      `user_abc/${media}/master.jpg`,
      `user_abc/${media}/card.jpg`,
      `user_abc/${media2}/master.jpg`,
      `user_abc/${media2}/card.jpg`,
      `user_abc/temp/${upload}.bin`,
      `user_abc/nested/deep/file.bin`,
      `user_abc/mms-temp/${job}.bin`,
    ]);
    const result = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      { storage }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.found).toBe(7);
    expect(result.deleted).toBe(7);
    expect(result.alreadyEmpty).toBe(false);
    expect(storage.files.size).toBe(0);
  });

  it("7–8. pagination and remove batching", async () => {
    const paths = Array.from({ length: 250 }, (_, i) => {
      const id = `770e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}`;
      return `user_page/${id}/master.jpg`;
    });
    const storage = memoryStorage(paths);
    // Force small pages via wrapping list
    const pageSizeStorage: VictoryMediaUserPrefixStorage = {
      async list(args) {
        return storage.list({ ...args, limit: Math.min(args.limit, 100) });
      },
      async remove(args) {
        // Simulate batching by removing in chunks of 100 inside helper
        return storage.remove(args);
      },
    };
    const result = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_page" },
      { storage: pageSizeStorage }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.found).toBe(250);
    expect(storage.files.size).toBe(0);
    expect(storage.listCalls.some((c) => c.offset > 0)).toBe(true);
    expect(storage.removeCalls.length).toBeGreaterThan(1);
    expect(storage.removeCalls.every((b) => b.length <= 100)).toBe(true);
  });

  it("9. remove failure -> failure", async () => {
    const storage = memoryStorage([`user_abc/a/master.jpg`]);
    const result = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      {
        storage: {
          list: storage.list.bind(storage),
          async remove() {
            throw new Error("remove_failed");
          },
        },
      }
    );
    expect(result).toEqual({ ok: false, code: "remove_failed" });
  });

  it("10. verification finds remaining object -> failure", async () => {
    let lists = 0;
    const storage: VictoryMediaUserPrefixStorage = {
      async list({ path }) {
        lists += 1;
        if (lists === 1) {
          return { entries: [{ name: "x.jpg", id: "1" }] };
        }
        // After "delete", verify still sees object
        return {
          entries:
            path === "user_abc"
              ? [{ name: "x.jpg", id: "1" }]
              : [],
        };
      },
      async remove() {
        /* pretend deleted */
      },
    };
    const result = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      { storage }
    );
    expect(result).toEqual({ ok: false, code: "verify_not_empty" });
  });

  it("11–12. retry after partial deletion / already absent", async () => {
    const storage = memoryStorage([
      `user_abc/a/master.jpg`,
      `user_abc/b/card.jpg`,
    ]);
    const first = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      { storage }
    );
    expect(first.ok).toBe(true);
    const second = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      { storage }
    );
    expect(second).toEqual({
      ok: true,
      found: 0,
      deleted: 0,
      alreadyEmpty: true,
    });
  });

  it("13–15. malformed id, traversal, other user untouched", async () => {
    const storage = memoryStorage([
      `user_abc/a/master.jpg`,
      `user_abcd/b/master.jpg`,
    ]);
    expect(
      await deleteAllVictoryMediaForUser(
        { clerkUserId: "user_abc/../evil" },
        { storage }
      )
    ).toEqual({ ok: false, code: "invalid_clerk_user_id" });
    expect(
      await deleteAllVictoryMediaForUser(
        { clerkUserId: "user_abc/extra" },
        { storage }
      )
    ).toEqual({ ok: false, code: "invalid_clerk_user_id" });
    expect(
      await deleteAllVictoryMediaForUser({ clerkUserId: "" }, { storage })
    ).toEqual({ ok: false, code: "invalid_clerk_user_id" });

    const result = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      { storage }
    );
    expect(result.ok).toBe(true);
    expect(storage.files.has("user_abcd/b/master.jpg")).toBe(true);
    expect(storage.files.has("user_abc/a/master.jpg")).toBe(false);
  });

  it("16. fixed victory-media bucket only", async () => {
    const storage = memoryStorage([`user_abc/a.jpg`]);
    await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      { storage }
    );
    expect(storage.listCalls.every((c) => c.bucket === "victory-media")).toBe(
      true
    );
  });

  it("list failure -> failure", async () => {
    const result = await deleteAllVictoryMediaForUser(
      { clerkUserId: "user_abc" },
      {
        storage: {
          async list() {
            throw new Error("list_failed");
          },
          async remove() {},
        },
      }
    );
    expect(result).toEqual({ ok: false, code: "list_failed" });
  });
});
