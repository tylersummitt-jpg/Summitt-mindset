/**
 * Detects generic future-window recommitment question family (writer guidance + product-law).
 * Not a new routing layer — shared detector for Strategy Card, Snapshot, and final guard.
 */

export const GENERIC_FUTURE_RECOMMITMENT_DNR_ASK =
  "generic future recommitment question already asked recently";

export const GENERIC_FUTURE_RECOMMITMENT_DNR_FAMILY_KEY =
  "commitment_future_recommitment_question";

export const GENERIC_FUTURE_RECOMMITMENT_QUESTION_NO_SEND =
  "generic_future_recommitment_question_blocked" as const;

/** Writer-facing must_not_do — daily main accountability. */
export const DAILY_MAIN_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO =
  "Do not ask a generic stay-committed / recommit-for-next-week-or-7-days question; keep the ask about today, the current next step, or the current accountability check.";

/** Writer-facing must_not_do — low-pressure reactivation. */
export const DAILY_REACTIVATION_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO =
  "Do not use guilt or generic recommitment questions; do not ask whether the user is ready to stay committed for the next week — use a low-pressure specific re-entry step instead.";

/** Writer-facing must_not_do — weekly proof surfaces. */
export const WEEKLY_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO =
  "Do not ask a generic stay-committed / recommit-for-next-week question; orient toward next week with a specific coach-led direction or reflection instead.";

/** Writer-facing must_not_do — contract / recommit proposal. */
export const CONTRACT_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO =
  "Do not use generic stay-committed-to-your-goal-for-next-week wording; present the specific server-authorized proposal or bar meaning, not abstract commitment renewal.";

/** Writer-facing must_not_do — refresh commitment fit-check. */
export const REFRESH_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO =
  "Do not ask a generic recommitment-for-next-week question; ask only the required fit-check tied to the server-owned effective ask and do not repeat a recent visible fit-check.";

/** Writer-facing must_not_do — inbound coaching turns. */
export const INBOUND_ANTI_GENERIC_RECOMMIT_MUST_NOT_DO =
  "Do not introduce generic future recommitment or abstract renewal questions; answer the user's current message first unless contract/refresh requires a server-owned decision.";

/** Writer-facing — abstract commitment-renewal cousin family (no future window required). */
export const ABSTRACT_COMMITMENT_RENEWAL_MUST_NOT_DO =
  "Do not ask an abstract commitment-renewal question (still committed, still want this goal, want to recommit, still in); use a specific next step, recovery question, or server-owned proposal instead.";

/** Writer-facing — generic plan/goal re-approval without naming the bar or candidate. */
export const ABSTRACT_PLAN_RENEWAL_MUST_NOT_DO =
  "Do not ask the user to re-approve the goal or keep the same plan in generic terms; coach the concrete bar, step, or server-owned candidate.";

/** Writer-facing — weekly yes/no reset / abstract renewal polls. */
export const WEEKLY_NO_YES_NO_RESET_MUST_NOT_DO =
  "Do not ask a yes/no ready-for-next-week reset or abstract stay-committed/recommit question; use coach-led next-week direction or reflection instead.";

/** Writer-facing — daily main today/current-step focus (includes future-window generic recommit). */
export const DAILY_TODAY_NOT_RENEWAL_MUST_NOT_DO =
  "Do not ask abstract renewal or generic stay-committed/recommit-for-next-week questions; coach today's current step or accountability check.";

/** Writer-facing — low-pressure reactivation specific re-entry. */
export const REACTIVATION_SPECIFIC_STEP_NOT_RENEWAL_MUST_NOT_DO =
  "Do not poll still-in, guilt, or abstract recommitment; use one low-pressure specific re-entry step.";

/** Writer-facing — contract proposal must name server bar, not abstract renewal. */
export const CONTRACT_BAR_SPECIFIC_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO =
  "Do not ask abstract still-committed or goal-renewal; present only the specific server-authorized shrink/recommit bar from semantic facts.";

