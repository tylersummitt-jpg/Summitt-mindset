/**
 * Shadow observability context — deterministic facts assembly only (no routing/state).
 */

import type {
  MeaningInterpreterDeterministicFacts,
  MeaningInterpreterShadowSkipReason,
} from "@/lib/sms-meaning-interpreter-shadow";

export type MeaningInterpreterShadowFinalizeInput = {
  clerkUserId: string;
  inboundMessageSid: string;
  coachJobMessageSid?: string | null;
  commitmentId?: string | null;
  rawBody: string;
  replyBody?: string | null;
  outcomeSent: boolean;
  jobStatus?: string | null;
  lastError?: string | null;
  deterministicRoute: string;
  deterministicFacts: MeaningInterpreterDeterministicFacts;
  skipReason?: MeaningInterpreterShadowSkipReason;
};

const pendingByMessageSid = new Map<string, MeaningInterpreterShadowFinalizeInput>();

export function parseMeaningInterpreterLastErrorTag(
  lastError: string | null | undefined
): string | null {
  const raw = (lastError ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tag?: unknown };
    if (typeof parsed.tag === "string" && parsed.tag.trim()) {
      return parsed.tag.trim().slice(0, 120);
    }
  } catch {
    /* plain string last_error */
  }
  return raw.slice(0, 120);
}

export function mergeMeaningInterpreterDeterministicFacts(
  base: MeaningInterpreterDeterministicFacts,
  patch: Partial<MeaningInterpreterDeterministicFacts>
): MeaningInterpreterDeterministicFacts {
  const merged: MeaningInterpreterDeterministicFacts = { ...base };
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof MeaningInterpreterDeterministicFacts, unknown]
  >) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function registerMeaningInterpreterShadowPending(
  input: MeaningInterpreterShadowFinalizeInput
): void {
  const existing = pendingByMessageSid.get(input.inboundMessageSid);
  if (!existing) {
    pendingByMessageSid.set(input.inboundMessageSid, input);
    return;
  }
  pendingByMessageSid.set(input.inboundMessageSid, {
    ...existing,
    ...input,
    deterministicFacts: mergeMeaningInterpreterDeterministicFacts(
      existing.deterministicFacts,
      input.deterministicFacts
    ),
  });
}

export function enrichMeaningInterpreterShadowPending(
  inboundMessageSid: string,
  patch: Partial<Omit<MeaningInterpreterShadowFinalizeInput, "deterministicFacts">> & {
    deterministicFacts?: Partial<MeaningInterpreterDeterministicFacts>;
  }
): void {
  const existing = pendingByMessageSid.get(inboundMessageSid);
  if (!existing) return;
  pendingByMessageSid.set(inboundMessageSid, {
    ...existing,
    ...patch,
    deterministicFacts: patch.deterministicFacts
      ? mergeMeaningInterpreterDeterministicFacts(existing.deterministicFacts, patch.deterministicFacts)
      : existing.deterministicFacts,
  });
}

export function peekMeaningInterpreterShadowPending(
  inboundMessageSid: string
): MeaningInterpreterShadowFinalizeInput | null {
  return pendingByMessageSid.get(inboundMessageSid) ?? null;
}

export function takeMeaningInterpreterShadowPending(
  inboundMessageSid: string
): MeaningInterpreterShadowFinalizeInput | null {
  const value = pendingByMessageSid.get(inboundMessageSid) ?? null;
  if (value) pendingByMessageSid.delete(inboundMessageSid);
  return value;
}

export function clearMeaningInterpreterShadowPending(inboundMessageSid: string): void {
  pendingByMessageSid.delete(inboundMessageSid);
}

export function buildMeaningInterpreterShadowFinalizeFromSchedule(args: {
  clerkUserId: string;
  inboundMessageSid: string;
  coachJobMessageSid?: string | null;
  commitmentId?: string | null;
  rawBody: string;
  replyBody?: string | null;
  outcomeSent: boolean;
  jobStatus?: string | null;
  lastError?: string | null;
  deterministicRoute: string;
  deterministicFacts: MeaningInterpreterDeterministicFacts;
  skipReason?: MeaningInterpreterShadowSkipReason;
}): MeaningInterpreterShadowFinalizeInput {
  const lastErrorTag = parseMeaningInterpreterLastErrorTag(args.lastError);
  return {
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    coachJobMessageSid: args.coachJobMessageSid ?? args.inboundMessageSid,
    commitmentId: args.commitmentId ?? null,
    rawBody: args.rawBody,
    replyBody: args.replyBody ?? null,
    outcomeSent: args.outcomeSent,
    jobStatus: args.jobStatus ?? null,
    lastError: args.lastError ?? null,
    deterministicRoute: args.deterministicRoute,
    skipReason: args.skipReason,
    deterministicFacts: mergeMeaningInterpreterDeterministicFacts(args.deterministicFacts, {
      job_status: args.jobStatus ?? null,
      last_error_tag: lastErrorTag,
      inbound_preview: args.rawBody.trim().replace(/\s+/g, " ").slice(0, 120) || null,
    }),
  };
}
