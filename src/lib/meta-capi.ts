/**
 * Meta Conversions API — server-only, fail-open, no PII beyond hashed external_id
 * plus optional unhashed website match identifiers (fbc/fbp/IP/UA) when present.
 */

import "server-only";

import { createHash } from "node:crypto";

import { getMetaPixelId, isMetaPixelEnabled } from "@/lib/meta-pixel";
import {
  sanitizeMetaClientIp,
  sanitizeMetaClientUserAgent,
  sanitizeMetaFbc,
  sanitizeMetaFbp,
} from "@/lib/meta-capi-web-identifier-validation";

export const META_CAPI_GRAPH_VERSION = "v21.0" as const;
export const META_CAPI_TIMEOUT_MS = 2000 as const;
export const META_CAPI_EVENT_SOURCE_URL =
  "https://www.summittmindset.com/subscribe" as const;

export type MetaCapiStandardEvent = "StartTrial" | "Subscribe";

export type MetaCapiSendInput = {
  eventName: MetaCapiStandardEvent;
  eventTime: number;
  eventId: string;
  externalIdHash?: string | null;
  value?: number | null;
  currency?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
};

export type MetaCapiSendResult =
  | { ok: true }
  | { ok: false; reason: string };

function getCapiAccessToken(): string | null {
  const raw = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  return raw ? raw : null;
}

/**
 * Meta Test Events code for the Graph body.
 * Never attached when VERCEL_ENV is production.
 * When VERCEL_ENV is unset (local/vitest), a non-empty env value is allowed.
 */
export function resolveMetaCapiTestEventCode(env?: {
  META_CAPI_TEST_EVENT_CODE?: string;
  VERCEL_ENV?: string;
}): string | null {
  const source = env ?? process.env;
  const code =
    typeof source.META_CAPI_TEST_EVENT_CODE === "string"
      ? source.META_CAPI_TEST_EVENT_CODE.trim()
      : "";
  if (!code) return null;
  if (source.VERCEL_ENV === "production") return null;
  return code;
}

export function isMetaCapiConfigured(): boolean {
  return isMetaPixelEnabled() && getMetaPixelId() !== null && getCapiAccessToken() !== null;
}

export function hashMetaExternalId(clerkUserId: string | null | undefined): string | null {
  if (typeof clerkUserId !== "string") return null;
  const trimmed = clerkUserId.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed, "utf8").digest("hex");
}

export function buildMetaCapiEventPayload(input: MetaCapiSendInput): Record<string, unknown> {
  const userData: Record<string, string> = {};
  if (input.externalIdHash && /^[a-f0-9]{64}$/.test(input.externalIdHash)) {
    userData.external_id = input.externalIdHash;
  }
  const fbc = sanitizeMetaFbc(input.fbc);
  if (fbc) userData.fbc = fbc;
  const fbp = sanitizeMetaFbp(input.fbp);
  if (fbp) userData.fbp = fbp;
  const ip = sanitizeMetaClientIp(input.clientIpAddress);
  if (ip) userData.client_ip_address = ip;
  const ua = sanitizeMetaClientUserAgent(input.clientUserAgent);
  if (ua) userData.client_user_agent = ua;

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: input.eventTime,
    event_id: input.eventId,
    action_source: "website",
    event_source_url: META_CAPI_EVENT_SOURCE_URL,
  };

  if (Object.keys(userData).length > 0) {
    event.user_data = userData;
  }

  if (input.eventName === "Subscribe") {
    event.custom_data = {
      value: input.value,
      currency: "USD",
    };
  }

  return event;
}

function capiUrl(pixelId: string): string {
  return `https://graph.facebook.com/${META_CAPI_GRAPH_VERSION}/${pixelId}/events`;
}

/**
 * POST one conversion event. Never throws. Never logs the access token or user payload.
 */
export async function sendMetaCapiEvent(
  input: MetaCapiSendInput
): Promise<MetaCapiSendResult> {
  try {
    const pixelId = getMetaPixelId();
    const token = getCapiAccessToken();
    if (!pixelId || !token) {
      return { ok: false, reason: "unconfigured" };
    }
    if (!isMetaPixelEnabled()) {
      return { ok: false, reason: "pixel_disabled" };
    }

    const eventTime = Number.isFinite(input.eventTime)
      ? Math.floor(input.eventTime)
      : Math.floor(Date.now() / 1000);
    if (eventTime <= 0) {
      return { ok: false, reason: "invalid_event_time" };
    }

    const body: Record<string, unknown> = {
      data: [
        buildMetaCapiEventPayload({
          ...input,
          eventTime,
        }),
      ],
      access_token: token,
    };
    const testEventCode = resolveMetaCapiTestEventCode();
    if (testEventCode) {
      body.test_event_code = testEventCode;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_CAPI_TIMEOUT_MS);
    try {
      const res = await fetch(capiUrl(pixelId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn("[meta-capi] graph non-2xx", {
          event_name: input.eventName,
          event_id: input.eventId,
          status: res.status,
        });
        return { ok: false, reason: `http_${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      const reason = aborted ? "timeout" : "network";
      console.warn("[meta-capi] graph request failed", {
        event_name: input.eventName,
        event_id: input.eventId,
        reason,
      });
      return { ok: false, reason };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    console.warn("[meta-capi] send unexpected failure", {
      event_name: input.eventName,
      event_id: input.eventId,
    });
    return { ok: false, reason: "unexpected" };
  }
}
