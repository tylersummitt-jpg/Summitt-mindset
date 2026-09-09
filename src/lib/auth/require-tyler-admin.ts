import { auth } from "@clerk/nextjs/server";

/**
 * ======================================================
 * requireTylerAdmin
 * ------------------------------------------------------
 * Hard admin gate for Tyler, plus optional Brooke.
 * - Uses Clerk auth() session userId only
 * - Tyler: required TYLER_CLERK_USER_ID
 * - Brooke: optional BROOKE_CLERK_USER_ID (unset/malformed = ignore)
 * - Throws structured errors for API routes
 * ======================================================
 */

function normalizeUserId(value: string | undefined | null) {
  if (!value) return null;

  const trimmed = value.trim();

  // Disallow truncated UI values
  if (trimmed.includes("…") || trimmed.includes("...")) return null;

  return trimmed.length > 0 ? trimmed : null;
}

export async function requireTylerAdmin() {
  const { userId } = await auth();

  if (!userId) {
    const err: any = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  const tylerId = normalizeUserId(process.env.TYLER_CLERK_USER_ID);

  if (!tylerId) {
    const err: any = new Error(
      "SERVER_MISCONFIG_TYLER_CLERK_USER_ID"
    );
    err.status = 500;
    throw err;
  }

  const brookeId = normalizeUserId(process.env.BROOKE_CLERK_USER_ID);

  if (userId === tylerId || (brookeId && userId === brookeId)) {
    return { userId };
  }

  const err: any = new Error("FORBIDDEN");
  err.status = 403;
  throw err;
}
