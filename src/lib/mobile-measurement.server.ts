import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import {
  isNavigationSurface,
  measurementEventType,
  measurementIdempotencyKey,
  validMeasurementId,
  type MeasuredPlatform,
  type MeasurementRecord,
  type NavigationSurface,
} from "@/lib/mobile-measurement";

export type MeasurementWriteResult = { status: "recorded" | "duplicate" | "rejected" | "failed" };

export async function recordAppMeasurement(args: {
  clerkUserId: string;
  metadata: unknown;
  platform: MeasuredPlatform;
  record: MeasurementRecord;
  measurementId: string;
  surface: NavigationSurface;
  launchKind: "cold" | "warm" | "navigation";
  elapsedMs: number | null;
  now?: Date;
}): Promise<MeasurementWriteResult> {
  if (!isSubscribedFromPublicMetadata(args.metadata)) return { status: "rejected" };
  if (!validMeasurementId(args.measurementId) || !isNavigationSurface(args.surface)) {
    return { status: "rejected" };
  }
  const failed = args.record === "startup_failed" || args.record === "navigation_failed";
  const payload = {
    platform: args.platform,
    outcome: failed ? "failed" : "ready",
    launchKind: args.launchKind,
    surface: args.surface,
    elapsedMs: failed ? null : args.elapsedMs,
  };
  const { error } = await supabaseServer.from("v2_event").insert({
    idempotency_key: measurementIdempotencyKey({
      clerkUserId: args.clerkUserId,
      measurementId: args.measurementId,
      record: args.record,
    }),
    clerk_user_id: args.clerkUserId,
    event_type: measurementEventType(args.record),
    source: "member_experience",
    occurred_at: (args.now ?? new Date()).toISOString(),
    payload_json: payload,
  });
  if (!error) return { status: "recorded" };
  if (error.code === "23505") return { status: "duplicate" };
  console.error("[mobile-measurement] write failed", {
    record: args.record,
    code: error.code ?? "unknown",
  });
  return { status: "failed" };
}
