/**
 * Relationship Snapshot v2 — authority-labeled envelope around Relationship Packet v1.8.
 * Read-only OpenAI context; does not route, mutate state, or authorize sends.
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  buildActivePendingStateFromDailyFacts,
  buildActivePendingStateFromInboundFacts,
  buildActivePendingStateFromWeeklyFacts,
  type ActivePendingState,
  type ActivePendingStateBuildMeta,
  type ActivePendingStateBuildResult,
  type ActivePendingStateItemKind,
  type ActivePendingStateSource,
} from "@/lib/sms-active-pending-state";
import type {
  RelationshipPacketAuthority,
  RelationshipPacketLane,
  RelationshipPacketMeta,
  RelationshipPacketSection,
  RelationshipPacketRecentExactThread72h,
  RelationshipPacketV1,
} from "@/lib/sms-relationship-packet-v1";
import {
  buildOpenLoopsAndDoNotRepeat,
  buildOpenLoopsAndDoNotRepeatPromptGuidance,
  type OpenLoopsAndDoNotRepeatData,
} from "@/lib/sms-open-loops-and-do-not-repeat";

const SNAPSHOT_THREAD_WINDOW_HOURS = 72 as const;
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";

export const RELATIONSHIP_SNAPSHOT_V2_VERSION = "2.0" as const;

export type RelationshipSnapshotSurface =
  | "inbound"
  | "daily"
  | "weekly"
  | "guided_contract";

export const RELATIONSHIP_SNAPSHOT_AUTHORITY_HIERARCHY = [
  "current_turn_exact",
  "server_state_authoritative",
  "structured_recent_truth",
  "recent_exact_thread_72h",
  "proof_and_praise_permission",
  "relationship_memory_7d",
  "relationship_memory_30d_or_season",
  "long_term_background_summary",
  "low_confidence_hints",
] as const;

export type SnapshotRecentExactThread72hData = {
  window_hours: typeof SNAPSHOT_THREAD_WINDOW_HOURS;
  messages: RecentExactThread72hMessage[];
  message_count: number;
  had_preview_messages: boolean;
  had_system_no_send: boolean;
  thread_fallback_used: boolean;
  thread_fallback_source?: string | null;
};

export type RelationshipSnapshotRouteContext = {
  surface: RelationshipSnapshotSurface;
  lane?: RelationshipPacketLane | null;
  route_purpose?: string | null;
  route_kind?: string | null;
  accountability_day_key?: string | null;
  timezone?: string | null;
  proposal_kind?: string | null;
};

export type RelationshipSnapshotV2 = {
  version: typeof RELATIONSHIP_SNAPSHOT_V2_VERSION;
  generated_at: string;
  timezone: string;
  surface: RelationshipSnapshotSurface;
  authority_hierarchy: readonly (typeof RELATIONSHIP_SNAPSHOT_AUTHORITY_HIERARCHY)[number][];
  current_turn: RelationshipPacketV1["current_turn"];
  canonical_state: RelationshipPacketV1["canonical_state"];
  active_pending_state: ActivePendingState;
  structured_recent_truth: RelationshipPacketV1["structured_recent_truth"];
  recent_exact_thread_72h: RelationshipPacketSection<SnapshotRecentExactThread72hData>;
  relationship_memory_7d?: RelationshipPacketV1["relationship_memory_7d"];
  relationship_memory_30d_or_season?: RelationshipPacketV1["relationship_memory_30d_or_season"];
  proof_and_praise_permission: RelationshipPacketV1["proof_victory_permission"];
  open_loops_and_do_not_repeat: RelationshipPacketSection<OpenLoopsAndDoNotRepeatData>;
  route_context: RelationshipPacketSection<RelationshipSnapshotRouteContext>;
  long_term_background_summary?: RelationshipPacketV1["lower_authority_background"];
  low_confidence_hints?: RelationshipPacketV1["lower_authority_background"];
  finalization_context: { note: "server_validates_send_separately" };
};

export type RelationshipSnapshotV2Meta = {
  relationship_snapshot_version: typeof RELATIONSHIP_SNAPSHOT_V2_VERSION;
  included_thread_message_count: number;
  included_thread_window_hours: typeof SNAPSHOT_THREAD_WINDOW_HOURS;
  had_preview_messages: boolean;
  had_system_no_send: boolean;
  active_pending_state_item_count: number;
  active_pending_state_source?: ActivePendingStateSource;
  active_pending_state_has_commitment_row?: boolean;
  row_authoritative_pending_kinds?: ActivePendingStateItemKind[];
  facts_fallback_pending_kinds?: ActivePendingStateItemKind[];
  relationship_snapshot_truncated: boolean;
  thread_fallback_used: boolean;
  open_loop_count?: number;
  satisfied_ask_count?: number;
  do_not_repeat_ask_count?: number;
  recent_unanswered_question_count?: number;
  open_loops_sources?: string[];
  open_loops_truncated?: boolean;
};

export function normalizeStructuredRecentExactThread72hForV2(
  section: RelationshipPacketSection<RelationshipPacketRecentExactThread72h> | null
): RelationshipPacketSection<SnapshotRecentExactThread72hData> {
  if (!section) {
    return {
      authority: "authoritative_recent_thread",
      data: {
        window_hours: SNAPSHOT_THREAD_WINDOW_HOURS,
        messages: [],
        message_count: 0,
        had_preview_messages: false,
        had_system_no_send: false,
        thread_fallback_used: true,
        thread_fallback_source: "missing_thread",
      },
    };
  }

  const hadLegacy = Boolean(section.data.legacy_fallback_lines?.length);
  const messages = section.data.messages ?? [];

  return {
    authority: "authoritative_recent_thread",
    data: {
      window_hours: section.data.window_hours ?? SNAPSHOT_THREAD_WINDOW_HOURS,
      messages,
      message_count: section.data.message_count ?? messages.length,
      had_preview_messages: section.data.had_preview_messages ?? false,
      had_system_no_send: section.data.had_system_no_send ?? false,
      thread_fallback_used: hadLegacy && messages.length === 0,
      thread_fallback_source:
        hadLegacy && messages.length === 0
          ? section.data.legacy_fallback_source ?? "legacy_lines_only"
          : messages.length === 0
            ? "empty_structured_thread"
            : null,
    },
  };
}

function buildOpenLoopsSectionForSnapshot(args: {
  packet: RelationshipPacketV1;
  activePendingState: ActivePendingState;
  threadSection: RelationshipPacketSection<SnapshotRecentExactThread72hData>;
  surface: RelationshipSnapshotSurface;
  lane?: RelationshipPacketLane | null;
  proposalKind?: string | null;
}): {
  section: RelationshipSnapshotV2["open_loops_and_do_not_repeat"];
  meta: Pick<
    RelationshipSnapshotV2Meta,
    | "open_loop_count"
    | "satisfied_ask_count"
    | "do_not_repeat_ask_count"
    | "recent_unanswered_question_count"
    | "open_loops_sources"
    | "open_loops_truncated"
  >;
} {
  const routeCtx = resolveRouteContext(args.packet, args.surface, args.lane, args.proposalKind);
  const built = buildOpenLoopsAndDoNotRepeat({
    structuredRecentTruth: args.packet.structured_recent_truth.data,
    activePendingState: args.activePendingState,
    relationshipMemory7d: args.packet.relationship_memory_7d?.data,
    recentExactThread72h: args.threadSection.data,
    routeContext: routeCtx.data,
  });
  return { section: built.section, meta: built.meta };
}

function resolveTimezoneFromPacket(
  packet: RelationshipPacketV1,
  surface: RelationshipSnapshotSurface
): string {
  return (
    packet.current_turn.data.timezone?.trim() ||
    (surface === "guided_contract" ? "UTC" : "America/Chicago")
  );
}

function resolveRouteContext(
  packet: RelationshipPacketV1,
  surface: RelationshipSnapshotSurface,
  lane?: RelationshipPacketLane | null,
  proposalKind?: string | null
): RelationshipPacketSection<RelationshipSnapshotRouteContext> {
  const ct = packet.current_turn.data;
  return {
    authority: "authoritative_current",
    data: {
      surface,
      lane: lane ?? null,
      route_purpose: ct.route_purpose ?? null,
      route_kind: ct.route_kind ?? null,
      accountability_day_key: ct.accountability_day_key ?? null,
      timezone: ct.timezone ?? null,
      proposal_kind: proposalKind ?? null,
    },
  };
}

export function buildRelationshipSnapshotV2(args: {
  packet: RelationshipPacketV1;
  activePendingState: ActivePendingState;
  activePendingMeta?: ActivePendingStateBuildMeta | null;
  surface: RelationshipSnapshotSurface;
  lane?: RelationshipPacketLane | null;
  timezone?: string | null;
  proposalKind?: string | null;
  generatedAt?: string;
  truncated?: boolean;
}): { snapshot: RelationshipSnapshotV2; meta: RelationshipSnapshotV2Meta } {
  const timezone = args.timezone?.trim() || resolveTimezoneFromPacket(args.packet, args.surface);
  const threadSection = normalizeStructuredRecentExactThread72hForV2(
    args.packet.recent_exact_thread_72h
  );
  const openLoopsBuilt = buildOpenLoopsSectionForSnapshot({
    packet: args.packet,
    activePendingState: args.activePendingState,
    threadSection,
    surface: args.surface,
    lane: args.lane,
    proposalKind: args.proposalKind,
  });

  const snapshot: RelationshipSnapshotV2 = {
    version: RELATIONSHIP_SNAPSHOT_V2_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    timezone,
    surface: args.surface,
    authority_hierarchy: RELATIONSHIP_SNAPSHOT_AUTHORITY_HIERARCHY,
    current_turn: args.packet.current_turn,
    canonical_state: args.packet.canonical_state,
    active_pending_state: args.activePendingState,
    structured_recent_truth: args.packet.structured_recent_truth,
    recent_exact_thread_72h: threadSection,
    proof_and_praise_permission: args.packet.proof_victory_permission,
    open_loops_and_do_not_repeat: openLoopsBuilt.section,
    route_context: resolveRouteContext(args.packet, args.surface, args.lane, args.proposalKind),
    finalization_context: { note: "server_validates_send_separately" },
  };

  if (args.packet.relationship_memory_7d) {
    snapshot.relationship_memory_7d = args.packet.relationship_memory_7d;
  }
  if (args.packet.relationship_memory_30d_or_season) {
    snapshot.relationship_memory_30d_or_season = args.packet.relationship_memory_30d_or_season;
  }
  if (args.packet.lower_authority_background) {
    snapshot.long_term_background_summary = {
      authority: "background_summary" as RelationshipPacketAuthority,
      data: {
        relationship_profile_summary:
          args.packet.lower_authority_background.data.relationship_profile_summary,
        coaching_memory_snippet: args.packet.lower_authority_background.data.coaching_memory_snippet,
      },
    };
    snapshot.low_confidence_hints = args.packet.lower_authority_background;
  }

  const pendingMeta = args.activePendingMeta;
  const meta: RelationshipSnapshotV2Meta = {
    relationship_snapshot_version: RELATIONSHIP_SNAPSHOT_V2_VERSION,
    included_thread_message_count: threadSection.data.message_count,
    included_thread_window_hours: SNAPSHOT_THREAD_WINDOW_HOURS,
    had_preview_messages: threadSection.data.had_preview_messages,
    had_system_no_send: threadSection.data.had_system_no_send,
    active_pending_state_item_count: args.activePendingState.items.length,
    ...(pendingMeta
      ? {
          active_pending_state_source: pendingMeta.active_pending_state_source,
          active_pending_state_has_commitment_row: pendingMeta.active_pending_state_has_commitment_row,
          row_authoritative_pending_kinds: pendingMeta.row_authoritative_pending_kinds,
          facts_fallback_pending_kinds: pendingMeta.facts_fallback_pending_kinds,
        }
      : {}),
    relationship_snapshot_truncated: args.truncated === true,
    thread_fallback_used: threadSection.data.thread_fallback_used,
    ...openLoopsBuilt.meta,
  };

  return { snapshot, meta };
}

export function buildRelationshipSnapshotV2PromptGuidance(): string {
  return `
RELATIONSHIP_SNAPSHOT_V2_AUTHORITY (read-only context — server final guard validates send separately):
- authority_hierarchy order is binding when sections conflict.
- current_turn_exact beats all older memory and summaries.
- server_state_authoritative (canonical_state + active_pending_state) beats relationship_memory summaries.
- structured_recent_truth beats relationship_memory_7d / relationship_memory_30d_or_season on stale-ask and open-loop conflicts.
- recent_exact_thread_72h beats relationship_memory_7d and relationship_memory_30d_or_season on what was actually said in SMS.
- relationship_memory_7d beats relationship_memory_30d_or_season.
- low_confidence_hints and long_term_background_summary are background tone only — never proof of completion or resolution.
- active_pending_state tells you what is still open — must_not_claim_resolved items must NOT be treated as closed in visible SMS.
${buildOpenLoopsAndDoNotRepeatPromptGuidance()}
- finalization_context is NOT permission to make proof/state claims; server validates send separately.
- thread_fallback_used true with empty messages[] means no prose transcript fallback — do not invent thread history.`;
}

export function userPromptAppendixFromSnapshotV2(snapshot: RelationshipSnapshotV2): string {
  return `RELATIONSHIP_SNAPSHOT_V2 (authority-labeled context; not copyable prose):
${JSON.stringify(snapshot)}`;
}

export function combinedUserPromptFromPacketAndSnapshot(
  packet: RelationshipPacketV1,
  snapshot: RelationshipSnapshotV2
): string {
  return `RELATIONSHIP_PACKET_V1 (facts only; not copyable prose):
${JSON.stringify(packet)}

${userPromptAppendixFromSnapshotV2(snapshot)}

Write JSON only.`;
}

export function relationshipSnapshotV2MetaForTelemetry(
  meta: RelationshipSnapshotV2Meta
): Record<string, unknown> {
  return { ...meta };
}

export function mergePacketAndSnapshotTelemetry(
  packetMeta: RelationshipPacketMeta,
  snapshotMeta: RelationshipSnapshotV2Meta
): Record<string, unknown> {
  return {
    ...packetMeta,
    ...relationshipSnapshotV2MetaForTelemetry(snapshotMeta),
  };
}

export function activePendingStateForLaneFacts(args: {
  lane: RelationshipPacketLane;
  sourceFacts: InboundV3RelationshipFacts | DailyV3RelationshipFacts | WeeklyV3OutboundFacts;
  commitmentRow?: ActiveV2CommitmentRow | null;
}): ActivePendingStateBuildResult {
  if (args.lane === "inbound") {
    return buildActivePendingStateFromInboundFacts(
      args.sourceFacts as InboundV3RelationshipFacts,
      args.commitmentRow
    );
  }
  if (args.lane === "daily") {
    return buildActivePendingStateFromDailyFacts(
      args.sourceFacts as DailyV3RelationshipFacts,
      args.commitmentRow
    );
  }
  return buildActivePendingStateFromWeeklyFacts(
    args.sourceFacts as WeeklyV3OutboundFacts,
    args.commitmentRow
  );
}

export function latestCoachBodyFromSnapshotThread(snapshot: RelationshipSnapshotV2): string | null {
  const messages = snapshot.recent_exact_thread_72h.data.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "coach" && m.delivery_status !== "preview" && m.body.trim()) {
      return m.body.trim();
    }
  }
  return null;
}

export function latestCoachSentAtFromSnapshotThread(snapshot: RelationshipSnapshotV2): string | null {
  const messages = snapshot.recent_exact_thread_72h.data.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "coach" && m.delivery_status !== "preview") {
      return m.at;
    }
  }
  return null;
}
