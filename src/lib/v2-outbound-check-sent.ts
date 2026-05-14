import { supabaseServer } from "@/lib/supabase-server";
import {
  parseContractOverlayProposalFromCheckPayload,
  type V2ContractOverlayProposalKind,
} from "./v2-check-payload-contract-parse";

export { parseContractOverlayProposalFromCheckPayload, type V2ContractOverlayProposalKind };

export type V2CheckSentPromptKind = "standard_accountability" | "contract_overlay_proposal";
export type V2CheckSentExpectedReplySemantics = "yes_no_partial" | "proposal_yes_no";
export type V2CheckSentPostSendMutationResult =
  | "applied"
  | "already_applied"
  | "state_conflict"
  | "not_found"
  | "error";

type V2CheckSentSnapshotRow = {
  idempotency_key: string;
  commitment_id: string;
  clerk_user_id: string;
  day_key: string;
  message_sid: string;
  template_id: number;
  template_family: "standard" | "recovery";
  body_preview: string;
  effective_ask_text: string;
  prompt_kind: V2CheckSentPromptKind;
  expected_reply_semantics: V2CheckSentExpectedReplySemantics;
  check_payload_json: Record<string, unknown>;
  source_wrapped_at: string;
};

type V2CheckSentFallbackCandidate = {
  commitmentId: string;
  clerkUserId: string;
  dayKey: string;
  messageSid: string;
  templateId: number;
  templateFamily: "standard" | "recovery";
  bodyPreview: string;
  effectiveAskText: string;
  promptKind: V2CheckSentPromptKind;
  expectedReplySemantics: V2CheckSentExpectedReplySemantics;
  payloadJson: Record<string, unknown>;
  idempotencyKey: string;
  source: "heuristic_sms_send_events";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function checkSentIdempotencyKey(commitmentId: string, dayKey: string): string {
  return `v2_check_sent:${commitmentId}:${dayKey}`;
}

function contractOverlayProposedIdempotencyKey(commitmentId: string, dayKey: string): string {
  return `v2_contract_overlay_proposed:${commitmentId}:${dayKey}`;
}

async function hasProposalOutboundBundleComplete(args: {
  commitmentId: string;
  dayKey: string;
  expectedProposalText: string;
}): Promise<boolean> {
  const checkKey = checkSentIdempotencyKey(args.commitmentId, args.dayKey);
  const proposedKey = contractOverlayProposedIdempotencyKey(args.commitmentId, args.dayKey);
  const { data: checkEv } = await supabaseServer
    .from("v2_commitment_event")
    .select("id")
    .eq("idempotency_key", checkKey)
    .eq("event_type", "check_sent")
    .maybeSingle();
  if (!checkEv?.id) return false;
  const { data: proposedEv } = await supabaseServer
    .from("v2_commitment_event")
    .select("id")
    .eq("idempotency_key", proposedKey)
    .eq("event_type", "contract_overlay_proposed")
    .maybeSingle();
  if (!proposedEv?.id) return false;
  const { data: row } = await supabaseServer
    .from("v2_commitment")
    .select("adaptive_proposal_text")
    .eq("id", args.commitmentId)
    .maybeSingle();
  const text = typeof row?.adaptive_proposal_text === "string" ? row.adaptive_proposal_text.trim() : "";
  return text === args.expectedProposalText.trim();
}

export async function applyCheckSentPostSendBookkeepingMutation(args: {
  commitmentId: string;
  clerkUserId: string;
  dayKey: string;
  messageSid: string;
  templateId: number;
  templateFamily: "standard" | "recovery";
  bodyPreview: string;
  effectiveAskText: string;
  promptKind: V2CheckSentPromptKind;
  expectedReplySemantics: V2CheckSentExpectedReplySemantics;
  checkPayloadJson?: Record<string, unknown> | null;
  /** When true, atomically persists `contract_overlay_proposed` + pending proposal columns with check_sent. */
  includeContractOverlayProposal?: boolean;
  proposalText?: string | null;
  contractKind?: V2ContractOverlayProposalKind | null;
}): Promise<
  | { ok: true; result: V2CheckSentPostSendMutationResult }
  | { ok: false; result?: V2CheckSentPostSendMutationResult; error: string }
> {
  const include =
    Boolean(args.includeContractOverlayProposal) &&
    args.promptKind === "contract_overlay_proposal" &&
    typeof args.proposalText === "string" &&
    args.proposalText.trim().length > 0 &&
    (args.contractKind === "shrink_ask" || args.contractKind === "recommit_same");

  const { data, error } = await supabaseServer.rpc(
    "v2_apply_check_sent_post_send_bookkeeping_mutation",
    {
      p_commitment_id: args.commitmentId,
      p_clerk_user_id: args.clerkUserId,
      p_day_key: args.dayKey,
      p_message_sid: args.messageSid,
      p_template_id: args.templateId,
      p_template_family: args.templateFamily,
      p_body_preview: args.bodyPreview.slice(0, 160),
      p_effective_ask_text: args.effectiveAskText.slice(0, 240),
      p_prompt_kind: args.promptKind,
      p_expected_reply_semantics: args.expectedReplySemantics,
      p_check_payload_json: args.checkPayloadJson ?? {},
      p_now: new Date().toISOString(),
      p_include_contract_overlay_proposal: include,
      p_proposal_text: include ? args.proposalText!.trim() : null,
      p_contract_kind: include ? args.contractKind! : null,
    }
  );

  if (error) {
    return { ok: false, error: `check_sent_post_send_rpc_failed:${error.message}` };
  }

  const row = Array.isArray(data) ? data[0] : null;
  const result =
    typeof row?.result === "string" ? (row.result as V2CheckSentPostSendMutationResult) : "error";
  if (result === "applied" || result === "already_applied") {
    return { ok: true, result };
  }
  return { ok: false, result, error: `check_sent_post_send_${result}` };
}

export async function onV2StandardCheckSentOutboundSendSuccess(args: {
  commitmentId: string;
  clerkUserId: string;
  dayKey: string;
  templateId: number;
  templateFamily: "standard" | "recovery";
  messageSid: string;
  smsBody: string;
  effectiveAskText: string;
  promptKind: V2CheckSentPromptKind;
  expectedReplySemantics: V2CheckSentExpectedReplySemantics;
  checkPayloadJson?: Record<string, unknown> | null;
  /** Required for `contract_overlay_proposal` so outbound truth is one DB transaction. */
  contractOverlayProposal?: { text: string; contractKind: V2ContractOverlayProposalKind } | null;
}): Promise<void> {
  const proposalBundle =
    args.promptKind === "contract_overlay_proposal"
      ? args.contractOverlayProposal
        ? {
            proposalText: args.contractOverlayProposal.text.trim(),
            contractKind: args.contractOverlayProposal.contractKind,
          }
        : parseContractOverlayProposalFromCheckPayload(args.checkPayloadJson ?? {})
      : null;
  if (args.promptKind === "contract_overlay_proposal" && !proposalBundle) {
    throw new Error("check_sent_post_send_bookkeeping_failed:contract_overlay_proposal_missing_bundle_fields");
  }

  const applied = await applyCheckSentPostSendBookkeepingMutation({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    dayKey: args.dayKey,
    templateId: args.templateId,
    templateFamily: args.templateFamily,
    messageSid: args.messageSid,
    bodyPreview: args.smsBody,
    effectiveAskText: args.effectiveAskText,
    promptKind: args.promptKind,
    expectedReplySemantics: args.expectedReplySemantics,
    checkPayloadJson: args.checkPayloadJson ?? {},
    includeContractOverlayProposal: args.promptKind === "contract_overlay_proposal",
    proposalText: proposalBundle?.proposalText ?? null,
    contractKind: proposalBundle?.contractKind ?? null,
  });
  if (!applied.ok) {
    throw new Error(`check_sent_post_send_bookkeeping_failed:${applied.error}`);
  }
}

function parseSnapshotRow(raw: Record<string, unknown>): V2CheckSentSnapshotRow | null {
  const idempotencyKey = typeof raw.idempotency_key === "string" ? raw.idempotency_key.trim() : "";
  const commitmentId = typeof raw.commitment_id === "string" ? raw.commitment_id.trim() : "";
  const clerkUserId = typeof raw.clerk_user_id === "string" ? raw.clerk_user_id.trim() : "";
  const dayKey = typeof raw.day_key === "string" ? raw.day_key.trim() : "";
  const messageSid = typeof raw.message_sid === "string" ? raw.message_sid.trim() : "";
  const templateId =
    typeof raw.template_id === "number" && Number.isFinite(raw.template_id)
      ? Math.floor(raw.template_id)
      : NaN;
  const templateFamily =
    raw.template_family === "standard" || raw.template_family === "recovery"
      ? raw.template_family
      : null;
  const promptKind =
    raw.prompt_kind === "standard_accountability" || raw.prompt_kind === "contract_overlay_proposal"
      ? raw.prompt_kind
      : null;
  const expectedReplySemantics =
    raw.expected_reply_semantics === "yes_no_partial" ||
    raw.expected_reply_semantics === "proposal_yes_no"
      ? raw.expected_reply_semantics
      : null;
  const payload = asRecord(raw.check_payload_json) ?? {};
  const sourceWrappedAt =
    typeof raw.source_wrapped_at === "string" ? raw.source_wrapped_at : new Date().toISOString();

  if (
    !idempotencyKey ||
    !commitmentId ||
    !clerkUserId ||
    !dayKey ||
    !messageSid ||
    !Number.isFinite(templateId) ||
    templateId <= 0 ||
    !templateFamily ||
    !promptKind ||
    !expectedReplySemantics
  ) {
    return null;
  }

  return {
    idempotency_key: idempotencyKey,
    commitment_id: commitmentId,
    clerk_user_id: clerkUserId,
    day_key: dayKey,
    message_sid: messageSid,
    template_id: templateId,
    template_family: templateFamily,
    body_preview: typeof raw.body_preview === "string" ? raw.body_preview.slice(0, 160) : "",
    effective_ask_text:
      typeof raw.effective_ask_text === "string" ? raw.effective_ask_text.slice(0, 240) : "",
    prompt_kind: promptKind,
    expected_reply_semantics: expectedReplySemantics,
    check_payload_json: payload,
    source_wrapped_at: sourceWrappedAt,
  };
}

function inferFallbackFromSmsSendEvent(raw: Record<string, unknown>): V2CheckSentFallbackCandidate | null {
  const status = typeof raw.status === "string" ? raw.status.trim() : "";
  const dayKey = typeof raw.day_key === "string" ? raw.day_key.trim() : "";
  const messageSid = typeof raw.message_sid === "string" ? raw.message_sid.trim() : "";
  const clerkUserId = typeof raw.clerk_user_id === "string" ? raw.clerk_user_id.trim() : "";
  const metadata = asRecord(raw.metadata);
  const v2Accountability = metadata?.v2_accountability === true;
  const reactivation = metadata?.v2_reactivation_nudge === true;
  const templateId =
    typeof metadata?.v2_template_id === "number" && Number.isFinite(metadata.v2_template_id)
      ? Math.floor(metadata.v2_template_id)
      : NaN;
  const commitmentId =
    typeof metadata?.v2_commitment_id === "string" ? metadata.v2_commitment_id.trim() : "";
  const templateFamily =
    metadata?.v2_template_family === "recovery" ? "recovery" : "standard";

  if (
    status !== "sent" ||
    !v2Accountability ||
    reactivation ||
    !dayKey ||
    !messageSid ||
    !clerkUserId ||
    !commitmentId ||
    !Number.isFinite(templateId) ||
    templateId <= 0
  ) {
    return null;
  }

  const promptKind =
    metadata?.v2_contract_proposal_mode === true
      ? "contract_overlay_proposal"
      : "standard_accountability";
  const expectedReplySemantics =
    promptKind === "contract_overlay_proposal" ? "proposal_yes_no" : "yes_no_partial";

  return {
    commitmentId,
    clerkUserId,
    dayKey,
    messageSid,
    templateId,
    templateFamily,
    bodyPreview:
      typeof raw.sms_body === "string" ? raw.sms_body.slice(0, 160) : "",
    effectiveAskText:
      typeof raw.sms_body === "string" ? raw.sms_body.slice(0, 240) : "",
    promptKind,
    expectedReplySemantics,
    payloadJson: {},
    idempotencyKey: checkSentIdempotencyKey(commitmentId, dayKey),
    source: "heuristic_sms_send_events",
  };
}

async function hasCheckSentByIdempotencyKey(idempotencyKey: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from("v2_commitment_event")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .eq("event_type", "check_sent")
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function reconcileCheckSentPostSendBookkeepingForCommitment(args: {
  commitmentId: string;
  clerkUserId: string;
  maxCandidates?: number;
}): Promise<{
  attempted: number;
  recovered: number;
  failures: number;
  snapshotCandidatesFound: number;
  snapshotReplayAttempted: number;
  snapshotReplayApplied: number;
  heuristicFallbackAttempted: number;
  heuristicFallbackApplied: number;
  unresolvedAfterBoth: number;
}> {
  const limit = Math.max(1, Math.min(10, args.maxCandidates ?? 5));
  const snapshotReadLimit = Math.max(limit * 2, 10);
  const { data: snapshotRows } = await supabaseServer
    .from("v2_check_sent_outbound_intent_snapshot")
    .select(
      "idempotency_key,commitment_id,clerk_user_id,day_key,message_sid,template_id,template_family,body_preview,effective_ask_text,prompt_kind,expected_reply_semantics,check_payload_json,source_wrapped_at"
    )
    .eq("commitment_id", args.commitmentId)
    .order("source_wrapped_at", { ascending: false })
    .limit(snapshotReadLimit);

  const snapshotByKey = new Map<string, V2CheckSentSnapshotRow>();
  for (const raw of (snapshotRows ?? []) as Record<string, unknown>[]) {
    const parsed = parseSnapshotRow(raw);
    if (!parsed || parsed.commitment_id !== args.commitmentId) continue;
    if (!snapshotByKey.has(parsed.idempotency_key)) snapshotByKey.set(parsed.idempotency_key, parsed);
  }

  const { data: recentSendRows } = await supabaseServer
    .from("sms_send_events")
    .select("clerk_user_id,day_key,status,message_sid,sms_body,metadata,created_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 4, 20));

  let attempted = 0;
  let recovered = 0;
  let failures = 0;
  let snapshotReplayAttempted = 0;
  let snapshotReplayApplied = 0;
  let heuristicFallbackAttempted = 0;
  let heuristicFallbackApplied = 0;
  const snapshotCandidatesFound = snapshotByKey.size;
  const seen = new Set<string>();

  for (const snapshot of snapshotByKey.values()) {
    if (attempted >= limit) break;
    if (snapshot.clerk_user_id !== args.clerkUserId) continue;
    if (seen.has(snapshot.idempotency_key)) continue;
    seen.add(snapshot.idempotency_key);

    const proposalParsed =
      snapshot.prompt_kind === "contract_overlay_proposal"
        ? parseContractOverlayProposalFromCheckPayload(snapshot.check_payload_json)
        : null;
    if (snapshot.prompt_kind === "contract_overlay_proposal") {
      if (!proposalParsed) {
        console.error("[v2-check-sent] reconcile: proposal snapshot missing contract_proposal payload", {
          commitment_id: snapshot.commitment_id,
          idempotency_key: snapshot.idempotency_key,
        });
        failures += 1;
        continue;
      }
      if (
        await hasProposalOutboundBundleComplete({
          commitmentId: snapshot.commitment_id,
          dayKey: snapshot.day_key,
          expectedProposalText: proposalParsed.proposalText,
        })
      ) {
        continue;
      }
    } else if (await hasCheckSentByIdempotencyKey(snapshot.idempotency_key)) {
      continue;
    }

    attempted += 1;
    snapshotReplayAttempted += 1;

    const replay = await applyCheckSentPostSendBookkeepingMutation({
      commitmentId: snapshot.commitment_id,
      clerkUserId: snapshot.clerk_user_id,
      dayKey: snapshot.day_key,
      messageSid: snapshot.message_sid,
      templateId: snapshot.template_id,
      templateFamily: snapshot.template_family,
      bodyPreview: snapshot.body_preview,
      effectiveAskText: snapshot.effective_ask_text,
      promptKind: snapshot.prompt_kind,
      expectedReplySemantics: snapshot.expected_reply_semantics,
      checkPayloadJson: snapshot.check_payload_json,
      includeContractOverlayProposal: snapshot.prompt_kind === "contract_overlay_proposal",
      proposalText: proposalParsed?.proposalText ?? null,
      contractKind: proposalParsed?.contractKind ?? null,
    });
    if (replay.ok) {
      recovered += 1;
      snapshotReplayApplied += 1;
    } else {
      failures += 1;
      console.error("[v2-check-sent] reconcile replay failed", {
        commitment_id: snapshot.commitment_id,
        clerk_user_id: snapshot.clerk_user_id,
        idempotency_key: snapshot.idempotency_key,
        source: "snapshot",
        error: replay.error,
        result: replay.result ?? "unknown",
      });
    }
  }

  if (attempted < limit) {
    for (const raw of (recentSendRows ?? []) as Record<string, unknown>[]) {
      if (attempted >= limit) break;
      const fallback = inferFallbackFromSmsSendEvent(raw);
      if (!fallback || fallback.commitmentId !== args.commitmentId) continue;
      if (seen.has(fallback.idempotencyKey)) continue;
      seen.add(fallback.idempotencyKey);

      if (await hasCheckSentByIdempotencyKey(fallback.idempotencyKey)) continue;
      attempted += 1;
      heuristicFallbackAttempted += 1;

      const replay = await applyCheckSentPostSendBookkeepingMutation({
        commitmentId: fallback.commitmentId,
        clerkUserId: fallback.clerkUserId,
        dayKey: fallback.dayKey,
        messageSid: fallback.messageSid,
        templateId: fallback.templateId,
        templateFamily: fallback.templateFamily,
        bodyPreview: fallback.bodyPreview,
        effectiveAskText: fallback.effectiveAskText,
        promptKind: fallback.promptKind,
        expectedReplySemantics: fallback.expectedReplySemantics,
        checkPayloadJson: fallback.payloadJson,
      });
      if (replay.ok) {
        recovered += 1;
        heuristicFallbackApplied += 1;
      } else {
        failures += 1;
        console.error("[v2-check-sent] reconcile replay failed", {
          commitment_id: fallback.commitmentId,
          clerk_user_id: fallback.clerkUserId,
          idempotency_key: fallback.idempotencyKey,
          source: fallback.source,
          error: replay.error,
          result: replay.result ?? "unknown",
        });
      }
    }
  }

  const unresolvedAfterBoth = failures;
  if (failures > 0) {
    console.warn("[v2-check-sent] reconcile summary", {
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      attempted,
      recovered,
      failures,
      snapshot_candidates_found: snapshotCandidatesFound,
      snapshot_replay_attempted: snapshotReplayAttempted,
      snapshot_replay_applied: snapshotReplayApplied,
      heuristic_fallback_attempted: heuristicFallbackAttempted,
      heuristic_fallback_applied: heuristicFallbackApplied,
      unresolved_after_both: unresolvedAfterBoth,
    });
  }
  console.log("[v2-check-sent] reconcile mode usage", {
    commitment_id: args.commitmentId,
    clerk_user_id: args.clerkUserId,
    attempted,
    recovered,
    failures,
    snapshot_candidates_found: snapshotCandidatesFound,
    snapshot_replay_attempted: snapshotReplayAttempted,
    snapshot_replay_applied: snapshotReplayApplied,
    heuristic_fallback_attempted: heuristicFallbackAttempted,
    heuristic_fallback_applied: heuristicFallbackApplied,
    unresolved_after_both: unresolvedAfterBoth,
  });

  return {
    attempted,
    recovered,
    failures,
    snapshotCandidatesFound,
    snapshotReplayAttempted,
    snapshotReplayApplied,
    heuristicFallbackAttempted,
    heuristicFallbackApplied,
    unresolvedAfterBoth,
  };
}
