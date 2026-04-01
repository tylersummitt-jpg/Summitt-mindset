/**
 * ======================================================
 * Clerk Public Metadata Updater (CANONICAL)
 * ======================================================
 *
 * Clerk server SDK metadata helpers are NOT trusted here.
 * We patch metadata via Clerk REST API with a safe merge.
 *
 * This is the ONLY safe way to patch metadata at scale.
 */

import { getClerkPublicMetadata } from "@/lib/clerk-rest";

export async function updateClerkPublicMetadata(
  userId: string,
  newFields: Record<string, any>,
  removeKeys?: string[]
) {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("Missing CLERK_SECRET_KEY");
  }

  // 1) Fetch existing metadata (fresh)
  const existing = await getClerkPublicMetadata(userId);

  // 2) Merge safely
  const merged = {
    ...existing,
    ...newFields,
  };
  if (removeKeys?.length) {
    for (const key of removeKeys) {
      delete merged[key];
    }
  }

  // 3) Patch back to Clerk
  const patchRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
    },
    body: JSON.stringify({
      public_metadata: merged,
    }),
  });

  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error(`Failed Clerk metadata patch: ${text}`);
  }
}
