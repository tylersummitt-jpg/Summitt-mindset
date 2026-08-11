/**
 * Account-deletion Storage integrity — delete every object under a user's
 * victory-media ownership prefix, then verify empty.
 *
 * Fixed bucket. Exact `{clerkUserId}/` root only. Not a generic Storage deleter.
 */

import "server-only";

import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  VictoryMediaPathError,
  victoryMediaUserStoragePrefix,
} from "@/lib/victory-media/storage-paths";

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

export type DeleteAllVictoryMediaForUserSuccess = {
  ok: true;
  found: number;
  deleted: number;
  alreadyEmpty: boolean;
};

export type DeleteAllVictoryMediaForUserErrorCode =
  | "invalid_clerk_user_id"
  | "list_failed"
  | "remove_failed"
  | "verify_not_empty";

export type DeleteAllVictoryMediaForUserFailure = {
  ok: false;
  code: DeleteAllVictoryMediaForUserErrorCode;
};

export type DeleteAllVictoryMediaForUserResult =
  | DeleteAllVictoryMediaForUserSuccess
  | DeleteAllVictoryMediaForUserFailure;

export type VictoryMediaUserPrefixStorage = {
  list(args: {
    bucket: string;
    path: string;
    limit: number;
    offset: number;
  }): Promise<{
    entries: Array<{ name: string; id: string | null }>;
  }>;
  remove(args: {
    bucket: string;
    paths: string[];
  }): Promise<void>;
};

export type DeleteAllVictoryMediaForUserDeps = {
  storage?: VictoryMediaUserPrefixStorage;
};

function fail(
  code: DeleteAllVictoryMediaForUserErrorCode
): DeleteAllVictoryMediaForUserFailure {
  return { ok: false, code };
}

function createDefaultStorage(): VictoryMediaUserPrefixStorage {
  return {
    async list({ bucket, path, limit, offset }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage
        .from(bucket)
        .list(path, {
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      if (error) throw new Error("list_failed");
      const entries = (data ?? []).map((row) => ({
        name: typeof row.name === "string" ? row.name : "",
        id: row.id == null ? null : String(row.id),
      }));
      return { entries };
    },
    async remove({ bucket, paths }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { error } = await supabaseServer.storage.from(bucket).remove(paths);
      if (error) throw new Error("remove_failed");
    },
  };
}

function joinPrefix(folderPath: string, name: string): string {
  if (!folderPath) return name;
  return `${folderPath.replace(/\/$/, "")}/${name}`;
}

/**
 * Recursively collect fully-qualified object paths under `folderPath`
 * (no trailing slash; empty string = bucket root — never used for this helper).
 */
async function collectObjectPaths(
  storage: VictoryMediaUserPrefixStorage,
  bucket: string,
  folderPath: string,
  out: string[]
): Promise<void> {
  let offset = 0;
  for (;;) {
    let page: { entries: Array<{ name: string; id: string | null }> };
    try {
      page = await storage.list({
        bucket,
        path: folderPath,
        limit: LIST_PAGE_SIZE,
        offset,
      });
    } catch {
      throw new Error("list_failed");
    }

    const entries = page.entries.filter((e) => e.name.length > 0);
    if (entries.length === 0) break;

    for (const entry of entries) {
      const childPath = joinPrefix(folderPath, entry.name);
      // Supabase folders typically have id === null; files have an object id.
      if (entry.id == null) {
        await collectObjectPaths(storage, bucket, childPath, out);
      } else {
        out.push(childPath);
      }
    }

    if (entries.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
}

async function removeAllPaths(
  storage: VictoryMediaUserPrefixStorage,
  bucket: string,
  paths: string[]
): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
    try {
      await storage.remove({ bucket, paths: batch });
    } catch {
      throw new Error("remove_failed");
    }
  }
}

/**
 * Delete every object under victory-media/{clerkUserId}/ and verify empty.
 * Idempotent when already empty. Never accepts caller bucket/prefix overrides.
 */
export async function deleteAllVictoryMediaForUser(
  input: { clerkUserId: string },
  deps: DeleteAllVictoryMediaForUserDeps = {}
): Promise<DeleteAllVictoryMediaForUserResult> {
  let prefixWithSlash: string;
  try {
    prefixWithSlash = victoryMediaUserStoragePrefix(input.clerkUserId);
  } catch (e) {
    if (e instanceof VictoryMediaPathError) {
      return fail("invalid_clerk_user_id");
    }
    return fail("invalid_clerk_user_id");
  }

  const userFolder = prefixWithSlash.replace(/\/$/, "");
  // Prefix security: ownership root must be exactly `{validatedId}/`.
  if (
    !userFolder ||
    userFolder.includes("/") ||
    userFolder.includes("..") ||
    prefixWithSlash !== `${userFolder}/`
  ) {
    return fail("invalid_clerk_user_id");
  }

  const bucket = VICTORY_MEDIA_BUCKET;
  const storage = deps.storage ?? createDefaultStorage();

  let foundPaths: string[];
  try {
    foundPaths = [];
    await collectObjectPaths(storage, bucket, userFolder, foundPaths);
  } catch {
    return fail("list_failed");
  }

  // Defense: only paths strictly under this user's folder.
  const allowedPrefix = `${userFolder}/`;
  for (const path of foundPaths) {
    if (!path.startsWith(allowedPrefix) || path.includes("..")) {
      return fail("list_failed");
    }
  }

  const found = foundPaths.length;
  if (found === 0) {
    return { ok: true, found: 0, deleted: 0, alreadyEmpty: true };
  }

  try {
    await removeAllPaths(storage, bucket, foundPaths);
  } catch {
    return fail("remove_failed");
  }

  let remaining: string[];
  try {
    remaining = [];
    await collectObjectPaths(storage, bucket, userFolder, remaining);
  } catch {
    return fail("list_failed");
  }

  if (remaining.length > 0) {
    return fail("verify_not_empty");
  }

  return {
    ok: true,
    found,
    deleted: found,
    alreadyEmpty: false,
  };
}
