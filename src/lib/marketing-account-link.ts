import "server-only";

import {
  insertMarketingEventFailOpen,
  readMarketingCookiesFromStore,
} from "@/lib/marketing-collect";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Idempotent visitor → Clerk first-touch link.
 * Missing cookies: no-op (do not invent Direct).
 * Insert/query failures: swallow and return. Never throw to callers.
 */
export async function linkMarketingVisitorToClerkUser(
  clerkUserId: string
): Promise<void> {
  try {
    const uid = typeof clerkUserId === "string" ? clerkUserId.trim() : "";
    if (!uid) return;

    const { visitorId, attribution } = await readMarketingCookiesFromStore();
    if (!visitorId || !attribution) return;

    const { error: attrError } = await supabaseServer.from("marketing_attribution").insert({
      clerk_user_id: uid,
      visitor_id: visitorId,
      first_touch_at: attribution.first_touch_at,
      source_normalized: attribution.source_normalized,
      is_paid_acquisition: attribution.is_paid_acquisition,
      source_detail: attribution.source_detail,
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content,
      referrer_host: attribution.referrer_host,
    });

    if (attrError && (attrError as { code?: string }).code !== "23505") {
      console.warn("[marketing-account-link] attribution insert failed", attrError.message);
    }

    await insertMarketingEventFailOpen({
      event_type: "account_created",
      visitor_id: visitorId,
      clerk_user_id: uid,
      path: null,
      attribution,
      metadata: null,
    });
  } catch (err) {
    console.warn("[marketing-account-link] failed; continuing product flow", err);
  }
}
