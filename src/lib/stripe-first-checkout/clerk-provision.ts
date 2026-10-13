import "server-only";

import { SIGN_IN_TICKET_SECONDS } from "@/lib/stripe-first-checkout/constants";

type ClerkErrorBody = {
  errors?: Array<{ code?: string }>;
};

export type ClerkIdentity = {
  id: string;
  primaryEmail: string | null;
  reserved: boolean;
  verificationStatus: string | null;
};

function clerkKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("missing_clerk");
  return key;
}

async function clerkJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function primaryFromUser(body: Record<string, unknown> | null): ClerkIdentity | null {
  if (!body || typeof body.id !== "string") return null;
  const emails = Array.isArray(body.email_addresses) ? body.email_addresses : [];
  const primaryId =
    typeof body.primary_email_address_id === "string" ? body.primary_email_address_id : null;
  const match =
    emails.find(
      (email) =>
        email &&
        typeof email === "object" &&
        (email as { id?: string }).id === primaryId
    ) ?? emails[0];
  const record = match && typeof match === "object" ? (match as Record<string, unknown>) : null;
  const primaryEmail =
    record && typeof record.email_address === "string" ? record.email_address.toLowerCase() : null;
  const reserved = record?.reserved === true;
  const verification = record?.verification;
  const verificationStatus =
    verification &&
    typeof verification === "object" &&
    typeof (verification as { status?: unknown }).status === "string"
      ? (verification as { status: string }).status
      : null;
  return { id: body.id, primaryEmail, reserved, verificationStatus };
}

export async function getClerkIdentity(userId: string): Promise<ClerkIdentity | null> {
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${clerkKey()}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("clerk_lookup_failed");
  return primaryFromUser(await clerkJson(res));
}

export async function lookupClerkUserIdsByEmail(email: string): Promise<string[]> {
  const url = new URL("https://api.clerk.com/v1/users");
  url.searchParams.set("email_address", email);
  url.searchParams.set("limit", "10");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${clerkKey()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("clerk_lookup_failed");
  const body = (await res.json()) as Array<{ id?: string }>;
  if (!Array.isArray(body)) return [];
  return body.map((user) => user.id).filter((id): id is string => typeof id === "string");
}

export async function lookupClerkUserIdByExternalId(
  externalId: string
): Promise<string | null> {
  const url = new URL("https://api.clerk.com/v1/users");
  url.searchParams.set("external_id", externalId);
  url.searchParams.set("limit", "2");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${clerkKey()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("clerk_lookup_failed");
  const body = (await res.json()) as Array<{ id?: string }>;
  const id = body?.[0]?.id;
  return typeof id === "string" ? id : null;
}

export async function createReservedClerkUser(args: {
  email: string;
  externalId: string;
}): Promise<{ id: string } | { conflict: true }> {
  const res = await fetch("https://api.clerk.com/v1/users", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clerkKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: [args.email],
      email_address_identification_status: ["reserved"],
      skip_password_requirement: true,
      external_id: args.externalId,
    }),
  });
  if (res.status === 422) {
    const body = (await clerkJson(res)) as ClerkErrorBody | null;
    const code = body?.errors?.[0]?.code ?? "conflict";
    if (code === "form_identifier_exists" || code.length > 0) {
      return { conflict: true };
    }
  }
  if (!res.ok) throw new Error("clerk_create_failed");
  const created = primaryFromUser(await clerkJson(res));
  if (!created?.id) throw new Error("clerk_create_failed");
  return { id: created.id };
}

export async function createClerkSignInTicket(userId: string): Promise<string> {
  const res = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clerkKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      expires_in_seconds: SIGN_IN_TICKET_SECONDS,
    }),
  });
  const body = await clerkJson(res);
  const token = body && typeof body.token === "string" ? body.token : "";
  if (!res.ok || !token) throw new Error("clerk_ticket_failed");
  return token;
}

/**
 * Replaces the address on the same Clerk user and keeps it reserved.
 * Does not mark the new address verified.
 */
export async function replaceClerkEmailReserved(args: {
  userId: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; taken: boolean }> {
  const res = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(args.userId)}/email_address`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${clerkKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: args.email,
        identification_status: "reserved",
      }),
    }
  );
  if (res.status === 422) return { ok: false, taken: true };
  if (!res.ok) throw new Error("clerk_email_replace_failed");
  const updated = primaryFromUser(await clerkJson(res));
  if (!updated || updated.primaryEmail !== args.email || !updated.reserved) {
    return { ok: false, taken: false };
  }
  return { ok: true };
}
