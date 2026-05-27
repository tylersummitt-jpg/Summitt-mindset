/**
 * Daily relationship contract/proposal semantic path: canonical proposal facts + light validator/safety rails.
 */

/** Stored on outbound snapshots / contract_proposal for inbound consent routing. */
export const DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION = "v1_semantic_daily" as const;

export type DailySemanticContractProposalFactsPacket = {
  proposal_kind: "recommit_same" | "shrink_ask";
  duration_days: 7;
  base_behavior_statement: string;
  /** Canonical shrink overlay ask persisted on YES; omitted / null for pure recommit_same (server applies active goal). */
  proposed_overlay_ask: string | null;
  proposed_behavior_preview: string;
  desired_response_semantics: "natural_confirmation_or_decline_or_adjustment";
  must_not_claim_goal_updated: boolean;
  forbidden_phrases: readonly string[];
};

/** Lowercase alphanumeric runs for substring checks (preserve word-ish boundaries loosely). */
function normalizeForOverlap(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
}

const FORBIDDEN_PROPOSAL_LEX = [
  "reply yes",
  "text yes",
  "yes to confirm",
  "keep this line",
  "same commitment",
  "this is the standard",
  "goal updated",
  "changed your goal",
  "new goal is set",
] as const;

function bodyHasForbiddenPhrase(bodyLc: string): string | undefined {
  for (const f of FORBIDDEN_PROPOSAL_LEX) {
    if (bodyLc.includes(f)) return f;
  }
  return undefined;
}

function tokenSetsForFacts(args: {
  preview: string;
  canonicalOverlayAsk?: string | null;
  baseBehaviorStatement: string;
}): Set<string>[] {
  return [
    new Set(normalizeForOverlap(args.preview)),
    new Set(normalizeForOverlap(args.canonicalOverlayAsk?.trim() ?? "")),
    new Set(normalizeForOverlap(args.baseBehaviorStatement.trim())),
  ];
}

/**
 * True if sms references the proposed bar (normalized token overlap >= 3 with preview, canonical ask, or base behavior).
 */
function mentionsProposedBar(smsLc: string, sets: Set<string>[]): boolean {
  const smsTokens = new Set(normalizeForOverlap(smsLc));
  if (smsTokens.size === 0) return false;
  let overlap = 0;
  for (const t of smsTokens) {
    for (const set of sets) {
      if (set.size === 0) continue;
      if (set.has(t)) {
        overlap += 1;
        if (overlap >= 3) return true;
        break;
      }
    }
  }
  return false;
}

/** Asks continuation / adjustment / confirmation in natural language (not robotic menu COPY). */
function asksForContinuationOrAdjustment(smsLc: string): boolean {
  if (/\?\s*$/.test(smsLc.trim())) return true;
  const cues = [
    "keep ",
    "continue",
    "stick with",
    "hold you",
    "hold me",
    "adjust",
    "tweak",
    "shift",
    "change",
    "different",
    "still want",
    "want to ",
    "work for you",
    "make sense",
    "sound right",
    "okay with",
    "good with",
    "go with",
  ];
  return cues.some((c) => smsLc.includes(c));
}

/** Default forbidden-phrases bullet list for prompting (deterministic validator uses FORBIDDEN_PROPOSAL_LEX above). */
export const DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES: readonly string[] = [
  "Reply YES",
  "Text YES",
  "YES to confirm",
  "keep this line",
  "same commitment",
  "this is the standard",
] as const;

/**
 * Lightweight deterministic checks after robot/menu passes.
 * Keeps varied relationship voice — only blocks forbidden lex + missing bar signal + absent ask signal.
 */
export function validateSemanticDailyContractProposalSms(args: {
  smsBody: string;
  preview: string;
  canonicalOverlayAsk?: string | null;
  baseBehaviorStatement: string;
}): { ok: true } | { ok: false; reason_code: string; reason_detail?: string } {
  const body = args.smsBody.trim();
  if (!body) return { ok: false, reason_code: "empty_body" };
  const bodyLc = body.toLowerCase();

  const forbiddenHit = bodyHasForbiddenPhrase(bodyLc);
  if (forbiddenHit) {
    return { ok: false, reason_code: "forbidden_lexeme", reason_detail: forbiddenHit };
  }

  const tokenSets = tokenSetsForFacts({
    preview: args.preview,
    canonicalOverlayAsk: args.canonicalOverlayAsk,
    baseBehaviorStatement: args.baseBehaviorStatement,
  });

  const hasBarSignal = mentionsProposedBar(bodyLc, tokenSets);

  let baseBehaviorSubstringSignal = false;
  const baseLc = args.baseBehaviorStatement.trim().toLowerCase();
  for (const t of normalizeForOverlap(args.preview)) {
    if (t.length >= 4 && bodyLc.includes(t)) {
      baseBehaviorSubstringSignal = true;
      break;
    }
  }
  const baseDistinct =
    baseLc.length >= 8 && bodyLc.includes(baseLc.slice(0, Math.min(24, baseLc.length)));

  const barOk = hasBarSignal || baseBehaviorSubstringSignal || baseDistinct;
  if (!barOk) {
    return { ok: false, reason_code: "missing_proposed_behavior_signal" };
  }

  const askOk = asksForContinuationOrAdjustment(bodyLc);
  if (!askOk) {
    return { ok: false, reason_code: "missing_confirmation_or_adjustment_ask" };
  }

  return { ok: true };
}

export type SemanticDailyOutboundSnapshotCandidate = {
  message_sid: string;
  prompt_kind: string;
  expected_reply_semantics: string;
  source_wrapped_at: string;
  check_payload_json: Record<string, unknown>;
};

/** Pure matcher for tests + inbound routing — no Supabase IO. */
export function matchSemanticDailyContractProposalSnapshots(args: {
  snapshots: ReadonlyArray<SemanticDailyOutboundSnapshotCandidate>;
  lastTwilioMessageSid: string | null | undefined;
  canonicalProposalText: string;
  nowMs: number;
  snapshotTtlMs: number;
}): boolean {
  const sid =
    typeof args.lastTwilioMessageSid === "string" ? args.lastTwilioMessageSid.trim() : "";
  const canon = args.canonicalProposalText.trim();
  if (!sid || !canon) return false;

  return args.snapshots.some((r) => {
    const msid = typeof r.message_sid === "string" ? r.message_sid.trim() : "";
    if (msid !== sid) return false;
    const pk = typeof r.prompt_kind === "string" ? r.prompt_kind.trim() : "";
    if (pk !== "contract_overlay_proposal") return false;
    const sem =
      typeof r.expected_reply_semantics === "string"
        ? r.expected_reply_semantics.trim().toLowerCase()
        : "";
    if (sem !== "proposal_yes_no") return false;

    const ts = Date.parse(r.source_wrapped_at);
    if (!Number.isFinite(ts) || args.nowMs - ts > args.snapshotTtlMs) return false;

    const payload = r.check_payload_json ?? {};
    const cpRaw = payload.contract_proposal;
    if (cpRaw == null || typeof cpRaw !== "object" || Array.isArray(cpRaw)) return false;
    const cp = cpRaw as Record<string, unknown>;

    const version =
      typeof cp.proposal_semantic_version === "string" ? cp.proposal_semantic_version.trim() : "";
    if (version !== DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION) return false;

    const proposalText =
      typeof cp.proposal_text === "string" ? cp.proposal_text.trim() : "";
    return proposalText === canon;
  });
}
