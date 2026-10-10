/**
 * ======================================================
 * Clerk REST Helpers (CANONICAL)
 * ======================================================
 *
 * - Do NOT rely on Clerk server SDK helpers for metadata.
 * - Read via Clerk REST using CLERK_SECRET_KEY.
 *
 * Added:
 * - listClerkUsers() for cron scanning (needed for SMS pulse)
 */

export type ClerkUserResponse = {
  id: string;
  /** Unix ms — present on list/get user from Clerk REST. */
  created_at?: number;
  first_name?: string | null;
  last_name?: string | null;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  public_metadata?: Record<string, any>;
  private_metadata?: Record<string, any>;
  unsafe_metadata?: Record<string, any>;
};

type ClerkUserListResponse = ClerkUserResponse[];

function getClerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("Missing CLERK_SECRET_KEY");
  return key;
}

export async function getClerkUser(userId: string): Promise<ClerkUserResponse> {
  const key = getClerkSecretKey();

  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Clerk user: ${text}`);
  }

  return (await res.json()) as ClerkUserResponse;
}

/** Same as getClerkUser but returns null when the user does not exist (404). */
export async function getClerkUserOrNull(
  userId: string
): Promise<ClerkUserResponse | null> {
  const key = getClerkSecretKey();

  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Clerk user: ${text}`);
  }

  return (await res.json()) as ClerkUserResponse;
}

export async function getClerkPublicMetadata(
  userId: string
): Promise<Record<string, any>> {
  const user = await getClerkUser(userId);
  return user.public_metadata || {};
}

/**
 * ✅ List users (paginated) — required for cron scans
 * Clerk supports limit (max 500) + offset.
 */
export async function listClerkUsers(args?: {
  limit?: number;
  offset?: number;
  /** Clerk order_by, for example "-created_at". Omit to keep the API default. */
  orderBy?: string;
}): Promise<ClerkUserResponse[]> {
  const key = getClerkSecretKey();

  const limit =
    typeof args?.limit === "number"
      ? Math.min(Math.max(args.limit, 1), 500)
      : 200;

  const offset = typeof args?.offset === "number" ? Math.max(args.offset, 0) : 0;

  const url = new URL("https://api.clerk.com/v1/users");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (args?.orderBy) url.searchParams.set("order_by", args.orderBy);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list Clerk users: ${text}`);
  }

  return (await res.json()) as ClerkUserListResponse;
}

/** Total Clerk users. Throws if the count cannot be read. */
export async function countClerkUsers(): Promise<number> {
  const key = getClerkSecretKey();
  const res = await fetch("https://api.clerk.com/v1/users/count", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to count Clerk users: ${text}`);
  }
  const body = (await res.json()) as { total_count?: unknown };
  if (typeof body.total_count !== "number" || !Number.isFinite(body.total_count)) {
    throw new Error("Clerk user count was not a number");
  }
  return body.total_count;
}

const CLERK_USERS_BY_IDS_MAX = 100;

/**
 * One Clerk Backend GET /v1/users filtered by user_id.
 * For small admin lookups (e.g. 20 trial starters). Not a full user scan.
 */
export async function listClerkUsersByIds(
  userIds: readonly string[]
): Promise<ClerkUserResponse[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of userIds) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= CLERK_USERS_BY_IDS_MAX) break;
  }
  if (unique.length === 0) return [];

  const key = getClerkSecretKey();
  const url = new URL("https://api.clerk.com/v1/users");
  url.searchParams.set("limit", String(unique.length));
  for (const id of unique) {
    url.searchParams.append("user_id", id);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list Clerk users by id: ${text}`);
  }

  return (await res.json()) as ClerkUserListResponse;
}
