/**
 * ======================================================
 * Clerk Public Metadata Updater (CANONICAL)
 * ======================================================
 *
 * Clerk SDK does NOT support server-side metadata helpers.
 * We must use Clerk REST API directly.
 *
 * This is the ONLY safe way to patch metadata at scale.
 */

export async function updateClerkPublicMetadata(
  userId: string,
  newFields: Record<string, any>
) {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("Missing CLERK_SECRET_KEY");
  }

  // 1) Fetch existing metadata
  const userRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
    },
  });

  if (!userRes.ok) {
    const text = await userRes.text();
    throw new Error(`Failed to fetch Clerk user: ${text}`);
  }

  const user = await userRes.json();
  const existing = user.public_metadata || {};

  // 2) Merge safely
  const merged = {
    ...existing,
    ...newFields,
  };

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
