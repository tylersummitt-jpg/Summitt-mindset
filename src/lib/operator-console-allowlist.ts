import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";

/**
 * Internal operator console (read-only coach state).
 *
 * Access: set one or both env vars (comma-separated lists, trimmed):
 * - OPERATOR_CONSOLE_ALLOWED_CLERK_USER_IDS — Clerk user ids, e.g. user_abc,user_def
 * - OPERATOR_CONSOLE_ALLOWED_EMAILS — primary-email allowlist (case-insensitive)
 *
 * If both lists resolve empty after parsing, no one is allowed (safe default).
 * Unauthorized viewers receive 404 via notFound() — no admin chrome leak.
 */
function parseCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseOperatorConsoleAllowedClerkUserIds(): Set<string> {
  return new Set(parseCsv(process.env.OPERATOR_CONSOLE_ALLOWED_CLERK_USER_IDS));
}

export function parseOperatorConsoleAllowedEmails(): Set<string> {
  const emails = parseCsv(process.env.OPERATOR_CONSOLE_ALLOWED_EMAILS).map((e) => e.toLowerCase());
  return new Set(emails);
}

export function isOperatorConsoleAllowlisted(clerkUserId: string, primaryEmail: string | null): boolean {
  const ids = parseOperatorConsoleAllowedClerkUserIds();
  const emails = parseOperatorConsoleAllowedEmails();
  if (ids.size === 0 && emails.size === 0) return false;
  if (ids.has(clerkUserId.trim())) return true;
  const em = primaryEmail?.trim().toLowerCase();
  if (em && emails.has(em)) return true;
  return false;
}

/**
 * Clerk session required; non-allowlisted users get 404.
 */
export async function assertOperatorConsoleAccess(): Promise<{
  clerkUserId: string;
  primaryEmail: string | null;
}> {
  const { userId } = await auth();
  if (!userId) notFound();
  const user = await currentUser();
  const primary = user?.emailAddresses?.[0]?.emailAddress?.trim() || null;
  if (!isOperatorConsoleAllowlisted(userId, primary)) notFound();
  return { clerkUserId: userId, primaryEmail: primary };
}
