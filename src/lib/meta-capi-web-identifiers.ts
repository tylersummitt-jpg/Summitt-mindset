/**
 * Persist/load Meta CAPI website match identifiers.
 * Fail-open. Never logs raw values. Not used for auth or billing.
 */

import "server-only";

import { readMarketingCookiesFromRequest } from "@/lib/marketing-collect";
import {
  clientIpFromRequestHeaders,
  constructFbcFromRealFbclid,
  parseCookieMap,
  sanitizeMetaClientIp,
  sanitizeMetaClientUserAgent,
  sanitizeMetaFbc,
  sanitizeMetaFbp,
  sanitizeMetaFbclid,
} from "@/lib/meta-capi-web-identifier-validation";
import { isNativeSummittMindsetAppRequestFromRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { supabaseServer } from "@/lib/supabase-server";

export const META_CAPI_WEB_IDENTIFIERS_TABLE = "meta_capi_web_identifiers" as const;

export type MetaCapiWebMatch = {
  fbc: string | null;
  fbp: string | null;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
};

type IdentifierRow = {
  clerk_user_id: string;
  meta_fbclid: string | null;
  meta_fbclid_observed_at: string | null;
  meta_fbc: string | null;
  meta_fbp: string | null;
  client_ip: string | null;
  client_user_agent: string | null;
};

function asRow(raw: Record<string, unknown> | null): IdentifierRow | null {
  if (!raw) return null;
  const clerkUserId =
    typeof raw.clerk_user_id === "string" ? raw.clerk_user_id.trim() : "";
  if (!clerkUserId) return null;
  return {
    clerk_user_id: clerkUserId,
    meta_fbclid: typeof raw.meta_fbclid === "string" ? raw.meta_fbclid : null,
    meta_fbclid_observed_at:
      typeof raw.meta_fbclid_observed_at === "string"
        ? raw.meta_fbclid_observed_at
        : null,
    meta_fbc: typeof raw.meta_fbc === "string" ? raw.meta_fbc : null,
    meta_fbp: typeof raw.meta_fbp === "string" ? raw.meta_fbp : null,
    client_ip: typeof raw.client_ip === "string" ? raw.client_ip : null,
    client_user_agent:
      typeof raw.client_user_agent === "string" ? raw.client_user_agent : null,
  };
}

function resolveFbc(args: {
  cookieFbc: string | null;
  existingFbc: string | null;
  fbclid: string | null;
  observedAt: string | null;
}): string | null {
  if (args.cookieFbc) return args.cookieFbc;
  if (args.existingFbc) return args.existingFbc;
  if (args.fbclid && args.observedAt) {
    return constructFbcFromRealFbclid(args.fbclid, args.observedAt);
  }
  return null;
}

function webMatchFromRow(row: IdentifierRow): MetaCapiWebMatch {
  const storedFbc = sanitizeMetaFbc(row.meta_fbc);
  const constructed =
    storedFbc ||
    (row.meta_fbclid && row.meta_fbclid_observed_at
      ? constructFbcFromRealFbclid(row.meta_fbclid, row.meta_fbclid_observed_at)
      : null);
  return {
    fbc: constructed,
    fbp: sanitizeMetaFbp(row.meta_fbp),
    clientIpAddress: sanitizeMetaClientIp(row.client_ip),
    clientUserAgent: sanitizeMetaClientUserAgent(row.client_user_agent),
  };
}

export async function loadMetaCapiWebIdentifiersForUser(
  clerkUserId: string | null | undefined
): Promise<MetaCapiWebMatch | null> {
  try {
    const uid = typeof clerkUserId === "string" ? clerkUserId.trim() : "";
    if (!uid) return null;
    const { data, error } = await supabaseServer
      .from(META_CAPI_WEB_IDENTIFIERS_TABLE)
      .select(
        "clerk_user_id, meta_fbclid, meta_fbclid_observed_at, meta_fbc, meta_fbp, client_ip, client_user_agent"
      )
      .eq("clerk_user_id", uid)
      .maybeSingle();
    if (error || !data) return null;
    const row = asRow(data as Record<string, unknown>);
    return row ? webMatchFromRow(row) : null;
  } catch {
    return null;
  }
}

export async function purgeMetaCapiWebIdentifiersForUser(
  clerkUserId: string | null | undefined
): Promise<void> {
  try {
    const uid = typeof clerkUserId === "string" ? clerkUserId.trim() : "";
    if (!uid) return;
    const { error } = await supabaseServer
      .from(META_CAPI_WEB_IDENTIFIERS_TABLE)
      .delete()
      .eq("clerk_user_id", uid);
    if (error) {
      console.warn("[meta-capi-web-identifiers] purge failed");
    }
  } catch {
    console.warn("[meta-capi-web-identifiers] purge unexpected");
  }
}

export type MetaCapiWebIdentifiersPresence = "absent" | "present" | "unknown";

function isUndefinedTableError(error: { code?: string; message?: string }): boolean {
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "42P01" || code === "PGRST205") return true;
  const message = typeof error.message === "string" ? error.message : "";
  return /could not find the table|relation .* does not exist/i.test(message);
}

