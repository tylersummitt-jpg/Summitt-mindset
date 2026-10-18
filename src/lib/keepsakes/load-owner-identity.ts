import "server-only";

import { auth } from "@clerk/nextjs/server";

import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";
import { supabaseServer } from "@/lib/supabase-server";

export type KeepsakeOwnerAccess =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 };

export type SignedInOwnerIdentity =
  | { ok: true; userId: string; identity: string | null }
  | { ok: false; status: 401 | 403 | 500 };

export async function authorizeKeepsakeOwner(): Promise<KeepsakeOwnerAccess> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401 };
  if (!(await isTylerOwnerSession())) return { ok: false, status: 403 };
  return { ok: true, userId };
}

export async function loadSignedInOwnerIdentity(): Promise<SignedInOwnerIdentity> {
  const access = await authorizeKeepsakeOwner();
  if (!access.ok) return access;

  const { data, error } = await supabaseServer
    .from("user_profiles")
    .select("identity_anchor_text")
    .eq("clerk_user_id", access.userId)
    .maybeSingle();

  if (error) {
    console.error("[keepsake-studio] identity load failed", { message: error.message });
    return { ok: false, status: 500 };
  }

  const raw = data?.identity_anchor_text;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: true, userId: access.userId, identity: null };
  }
  return { ok: true, userId: access.userId, identity: raw };
}