/** Writer-facing — refresh commitment route-required fit-check only. */
export const REFRESH_FIT_CHECK_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO =
  "Do not ask abstract commitment renewal; ask only the route-required fit-check tied to the effective ask/verbatim.";

/** Writer-facing — pending resolution candidate-specific only. */
export const PENDING_CANDIDATE_NOT_ABSTRACT_RENEWAL_MUST_NOT_DO =
  "Do not ask abstract goal renewal; ask only about the actual pending candidate/loop from server facts.";

export type GenericFutureRecommitmentDetectOptions = {
  /** Route-specific effective ask / bar substring — exempts specific fit-check or proposal copy. */
  specificBarSubstrings?: string[];
};

function normalizeForDetect(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasQuestionShape(text: string, lower: string): boolean {
  if (/\?/.test(text)) return true;
  return /\b(are you ready|do you want|are you willing|can you commit|will you stay|want to keep|how does .+ feel|does .+ sound good)\b/i.test(
    lower
  );
}

function hasCommitIntent(lower: string): boolean {
  return (
    /\b(stay committed|staying committed|recommit|commit to|keep going with|stick with|continue with|stay with)\b/i.test(
      lower
    ) ||
    /\b(keep (this|the same) (goal|bar|line|focus)|still in for)\b/i.test(lower) ||
    /\b(ready to (stay|commit)|want to stay|willing to stay)\b/i.test(lower)
  );
}

function hasFutureWindow(lower: string): boolean {
  return (
    /\b(next week|this week|another week|for the week|7 days|seven days|next 7|for 7)\b/i.test(
      lower
    ) || /\b(this next stretch|the next few days)\b/i.test(lower)
  );
}

function hasGenericGoalObject(lower: string): boolean {
  return /\b(your goal|this goal|the goal|your commitment|this commitment|the commitment|the bar|current bar|current commitment|same bar|same line|same goal)\b/i.test(
    lower
  );
}

function hasQuestionForm(lower: string): boolean {
  return (
    /\b(are you ready|do you want|are you willing|can you commit|will you stay|want to keep)\b/i.test(
      lower
    ) ||
    /\bdoes .+ sound good\b/i.test(lower) ||
    /\bhow does .+ feel\b/i.test(lower)
  );
}

function isTodayOnlyRefreshFitCheck(lower: string): boolean {
  return (
    /\bstill fits?\b/i.test(lower) &&
    /\btoday\b/i.test(lower) &&
    !hasFutureWindow(lower) &&
    !/\brecommit\b/i.test(lower)
  );
}

function includesSpecificBarSubstring(body: string, substrings: string[]): boolean {
  for (const raw of substrings) {
    const s = raw.trim();
    if (s.length < 12) continue;
    if (body.includes(s)) return true;
    const snippet = s.slice(0, Math.min(48, s.length));
    if (snippet.length >= 12 && body.toLowerCase().includes(snippet.toLowerCase())) return true;
  }
  return false;
}

/**
 * True when SMS text matches the generic future-window recommitment question family.
 */
export function isGenericFutureRecommitmentQuestionFamily(
  text: string,
  opts?: GenericFutureRecommitmentDetectOptions
): boolean {
  const t = text.trim();
  if (!t || t.length < 16) return false;

  if (opts?.specificBarSubstrings?.length && includesSpecificBarSubstring(t, opts.specificBarSubstrings)) {
    return false;
  }

  const lower = normalizeForDetect(t);

  if (isTodayOnlyRefreshFitCheck(lower)) return false;

  if (!hasQuestionShape(t, lower)) return false;

  const commit = hasCommitIntent(lower);
  const future = hasFutureWindow(lower);
  const goal = hasGenericGoalObject(lower);
  const qForm = hasQuestionForm(lower);

  if (commit && future) return true;
  if (/\brecommit\b/i.test(lower) && (future || /\b7\b/.test(lower))) return true;
  if (/\bkeep the same bar\b/i.test(lower) && /\b(this week|next week)\b/i.test(lower)) return true;
  if (/\bwant to stay committed\b/i.test(lower)) return true;
  if (commit && qForm && goal) return true;
  if (qForm && commit && future) return true;
  if (/\bhow does\b/i.test(lower) && /\b(committing to|staying committed)\b/i.test(lower) && (future || goal)) {
    return true;
  }

  return false;
}

export type GenericFutureRecommitmentProductLawResult = {
  block: boolean;
  metadata: Record<string, unknown>;
};

export function collectGenericRecommitSpecificBarSubstrings(args: {
  dailyGuardCtx?: {
    canonicalProposalAskTrim?: string | null;
    baseBehaviorStatement?: string | null;
    refreshGuardFacts?: {
      effectiveAskForBar?: string | null;
      identityAnchorText?: string | null;
      requiredVerbatimSubstrings?: string[];
    } | null;
  } | null;
  factsJson?: Record<string, unknown> | null;
}): string[] {
  const out: string[] = [];
  const ctx = args.dailyGuardCtx;
  if (ctx?.canonicalProposalAskTrim?.trim()) out.push(ctx.canonicalProposalAskTrim.trim());
  if (ctx?.baseBehaviorStatement?.trim()) out.push(ctx.baseBehaviorStatement.trim());
  if (ctx?.refreshGuardFacts?.effectiveAskForBar?.trim()) {
    out.push(ctx.refreshGuardFacts.effectiveAskForBar.trim());
  }
  if (ctx?.refreshGuardFacts?.identityAnchorText?.trim()) {
    out.push(ctx.refreshGuardFacts.identityAnchorText.trim());
  }
  for (const s of ctx?.refreshGuardFacts?.requiredVerbatimSubstrings ?? []) {
    if (s.trim().length >= 12) out.push(s.trim());
  }

  const facts = args.factsJson;
  if (facts) {
    const topRv = facts.required_verbatim_substrings;
    if (Array.isArray(topRv)) {
      for (const s of topRv) {
        if (typeof s === "string" && s.trim().length >= 12) out.push(s.trim());
      }
    }
    const constraints = facts.constraints;
    if (constraints && typeof constraints === "object" && !Array.isArray(constraints)) {
      const cRv = (constraints as Record<string, unknown>).required_verbatim_substrings;
      if (Array.isArray(cRv)) {
        for (const s of cRv) {
          if (typeof s === "string" && s.trim().length >= 12) out.push(s.trim());
        }
      }
    }
  }

  return [...new Set(out)];
}

/**
 * Conservative product-law block for final guard paths.
 * Contract/refresh routes exempt when body includes route-specific bar substrings.
 */
export function evaluateGenericFutureRecommitmentProductLaw(args: {
  body: string;
  routePurpose?: string | null;
  specificBarSubstrings?: string[];
}): GenericFutureRecommitmentProductLawResult {
  const route = args.routePurpose?.trim() ?? "";
  const substrings = args.specificBarSubstrings ?? [];
  const detected = isGenericFutureRecommitmentQuestionFamily(args.body, {
    specificBarSubstrings: substrings,
  });

  const baseMeta: Record<string, unknown> = {
    generic_recommitment_question_family_detected: detected,
    generic_recommitment_question_family_source: route || "unknown",
  };

  if (!detected) {
    return { block: false, metadata: baseMeta };
  }

  const isContractOrRefresh =
    route === "contract_prompt" ||
    route === "guided_shrink_contract_prompt" ||
    route === "refresh_commitment" ||
    route === "recommit_same";

  if (isContractOrRefresh && substrings.length > 0 && includesSpecificBarSubstring(args.body, substrings)) {
    return {
      block: false,
      metadata: {
        ...baseMeta,
        generic_recommitment_question_family_suppressed: "route_specific_bar_exempt",
      },
    };
  }

  return {
    block: true,
    metadata: {
      ...baseMeta,
      generic_recommitment_question_family_suppressed: true,
    },
  };
}
