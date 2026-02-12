import { auth } from "@clerk/nextjs/server";

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
    throw new Error("UNAUTHORIZED: not signed in");
  }

  const adminId = normalizeUserId(process.env.TYLER_CLERK_USER_ID);

  if (!adminId) {
    throw new Error(
      "SERVER MISCONFIG: TYLER_CLERK_USER_ID is missing or truncated. Copy the full Clerk user id (no ellipsis)."
    );
  }

  if (userId !== adminId) {
    throw new Error("FORBIDDEN: admin only");
  }

  return { userId };
}