/**
 * Whether a meta identifier row remains for this Clerk user.
 * `absent` if the table is not installed yet (nothing to leave behind).
 * `unknown` if presence cannot be proven — callers must not complete deletion.
 */
export async function metaCapiWebIdentifiersPresenceForUser(
  clerkUserId: string | null | undefined
): Promise<MetaCapiWebIdentifiersPresence> {
  try {
    const uid = typeof clerkUserId === "string" ? clerkUserId.trim() : "";
    if (!uid) return "absent";
    const { data, error } = await supabaseServer
      .from(META_CAPI_WEB_IDENTIFIERS_TABLE)
      .select("clerk_user_id")
      .eq("clerk_user_id", uid)
      .maybeSingle();
    if (error) {
      if (isUndefinedTableError(error)) return "absent";
      return "unknown";
    }
    return data ? "present" : "absent";
  } catch {
    return "unknown";
  }
}

/**
 * Capture identifiers from the authenticated WEB create-checkout-session request.
 * Native callers must already have been rejected. This helper also no-ops native UA.
 */
export async function persistMetaCapiWebIdentifiersFromCheckoutRequest(args: {
  req: Request;
  userId: string;
}): Promise<void> {
  try {
    if (isNativeSummittMindsetAppRequestFromRequest(args.req)) return;
    const uid = typeof args.userId === "string" ? args.userId.trim() : "";
    if (!uid) return;

    const cookies = parseCookieMap(args.req.headers.get("cookie"));
    const cookieFbc = sanitizeMetaFbc(cookies.get("_fbc") ?? null);
    const cookieFbp = sanitizeMetaFbp(cookies.get("_fbp") ?? null);
    const marketing = await readMarketingCookiesFromRequest(args.req);
    const cookieFbclid = sanitizeMetaFbclid(
      marketing.attribution?.meta_fbclid ?? null
    );
    const cookieObservedAt =
      typeof marketing.attribution?.meta_fbclid_observed_at === "string"
        ? marketing.attribution.meta_fbclid_observed_at
        : null;

    const clientIp = clientIpFromRequestHeaders(args.req.headers);
    const clientUserAgent = sanitizeMetaClientUserAgent(
      args.req.headers.get("user-agent")
    );

    const { data: existingRaw, error: selectError } = await supabaseServer
      .from(META_CAPI_WEB_IDENTIFIERS_TABLE)
      .select(
        "clerk_user_id, meta_fbclid, meta_fbclid_observed_at, meta_fbc, meta_fbp, client_ip, client_user_agent"
      )
      .eq("clerk_user_id", uid)
      .maybeSingle();
    if (selectError) {
      console.warn("[meta-capi-web-identifiers] persist lookup failed");
      return;
    }

    const existing = asRow((existingRaw as Record<string, unknown> | null) ?? null);
    const nextFbclid = existing?.meta_fbclid ?? cookieFbclid;
    const nextObservedAt = existing?.meta_fbclid_observed_at
      ? existing.meta_fbclid_observed_at
      : nextFbclid
        ? cookieObservedAt
        : null;
    const nextFbc = resolveFbc({
      cookieFbc,
      existingFbc: sanitizeMetaFbc(existing?.meta_fbc ?? null),
      fbclid: nextFbclid,
      observedAt: nextObservedAt,
    });
    const nextFbp = cookieFbp ?? sanitizeMetaFbp(existing?.meta_fbp ?? null);
    const nextIp = clientIp ?? existing?.client_ip ?? null;
    const nextUa = clientUserAgent ?? existing?.client_user_agent ?? null;

    if (
      !nextFbclid &&
      !nextFbc &&
      !nextFbp &&
      !nextIp &&
      !nextUa &&
      !existing
    ) {
      return;
    }

    const payload = {
      clerk_user_id: uid,
      meta_fbclid: nextFbclid,
      meta_fbclid_observed_at: nextObservedAt,
      meta_fbc: nextFbc,
      meta_fbp: nextFbp,
      client_ip: nextIp,
      client_user_agent: nextUa,
      updated_at: new Date().toISOString(),
    };

    if (!existing) {
      const { error } = await supabaseServer
        .from(META_CAPI_WEB_IDENTIFIERS_TABLE)
        .insert(payload);
      if (error && (error as { code?: string }).code !== "23505") {
        console.warn("[meta-capi-web-identifiers] persist insert failed");
      }
      return;
    }

    const { error } = await supabaseServer
      .from(META_CAPI_WEB_IDENTIFIERS_TABLE)
      .update({
        meta_fbclid: nextFbclid,
        meta_fbclid_observed_at: nextObservedAt,
        meta_fbc: nextFbc,
        meta_fbp: nextFbp,
        client_ip: nextIp,
        client_user_agent: nextUa,
        updated_at: payload.updated_at,
      })
      .eq("clerk_user_id", uid);
    if (error) {
      console.warn("[meta-capi-web-identifiers] persist update failed");
    }
  } catch {
    console.warn("[meta-capi-web-identifiers] persist unexpected");
  }
}
