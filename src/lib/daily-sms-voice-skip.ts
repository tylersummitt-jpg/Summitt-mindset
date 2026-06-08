import type { NorthStarCoachChannel } from "@/lib/north-star-coach-sms";

/**
 * Inspect skipped daily voice decisions in Supabase (no schema change):
 *
 * ```sql
 * select
 *   created_at,
 *   clerk_user_id,
 *   status,
 *   metadata->>'voice_decision' as voice_decision,
 *   metadata->'final_voice_gate' as final_voice_gate,
 *   metadata->'north_star_gate' as north_star_gate
 * from sms_send_events
 * where created_at > now() - interval '24 hours'
 * order by created_at desc;
 * ```
 */
export function isDailySmsWithheldByFinalVoiceGate(built: {
  v2Accountability: boolean;
  v2CommitmentId?: string;
  v2AiPayload?: Record<string, unknown> | null;
}): boolean {
  const vsd = built.v2AiPayload?.voice_send_decision as { should_send?: boolean } | undefined;
  return built.v2Accountability === true && Boolean(built.v2CommitmentId) && vsd?.should_send === false;
}

export function dailySmsVoiceSkipEventPatch(args: {
  existingMeta: Record<string, unknown> | undefined;
  northStarGate: Record<string, unknown>;
  finalVoiceGate: Record<string, unknown>;
  channel: NorthStarCoachChannel;
  timezone: string;
  localTimeIso: string;
  blockedReasons: string[];
  northStarVisibleBody?: string;
  skipSource?: string;
  unifiedFinalGuard?: Record<string, unknown> | null;
  routeKind?: string | null;
  noSendReason?: string | null;
}): { status: string; metadata: Record<string, unknown>; sms_body: string } {
  return {
    status: "skipped_no_safe_v3_voice",
    sms_body: "",
    metadata: {
      ...(args.existingMeta ?? {}),
      note: "skipped_no_safe_v3_voice",
      voice_decision: "skipped_no_safe_v3_voice",
      skip_source: args.skipSource ?? "FVG_no_send",
      cron_route: "/api/cron/daily-sms",
      sms_purpose: "v2_daily_accountability_coaching",
      voice_channel: args.channel,
      blocked_reasons: args.blockedReasons,
      visible_sent: false,
      twilio_send_attempted: false,
      final_body_authority: args.unifiedFinalGuard?.final_body_authority ?? null,
      north_star_gate: args.northStarGate,
      final_voice_gate: args.finalVoiceGate,
      ...(args.unifiedFinalGuard ? { unified_final_product_law_guard: args.unifiedFinalGuard } : {}),
      ...(args.routeKind ? { daily_route_kind: args.routeKind } : {}),
      ...(args.noSendReason ? { no_send_reason: args.noSendReason } : {}),
      ...(args.northStarVisibleBody != null && args.northStarVisibleBody !== ""
        ? { north_star_visible_body: args.northStarVisibleBody }
        : {}),
      timezone: args.timezone,
      local_time: args.localTimeIso,
    },
  };
}
