import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateScheduledDeliveryGrace } from "@/lib/daily-sms-scheduling";
import {
  buildMorningMessageFor,
  sundayContextChanged,
  sundayContextEvidenceFromCoaching,
  weekdayLongFromLocalDayKey,
  type MorningRelationshipPacket,
  type SundayCoachingContext,
  type SundayContextEvidence,
} from "@/lib/morning-tto-relationship-packet";
import {
  mondayThroughSundayEnding,
  selectAccountabilityEventsBeforeCap,
  weeklyAccountabilityWeekUtcRange,
} from "@/lib/weekly-tto-accountability-events";
import { resolveProactiveSchedule, scheduledDeliveryTupleIsCoherent, type ScheduledProactiveText } from "@/lib/sms-proactive-schedule";
import {
  MORNING_TTO_THREAD_MAX_MESSAGES,
  MORNING_TTO_THREAD_MAX_TOTAL_CHARS,
  MORNING_TTO_THREAD_WINDOW_DAYS,
} from "@/lib/sms-recent-exact-thread-72h";
import { classifySmsAudienceSendability, formatReconsiderationRecord } from "@/lib/tyler-text-overview-admin";
import { SMS_DAILY_PRODUCTION_SEND_SLOT } from "@/lib/tyler-text-overview-types";
import {
  bindFinishedConsiderationEvidence,
  buildTtoInputEvidence,
  retrievalFailureEvidence,
  currentBodyEditContextRequiresReconsideration,
  editContextBelongsToBodyVersion,
  evidenceApprovesCurrentBody,
  evidenceDeliveryFromSchedule,
  failureAppliesToCurrentBody,
  latestAffirmedDeliveryFromMetadata,
  originalModelDeliveryFromMetadata,
  reconsiderationAppliesKeep,
  reconsiderationRetentionEvidence,
  tylerEditDeliveryMateriallyDiffers,
  scheduledDeliveryForGeneration,
  recordedInstantsMatch,
  successfulConsiderationEvidence,
  unobservedDiscoverySourceIds,
  type TtoBodyVersion,
  type TtoEditDeliveryContext,
  type TtoInputEvidence,
} from "@/lib/tyler-text-overview-generate";
import {
  authoritativeSchedulingTimezone,
  crossOwnerActionForCandidate,
  existingGraceDeliveryShouldContinue,
  releaseActualWorkSlot,
  reserveActualWorkSlot,
  scheduledDailyBodyAuthorization,
  scheduledDeliveryRemainsActionable,
  shouldTransferCrossOwnerSource,
} from "@/lib/tto-scheduled-generate";
import { dayKeyOffset } from "@/lib/sms-temporal-contract-v1";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { isPendingResolutionExpired } from "@/lib/v2-guided-resolution";
import {
  buildScheduledGenerationMetadata,
  eveningPreviewIsReady,
  decideScheduledPreviewWork,
  exactPreviewCanOpenBatch,
  executeScheduledBatch,
  initialPassIsComplete,
  interpretBatchProgress,
  isUncertainPersistence,
  legacyCadenceDecisionFromCommitment,
  legacyCadenceEligibilityForDate,
  memberLocalDatesForBatch,
  planMemberSchedule,
  authoritativeTimezoneChanged,
  discoverMemberMessages,
  earlierDeliveryBlocksCandidate,
  effectiveCoachingAskForDiscovery,
  MEMBER_CONVERSATION_READ_LIMIT,
  occurrenceRevalidationDisposition,
  orderReconsiderationWork,
  conversationHasUnconsideredMessage,
  reconsiderationInputsChanged,
  reconsiderationScheduleOnly,
  reconsiderationReadiness,
  replacementOccurrenceState,
  resolveScheduledGenerationWindow,
  runAutomaticScheduledGeneration,
  scheduledBatchWindowEndsAt,
  scheduledMemberEligibility,
  chooseAuthoritativeReconsiderationCandidate,
  conversationsFromDiscoveryPayload,
  dashboardOutcomeFromCurrentDraft,
  dashboardRepairState,
  listUpcomingOccurrenceCandidates,
  reconsiderationOutcomePatchAllowed,
  selectNextReconsiderationCandidates,
  selectPreviewOccurrence,
  selectRecoverableOccurrences,
  type ScheduledBatchRecord,
  type ScheduledOccurrence,
} from "@/lib/tto-scheduled-generate";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261125150000_sms_tto_scheduled_generation.sql"),
  "utf8"
);

function occurrence(overrides: Partial<ScheduledOccurrence> = {}): ScheduledOccurrence {
  return {
    clerkUserId: "user_a",
    memberLocalDate: "2026-01-15",
    utcInstant: "2026-01-15T12:00:00.000Z",
    selectedLocalMinute: 420,
    effectiveLocalMinute: 420,
    timeZone: "America/New_York",
    state: "pending",
    initialSet: true,
    claimOwnerId: null,
    claimExpiresAt: null,
    detail: null,
    ...overrides,
  };
}

function emptyBatch(occurrences: ScheduledOccurrence[]): ScheduledBatchRecord {
  return {
    id: "batch-1",
    batchDate: "2026-01-15",
    sendSlot: "morning",
    openedTrigger: "automatic_schedule",
    windowEndsAt: "2026-01-15T02:00:00.000Z",
    startedAt: "2026-01-14T21:00:00.000Z",
    initialCompletedAt: null,
    initialCompletedTrigger: null,
    relevantMemberCount: 2,
    scheduledMemberCount: new Set(occurrences.map((item) => item.clerkUserId)).size,
    scheduledOccurrenceCount: occurrences.filter((item) => item.initialSet).length,
    occurrences,
    nonScheduled: [],
  };
}

describe("Eastern generation windows", () => {
  it("lets the production cron call the scheduler without an injected clock", async () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cron/tto-scheduled-generate/route.ts"),
      "utf8"
    );
    expect(route).toContain("await runAutomaticScheduledGeneration()");
    expect(runAutomaticScheduledGeneration.length).toBe(0);
    const outcome = await Promise.race([
      runAutomaticScheduledGeneration()
        .then((value) => ({ kind: "result" as const, value }))
        .catch((error: unknown) => ({ kind: "error" as const, error })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), 1500);
      }),
    ]);
    if (outcome.kind === "error") {
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      expect(message).not.toMatch(/reading 'now'|args is not defined/);
    } else if (outcome.kind === "result") {
      expect(outcome.value.status).toBeGreaterThan(0);
    }
  });

  it("opens Evening at 5:00 AM and Morning at 4:00 PM in standard time", () => {
    expect(resolveScheduledGenerationWindow(new Date("2026-01-14T10:00:00.000Z"))).toEqual({
      active: true,
      owner: "evening",
      batchDate: "2026-01-14",
    });
    expect(resolveScheduledGenerationWindow(new Date("2026-01-14T14:59:00.000Z"))).toEqual({
      active: true,
      owner: "evening",
      batchDate: "2026-01-14",
    });
    expect(resolveScheduledGenerationWindow(new Date("2026-01-14T21:00:00.000Z"))).toEqual({
      active: true,
      owner: "morning",
      batchDate: "2026-01-15",
    });
    expect(resolveScheduledGenerationWindow(new Date("2026-01-15T01:59:00.000Z"))).toEqual({
      active: true,
      owner: "morning",
      batchDate: "2026-01-15",
    });
  });

  it("opens the same wall-clock hours in daylight time", () => {
    expect(resolveScheduledGenerationWindow(new Date("2026-07-15T09:00:00.000Z"))).toEqual({
      active: true,
      owner: "evening",
      batchDate: "2026-07-15",
    });
    expect(resolveScheduledGenerationWindow(new Date("2026-07-15T20:00:00.000Z"))).toEqual({
      active: true,
      owner: "morning",
      batchDate: "2026-07-16",
    });
    expect(resolveScheduledGenerationWindow(new Date("2026-07-16T00:59:00.000Z"))).toEqual({
      active: true,
      owner: "morning",
      batchDate: "2026-07-16",
    });
  });

  it("does not generate outside the authorized windows", () => {
    for (const iso of [
      "2026-01-14T09:59:00.000Z",
      "2026-01-14T15:00:00.000Z",
      "2026-01-15T02:00:00.000Z",
      "2026-07-15T08:59:00.000Z",
      "2026-07-15T14:00:00.000Z",
      "2026-07-15T19:59:00.000Z",
      "2026-07-16T01:00:00.000Z",
    ]) {
      expect(resolveScheduledGenerationWindow(new Date(iso)).active).toBe(false);
    }
  });
});

describe("batch membership and draft identity", () => {
  it("keeps two member-local dates in one Thursday Morning batch", () => {
    const preferenceRead = { ok: true as const, row: null };
    const night = resolveProactiveSchedule({
      preferenceRead,
      clerkTimezone: "America/New_York",
      audienceTimezone: "America/New_York",
      memberLocalDate: "2026-01-14",
      proactiveDeliveryAllowed: true,
    });
    const morning = resolveProactiveSchedule({
      preferenceRead: {
        ok: true,
        row: {
          weekly_schedule: {
            monday: 420,
            tuesday: 420,
            wednesday: 23 * 60 + 45,
            thursday: 420,
            friday: 420,
            saturday: 420,
            sunday: 420,
          },
          schedule_timezone: "America/New_York",
          pause_indefinite: false,
          pause_until: null,
          cadence_override: null,
          weekend_send_policy: null,
        },
      },
      clerkTimezone: "America/New_York",
      audienceTimezone: "America/New_York",
      memberLocalDate: "2026-01-14",
      proactiveDeliveryAllowed: true,
    });
    const day = resolveProactiveSchedule({
      preferenceRead,
      clerkTimezone: "America/New_York",
      audienceTimezone: "America/New_York",
      memberLocalDate: "2026-01-15",
      proactiveDeliveryAllowed: true,
    });
    const planned = planMemberSchedule({
      clerkUserId: "user_east",
      results: [night, morning, day],
      owner: "morning",
      batchDate: "2026-01-15",
      now: new Date("2026-01-14T21:00:00.000Z"),
    });
    const dates = planned.occurrences.map((item) => item.memberLocalDate).sort();
    expect(dates).toEqual(["2026-01-14", "2026-01-15"]);
    expect(new Set(planned.occurrences.map((item) => item.utcInstant)).size).toBe(2);
    expect(planned.nonScheduled).toBeNull();
  });

  it("does not schedule a failed preference read or an expired instant", () => {
    const unresolved = planMemberSchedule({
      clerkUserId: "user_bad_read",
      results: [
        { kind: "unresolved", reason: "preference_read_failed", memberLocalDate: "2026-01-15" },
      ],
      owner: "morning",
      batchDate: "2026-01-15",
      now: new Date("2026-01-14T21:00:00.000Z"),
    });
    expect(unresolved.occurrences).toEqual([]);
    expect(unresolved.nonScheduled).toEqual({
      clerkUserId: "user_bad_read",
      classification: "unresolved",
      reason: "preference_read_failed",
    });

    const expired = planMemberSchedule({
      clerkUserId: "user_late",
      results: [
        resolveProactiveSchedule({
          preferenceRead: { ok: true, row: null },
          clerkTimezone: "America/New_York",
          audienceTimezone: "America/New_York",
          memberLocalDate: "2026-01-15",
          proactiveDeliveryAllowed: true,
        }),
      ],
      owner: "morning",
      batchDate: "2026-01-15",
      now: new Date("2026-01-16T15:00:00.000Z"),
    });
    expect(expired.occurrences[0]?.state).toBe("expired");
    expect(
      selectRecoverableOccurrences({
        occurrences: expired.occurrences,
        now: new Date("2026-01-16T15:00:00.000Z"),
        limit: 8,
      })
    ).toEqual([]);
  });

  it("keeps an enabled Sunday occurrence and stores schedule facts without removing them", () => {
    const sunday = resolveProactiveSchedule({
      preferenceRead: { ok: true, row: null },
      clerkTimezone: "America/New_York",
      audienceTimezone: "America/New_York",
      memberLocalDate: "2026-01-18",
      proactiveDeliveryAllowed: true,
    });
    expect(sunday.kind).toBe("scheduled");
    if (sunday.kind !== "scheduled") return;
    const planned = planMemberSchedule({
      clerkUserId: "user_sunday",
      results: [sunday],
      owner: sunday.owner,
      batchDate: sunday.batchDate,
      now: new Date("2026-01-17T21:00:00.000Z"),
    });
    expect(planned.occurrences).toHaveLength(1);
    const metadata = buildScheduledGenerationMetadata({
      scheduled: sunday,
      trigger: "automatic_schedule",
    });
    expect(metadata.scheduled_generation_convention).toBe("member_local_delivery_v1");
    expect(metadata.member_local_date).toBe("2026-01-18");
    expect(metadata.administrative_batch_date).toBe(sunday.batchDate);
    expect(metadata.generation_trigger).toBe("automatic_schedule");
    expect(memberLocalDatesForBatch("2026-01-15")).toEqual([
      "2026-01-14",
      "2026-01-15",
      "2026-01-16",
    ]);
  });
});

describe("scheduled batch execution", () => {
  it("claims before generation, continues after a failure, and does not redo a success", async () => {
    const order: string[] = [];
    let batch: ScheduledBatchRecord | null = null;
    const occurrences = [
      occurrence({ clerkUserId: "user_fail", memberLocalDate: "2026-01-15" }),
      occurrence({ clerkUserId: "user_ok", memberLocalDate: "2026-01-15" }),
    ];
    const ran = await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 2,
      discovered: occurrences,
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => {
          order.push("open");
          expect(next.startedAt).toBe("");
          expect(next.openedTrigger).toBe("automatic_schedule");
          batch = { ...next, id: "batch-1", startedAt: "2026-01-14T21:00:01.000Z" };
          return batch;
        },
        patchBatch: async (patches, append) => {
          if (!batch) throw new Error("batch missing");
          const next = batch.occurrences.map((item) => {
            const patch = patches.find(
              (candidate) =>
                candidate.clerkUserId === item.clerkUserId &&
                candidate.memberLocalDate === item.memberLocalDate
            );
            if (!patch) return item;
            if (
              ["generated", "intentional_space", "protected", "failed", "sent", "legacy_conflict", "expired"].includes(
                item.state
              ) &&
              (patch.state === "pending" || patch.state === "claimed")
            ) {
              return item;
            }
            return { ...item, ...patch, initialSet: item.initialSet };
          });
          for (const item of append) {
            if (
              !next.some(
                (existing) =>
                  existing.clerkUserId === item.clerkUserId &&
                  existing.memberLocalDate === item.memberLocalDate
              )
            ) {
              next.push({ ...item, initialSet: false });
            }
          }
          batch = {
            ...batch,
            occurrences: next,
            initialCompletedAt:
              batch.initialCompletedAt ??
              (initialPassIsComplete(next) ? "2026-01-14T21:03:00.000Z" : null),
          };
          return batch;
        },
        claim: async (item) => {
          order.push(`claim:${item.clerkUserId}`);
          return { outcome: "claimed", generationId: "claim-1", reason: "new_claim" };
        },
        generate: async (item) => {
          order.push(`generate:${item.clerkUserId}`);
          if (item.clerkUserId === "user_fail") {
            return {
              outcome: "failed",
              body: null,
              generationId: "gen-fail",
              machineShouldSend: false,
              machineNoSendReason: "writer_failed",
              error: "writer_failed",
            };
          }
          return {
            outcome: "generated",
            body: "Morning text",
            generationId: "gen-ok",
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
          };
        },
      },
    });

    expect(order[0]).toBe("open");
    expect(order.indexOf("claim:user_fail")).toBeLessThan(order.indexOf("generate:user_fail"));
    expect(order.indexOf("claim:user_ok")).toBeLessThan(order.indexOf("generate:user_ok"));
    expect(ran.batch.startedAt).toBe("2026-01-14T21:00:01.000Z");
    expect(ran.batch.initialCompletedAt).toBe("2026-01-14T21:03:00.000Z");
    expect(ran.batch.initialCompletedAt).not.toBe(ran.batch.startedAt);
    expect(ran.batch.scheduledMemberCount).toBe(2);
    expect(ran.batch.scheduledOccurrenceCount).toBe(2);
    expect(ran.batch.occurrences.find((item) => item.clerkUserId === "user_ok")?.state).toBe(
      "generated"
    );

    const againOrder: string[] = [];
    await executeScheduledBatch({
      now: new Date("2026-01-14T21:05:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 2,
      discovered: occurrences,
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:05:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async () => {
          throw new Error("batch must not be reopened");
        },
        patchBatch: async () => batch!,
        claim: async () => {
          againOrder.push("claim");
          return { outcome: "claimed", generationId: null, reason: null };
        },
        generate: async () => {
          againOrder.push("generate");
          return {
            outcome: "generated",
            body: "again",
            generationId: null,
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
          };
        },
      },
    });
    expect(againOrder).toEqual([]);
  });

  it("does not call the generator for a busy claim, legacy key, sent draft, or Tyler-protected claim", async () => {
    const cases = ["busy", "legacy_conflict", "sent", "protected", "intentional_space"] as const;
    for (const outcome of cases) {
      const generated: string[] = [];
      let batch: ScheduledBatchRecord | null = emptyBatch([occurrence()]);
      await executeScheduledBatch({
        now: new Date("2026-01-14T21:00:00.000Z"),
        batchDate: "2026-01-15",
        owner: "morning",
        trigger: "manual_schedule",
        relevantMemberCount: 1,
        discovered: [],
        nonScheduled: [],
        nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
        deps: {
          readBatch: async () => batch,
          openBatch: async (next) => next,
          patchBatch: async (patches) => {
            batch = {
              ...batch!,
              occurrences: batch!.occurrences.map((item) => ({ ...item, ...patches[0] })),
            };
            return batch;
          },
          claim: async () => ({ outcome, generationId: "gen", reason: outcome }),
          generate: async () => {
            generated.push(outcome);
            return {
              outcome: "generated",
              body: "nope",
              generationId: null,
              machineShouldSend: true,
              machineNoSendReason: null,
              error: null,
            };
          },
        },
      });
      expect(generated).toEqual([]);
    }
  });

  it("tries an unattempted member before a recorded failure and keeps late work out of the initial count", async () => {
    const selected = selectRecoverableOccurrences({
      occurrences: [
        occurrence({ clerkUserId: "user_failed", state: "failed" }),
        occurrence({
          clerkUserId: "user_new",
          state: "pending",
          initialSet: false,
          utcInstant: "2026-01-15T18:00:00.000Z",
        }),
        occurrence({ clerkUserId: "user_pending", utcInstant: "2026-01-15T13:00:00.000Z" }),
      ],
      now: new Date("2026-01-14T21:00:00.000Z"),
      limit: 8,
    });
    expect(selected.map((item) => item.clerkUserId)).toEqual(["user_pending", "user_new"]);

    let batch = emptyBatch([
      occurrence({ clerkUserId: "user_done", state: "generated" }),
    ]);
    batch = {
      ...batch,
      initialCompletedAt: "2026-01-14T21:04:00.000Z",
      scheduledOccurrenceCount: 1,
      relevantMemberCount: 1,
    };
    const late = occurrence({
      clerkUserId: "user_joined",
      memberLocalDate: "2026-01-15",
      utcInstant: "2026-01-15T18:00:00.000Z",
    });
    const ran = await executeScheduledBatch({
      now: new Date("2026-01-14T21:10:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 1,
      discovered: [occurrence({ clerkUserId: "user_done", state: "generated" }), late],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:10:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async () => {
          throw new Error("existing batch must stay open");
        },
        patchBatch: async (_patches, append) => {
          batch = {
            ...batch,
            occurrences: [...batch.occurrences, ...append.map((item) => ({ ...item, initialSet: false }))],
          };
          return batch;
        },
        claim: async () => ({ outcome: "busy", generationId: null, reason: "claim_held" }),
        generate: async () => {
          throw new Error("late work must not generate while the claim is busy");
        },
      },
    });
    expect(ran.batch.scheduledOccurrenceCount).toBe(1);
    expect(ran.batch.initialCompletedAt).toBe("2026-01-14T21:04:00.000Z");
    expect(ran.batch.relevantMemberCount).toBe(1);
    expect(
      ran.batch.occurrences.find((item) => item.clerkUserId === "user_joined")?.initialSet
    ).toBe(false);
  });
});

describe("scheduled generation migration", () => {
  it("adds one batch table, a fenced six-minute claim, and scheduled finish protection", () => {
    expect(MIGRATION).toContain("CREATE TABLE public.sms_tto_generation_batches");
    expect(MIGRATION).not.toContain("CREATE TABLE public.sms_daily_drafts");
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain("GRANT ALL ON TABLE public.sms_tto_generation_batches TO service_role");
    expect(MIGRATION).toContain("interval '6 minutes'");
    expect(MIGRATION).toContain("FOR UPDATE");
    expect(MIGRATION).toContain("stale_claim_owner");
    expect(MIGRATION).toContain("scheduled_finish_refused");
    expect(MIGRATION).toContain("intentional_space");
    expect(MIGRATION).toContain("member_local_delivery_v1");
    expect(MIGRATION).toContain("generation_claim");
    expect(MIGRATION).toContain("ON CONFLICT (batch_date, send_slot) DO NOTHING");
    expect(MIGRATION).toContain("initial_completed_at");
    expect(MIGRATION).toContain("pg_advisory_xact_lock");
    expect(MIGRATION).toContain("clock_timestamp()");
    expect(MIGRATION).toContain("opened_trigger");
    expect(MIGRATION).toContain("p_allow_failed_retry");
    expect(MIGRATION).toContain("DELETE FROM public.sms_daily_draft_generations WHERE id = v_id");
    expect(MIGRATION.match(/CREATE TABLE/g)?.length).toBe(1);
  });

  it("does not put a Sunday exclusion or a Weekly draft into the orchestrator", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/tto-scheduled-generate.ts"),
      "utf8"
    );
    expect(source).not.toContain("weekly_review");
    expect(source).not.toContain("getDay()");
    const generate = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"),
      "utf8"
    );
    expect(generate).toContain("scheduleAuthoritativelyResolved");
    expect(generate).toContain("p_require_claim_owner");
  });
});

describe("stage 3 corrections", () => {
  it("uses the existing cadence interval and keeps a failed history read unresolved", () => {
    expect(
      legacyCadenceEligibilityForDate({
        explicitSchedule: false,
        cadenceOverride: "every_other_day",
        behaviorStatement: "train",
        appliedCadence: "every_other_day",
        history: { ok: true, dayKey: null },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("eligible");
    expect(
      legacyCadenceEligibilityForDate({
        explicitSchedule: false,
        cadenceOverride: "every_other_day",
        behaviorStatement: "train",
        appliedCadence: "every_other_day",
        history: { ok: true, dayKey: "2026-01-14" },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("not_due");
    expect(
      legacyCadenceEligibilityForDate({
        explicitSchedule: false,
        cadenceOverride: "every_3_days",
        behaviorStatement: "train",
        appliedCadence: "every_3_days",
        history: { ok: true, dayKey: "2026-01-12" },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("eligible");
    expect(
      legacyCadenceEligibilityForDate({
        explicitSchedule: false,
        cadenceOverride: "every_other_day",
        behaviorStatement: "train",
        appliedCadence: "every_other_day",
        history: { ok: false },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("unresolved");
    expect(
      legacyCadenceEligibilityForDate({
        explicitSchedule: true,
        cadenceOverride: "every_other_day",
        behaviorStatement: "train",
        appliedCadence: null,
        history: { ok: false },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("not_applicable");
  });

  it("keeps the window end distinct from a request clock and does not complete an unfinished batch", () => {
    expect(scheduledBatchWindowEndsAt("2026-01-14", "evening")).toBe(
      "2026-01-14T15:00:00.000Z"
    );
    expect(scheduledBatchWindowEndsAt("2026-07-14", "evening")).toBe(
      "2026-07-14T14:00:00.000Z"
    );
    expect(scheduledBatchWindowEndsAt("2026-01-15", "morning")).toBe("2026-01-15T02:00:00.000Z");
    expect(
      interpretBatchProgress({
        initialCompletedAt: null,
        windowEndsAt: "2026-01-14T15:00:00.000Z",
        now: new Date("2026-01-14T14:00:00.000Z"),
      })
    ).toBe("active");
    expect(
      interpretBatchProgress({
        initialCompletedAt: null,
        windowEndsAt: "2026-01-14T15:00:00.000Z",
        now: new Date("2026-01-14T15:00:00.000Z"),
      })
    ).toBe("incomplete_after_window");
    expect(
      interpretBatchProgress({
        initialCompletedAt: "2026-01-14T14:05:00.000Z",
        windowEndsAt: "2026-01-14T15:00:00.000Z",
        now: new Date("2026-01-14T16:00:00.000Z"),
      })
    ).toBe("completed");
  });

  it("leaves uncertain persistence recoverable and does not call the model again after a saved draft", async () => {
    let batch = emptyBatch([occurrence()]);
    const patches: string[] = [];
    await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async (nextPatches) => {
          patches.push(nextPatches.map((item) => `${item.patchKind}:${item.state}`).join(","));
          if (nextPatches.some((item) => item.state === "failed")) {
            throw new Error("uncertain persistence must not be stored as failed");
          }
          batch = {
            ...batch,
            occurrences: batch.occurrences.map((item) => ({ ...item, ...nextPatches[0] })),
          };
          return batch;
        },
        claim: async () => ({
          outcome: "claimed",
          generationId: "claim",
          reason: "new_claim",
          claimExpiresAt: "2026-01-14T21:06:00.000Z",
        }),
        generate: async () => ({
          outcome: "claimed",
          body: null,
          generationId: null,
          machineShouldSend: false,
          machineNoSendReason: null,
          error: "upsert_failed",
          recoverable: true,
        }),
      },
    });
    expect(isUncertainPersistence("upsert_failed", null)).toBe(true);
    expect(patches.some((item) => item.includes("failed"))).toBe(false);
    expect(batch.occurrences[0]?.state).not.toBe("failed");

    const generated: string[] = [];
    batch = {
      ...batch,
      occurrences: [{ ...batch.occurrences[0]!, state: "claimed", claimExpiresAt: "2026-01-14T21:00:00.000Z" }],
    };
    await executeScheduledBatch({
      now: new Date("2026-01-14T21:10:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:10:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async (nextPatches) => {
          batch = {
            ...batch,
            occurrences: batch.occurrences.map((item) => ({ ...item, ...(nextPatches[0] ?? {}) })),
          };
          return batch;
        },
        claim: async () => ({
          outcome: "generated",
          generationId: "saved",
          reason: "existing_body",
          claimExpiresAt: null,
        }),
        generate: async () => {
          generated.push("model");
          return {
            outcome: "generated",
            body: "saved",
            generationId: "saved",
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
            recoverable: false,
          };
        },
      },
    });
    expect(generated).toEqual([]);
    expect(batch.occurrences[0]?.state).toBe("generated");
  });

  it("retries a failed occurrence once per manual continuation and keeps the sibling date", async () => {
    const retried: string[] = [];
    let batch = emptyBatch([
      occurrence({ clerkUserId: "user_a", memberLocalDate: "2026-01-14", state: "failed" }),
      occurrence({ clerkUserId: "user_a", memberLocalDate: "2026-01-15", state: "failed" }),
    ]);
    await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "manual_schedule",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      excludeOccurrenceKeys: ["user_a|2026-01-14"],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async (nextPatches) => {
          batch = {
            ...batch,
            occurrences: batch.occurrences.map((item) => {
              const patch = nextPatches.find(
                (candidate) =>
                  candidate.clerkUserId === item.clerkUserId &&
                  candidate.memberLocalDate === item.memberLocalDate
              );
              return patch ? { ...item, ...patch } : item;
            }),
          };
          return batch;
        },
        claim: async (item, _owner, allowRetry) => {
          retried.push(`${item.memberLocalDate}:${allowRetry}`);
          return {
            outcome: "failed",
            generationId: "old",
            reason: "confirmed_failure",
            claimExpiresAt: null,
          };
        },
        generate: async () => {
          throw new Error("a confirmed failure claim must not call the model");
        },
      },
    });
    expect(retried).toEqual(["2026-01-15:true"]);
  });

  it("does not report an all-busy chunk as progress", async () => {
    const batch = emptyBatch([occurrence(), occurrence({ clerkUserId: "user_b" })]);
    const ran = await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 2,
      discovered: [],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async () => batch,
        claim: async () => ({
          outcome: "busy",
          generationId: "held",
          reason: "claim_held",
          claimExpiresAt: null,
        }),
        generate: async () => {
          throw new Error("busy must not generate");
        },
      },
    });
    expect(ran.processed).toBe(0);
  });

  it("does not claim a pending occurrence that the calculator now refuses", async () => {
    const claimed: string[] = [];
    let batch = emptyBatch([occurrence()]);
    await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async (nextPatches) => {
          batch = {
            ...batch,
            occurrences: batch.occurrences.map((item) => ({ ...item, ...nextPatches[0] })),
          };
          return batch;
        },
        revalidate: async () => ({ action: "ineligible", reason: "pause_indefinite" }),
        claim: async () => {
          claimed.push("claim");
          return { outcome: "claimed", generationId: null, reason: null, claimExpiresAt: null };
        },
        generate: async () => {
          throw new Error("ineligible work must not generate");
        },
      },
    });
    expect(claimed).toEqual([]);
    expect(batch.occurrences[0]?.state).toBe("ineligible");
  });

  it("returns the occurrence that matches the posted day when a member has two", () => {
    const choice = selectPreviewOccurrence({
      clerkUserId: "user_a",
      postedBatchDate: "2026-01-15",
      occurrences: [
        occurrence({ memberLocalDate: "2026-01-14", state: "generated" }),
        occurrence({ memberLocalDate: "2026-01-15", state: "generated" }),
      ],
    });
    expect(choice.kind).toBe("one");
    if (choice.kind === "one") {
      expect(choice.occurrence.memberLocalDate).toBe("2026-01-15");
      expect(choice.otherDates).toEqual(["2026-01-14"]);
    }
    expect(
      selectPreviewOccurrence({
        clerkUserId: "user_a",
        postedBatchDate: "2026-01-16",
        occurrences: [
          occurrence({ memberLocalDate: "2026-01-14" }),
          occurrence({ memberLocalDate: "2026-01-15" }),
        ],
      }).kind
    ).toBe("ambiguous");
  });

  it("does not store a stale claimant's late error as a failed generation", async () => {
    const patches: string[] = [];
    let batch = emptyBatch([occurrence()]);
    await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async (nextPatches) => {
          patches.push(nextPatches.map((item) => item.state).join(","));
          batch = {
            ...batch,
            occurrences: batch.occurrences.map((item) => ({ ...item, ...(nextPatches[0] ?? item) })),
          };
          return batch;
        },
        claim: async () => ({
          outcome: "claimed",
          generationId: "claim",
          reason: "new_claim",
          claimExpiresAt: "2026-01-14T21:06:00.000Z",
        }),
        generate: async () => ({
          outcome: "failed",
          body: null,
          generationId: null,
          machineShouldSend: false,
          machineNoSendReason: null,
          error: "stale_claim_owner",
          recoverable: true,
        }),
      },
    });
    expect(patches).toEqual(["claimed"]);
    expect(batch.occurrences[0]?.state).toBe("claimed");
  });

  it("does not automatically retry a confirmed failure", () => {
    const failed = occurrence({ state: "failed" });
    expect(
      selectRecoverableOccurrences({
        occurrences: [failed],
        now: new Date("2026-01-14T21:00:00.000Z"),
        limit: 8,
        includeFailed: false,
      })
    ).toEqual([]);
    expect(
      selectRecoverableOccurrences({
        occurrences: [failed, occurrence({ memberLocalDate: "2026-01-14", state: "pending" })],
        now: new Date("2026-01-14T21:00:00.000Z"),
        limit: 8,
        includeFailed: true,
        excludeOccurrenceKeys: new Set(["user_a:2026-01-15"]),
      }).map((item) => item.memberLocalDate)
    ).toEqual(["2026-01-14"]);
  });
});

describe("stage 3 second correction", () => {
  const sendableRow = {
    clerk_user_id: "user_a",
    phone_number: "+15555550100",
    sms_enabled: true,
    summitt_subscribed: true,
    stopped_at: null,
  };

  function applyClaimPatches(
    batch: ScheduledBatchRecord,
    patches: ScheduledOccurrence[]
  ): ScheduledBatchRecord {
    return {
      ...batch,
      occurrences: batch.occurrences.map((item) => {
        const patch = patches.find(
          (candidate) =>
            candidate.clerkUserId === item.clerkUserId &&
            candidate.memberLocalDate === item.memberLocalDate
        );
        return patch ? { ...item, ...patch } : item;
      }),
    };
  }

  async function runClaimAttempt(args: {
    state?: ScheduledOccurrence["state"];
    trigger?: "automatic_schedule" | "manual_schedule";
    patch: (
      batch: ScheduledBatchRecord,
      patches: ScheduledOccurrence[]
    ) => ScheduledBatchRecord;
  }) {
    const generated: string[] = [];
    let batch = emptyBatch([occurrence({ state: args.state ?? "pending" })]);
    const ran = await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: args.trigger ?? "automatic_schedule",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async (patches) => {
          batch = args.patch(batch, patches);
          return batch;
        },
        claim: async () => ({
          outcome: "claimed",
          generationId: "claim",
          reason: "new_claim",
          claimExpiresAt: "2026-01-14T21:06:00.000Z",
        }),
        generate: async () => {
          generated.push("generate");
          return {
            outcome: "generated",
            body: "Morning text",
            generationId: "gen",
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
            recoverable: false,
          };
        },
      },
    });
    return { ran, generated, batch };
  }

  it("does not treat a failed commitment read as permission to send", () => {
    expect(
      legacyCadenceDecisionFromCommitment({
        explicitSchedule: false,
        cadenceOverride: "every_other_day",
        commitment: { ok: false },
        appliedCadence: "every_other_day",
        history: { ok: true, dayKey: null },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("unresolved");
    expect(
      legacyCadenceDecisionFromCommitment({
        explicitSchedule: false,
        cadenceOverride: "every_3_days",
        commitment: { ok: true, behaviorStatement: null },
        appliedCadence: null,
        history: { ok: true, dayKey: null },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("eligible");
    expect(
      legacyCadenceDecisionFromCommitment({
        explicitSchedule: true,
        cadenceOverride: "every_other_day",
        commitment: { ok: false },
        appliedCadence: null,
        history: { ok: false },
        memberLocalDate: "2026-01-15",
      })
    ).toBe("not_applicable");
  });

  it("generates only after the returned batch shows this worker owns the claim", async () => {
    const accepted = await runClaimAttempt({
      patch: (batch, patches) => applyClaimPatches(batch, patches),
    });
    expect(accepted.generated).toEqual(["generate"]);
    expect(accepted.batch.occurrences[0]?.state).toBe("generated");

    const rejected = await runClaimAttempt({
      patch: (batch) => batch,
    });
    expect(rejected.generated).toEqual([]);
    expect(rejected.ran.processed).toBe(0);
    expect(rejected.batch.occurrences[0]?.state).toBe("pending");

    const missing = await runClaimAttempt({
      patch: (batch) => ({ ...batch, occurrences: [] }),
    });
    expect(missing.generated).toEqual([]);
    expect(missing.ran.processed).toBe(0);

    const otherOwner = await runClaimAttempt({
      patch: (batch) => ({
        ...batch,
        occurrences: batch.occurrences.map((item) => ({
          ...item,
          state: "claimed" as const,
          claimOwnerId: "other-worker",
        })),
      }),
    });
    expect(otherOwner.generated).toEqual([]);
    expect(otherOwner.ran.processed).toBe(0);
    expect(otherOwner.batch.occurrences[0]?.claimOwnerId).toBe("other-worker");

    const rejectedRetry = await runClaimAttempt({
      state: "failed",
      trigger: "manual_schedule",
      patch: (batch) => batch,
    });
    expect(rejectedRetry.generated).toEqual([]);
    expect(rejectedRetry.ran.processed).toBe(0);
    expect(rejectedRetry.batch.occurrences[0]?.state).toBe("failed");
  });

  it("does not describe a pending or claimed preview as a saved no-send", () => {
    expect(eveningPreviewIsReady({ state: "pending", preview: null })).toBe(false);
    expect(eveningPreviewIsReady({ state: "claimed", preview: null })).toBe(false);
    expect(
      eveningPreviewIsReady({
        state: "claimed",
        preview: {
          body: null,
          machineNoSendReason: "scheduled_generation_claim",
          protected: false,
        },
      })
    ).toBe(false);
    expect(
      eveningPreviewIsReady({
        state: "generated",
        preview: { body: "Existing text", machineNoSendReason: null, protected: false },
      })
    ).toBe(true);
    expect(
      eveningPreviewIsReady({
        state: "protected",
        preview: { body: null, machineNoSendReason: null, protected: true },
      })
    ).toBe(true);
    expect(
      eveningPreviewIsReady({
        state: "claimed",
        preview: {
          body: null,
          machineNoSendReason: "scheduled_generation_claim",
          protected: true,
        },
      })
    ).toBe(true);
    expect(
      eveningPreviewIsReady({
        state: "intentional_space",
        preview: { body: null, machineNoSendReason: "intentional_space", protected: false },
      })
    ).toBe(true);
    expect(eveningPreviewIsReady({ state: "generated", preview: null })).toBe(false);
    expect(eveningPreviewIsReady({ state: "protected", preview: null })).toBe(false);
    expect(eveningPreviewIsReady({ state: "intentional_space", preview: null })).toBe(false);
    expect(eveningPreviewIsReady({ state: "sent", preview: null })).toBe(false);
    expect(
      eveningPreviewIsReady({
        state: "sent",
        preview: { body: "Sent text", machineNoSendReason: null, protected: false },
      })
    ).toBe(true);
    expect(
      eveningPreviewIsReady({
        state: "generated",
        preview: { body: null, machineNoSendReason: null, protected: false },
      })
    ).toBe(false);
  });

  it("rechecks current consent before treating a member as eligible", () => {
    expect(classifySmsAudienceSendability(sendableRow)).toEqual({ sendable: true });
    expect(
      classifySmsAudienceSendability({ ...sendableRow, stopped_at: "2026-01-14T12:00:00.000Z" })
    ).toEqual({ sendable: false, reason: "stopped" });
    expect(
      classifySmsAudienceSendability({ ...sendableRow, summitt_subscribed: false })
    ).toEqual({ sendable: false, reason: "membership" });
    expect(classifySmsAudienceSendability({ ...sendableRow, sms_enabled: false })).toEqual({
      sendable: false,
      reason: "sms_disabled",
    });
    expect(
      scheduledMemberEligibility({
        sms: { ok: true, sendable: true },
        commitment: { ok: true, behaviorStatement: "train" },
      })
    ).toBe("eligible");
    expect(
      scheduledMemberEligibility({
        sms: { ok: true, sendable: false },
        commitment: { ok: true, behaviorStatement: "train" },
      })
    ).toBe("ineligible");
    expect(
      scheduledMemberEligibility({
        sms: { ok: false },
        commitment: { ok: true, behaviorStatement: "train" },
      })
    ).toBe("unresolved");
    expect(
      scheduledMemberEligibility({
        sms: { ok: true, sendable: true },
        commitment: { ok: false },
      })
    ).toBe("unresolved");
  });

  it("leaves an unresolved eligibility check pending instead of canceling it", async () => {
    const batch = emptyBatch([occurrence()]);
    const claimed: string[] = [];
    const ran = await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "automatic_schedule",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async (next) => next,
        patchBatch: async () => {
          throw new Error("unresolved eligibility must not change the batch");
        },
        revalidate: async () => ({ action: "unresolved" }),
        claim: async () => {
          claimed.push("claim");
          return { outcome: "claimed", generationId: null, reason: null, claimExpiresAt: null };
        },
        generate: async () => {
          throw new Error("unresolved eligibility must not generate");
        },
      },
    });
    expect(claimed).toEqual([]);
    expect(ran.processed).toBe(0);
    expect(batch.occurrences[0]?.state).toBe("pending");
  });
});

describe("stage 4 dashboard contracts", () => {
  it("selects the requested member-local occurrence and does not fall through", () => {
    const occurrences = [
      occurrence({ memberLocalDate: "2026-01-14" }),
      occurrence({ memberLocalDate: "2026-01-15" }),
    ];
    const exact = selectPreviewOccurrence({
      occurrences,
      clerkUserId: "user_a",
      postedBatchDate: "2026-01-15",
      memberLocalDate: "2026-01-14",
    });
    expect(exact.kind).toBe("one");
    if (exact.kind === "one") expect(exact.occurrence.memberLocalDate).toBe("2026-01-14");

    const missing = selectPreviewOccurrence({
      occurrences,
      clerkUserId: "user_a",
      postedBatchDate: "2026-01-15",
      memberLocalDate: "2026-01-13",
    });
    expect(missing).toEqual({ kind: "none" });

    const ambiguous = selectPreviewOccurrence({
      occurrences,
      clerkUserId: "user_a",
      postedBatchDate: "2026-01-16",
    });
    expect(ambiguous.kind).toBe("ambiguous");
  });

  it("selects only confirmed failures for failed-only retry", () => {
    const selected = selectRecoverableOccurrences({
      occurrences: [
        occurrence({ state: "pending" }),
        occurrence({ state: "claimed", memberLocalDate: "2026-01-12" }),
        occurrence({ state: "generated", memberLocalDate: "2026-01-13" }),
        occurrence({
          state: "failed",
          memberLocalDate: "2026-01-10",
          utcInstant: "2026-01-10T12:00:00.000Z",
          initialOutcome: "failed",
        }),
        occurrence({ state: "intentional_space", memberLocalDate: "2026-01-11" }),
      ],
      now: new Date("2026-01-14T21:00:00.000Z"),
      limit: 10,
      failedOnly: true,
      excludeOccurrenceKeys: new Set(["user_a:2026-01-09"]),
    });
    expect(selected.map((item) => item.memberLocalDate)).toEqual(["2026-01-10"]);
  });

  it("does not open a batch or generate pending work in failed-only mode", async () => {
    const generated: string[] = [];
    let opened = false;
    let batch: ScheduledBatchRecord | null = emptyBatch([
      occurrence({ state: "pending", memberLocalDate: "2026-01-15" }),
      occurrence({
        state: "failed",
        memberLocalDate: "2026-01-14",
        initialOutcome: "failed",
      }),
      occurrence({
        state: "generated",
        memberLocalDate: "2026-01-13",
        initialOutcome: "generated",
      }),
    ]);
    batch.startedAt = "2026-01-14T21:00:00.000Z";
    batch.initialCompletedAt = "2026-01-14T21:05:00.000Z";
    const ran = await executeScheduledBatch({
      now: new Date("2026-01-14T21:00:00.000Z"),
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "manual_schedule",
      failedOnly: true,
      relevantMemberCount: 1,
      discovered: [occurrence({ clerkUserId: "user_new", memberLocalDate: "2026-01-16" })],
      nonScheduled: [],
      nowMs: () => Date.parse("2026-01-14T21:00:00.000Z"),
      deps: {
        readBatch: async () => batch,
        openBatch: async () => {
          opened = true;
          throw new Error("failed-only must not open a batch");
        },
        patchBatch: async (patches) => {
          batch = {
            ...batch!,
            occurrences: batch!.occurrences.map((item) => {
              const patch = patches.find(
                (candidate) =>
                  candidate.clerkUserId === item.clerkUserId &&
                  candidate.memberLocalDate === item.memberLocalDate
              );
              return patch ? { ...item, ...patch, initialOutcome: item.initialOutcome } : item;
            }),
          };
          return batch;
        },
        claim: async (occurrence, _owner, allowFailedRetry) => {
          expect(allowFailedRetry).toBe(true);
          expect(occurrence.state).toBe("failed");
          return {
            outcome: "claimed",
            generationId: "claim",
            reason: "retry",
            claimExpiresAt: "2026-01-14T21:06:00.000Z",
          };
        },
        generate: async (occurrence) => {
          generated.push(occurrence.memberLocalDate);
          return {
            outcome: "generated",
            body: "Retried",
            generationId: "gen",
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
            recoverable: false,
          };
        },
      },
    });
    expect(opened).toBe(false);
    expect(generated).toEqual(["2026-01-14"]);
    expect(ran.processed).toBe(1);
    expect(batch?.startedAt).toBe("2026-01-14T21:00:00.000Z");
    expect(batch?.initialCompletedAt).toBe("2026-01-14T21:05:00.000Z");
    expect(batch?.occurrences.find((item) => item.memberLocalDate === "2026-01-15")?.state).toBe(
      "pending"
    );
    expect(batch?.occurrences.find((item) => item.memberLocalDate === "2026-01-14")?.initialOutcome).toBe(
      "failed"
    );

    await expect(
      executeScheduledBatch({
        now: new Date("2026-01-14T21:00:00.000Z"),
        batchDate: "2026-01-15",
        owner: "morning",
        trigger: "manual_schedule",
        failedOnly: true,
        relevantMemberCount: 1,
        discovered: [],
        nonScheduled: [],
        deps: {
          readBatch: async () => null,
          openBatch: async () => {
            throw new Error("failed-only must not open a batch");
          },
          patchBatch: async () => {
            throw new Error("no batch");
          },
          claim: async () => {
            throw new Error("no batch");
          },
          generate: async () => {
            throw new Error("no batch");
          },
        },
      })
    ).rejects.toThrow("no_scheduled_batch");
  });

  it("generates only the requested member-local date and skips a date that is not in the batch", async () => {
    const occurrences = [
      occurrence({
        state: "pending",
        memberLocalDate: "2026-01-14",
        utcInstant: "2026-01-15T04:45:00.000Z",
      }),
      occurrence({
        state: "pending",
        memberLocalDate: "2026-01-15",
        utcInstant: "2026-01-15T15:00:00.000Z",
      }),
    ];
    const now = new Date("2026-01-14T21:00:00.000Z");
    const requested = decideScheduledPreviewWork({
      occurrences,
      clerkUserId: "user_a",
      postedBatchDate: "2026-01-15",
      memberLocalDate: "2026-01-14",
      now,
    });
    expect(requested.action).toBe("generate");
    if (requested.action !== "generate") return;

    const missing = decideScheduledPreviewWork({
      occurrences,
      clerkUserId: "user_a",
      postedBatchDate: "2026-01-15",
      memberLocalDate: "2026-01-13",
      now,
    });
    expect(missing.action).toBe("none");

    const ambiguous = decideScheduledPreviewWork({
      occurrences,
      clerkUserId: "user_a",
      postedBatchDate: "2026-01-16",
      now,
    });
    expect(ambiguous.action).toBe("ambiguous");

    const generated: string[] = [];
    let opened = false;
    let batch: ScheduledBatchRecord | null = emptyBatch(occurrences);
    const ran = await executeScheduledBatch({
      now,
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "manual_schedule",
      onlyClerkUserIds: ["user_a"],
      onlyMemberLocalDate: requested.occurrence.memberLocalDate,
      relevantMemberCount: 1,
      discovered: [occurrence({ clerkUserId: "user_new", memberLocalDate: "2026-01-16" })],
      nonScheduled: [],
      nowMs: () => now.getTime(),
      deps: {
        readBatch: async () => batch,
        openBatch: async () => {
          opened = true;
          throw new Error("preview must not open a batch");
        },
        patchBatch: async (patches) => {
          batch = {
            ...batch!,
            occurrences: batch!.occurrences.map((item) => {
              const patch = patches.find(
                (candidate) =>
                  candidate.clerkUserId === item.clerkUserId &&
                  candidate.memberLocalDate === item.memberLocalDate
              );
              return patch ? { ...item, ...patch, initialOutcome: item.initialOutcome } : item;
            }),
          };
          return batch;
        },
        claim: async (occurrence) => {
          expect(occurrence.memberLocalDate).toBe("2026-01-14");
          return {
            outcome: "claimed",
            generationId: "claim",
            reason: "preview",
            claimExpiresAt: "2026-01-14T21:06:00.000Z",
          };
        },
        generate: async (occurrence) => {
          generated.push(occurrence.memberLocalDate);
          return {
            outcome: "generated",
            body: "Wednesday",
            generationId: "gen",
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
            recoverable: false,
          };
        },
      },
    });
    expect(opened).toBe(false);
    expect(generated).toEqual(["2026-01-14"]);
    expect(ran.processed).toBe(1);
    expect(batch?.occurrences.find((item) => item.memberLocalDate === "2026-01-15")?.state).toBe(
      "pending"
    );

    const untouched = await executeScheduledBatch({
      now,
      batchDate: "2026-01-15",
      owner: "morning",
      trigger: "manual_schedule",
      onlyClerkUserIds: ["user_a"],
      onlyMemberLocalDate: "2026-01-13",
      relevantMemberCount: 1,
      discovered: occurrences,
      nonScheduled: [],
      nowMs: () => now.getTime(),
      deps: {
        readBatch: async () => batch,
        openBatch: async () => {
          throw new Error("missing preview date must not open a batch");
        },
        patchBatch: async () => {
          throw new Error("missing preview date must not patch the batch");
        },
        claim: async () => {
          throw new Error("missing preview date must not claim");
        },
        generate: async () => {
          throw new Error("missing preview date must not generate");
        },
      },
    });
    expect(untouched.processed).toBe(0);
    expect(batch?.occurrences.find((item) => item.memberLocalDate === "2026-01-15")?.state).toBe(
      "pending"
    );
  });

  it("opens a manual batch for one future occurrence and leaves every other occurrence pending", async () => {
    const now = new Date("2026-01-14T21:00:00.000Z");
    const requested = occurrence({
      clerkUserId: "user_a",
      memberLocalDate: "2026-01-20",
      utcInstant: "2026-01-20T15:00:00.000Z",
      state: "pending",
    });
    const sibling = occurrence({
      clerkUserId: "user_a",
      memberLocalDate: "2026-01-19",
      utcInstant: "2026-01-20T04:45:00.000Z",
      state: "pending",
    });
    const otherMember = occurrence({
      clerkUserId: "user_b",
      memberLocalDate: "2026-01-20",
      utcInstant: "2026-01-20T12:00:00.000Z",
      state: "pending",
    });
    const discovered = [requested, sibling, otherMember];
    expect(
      exactPreviewCanOpenBatch({
        discovered,
        clerkUserIds: ["user_a"],
        memberLocalDate: "2026-01-20",
        now,
      })
    ).toBe(true);
    expect(
      decideScheduledPreviewWork({
        occurrences: discovered.filter((item) => item.clerkUserId === "user_a"),
        clerkUserId: "user_a",
        postedBatchDate: "2026-01-20",
        now,
      }).action
    ).toBe("generate");

    const generated: string[] = [];
    let completionStamps = 0;
    let stored: ScheduledBatchRecord | null = null;
    const requireStored = (): ScheduledBatchRecord => {
      if (stored == null) throw new Error("batch was not stored");
      return stored;
    };
    const ran = await executeScheduledBatch({
      now,
      batchDate: "2026-01-20",
      owner: "morning",
      trigger: "manual_schedule",
      onlyClerkUserIds: ["user_a"],
      onlyMemberLocalDate: "2026-01-20",
      relevantMemberCount: 4,
      discovered,
      nonScheduled: [
        { clerkUserId: "user_off", classification: "unscheduled", reason: "weekday_off" },
      ],
      nowMs: () => now.getTime(),
      deps: {
        readBatch: async () => stored,
        openBatch: async (proposed): Promise<ScheduledBatchRecord> => {
          expect(proposed.openedTrigger).toBe("manual_schedule");
          expect(proposed.relevantMemberCount).toBe(4);
          expect(proposed.scheduledMemberCount).toBe(2);
          expect(proposed.scheduledOccurrenceCount).toBe(3);
          expect(proposed.nonScheduled).toEqual([
            { clerkUserId: "user_off", classification: "unscheduled", reason: "weekday_off" },
          ]);
          const opened: ScheduledBatchRecord = { ...proposed, id: "opened", startedAt: now.toISOString() };
          stored = opened;
          return opened;
        },
        patchBatch: async (patches) => {
          if (patches.length === 0) completionStamps += 1;
          const current = stored;
          if (current == null) throw new Error("batch was not opened");
          const next: ScheduledBatchRecord = {
            ...current,
            occurrences: current.occurrences.map((item) => {
              const patch = patches.find(
                (candidate) =>
                  candidate.clerkUserId === item.clerkUserId &&
                  candidate.memberLocalDate === item.memberLocalDate
              );
              return patch ? { ...item, ...patch, initialOutcome: item.initialOutcome } : item;
            }),
          };
          stored = next;
          return next;
        },
        claim: async (item) => {
          expect(item.memberLocalDate).toBe("2026-01-20");
          expect(item.clerkUserId).toBe("user_a");
          return {
            outcome: "claimed",
            generationId: "claim",
            reason: "preview",
            claimExpiresAt: "2026-01-14T21:06:00.000Z",
          };
        },
        generate: async (item) => {
          generated.push(`${item.clerkUserId}:${item.memberLocalDate}`);
          return {
            outcome: "generated",
            body: "Future",
            generationId: "gen",
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
            recoverable: false,
          };
        },
        revalidate: async (item) => {
          expect(stored?.occurrences.some(
            (candidate) =>
              candidate.clerkUserId === item.clerkUserId &&
              candidate.memberLocalDate === item.memberLocalDate
          )).toBe(true);
          return { action: "ready" };
        },
      },
    });

    expect(generated).toEqual(["user_a:2026-01-20"]);
    expect(ran.processed).toBe(1);
    expect(completionStamps).toBe(0);
    const saved = requireStored();
    expect(saved.openedTrigger).toBe("manual_schedule");
    expect(saved.occurrences.find((item) => item.clerkUserId === "user_b")?.state).toBe(
      "pending"
    );
    expect(
      saved.occurrences.find(
        (item) => item.clerkUserId === "user_a" && item.memberLocalDate === "2026-01-19"
      )?.state
    ).toBe("pending");
  });

  it("refuses an invalid, expired, or ambiguous preview before opening a batch", async () => {
    const now = new Date("2026-01-14T21:00:00.000Z");
    const future = [
      occurrence({ memberLocalDate: "2026-01-14", utcInstant: "2026-01-15T04:45:00.000Z" }),
      occurrence({ memberLocalDate: "2026-01-15", utcInstant: "2026-01-15T15:00:00.000Z" }),
    ];
    expect(
      decideScheduledPreviewWork({
        occurrences: future,
        clerkUserId: "user_a",
        postedBatchDate: "2026-01-16",
        now,
      }).action
    ).toBe("ambiguous");
    expect(
      exactPreviewCanOpenBatch({
        discovered: future,
        clerkUserIds: ["user_a"],
        memberLocalDate: "2026-01-13",
        now,
      })
    ).toBe(false);
    expect(
      exactPreviewCanOpenBatch({
        discovered: [
          occurrence({
            memberLocalDate: "2026-01-20",
            utcInstant: "2026-01-14T20:00:00.000Z",
            state: "pending",
          }),
        ],
        clerkUserIds: ["user_a"],
        memberLocalDate: "2026-01-20",
        now,
      })
    ).toBe(false);

    await expect(
      executeScheduledBatch({
        now,
        batchDate: "2026-01-20",
        owner: "morning",
        trigger: "manual_schedule",
        onlyClerkUserIds: ["user_a"],
        onlyMemberLocalDate: "2026-01-13",
        relevantMemberCount: 4,
        discovered: future,
        nonScheduled: [],
        nowMs: () => now.getTime(),
        deps: {
          readBatch: async () => null,
          openBatch: async () => {
            throw new Error("invalid preview must not open a batch");
          },
          patchBatch: async () => {
            throw new Error("invalid preview must not patch a batch");
          },
          claim: async () => {
            throw new Error("invalid preview must not claim");
          },
          generate: async () => {
            throw new Error("invalid preview must not generate");
          },
        },
      })
    ).rejects.toThrow("no_scheduled_occurrence");
  });

  it("keeps the winning batch when another invocation opens it first", async () => {
    const now = new Date("2026-01-14T21:00:00.000Z");
    const requested = occurrence({
      memberLocalDate: "2026-01-20",
      utcInstant: "2026-01-20T15:00:00.000Z",
    });
    const winner = emptyBatch([
      requested,
      occurrence({
        clerkUserId: "user_b",
        memberLocalDate: "2026-01-20",
        utcInstant: "2026-01-20T12:00:00.000Z",
      }),
    ]);
    winner.openedTrigger = "automatic_schedule";
    winner.relevantMemberCount = 4;
    let stored: ScheduledBatchRecord | null = null;
    const requireStored = (): ScheduledBatchRecord => {
      if (stored == null) throw new Error("batch was not stored");
      return stored;
    };
    const generated: string[] = [];
    await executeScheduledBatch({
      now,
      batchDate: "2026-01-20",
      owner: "morning",
      trigger: "manual_schedule",
      onlyClerkUserIds: ["user_a"],
      onlyMemberLocalDate: "2026-01-20",
      relevantMemberCount: 4,
      discovered: [
        requested,
        occurrence({
          clerkUserId: "user_b",
          memberLocalDate: "2026-01-20",
          utcInstant: "2026-01-20T12:00:00.000Z",
        }),
      ],
      nonScheduled: [],
      nowMs: () => now.getTime(),
      deps: {
        readBatch: async () => stored,
        openBatch: async (proposed) => {
          expect(proposed.openedTrigger).toBe("manual_schedule");
          stored = winner;
          return winner;
        },
        patchBatch: async (patches) => {
          const current = stored;
          if (current == null) throw new Error("batch was not opened");
          const next: ScheduledBatchRecord = {
            ...current,
            occurrences: current.occurrences.map((item) => {
              const patch = patches.find(
                (candidate) =>
                  candidate.clerkUserId === item.clerkUserId &&
                  candidate.memberLocalDate === item.memberLocalDate
              );
              return patch ? { ...item, ...patch, initialOutcome: item.initialOutcome } : item;
            }),
          };
          stored = next;
          return next;
        },
        claim: async (item) => {
          expect(item.clerkUserId).toBe("user_a");
          return {
            outcome: "claimed",
            generationId: "claim",
            reason: "preview",
            claimExpiresAt: "2026-01-14T21:06:00.000Z",
          };
        },
        generate: async (item) => {
          generated.push(item.clerkUserId);
          return {
            outcome: "generated",
            body: "Winner",
            generationId: "gen",
            machineShouldSend: true,
            machineNoSendReason: null,
            error: null,
            recoverable: false,
          };
        },
        revalidate: async (item) => {
          const authoritative = stored?.occurrences.find(
            (candidate) =>
              candidate.clerkUserId === item.clerkUserId &&
              candidate.memberLocalDate === item.memberLocalDate &&
              candidate.utcInstant === item.utcInstant
          );
          expect(authoritative).toBeTruthy();
          return { action: "ready" };
        },
      },
    });
    expect(generated).toEqual(["user_a"]);
    const savedBatch = requireStored();
    expect(savedBatch.openedTrigger).toBe("automatic_schedule");
    expect(savedBatch.relevantMemberCount).toBe(4);
    expect(savedBatch.occurrences.find((item) => item.clerkUserId === "user_b")?.state).toBe(
      "pending"
    );
  });

  it("does not generate again when the requested occurrence is already complete", async () => {
    const now = new Date("2026-01-14T21:00:00.000Z");
    const saved = occurrence({ state: "generated", memberLocalDate: "2026-01-15" });
    expect(
      decideScheduledPreviewWork({
        occurrences: [saved, occurrence({ memberLocalDate: "2026-01-14", state: "pending" })],
        clerkUserId: "user_a",
        postedBatchDate: "2026-01-15",
        memberLocalDate: "2026-01-15",
        now,
      }).action
    ).toBe("read_existing");
    const ran = await executeScheduledBatch({
      now,
      batchDate: "2026-01-15",
      owner: "evening",
      trigger: "manual_schedule",
      onlyClerkUserIds: ["user_a"],
      onlyMemberLocalDate: "2026-01-15",
      relevantMemberCount: 1,
      discovered: [],
      nonScheduled: [],
      nowMs: () => now.getTime(),
      deps: {
        readBatch: async () => emptyBatch([saved]),
        openBatch: async () => {
          throw new Error("completed preview must not open a batch");
        },
        patchBatch: async () => {
          throw new Error("completed preview must not patch a batch");
        },
        claim: async () => {
          throw new Error("completed preview must not claim");
        },
        generate: async () => {
          throw new Error("completed preview must not generate");
        },
      },
    });
    expect(ran.processed).toBe(0);
    expect(ran.previews).toEqual([]);
  });

  it("keeps individual preview available before a batch starts and resolves that occurrence first", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/tyler-text-overview/evening-preview/route.ts"),
      "utf8"
    );
    const dashboard = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(route.indexOf("resolveMemberPreviewDecision")).toBeGreaterThan(-1);
    expect(route.indexOf("resolveMemberPreviewDecision")).toBeLessThan(
      route.indexOf("runScheduledTtoGeneration")
    );
    expect(route).toContain('reason: "unresolved"');
    expect(route).toContain('reason: "ambiguous_occurrences"');
    expect(dashboard).toContain("generateEveningPreview(row)");
    expect(dashboard).toContain('batchStatistics?.status === "not_started"');
    expect(dashboard).not.toContain('disabled={batchStatistics?.status === "not_started"');
  });
});

function batchFor(
  sendSlot: ScheduledBatchRecord["sendSlot"],
  batchDate: string,
  items: ScheduledOccurrence[]
): ScheduledBatchRecord {
  return {
    id: `${sendSlot}-${batchDate}`,
    batchDate,
    sendSlot,
    openedTrigger: "automatic_schedule",
    windowEndsAt: "2026-01-15T15:00:00.000Z",
    startedAt: "2026-01-14T21:00:00.000Z",
    initialCompletedAt: "2026-01-14T21:05:00.000Z",
    initialCompletedTrigger: "automatic_schedule",
    relevantMemberCount: items.length,
    scheduledMemberCount: items.length,
    scheduledOccurrenceCount: items.length,
    occurrences: items,
    nonScheduled: [],
  };
}

function evidence(overrides: Partial<TtoInputEvidence> = {}): TtoInputEvidence {
  return {
    succeeded: true,
    considered_source_ids: ["SM_coach_1"],
    thread_oldest_sent_at: "2026-01-14T12:00:00.000Z",
    omitted_older_turn_count: 0,
    thread_tail: {
      source_id: "SM_coach_1",
      sender: "coach",
      sent_at_utc: "2026-01-14T18:00:00.000Z",
    },
    thread_message_count: 2,
    goal_text: "Walk after lunch",
    existing_body_sha256: "saved-body",
    existing_body_source: "machine",
    edited_by_tyler: false,
    edited_at: null,
    delivery: {
      utc_instant: "2026-01-15T14:00:00.000Z",
      member_local_date: "2026-01-15",
      batch_date: "2026-01-15",
      effective_local_minute: 540,
      time_zone: "America/New_York",
      send_slot: "morning",
      preference_updated_at: "2026-01-14T12:00:00.000Z",
    },
    attempt_id: "attempt-1",
    ...overrides,
  };
}

function compare(args: {
  considered?: TtoInputEvidence | null;
  failedAttempt?: TtoInputEvidence | null;
  discovered?: Array<{ sourceId: string; sender: "user" | "coach"; sentAtUtc: string; receivedAtUtc?: string | null }>;
  unidentifiedReplies?: Array<{ sentAtUtc: string; receivedAtUtc: string | null }>;
  retrieval?: "ok" | "failed" | "incomplete";
  goalText?: string | null;
  goalReadOk?: boolean;
  delivery?: { utcInstant: string; effectiveLocalMinute: number; timeZone: string } | null;
  deliveryReadOk?: boolean;
  scheduleChangedSinceSuccess?: boolean;
  scheduleChangedSinceFailure?: boolean;
  retryAfter?: string | null;
  now: Date;
}) {
  return reconsiderationInputsChanged({
    considered: args.considered === undefined ? evidence() : args.considered,
    failedAttempt: args.failedAttempt ?? null,
    discovered: args.discovered ?? [
      { sourceId: "SM_coach_1", sender: "coach", sentAtUtc: "2026-01-14T18:00:00.000Z" },
    ],
    unidentifiedReplies: args.unidentifiedReplies,
    retrieval: args.retrieval ?? "ok",
    goalText: args.goalText === undefined ? "Walk after lunch" : args.goalText,
    goalReadOk: args.goalReadOk ?? true,
    delivery: args.delivery === undefined ? {
      utcInstant: "2026-01-15T14:00:00.000Z",
      effectiveLocalMinute: 540,
      timeZone: "America/New_York",
    } : args.delivery,
    deliveryReadOk: args.deliveryReadOk ?? true,
    scheduleChangedSinceSuccess: args.scheduleChangedSinceSuccess ?? false,
    scheduleChangedSinceFailure: args.scheduleChangedSinceFailure ?? false,
    retryAfter: args.retryAfter ?? null,
    now: args.now,
  });
}

describe("stage 5 reconsideration", () => {
  const now = new Date("2026-01-15T03:00:00.000Z");

  it("does not call for reconsideration when the considered inputs are unchanged", () => {
    expect(compare({ now })).toBe("unchanged");
  });

  it("reconsiders when the member answers the upcoming question", () => {
    expect(compare({
      now,
      discovered: [
        { sourceId: "SM_coach_1", sender: "coach", sentAtUtc: "2026-01-14T18:00:00.000Z" },
        { sourceId: "SM_user_2", sender: "user", sentAtUtc: "2026-01-15T02:00:00.000Z" },
      ],
    })).toBe("changed");
  });

  it("keeps the same decision when the same source id is discovered again", () => {
    expect(compare({ now })).toBe("unchanged");
  });

  it("does not treat a raw body or a different clock string as a new message", () => {
    const raw = discoverMemberMessages({
      inboundRows: [{
        message_sid: "SM_coach_1",
        raw_body: "  Did you\n\naccomplish your goal yesterday?  ",
        received_at: "2026-01-14T18:00:00.000Z",
      }],
      inboundCapped: false,
      coachRows: [],
      coachCapped: false,
    });
    expect(raw.messages.map((message) => message.sourceId)).toEqual(["SM_coach_1"]);
    expect(compare({ now, discovered: raw.messages })).toBe("unchanged");
    expect(compare({
      now,
      discovered: [
        { sourceId: "SM_coach_1", sender: "coach", sentAtUtc: "2026-01-14T18:00:05.000Z" },
      ],
    })).toBe("unchanged");
  });

  it("distinguishes two messages that share a timestamp", () => {
    expect(compare({
      now,
      discovered: [
        { sourceId: "SM_coach_1", sender: "coach", sentAtUtc: "2026-01-14T18:00:00.000Z" },
        { sourceId: "SM_user_same_time", sender: "user", sentAtUtc: "2026-01-14T18:00:00.000Z" },
      ],
    })).toBe("changed");
  });

  it("discovers a late message inside the included window and ignores one older than that window", () => {
    expect(compare({
      now,
      discovered: [
        { sourceId: "SM_late", sender: "user", sentAtUtc: "2026-01-14T15:00:00.000Z" },
      ],
    })).toBe("changed");
    expect(compare({
      now,
      discovered: [
        { sourceId: "SM_too_old", sender: "user", sentAtUtc: "2026-01-14T11:00:00.000Z" },
      ],
    })).toBe("unchanged");
  });

  it("does not let one member's messages decide another member's page", () => {
    const crowded = Array.from({ length: MEMBER_CONVERSATION_READ_LIMIT }, (_, index) => ({
      message_sid: `SM_a_${index}`,
      raw_body: `member a ${index}`,
      received_at: `2026-01-14T18:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const memberB = discoverMemberMessages({
      inboundRows: [{
        message_sid: "SM_b_1",
        raw_body: "I walked",
        received_at: "2026-01-14T12:00:00.000Z",
      }],
      inboundCapped: false,
      coachRows: [],
      coachCapped: false,
    });
    const memberA = discoverMemberMessages({
      inboundRows: crowded,
      inboundCapped: true,
      coachRows: [],
      coachCapped: false,
    });
    expect(memberB.messages.map((message) => message.sourceId)).toEqual(["SM_b_1"]);
    expect(memberA.messages.some((message) => message.sourceId === "SM_b_1")).toBe(false);
    expect(memberA.retrieval).toBe("ok");
  });

  it("treats a failed goal, preference, or conversation read as unresolved", () => {
    expect(compare({ now, goalReadOk: false, goalText: null })).toBe("unresolved");
    expect(compare({ now, deliveryReadOk: false, delivery: null })).toBe("unresolved");
    expect(compare({ now, retrieval: "failed", discovered: [] })).toBe("unresolved");
    expect(reconsiderationReadiness({
      goalReadOk: true,
      preferenceReadOk: false,
      draftReadOk: true,
      generationReadOk: true,
      retrieval: "ok",
    })).toBe("unresolved");
    expect(reconsiderationReadiness({
      goalReadOk: true,
      preferenceReadOk: true,
      draftReadOk: false,
      generationReadOk: true,
      retrieval: "ok",
    })).toBe("unresolved");
  });

  it("backs off the failed attempt and still notices a genuinely new message", () => {
    const failed = evidence({ attempt_id: "failed-1" });
    expect(compare({
      now,
      failedAttempt: failed,
      retryAfter: "2026-01-15T03:30:00.000Z",
    })).toBe("backoff");
    expect(compare({
      now,
      failedAttempt: failed,
      retryAfter: "2026-01-15T03:30:00.000Z",
      discovered: [
        { sourceId: "SM_coach_1", sender: "coach", sentAtUtc: "2026-01-14T18:00:00.000Z" },
        { sourceId: "SM_user_new", sender: "user", sentAtUtc: "2026-01-15T02:30:00.000Z" },
      ],
    })).toBe("changed");
  });

  it("treats an unchanged effective coaching ask as unchanged, including an adaptive ask", () => {
    expect(compare({ now, goalText: "Walk after lunch  " })).toBe("unchanged");
    const nowMs = Date.parse("2026-01-15T03:00:00.000Z");
    expect(effectiveCoachingAskForDiscovery({
      behavior_statement: "Walk after lunch",
      adaptive_ask_text: "Stretch before bed",
      adaptive_ask_expires_at: "2026-02-01T00:00:00.000Z",
    }, nowMs)).toBe("Stretch before bed");
    expect(effectiveCoachingAskForDiscovery({
      behavior_statement: "Walk after lunch ",
      adaptive_ask_text: "Stretch before bed",
      adaptive_ask_expires_at: "2026-01-01T00:00:00.000Z",
    }, nowMs)).toBe("Walk after lunch");
    expect(compare({ now, goalText: "Stretch before bed" })).toBe("changed");
  });

  it("reconsiders an app goal change without an SMS", () => {
    expect(compare({ now, goalText: "Stretch before bed", discovered: [] })).toBe("changed");
  });

  it("reconsiders a delivery-time change and ignores an unchanged schedule", () => {
    expect(compare({
      now,
      delivery: {
        utcInstant: "2026-01-15T14:00:00.000Z",
        effectiveLocalMinute: 1200,
        timeZone: "America/New_York",
      },
    })).toBe("changed");
    expect(compare({ now, scheduleChangedSinceSuccess: false })).toBe("unchanged");
  });

  it("selects the next upcoming occurrence across Morning and Evening", () => {
    const morning = occurrence({
      clerkUserId: "user_a",
      memberLocalDate: "2026-01-15",
      utcInstant: "2026-01-15T14:00:00.000Z",
      state: "generated",
    });
    const evening = occurrence({
      clerkUserId: "user_a",
      memberLocalDate: "2026-01-15",
      utcInstant: "2026-01-15T23:00:00.000Z",
      state: "generated",
    });
    const selected = selectNextReconsiderationCandidates(
      [
        batchFor("morning", "2026-01-15", [morning]),
        batchFor("evening_checkin", "2026-01-15", [evening]),
      ],
      now
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.sendSlot).toBe("morning");
    expect(selected[0]?.occurrence.utcInstant).toBe("2026-01-15T14:00:00.000Z");
  });

  it("does not jump to a later draft while an earlier occurrence is still upcoming", () => {
    const pending = occurrence({
      utcInstant: "2026-01-15T14:00:00.000Z",
      state: "pending",
    });
    const later = occurrence({
      memberLocalDate: "2026-01-16",
      utcInstant: "2026-01-16T14:00:00.000Z",
      state: "generated",
    });
    expect(
      selectNextReconsiderationCandidates(
        [batchFor("morning", "2026-01-15", [pending, later])],
        now
      )
    ).toEqual([]);
  });

  it("does not reconsider a sent or historical occurrence", () => {
    const sent = occurrence({
      utcInstant: "2026-01-15T14:00:00.000Z",
      state: "sent",
    });
    const historical = occurrence({
      utcInstant: "2026-01-14T14:00:00.000Z",
      state: "generated",
    });
    expect(
      selectNextReconsiderationCandidates(
        [batchFor("morning", "2026-01-15", [sent, historical])],
        now
      )
    ).toEqual([]);
  });

  it("reconsiders a protected Tyler text and an intentional blank the same way", () => {
    const tyler = occurrence({ state: "protected", utcInstant: "2026-01-15T14:00:00.000Z" });
    const blank = occurrence({
      clerkUserId: "user_b",
      state: "intentional_space",
      utcInstant: "2026-01-15T15:00:00.000Z",
    });
    const selected = selectNextReconsiderationCandidates(
      [batchFor("morning", "2026-01-15", [tyler, blank])],
      now
    );
    expect(selected.map((item) => item.occurrence.clerkUserId)).toEqual(["user_a", "user_b"]);
  });

  it("records the loaded thread and does not treat a later message as already seen", () => {
    const packet = {
      exact_thread: {
        messages: [
          {
            sender: "coach" as const,
            source_id: "SM_coach_1",
            sent_at_utc: "2026-01-14T18:00:00.000Z",
            body: "Did you accomplish your goal yesterday?\n\nReply STOP to stop.",
          },
        ],
        omitted_older_turn_count: 0,
      },
      current_goal: { text: "Walk after lunch" },
      message_for: { local_date: "2026-01-15", timezone: "America/New_York" },
    };
    const captured = buildTtoInputEvidence({
      packet: packet as never,
      attemptId: "attempt-1",
      existingBody: "Did you accomplish your goal yesterday?",
      existingBodySource: "tyler_edit",
      editedByTyler: true,
      editedAt: "2026-01-14T22:00:00.000Z",
      delivery: {
        utc_instant: "2026-01-15T14:00:00.000Z",
        member_local_date: "2026-01-15",
        batch_date: "2026-01-15",
        effective_local_minute: 540,
        time_zone: "America/New_York",
        send_slot: "morning",
      },
    });
    expect(captured.considered_source_ids).toEqual(["SM_coach_1"]);
    expect(captured.thread_tail?.source_id).toBe("SM_coach_1");
    expect(captured.thread_tail).not.toHaveProperty("body_sha256");
    expect(captured.edited_by_tyler).toBe(true);
    expect(captured.succeeded).toBe(false);
    const during = compare({
      considered: captured,
      now,
      discovered: [
        { sourceId: "SM_user_during", sender: "user", sentAtUtc: "2026-01-14T18:00:01.000Z" },
      ],
      delivery: {
        utcInstant: captured.delivery.utc_instant ?? "",
        effectiveLocalMinute: captured.delivery.effective_local_minute ?? 0,
        timeZone: captured.delivery.time_zone ?? "",
      },
    });
    expect(during).toBe("unchanged");
    expect(compare({
      considered: captured,
      now,
      discovered: [
        { sourceId: "SM_user_after_edit", sender: "user", sentAtUtc: "2026-01-14T22:30:00.000Z" },
      ],
      delivery: {
        utcInstant: captured.delivery.utc_instant ?? "",
        effectiveLocalMinute: captured.delivery.effective_local_minute ?? 0,
        timeZone: captured.delivery.time_zone ?? "",
      },
    })).toBe("changed");
    expect(successfulConsiderationEvidence({ input_evidence: captured })).toEqual(captured);
    expect(
      successfulConsiderationEvidence({
        input_evidence: captured,
        reconsideration_evidence: { ...captured, succeeded: true, attempt_id: "keep-1" },
      })?.attempt_id
    ).toBe("keep-1");
  });

  it("keeps reconsideration on the existing five-minute cron outside the initial window", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    const cron = readFileSync(
      join(process.cwd(), "vercel.json"),
      "utf8"
    );
    expect(source).toContain("runScheduledReconsideration");
    expect(source).toContain("body: { ok: true, active: false, recovered, reconsideration }");
    expect(source).not.toContain("new Cron");
    expect(cron).toContain('"/api/cron/tto-scheduled-generate"');
    expect(cron).toContain('"*/5 * * * *"');
  });

  it("fences KEEP and REPLACE in the unexecuted claim and finish functions", () => {
    expect(MIGRATION).toContain("p_mode text DEFAULT 'initial'");
    expect(MIGRATION).toContain("p_reconsideration boolean DEFAULT false");
    expect(MIGRATION).toContain("p_expected_generation_id uuid");
    expect(MIGRATION).toContain("p_expected_edited_at timestamptz");
    expect(MIGRATION).toContain("p_expected_body_hash text");
    expect(MIGRATION).toContain("p_expected_body_source text");
    expect(MIGRATION).toContain("p_expected_edited_by_tyler boolean");
    expect(MIGRATION).toContain("'reconsideration_held'");
    expect(MIGRATION).toContain("'initial_claim'");
    expect(MIGRATION).toContain("p_reconsideration_result = 'keep'");
    expect(MIGRATION).toContain("p_reconsideration_result = 'release'");
    expect(MIGRATION).toContain("IS DISTINCT FROM p_expected_generation_id");
    expect(MIGRATION).toContain("IS DISTINCT FROM p_expected_edited_at");
    expect(MIGRATION).toContain("current_body_hash");
    expect(MIGRATION).toContain("reconsideration_failure_count");
    const keep = MIGRATION.slice(
      MIGRATION.indexOf("IF p_reconsideration_result = 'keep'"),
      MIGRATION.indexOf("IF p_reconsideration_result = 'release'")
    );
    expect(keep).not.toContain("current_body_to_send");
    expect(keep).toContain("reconsideration_evidence");
    expect(keep).toContain("- 'reconsideration_failure_count'");
    expect(keep).toContain("- 'reconsideration_retry_after'");
    const replace = MIGRATION.slice(
      MIGRATION.indexOf("IF p_reconsideration_result IS DISTINCT FROM 'replace'"),
      MIGRATION.indexOf("IF coalesce(p_require_claim_owner, false)")
    );
    const draftUpdate = replace.indexOf("current_generation_id = p_new_generation_id");
    const rejected = replace.indexOf("IF NOT FOUND");
    const supersede = replace.indexOf("superseded_by_generation_id");
    expect(draftUpdate).toBeGreaterThan(-1);
    expect(rejected).toBeGreaterThan(draftUpdate);
    expect(supersede).toBeGreaterThan(rejected);
    const release = MIGRATION.slice(
      MIGRATION.indexOf("IF p_reconsideration_result = 'release'"),
      MIGRATION.indexOf("IF p_reconsideration_result IS DISTINCT FROM 'replace'")
    );
    expect(release).toContain("'reconsideration_failure_evidence'");
    expect(release).toContain("interval '15 minutes'");
    expect(release).toContain("interval '60 minutes'");
  });

  it("does not let an obsolete or paused occurrence call the model, and does not destroy a pause", () => {
    expect(occurrenceRevalidationDisposition({ action: "expired" })).toBe("patch_expired");
    expect(occurrenceRevalidationDisposition({
      action: "ineligible",
      reason: "no_longer_in_batch",
    })).toBe("skip_recoverable");
    expect(occurrenceRevalidationDisposition({
      action: "ineligible",
      reason: "pause_until",
    })).toBe("skip_recoverable");
    expect(occurrenceRevalidationDisposition({
      action: "ineligible",
      reason: "weekday_disabled",
    })).toBe("skip_recoverable");
    expect(occurrenceRevalidationDisposition({ action: "unresolved" })).toBe("unresolved");
    expect(occurrenceRevalidationDisposition({ action: "ready" })).toBe("proceed");
  });

  it("does not prefer a later draft when an earlier eligible delivery exists", () => {
    expect(earlierDeliveryBlocksCandidate({
      candidateUtc: "2026-01-16T14:00:00.000Z",
      now,
      earlierUtcInstants: ["2026-01-15T14:00:00.000Z"],
    })).toBe(true);
    expect(earlierDeliveryBlocksCandidate({
      candidateUtc: "2026-01-15T14:00:00.000Z",
      now,
      earlierUtcInstants: ["2026-01-14T14:00:00.000Z"],
    })).toBe(false);
  });

  it("orders fresh candidates ahead of repeated failures and earlier deliveries first", () => {
    const ordered = orderReconsiderationWork([
      { failureCount: 3, occurrence: { utcInstant: "2026-01-15T14:00:00.000Z" }, id: "soon-failing" },
      { failureCount: 0, occurrence: { utcInstant: "2026-01-15T18:00:00.000Z" }, id: "later-fresh" },
      { failureCount: 1, occurrence: { utcInstant: "2026-01-15T12:00:00.000Z" }, id: "earliest-once" },
      { failureCount: 0, occurrence: { utcInstant: "2026-01-15T15:00:00.000Z" }, id: "sooner-fresh" },
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "sooner-fresh",
      "later-fresh",
      "earliest-once",
      "soon-failing",
    ]);
  });

  it("reports the current outcome after replacement without changing the initial outcome kind", () => {
    expect(replacementOccurrenceState("intentional_space")).toBe("intentional_space");
    expect(replacementOccurrenceState(null)).toBe("generated");
    expect(MIGRATION).toContain("'initial_outcome', v_initial");
    expect(MIGRATION).toContain("expected_state");
    expect(MIGRATION).toContain("expected_generation_id");
    expect(MIGRATION).toContain("expected_edited_at");
    expect(MIGRATION).toContain("v_draft.current_generation_id");
    const fence = MIGRATION.slice(
      MIGRATION.indexOf("IF v_allow AND v_patch ? 'expected_generation_id'"),
      MIGRATION.indexOf("v_merged := v_cur || v_patch")
    );
    expect(fence).toContain("FOR UPDATE");
    expect(fence).toContain("IS DISTINCT FROM v_patch->>'expected_generation_id'");
  });

  it("discovers a persisted timezone change and leaves an unreadable zone unresolved", () => {
    expect(authoritativeTimezoneChanged({
      evidenceTimeZone: "America/New_York",
      scheduleTimezone: "America/Chicago",
      audienceTimezone: "America/New_York",
      clerkTimezone: "America/Los_Angeles",
    })).toBe(true);
    expect(authoritativeTimezoneChanged({
      evidenceTimeZone: "America/Chicago",
      scheduleTimezone: "America/Chicago",
      audienceTimezone: "America/New_York",
      clerkTimezone: "America/Los_Angeles",
    })).toBe(false);
    expect(authoritativeTimezoneChanged({
      evidenceTimeZone: "America/New_York",
      scheduleTimezone: null,
      audienceTimezone: null,
      clerkTimezone: "America/Chicago",
    })).toBe(true);
    expect(authoritativeTimezoneChanged({
      evidenceTimeZone: "America/New_York",
      scheduleTimezone: "Not/A_Zone",
      audienceTimezone: "America/New_York",
      clerkTimezone: null,
    })).toBe("unresolved");
  });

  it("treats compliance-filled retrieval as incomplete instead of unchanged", () => {
    const compliance = Array.from({ length: MEMBER_CONVERSATION_READ_LIMIT }, () => ({
      message_sid: "SM_stop",
      raw_body: "STOP",
      received_at: "2026-01-15T02:00:00.000Z",
    }));
    const found = discoverMemberMessages({
      inboundRows: compliance,
      inboundCapped: true,
      coachRows: [],
      coachCapped: false,
    });
    expect(found.retrieval).toBe("incomplete");
    expect(compare({
      now,
      retrieval: found.retrieval,
      discovered: found.messages,
    })).toBe("unresolved");
  });

  it("does not reconsider history the packet window excludes, including on a later tick", () => {
    const empty = evidence({
      considered_source_ids: [],
      thread_oldest_sent_at: null,
      omitted_older_turn_count: 0,
      thread_message_count: 0,
      thread_tail: null,
      conversation_read_at: "2026-01-15T02:00:00.000Z",
    });
    const old = [{
      sourceId: "SM_old",
      sender: "user" as const,
      sentAtUtc: "2025-12-01T12:00:00.000Z",
      receivedAtUtc: "2025-12-01T12:00:00.000Z",
    }];
    expect(compare({ now, considered: empty, discovered: old })).toBe("unchanged");
    expect(compare({
      now,
      considered: empty,
      failedAttempt: empty,
      discovered: old,
      retryAfter: "2026-01-15T03:10:00.000Z",
    })).toBe("backoff");
  });

  it("discovers a message ingested during generation and a late in-window arrival", () => {
    const considered = evidence({
      conversation_read_at: "2026-01-14T18:30:00.000Z",
      omitted_older_turn_count: 0,
    });
    expect(compare({
      now,
      considered,
      discovered: [{
        sourceId: "SM_during",
        sender: "user",
        sentAtUtc: "2026-01-14T19:00:00.000Z",
        receivedAtUtc: "2026-01-14T19:00:00.000Z",
      }],
    })).toBe("changed");
    expect(compare({
      now,
      considered,
      discovered: [{
        sourceId: "SM_late_old",
        sender: "user",
        sentAtUtc: "2026-01-14T11:00:00.000Z",
        receivedAtUtc: "2026-01-14T19:00:00.000Z",
      }],
    })).toBe("changed");
    expect(compare({
      now,
      considered: evidence({ omitted_older_turn_count: 2, conversation_read_at: "2026-01-14T18:30:00.000Z" }),
      discovered: [{
        sourceId: "SM_capped_out",
        sender: "user",
        sentAtUtc: "2026-01-14T11:00:00.000Z",
        receivedAtUtc: "2026-01-14T19:00:00.000Z",
      }],
    })).toBe("unchanged");
  });

  it("keeps identical timestamps distinct and does not reuse an inbound sid for a reply", () => {
    const tied = discoverMemberMessages({
      inboundRows: [
        { message_sid: "SM_one", raw_body: "One", received_at: "2026-01-14T18:00:00.000Z" },
        { message_sid: "SM_two", raw_body: "Two", received_at: "2026-01-14T18:00:00.000Z" },
      ],
      inboundCapped: false,
      coachRows: [{
        message_sid: "SM_one",
        outbound_message_sid: "SM_reply",
        reply_body: "Good",
        status: "sent",
        processed_at: "2026-01-14T18:05:00.000Z",
        created_at: "2026-01-14T18:05:00.000Z",
      }],
      coachCapped: false,
    });
    expect(tied.messages.map((message) => message.sourceId)).toEqual(["SM_one", "SM_two", "SM_reply"]);
    const collided = discoverMemberMessages({
      inboundRows: [],
      inboundCapped: false,
      coachRows: [{
        message_sid: "SM_one",
        reply_body: "Good",
        status: "sent",
        sent_at: "2026-01-14T18:05:00.000Z",
        processed_at: "2026-01-14T18:05:00.000Z",
        created_at: "2026-01-14T18:10:00.000Z",
      }],
      coachCapped: false,
    });
    expect(collided.messages).toEqual([]);
    expect(collided.unidentifiedReplies).toHaveLength(1);
    expect(compare({
      now,
      considered: evidence({ conversation_read_at: "2026-01-14T18:00:00.000Z" }),
      discovered: collided.messages,
      unidentifiedReplies: collided.unidentifiedReplies,
    })).toBe("unresolved");
  });

  it("excludes INFO and END the same way on both sides of proactive discovery", () => {
    const found = discoverMemberMessages({
      inboundRows: [
        { message_sid: "SM_info", raw_body: "INFO", received_at: "2026-01-14T18:00:00.000Z" },
        { message_sid: "SM_end", raw_body: "END", received_at: "2026-01-14T18:01:00.000Z" },
        { message_sid: "SM_real", raw_body: "I walked", received_at: "2026-01-14T18:02:00.000Z" },
      ],
      inboundCapped: false,
      coachRows: [],
      coachCapped: false,
    });
    expect(found.messages.map((message) => message.sourceId)).toEqual(["SM_real"]);
  });

  it("returns to the original occurrence after a reversible schedule change", () => {
    const morning = {
      batchDate: "2026-01-15",
      owner: "morning" as const,
      sendSlot: "morning" as const,
      occurrence: occurrence({
        state: "generated",
        memberLocalDate: "2026-01-15",
        utcInstant: "2026-01-15T14:00:00.000Z",
      }),
    };
    const evening = {
      batchDate: "2026-01-15",
      owner: "evening" as const,
      sendSlot: "evening_checkin" as const,
      occurrence: occurrence({
        state: "generated",
        memberLocalDate: "2026-01-15",
        utcInstant: "2026-01-15T23:00:00.000Z",
      }),
    };
    expect(chooseAuthoritativeReconsiderationCandidate({
      occurrences: [morning, evening],
      schedule: [{
        memberLocalDate: "2026-01-15",
        owner: "evening",
        batchDate: "2026-01-15",
        utcInstant: "2026-01-15T23:00:00.000Z",
      }],
      now,
    })?.sendSlot).toBe("evening_checkin");
    expect(chooseAuthoritativeReconsiderationCandidate({
      occurrences: [morning, evening],
      schedule: [{
        memberLocalDate: "2026-01-15",
        owner: "morning",
        batchDate: "2026-01-15",
        utcInstant: "2026-01-15T14:00:00.000Z",
      }],
      now,
    })?.sendSlot).toBe("morning");
    expect(chooseAuthoritativeReconsiderationCandidate({
      occurrences: [morning, evening],
      schedule: "unresolved",
      now,
    })).toBeNull();
  });

  it("does not let an obsolete earlier occurrence block a later legitimate one, or skip an earlier delivery that has no batch", () => {
    const obsolete = {
      batchDate: "2026-01-15",
      owner: "morning" as const,
      sendSlot: "morning" as const,
      occurrence: occurrence({
        state: "generated",
        memberLocalDate: "2026-01-15",
        utcInstant: "2026-01-15T14:00:00.000Z",
      }),
    };
    const later = {
      batchDate: "2026-01-16",
      owner: "morning" as const,
      sendSlot: "morning" as const,
      occurrence: occurrence({
        state: "generated",
        memberLocalDate: "2026-01-16",
        utcInstant: "2026-01-16T14:00:00.000Z",
      }),
    };
    expect(chooseAuthoritativeReconsiderationCandidate({
      occurrences: [obsolete, later],
      schedule: [{
        memberLocalDate: "2026-01-16",
        owner: "morning",
        batchDate: "2026-01-16",
        utcInstant: "2026-01-16T14:00:00.000Z",
      }],
      now,
    })?.occurrence.memberLocalDate).toBe("2026-01-16");
    expect(chooseAuthoritativeReconsiderationCandidate({
      occurrences: [later],
      schedule: [
        {
          memberLocalDate: "2026-01-15",
          owner: "morning",
          batchDate: "2026-01-15",
          utcInstant: "2026-01-15T14:00:00.000Z",
        },
        {
          memberLocalDate: "2026-01-16",
          owner: "morning",
          batchDate: "2026-01-16",
          utcInstant: "2026-01-16T14:00:00.000Z",
        },
      ],
      now,
    })).toBeNull();
    expect(listUpcomingOccurrenceCandidates(
      [batchFor("morning", "2026-01-15", [occurrence({ state: "sent", utcInstant: "2026-01-15T14:00:00.000Z" })])],
      now
    )).toEqual([]);
  });

  it("does not replace a newer Tyler edit for older conversation, and does for later member information", () => {
    const tyler = evidence({
      edited_by_tyler: true,
      edited_at: "2026-01-14T22:00:00.000Z",
      existing_body_source: "tyler_edit",
      conversation_read_at: "2026-01-14T21:00:00.000Z",
    });
    expect(compare({
      now,
      considered: tyler,
      discovered: [{
        sourceId: "SM_before_save",
        sender: "user",
        sentAtUtc: "2026-01-14T16:00:00.000Z",
        receivedAtUtc: "2026-01-14T16:00:00.000Z",
      }],
    })).toBe("unchanged");
    expect(compare({
      now,
      considered: tyler,
      discovered: [{
        sourceId: "SM_after_save",
        sender: "user",
        sentAtUtc: "2026-01-14T22:30:00.000Z",
        receivedAtUtc: "2026-01-14T22:30:00.000Z",
      }],
    })).toBe("changed");
    expect(reconsiderationAppliesKeep({ decision: "replace", preserveTylerEdit: true })).toBe(true);
    expect(reconsiderationAppliesKeep({ decision: "replace", preserveTylerEdit: false })).toBe(false);
    expect(reconsiderationAppliesKeep({ decision: "not_applicable", preserveTylerEdit: true })).toBe(false);
    expect(reconsiderationAppliesKeep({ decision: "keep" })).toBe(true);
    const policyHeld = reconsiderationRetentionEvidence({
      evidence: tyler,
      decision: "replace",
    });
    expect(policyHeld.model_existing_text_decision).toBe("replace");
    expect(policyHeld.body_retention).toBe("tyler_edit_policy");
    expect(policyHeld.succeeded).toBe(true);
    const affirmed = reconsiderationRetentionEvidence({
      evidence: tyler,
      decision: "keep",
    });
    expect(affirmed.model_existing_text_decision).toBe("keep");
    expect(affirmed.body_retention).toBe("model_keep");
    expect(compare({
      now,
      considered: tyler,
      goalText: "A different ask",
      discovered: [{
        sourceId: "SM_before_save",
        sender: "user",
        sentAtUtc: "2026-01-14T16:00:00.000Z",
        receivedAtUtc: "2026-01-14T16:00:00.000Z",
      }],
    })).toBe("changed");
  });

  it("rejects a stale generated-space-generated patch and repairs from the current draft without a model", () => {
    expect(reconsiderationOutcomePatchAllowed({
      occurrenceState: "generated",
      expectedState: "generated",
      nextState: "intentional_space",
      expectedGenerationId: "gen-a",
      currentGenerationId: "gen-c",
    })).toBe(false);
    expect(reconsiderationOutcomePatchAllowed({
      occurrenceState: "generated",
      expectedState: "generated",
      nextState: "intentional_space",
      expectedGenerationId: "gen-b",
      currentGenerationId: "gen-b",
      expectedEditedAt: null,
      currentEditedAt: "2026-01-14T22:00:00.000Z",
    })).toBe(false);
    expect(reconsiderationOutcomePatchAllowed({
      occurrenceState: "generated",
      expectedState: "generated",
      nextState: "intentional_space",
      expectedGenerationId: "gen-b",
      currentGenerationId: "gen-b",
    })).toBe(true);
    expect(dashboardOutcomeFromCurrentDraft({
      editedByTyler: false,
      bodySource: "machine",
      body: null,
      machineNoSendReason: "intentional_space",
    })).toBe("intentional_space");
    expect(dashboardRepairState({
      occurrenceState: "generated",
      draftState: "intentional_space",
    })).toBe("intentional_space");
    expect(dashboardRepairState({
      occurrenceState: "intentional_space",
      draftState: "intentional_space",
    })).toBeNull();
    expect(dashboardRepairState({
      occurrenceState: "sent",
      draftState: "generated",
    })).toBeNull();
    expect(dashboardRepairState({
      occurrenceState: "expired",
      draftState: "generated",
    })).toBeNull();
  });

  it("keeps each member's bounded conversation when discovery is one payload", () => {
    const crowded = Array.from({ length: MEMBER_CONVERSATION_READ_LIMIT }, (_, index) => ({
      clerk_user_id: "user_a",
      message_sid: `SM_a_${index}`,
      raw_body: `a ${index}`,
      received_at: "2026-01-14T18:00:00.000Z",
      created_at: "2026-01-14T18:00:00.000Z",
    }));
    const payload = {
      inbound: [
        ...crowded,
        {
          clerk_user_id: "user_b",
          message_sid: "SM_b",
          raw_body: "I walked",
          received_at: "2026-01-14T12:00:00.000Z",
          created_at: "2026-01-14T12:00:00.000Z",
        },
      ],
      coach: [],
      proactive: [],
      weekly: [],
    };
    const found = conversationsFromDiscoveryPayload(["user_a", "user_b", "user_c"], payload);
    expect(found.get("user_b")?.retrieval).toBe("ok");
    expect(found.get("user_b")?.messages.map((message) => message.sourceId)).toEqual(["SM_b"]);
    expect(found.get("user_a")?.messages.some((message) => message.sourceId === "SM_b")).toBe(false);
    expect(found.get("user_c")?.retrieval).toBe("ok");
    expect(found.get("user_c")?.messages).toEqual([]);
    expect(conversationsFromDiscoveryPayload(["user_a"], null).get("user_a")?.retrieval).toBe("failed");
    expect(conversationsFromDiscoveryPayload(["user_a"], { inbound: [] }).get("user_a")?.retrieval).toBe("failed");
    expect(MIGRATION).toContain("tto_reconsideration_conversation_discovery");
    expect(MIGRATION).toContain("row_number() OVER");
    expect(MIGRATION).toContain("PARTITION BY m.clerk_user_id");
    expect(MIGRATION).toContain("<= p_now");
    expect(MIGRATION).toContain("sms_send_events");
    expect(MIGRATION).toContain("sms_weekly_send_events");
    expect(MIGRATION).toContain("tto_save_tyler_draft_body");
    expect(MIGRATION).toContain("TO service_role");
    const weekly = conversationsFromDiscoveryPayload(["user_b"], {
      inbound: [],
      coach: [],
      proactive: [],
      weekly: [{
        clerk_user_id: "user_b",
        message_sid: "SM_weekly",
        status: "sent",
        sent_at: "2026-01-14T15:00:00.000Z",
        body: "How did the commitment go?",
      }],
    });
    expect(weekly.get("user_b")?.messages.map((message) => message.sourceId)).toEqual(["SM_weekly"]);
    expect(conversationsFromDiscoveryPayload(["user_a"], {
      inbound: [],
      coach: [],
    }).get("user_a")?.retrieval).toBe("failed");
  });
});

describe("stage 6 temporal delivery evidence", () => {
  function preference(minute: number, timeZone: string) {
    return {
      ok: true as const,
      row: {
        weekly_schedule: {
          monday: minute,
          tuesday: minute,
          wednesday: minute,
          thursday: minute,
          friday: minute,
          saturday: minute,
          sunday: minute,
        },
        schedule_timezone: timeZone,
        pause_indefinite: false,
        pause_until: null,
        cadence_override: null,
        weekend_send_policy: null,
      },
    };
  }

  function resolved(memberLocalDate: string, minute: number, timeZone: string, clerkTimezone = "America/New_York") {
    return resolveProactiveSchedule({
      preferenceRead: preference(minute, timeZone),
      clerkTimezone,
      audienceTimezone: clerkTimezone,
      memberLocalDate,
      proactiveDeliveryAllowed: true,
    });
  }

  function considered(delivery: TtoInputEvidence["delivery"]): TtoInputEvidence {
    return {
      attempt_id: "attempt",
      succeeded: true,
      considered_source_ids: ["SM-known"],
      thread_oldest_sent_at: "2026-08-05T12:00:00.000Z",
      omitted_older_turn_count: 0,
      conversation_read_at: "2026-08-05T20:00:00.000Z",
      thread_tail: null,
      goal_text: "Walk",
      existing_body_sha256: null,
      existing_body_source: "machine",
      edited_by_tyler: false,
      edited_at: null,
      delivery,
    };
  }

  it("records the scheduler minute and does not treat that same delivery as a change", () => {
    const night = resolved("2026-08-06", 23 * 60 + 45, "America/New_York");
    expect(night.kind).toBe("scheduled");
    if (night.kind !== "scheduled") return;
    expect(night.owner).toBe(SMS_DAILY_PRODUCTION_SEND_SLOT);
    expect(night.effectiveLocalMinute).toBe(23 * 60 + 45);
    expect(night.batchDate).toBe("2026-08-07");
    const metadata = buildScheduledGenerationMetadata({ scheduled: night, trigger: "automatic_schedule" });
    const delivery = scheduledDeliveryForGeneration({
      requireScheduled: true,
      metadata,
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      fallbackOwner: "morning",
      draftForDayKey: "2026-08-06",
    });
    expect(delivery).not.toBe("unresolved");
    expect(delivery).not.toBeNull();
    if (delivery == null || delivery === "unresolved") return;
    expect(formatMinute(delivery.effectiveLocalMinute)).toBe("23:45");
    const evidence = evidenceDeliveryFromSchedule(delivery);
    expect(evidence.effective_local_minute).toBe(23 * 60 + 45);
    expect(evidence.utc_instant).toBe(night.utcInstant);
    const now = new Date("2026-08-05T20:00:00.000Z");
    const base = {
      failedAttempt: null,
      discovered: [],
      retrieval: "ok" as const,
      goalText: "Walk",
      goalReadOk: true,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now,
      delivery: {
        utcInstant: night.utcInstant,
        effectiveLocalMinute: night.effectiveLocalMinute,
        timeZone: night.timeZone,
      },
    };
    expect(
      reconsiderationInputsChanged({
        ...base,
        considered: considered({
          utc_instant: null,
          member_local_date: "2026-08-06",
          batch_date: "2026-08-07",
          effective_local_minute: null,
          time_zone: "America/New_York",
          send_slot: "morning",
        }),
      })
    ).toBe("changed");
    expect(reconsiderationInputsChanged({ ...base, considered: considered(evidence) })).toBe("unchanged");
    expect(
      scheduledDeliveryForGeneration({
        requireScheduled: true,
        metadata: { ...metadata, effective_local_minute: null },
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fallbackOwner: "morning",
        draftForDayKey: "2026-08-06",
      })
    ).toBe("unresolved");
    expect(
      scheduledDeliveryForGeneration({
        requireScheduled: false,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fallbackOwner: "morning",
        draftForDayKey: "2026-08-06",
      })
    ).toBeNull();
  });

  it("keeps an explicit schedule timezone and both same-owner and cross-owner changes visible", () => {
    const chicago = resolved("2026-01-15", 14 * 60 + 15, "America/Chicago", "America/New_York");
    expect(chicago.kind).toBe("scheduled");
    if (chicago.kind !== "scheduled") return;
    expect(chicago.timeZone).toBe("America/Chicago");
    expect(chicago.effectiveLocalMinute).toBe(14 * 60 + 15);
    const pacific = resolved("2026-01-15", 7 * 60, "America/Los_Angeles", "America/New_York");
    expect(pacific.kind).toBe("scheduled");
    if (pacific.kind !== "scheduled") return;
    expect(pacific.owner).not.toBe(SMS_DAILY_PRODUCTION_SEND_SLOT);
    expect(pacific.effectiveLocalMinute).toBe(420);
    const pacificMeta = buildScheduledGenerationMetadata({
      scheduled: pacific,
      trigger: "automatic_schedule",
    });
    expect(
      scheduledDeliveryForGeneration({
        requireScheduled: true,
        metadata: pacificMeta,
        sendSlot: pacific.owner,
        fallbackOwner: "evening",
        draftForDayKey: "2026-01-15",
      })
    ).not.toBe("unresolved");
    expect(
      scheduledDeliveryForGeneration({
        requireScheduled: true,
        metadata: pacificMeta,
        sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        fallbackOwner: "morning",
        draftForDayKey: "2026-01-15",
      })
    ).toBe("unresolved");
    const moved = scheduledDeliveryForGeneration({
      requireScheduled: true,
      metadata: buildScheduledGenerationMetadata({
        scheduled: { ...chicago, effectiveLocalMinute: 14 * 60 + 30, utcInstant: chicago.utcInstant },
        trigger: "automatic_schedule",
      }),
      sendSlot: chicago.owner,
      fallbackOwner: "evening",
      draftForDayKey: "2026-01-15",
    });
    expect(moved).toBe("unresolved");
    const quarter = resolved("2026-01-15", 14 * 60 + 30, "America/Chicago", "America/New_York");
    expect(quarter.kind).toBe("scheduled");
    if (quarter.kind !== "scheduled") return;
    const accepted = scheduledDeliveryForGeneration({
      requireScheduled: true,
      metadata: buildScheduledGenerationMetadata({ scheduled: quarter, trigger: "automatic_schedule" }),
      sendSlot: quarter.owner,
      fallbackOwner: quarter.owner,
      draftForDayKey: "2026-01-15",
    });
    expect(accepted).not.toBe("unresolved");
    if (accepted == null || accepted === "unresolved") return;
    expect(accepted.effectiveLocalMinute).toBe(14 * 60 + 30);
    expect(accepted.utcInstant).toBe(quarter.utcInstant);
  });

  it("uses the resolver's daylight-saving minute and Sunday member date", () => {
    const spring = resolved("2026-03-08", 2 * 60 + 30, "America/New_York");
    expect(spring.kind).toBe("scheduled");
    if (spring.kind !== "scheduled") return;
    expect(spring.selectedLocalMinute).toBe(150);
    expect(spring.effectiveLocalMinute).toBe(180);
    const fall = resolved("2026-11-01", 90, "America/New_York");
    expect(fall.kind).toBe("scheduled");
    if (fall.kind !== "scheduled") return;
    expect(fall.effectiveLocalMinute).toBe(90);
    expect(fall.utcInstant).toBe("2026-11-01T05:30:00.000Z");
    const sunday = resolved("2026-08-09", 7 * 60, "America/New_York");
    expect(sunday.kind).toBe("scheduled");
    if (sunday.kind !== "scheduled") return;
    expect(sunday.memberLocalDate).toBe("2026-08-09");
    expect(sunday.owner).toBe(SMS_DAILY_PRODUCTION_SEND_SLOT);
  });

  it("ignores future-dated discovery rows and still sees a real new message", () => {
    const now = new Date("2026-08-05T20:00:00.000Z");
    const saved = considered({
      utc_instant: "2026-08-06T11:00:00.000Z",
      member_local_date: "2026-08-06",
      batch_date: "2026-08-06",
      effective_local_minute: 420,
      time_zone: "America/New_York",
      send_slot: "morning",
    });
    expect(
      conversationHasUnconsideredMessage(
        [{ sourceId: "SM-future", sender: "user", sentAtUtc: "2026-08-07T15:00:00.000Z" }],
        saved,
        { now }
      )
    ).toBe("same");
    expect(
      conversationHasUnconsideredMessage(
        [{ sourceId: "SM-new", sender: "user", sentAtUtc: "2026-08-05T16:00:00.000Z" }],
        saved,
        { now }
      )
    ).toBe("new");
    expect(
      conversationHasUnconsideredMessage(
        [
          {
            sourceId: "SM-late",
            sender: "user",
            sentAtUtc: "2026-08-04T16:00:00.000Z",
            receivedAtUtc: "2026-08-05T21:00:00.000Z",
          },
        ],
        { ...saved, thread_oldest_sent_at: "2026-08-05T12:00:00.000Z" },
        { now: new Date("2026-08-05T22:00:00.000Z") }
      )
    ).toBe("new");
    expect(
      conversationHasUnconsideredMessage(
        [{ sourceId: "SM-during", sender: "user", sentAtUtc: "2026-08-05T20:00:00.001Z" }],
        saved,
        { now }
      )
    ).toBe("same");
    expect(
      conversationHasUnconsideredMessage(
        [{ sourceId: "SM-before-edit", sender: "user", sentAtUtc: "2026-08-05T18:00:00.000Z" }],
        { ...saved, edited_by_tyler: true, edited_at: "2026-08-05T19:00:00.000Z" },
        { now }
      )
    ).toBe("same");
    expect(
      conversationHasUnconsideredMessage(
        [{ sourceId: "SM-dup", sender: "coach", sentAtUtc: "2026-08-05T16:00:00.000Z" }],
        {
          ...saved,
          excluded_source_ids: [{ source_id: "SM-dup", reason: "near_duplicate" }],
        },
        { now }
      )
    ).toBe("same");
    expect(
      conversationHasUnconsideredMessage(
        [{ sourceId: "SM-budget", sender: "coach", sentAtUtc: "2026-08-05T16:00:00.000Z" }],
        {
          ...saved,
          excluded_source_ids: [{ source_id: "SM-budget", reason: "character_budget" }],
        },
        { now }
      )
    ).toBe("same");
    expect(
      conversationHasUnconsideredMessage(
        [{ sourceId: "SM-after-edit", sender: "user", sentAtUtc: "2026-08-05T19:30:00.000Z" }],
        { ...saved, edited_by_tyler: true, edited_at: "2026-08-05T19:00:00.000Z" },
        { now }
      )
    ).toBe("new");
  });

  it("reads the original model clock from the stored packet and not from schedule metadata", () => {
    expect(
      originalModelDeliveryFromMetadata(
        { effective_local_minute: 1425, time_zone: "America/Chicago" },
        false
      )
    ).toEqual({ status: "unavailable", describes_saved_body: false, message_for: null });
    const known = originalModelDeliveryFromMetadata(
      {
        morning_relationship_packet_v1: {
          message_for: {
            timezone: "America/New_York",
            local_date: "2026-08-06",
            local_weekday: "Thursday",
            daypart: "morning",
            intended_receive_time_local: "07:00",
          },
        },
      },
      true
    );
    expect(known.status).toBe("known");
    expect(known.describes_saved_body).toBe(false);
    expect(known.message_for?.intended_receive_time_local).toBe("07:00");
    expect(known.message_for?.timezone).toBe("America/New_York");
  });

  it("evaluates the coaching ask and pending resolution at generation time", () => {
    const now = Date.parse("2026-08-05T20:00:00.000Z");
    const row = {
      behavior_statement: "Walk",
      adaptive_ask_text: "Walk one block",
      adaptive_ask_expires_at: "2026-08-06T04:00:00.000Z",
      pending_resolution_kind: "commitment_tighten",
      pending_resolution_created_at: "2026-08-05T12:00:00.000Z",
      pending_resolution_expires_at: "2026-08-06T04:00:00.000Z",
      pending_resolution_payload: null,
    } as never;
    expect(getEffectiveCoachingAsk(row, now)).toBe("Walk one block");
    expect(isPendingResolutionExpired(row, now)).toBe(false);
    expect(getEffectiveCoachingAsk(row, Date.parse("2026-08-06T11:00:00.000Z"))).toBe("Walk");
    expect(isPendingResolutionExpired(row, Date.parse("2026-08-06T11:00:00.000Z"))).toBe(true);
  });

  it("lets a known Tyler-edit delivery difference authorize replacement and keeps an unavailable context uncertain", () => {
    const morning = {
      memberLocalDate: "2026-08-06",
      effectiveLocalMinute: 7 * 60,
      timeZone: "America/New_York",
      utcInstant: "2026-08-06T11:00:00.000Z",
      owner: "morning",
    };
    const evening = {
      ...morning,
      effectiveLocalMinute: 20 * 60,
      utcInstant: "2026-08-07T00:00:00.000Z",
      owner: "evening_checkin",
    };
    const context = {
      status: "known" as const,
      member_local_date: morning.memberLocalDate,
      effective_local_minute: morning.effectiveLocalMinute,
      time_zone: morning.timeZone,
      utc_instant: morning.utcInstant,
      owner: morning.owner,
      body_hash: "abc",
      generation_id: "gen",
      edited_at: "2026-08-05T22:00:00.000Z",
    };
    expect(tylerEditDeliveryMateriallyDiffers({
      context,
      currentBodyHash: "abc",
      current: evening,
    })).toBe(true);
    expect(tylerEditDeliveryMateriallyDiffers({
      context,
      currentBodyHash: "abc",
      current: morning,
    })).toBe(false);
    expect(tylerEditDeliveryMateriallyDiffers({
      context: { ...context, status: "unavailable" },
      currentBodyHash: "abc",
      current: evening,
    })).toBe(false);
    expect(tylerEditDeliveryMateriallyDiffers({
      context,
      currentBodyHash: "other",
      current: evening,
    })).toBe(false);
    const evidence = considered({
      utc_instant: morning.utcInstant,
      member_local_date: morning.memberLocalDate,
      batch_date: morning.memberLocalDate,
      effective_local_minute: morning.effectiveLocalMinute,
      time_zone: morning.timeZone,
      send_slot: "morning",
    });
    expect(reconsiderationInputsChanged({
      considered: evidence,
      failedAttempt: null,
      discovered: [],
      retrieval: "ok",
      goalText: evidence.goal_text,
      goalReadOk: true,
      delivery: {
        utcInstant: evening.utcInstant,
        effectiveLocalMinute: evening.effectiveLocalMinute,
        timeZone: evening.timeZone,
      },
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now: new Date("2026-08-05T22:00:00.000Z"),
    })).toBe("changed");
    const retained = reconsiderationRetentionEvidence({
      evidence,
      decision: "replace",
      deliveryMismatchUnresolved: true,
    });
    expect(retained.body_retention).toBe("tyler_edit_policy");
    expect(retained.model_existing_text_decision).toBe("replace");
    expect(retained.delivery_mismatch_unresolved).toBe(true);
    const affirmed = reconsiderationRetentionEvidence({ evidence, decision: "keep" });
    expect(affirmed.body_retention).toBe("model_keep");
    expect(affirmed.delivery_mismatch_unresolved).toBeUndefined();
    expect(latestAffirmedDeliveryFromMetadata({
      reconsideration_evidence: { ...affirmed, succeeded: true, existing_body_sha256: "abc" },
    }, "abc")?.effective_local_minute).toBe(7 * 60);
    expect(latestAffirmedDeliveryFromMetadata({
      reconsideration_evidence: { ...retained, succeeded: true, existing_body_sha256: "abc" },
    }, "abc")).toBeNull();
  });
});

function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

describe("stage 6 remaining body, hallway, and delivery corrections", () => {
  const now = new Date("2026-01-15T03:00:00.000Z");
  const tylerBody = {
    generation_id: "gen-1",
    body_hash: "abc",
    edited_at: "2026-01-15T01:00:00.000Z",
    body_source: "tyler_edit",
    edited_by_tyler: true,
  };
  const sameWordsLater = { ...tylerBody, edited_at: "2026-01-15T02:00:00.000Z" };
  const blank = { ...tylerBody, body_hash: null, edited_at: "2026-01-15T01:30:00.000Z" };
  const blankAgain = { ...blank, edited_at: "2026-01-15T02:30:00.000Z" };
  const machineResult = {
    generation_id: "gen-2",
    body_hash: "machine-body",
    edited_at: null,
    body_source: "machine",
    edited_by_tyler: false,
  };

  function keptEvidence() {
    return bindFinishedConsiderationEvidence({
      evidence: evidence({
        considered_source_ids: ["SM_old"],
        existing_body_sha256: "abc",
        existing_body_source: "tyler_edit",
        edited_by_tyler: true,
        edited_at: tylerBody.edited_at,
        model_existing_text_decision: "keep",
        body_retention: "model_keep",
      }),
      result: "keep",
      version: tylerBody,
    });
  }

  it("binds KEEP, identical wording, and a blank to the saved version", () => {
    const kept = keptEvidence();
    expect(evidenceApprovesCurrentBody(kept, tylerBody)).toBe(true);
    expect(evidenceApprovesCurrentBody(kept, sameWordsLater)).toBe(false);
    expect(latestAffirmedDeliveryFromMetadata({
      reconsideration_evidence: kept,
    }, "abc", sameWordsLater)).toBeNull();
    expect(latestAffirmedDeliveryFromMetadata({
      reconsideration_evidence: kept,
    }, "abc", tylerBody)?.effective_local_minute).toBe(540);
    const blankKept = bindFinishedConsiderationEvidence({
      evidence: evidence({
        existing_body_sha256: null,
        existing_body_source: "tyler_edit",
        edited_by_tyler: true,
        edited_at: blank.edited_at,
        body_retention: "model_keep",
        model_existing_text_decision: "keep",
      }),
      result: "keep",
      version: blank,
    });
    expect(evidenceApprovesCurrentBody(blankKept, blank)).toBe(true);
    expect(evidenceApprovesCurrentBody(blankKept, blankAgain)).toBe(false);
    const detached = { ...kept, current_body_approval: false as const };
    expect(successfulConsiderationEvidence({
      reconsideration_evidence: detached,
    })?.considered_source_ids).toEqual(["SM_old"]);
    expect(evidenceApprovesCurrentBody(detached, tylerBody)).toBe(false);
    expect(conversationHasUnconsideredMessage([
      { sourceId: "SM_old", sender: "coach", sentAtUtc: "2026-01-14T18:00:00.000Z" },
    ], detached, { now })).toBe("same");
    expect(conversationHasUnconsideredMessage([
      { sourceId: "SM_new", sender: "user", sentAtUtc: "2026-01-15T02:30:00.000Z" },
    ], detached, { now })).toBe("new");
    const recopied = bindFinishedConsiderationEvidence({
      evidence: detached,
      result: "keep",
      version: sameWordsLater,
    });
    expect(recopied.current_body_approval).toBe(false);
    expect(recopied.applies_to_body_version).toEqual(kept.applies_to_body_version);
  });

  it("keeps REPLACE on the resulting body and drops a RELEASE after the body changes", () => {
    const replaced = bindFinishedConsiderationEvidence({
      evidence: evidence({
        existing_body_sha256: "prior-body",
        model_existing_text_decision: "replace",
      }),
      result: "replace",
      version: machineResult,
    });
    expect(replaced.existing_body_sha256).toBe("prior-body");
    expect(replaced.applies_to_body_version).toEqual(machineResult);
    expect(evidenceApprovesCurrentBody(replaced, machineResult)).toBe(true);
    expect(latestAffirmedDeliveryFromMetadata({
      reconsideration_evidence: replaced,
    }, "machine-body", machineResult)).toBeNull();
    expect(successfulConsiderationEvidence({
      reconsideration_evidence: replaced,
    })?.considered_source_ids).toEqual(["SM_coach_1"]);
    const released = bindFinishedConsiderationEvidence({
      evidence: evidence({ succeeded: false, retrieval_failed: false }),
      result: "release",
      version: tylerBody,
    });
    expect(released.current_body_approval).toBe(false);
    expect(failureAppliesToCurrentBody(released, tylerBody)).toBe(true);
    expect(failureAppliesToCurrentBody(released, sameWordsLater)).toBe(false);
  });

  it("shows an earlier KEEP as knowledge and not as approval of a newer body", () => {
    const kept = keptEvidence();
    expect(formatReconsiderationRecord({
      reconsideration_evidence: kept,
    })).toContain("affirmative model KEEP");
    expect(formatReconsiderationRecord({
      current_body_version: sameWordsLater,
      reconsideration_evidence: { ...kept, current_body_approval: false },
    })).toBe("An earlier consideration does not approve the current body. Not send authorization.");
    expect(formatReconsiderationRecord({
      current_body_version: sameWordsLater,
      reconsideration_failure_evidence: {
        succeeded: false,
        applies_to_body_version: tylerBody,
      },
    })).toBe("An earlier failure does not apply to the current body.");
  });

  it("records an observed exclusion and refuses an unobserved discovery identity", () => {
    expect(unobservedDiscoverySourceIds({
      discoveredSourceIds: ["SM_kept", "SM_capped"],
      consideredSourceIds: ["SM_kept"],
      excludedSourceIds: [{ source_id: "SM_capped" }],
    })).toEqual([]);
    expect(unobservedDiscoverySourceIds({
      discoveredSourceIds: ["SM_kept", "SM_missing"],
      consideredSourceIds: ["SM_kept"],
      excludedSourceIds: [],
    })).toEqual(["SM_missing"]);
  });

  it("backs off an identical incomplete retrieval and still notices a new message", () => {
    const failed = evidence({
      succeeded: false,
      retrieval_failed: true,
      considered_source_ids: [],
      retrieval_unavailable_source_ids: ["SM_missing"],
      thread_oldest_sent_at: null,
      thread_tail: null,
    });
    const base = {
      considered: evidence(),
      failedAttempt: failed,
      retrieval: "ok" as const,
      goalText: "Walk after lunch",
      goalReadOk: true,
      deliveryReadOk: true,
      delivery: {
        utcInstant: "2026-01-15T14:00:00.000Z",
        effectiveLocalMinute: 540,
        timeZone: "America/New_York",
      },
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: "2026-01-15T04:00:00.000Z",
      now,
    };
    expect(reconsiderationInputsChanged({
      ...base,
      discovered: [{ sourceId: "SM_missing", sender: "user", sentAtUtc: "2026-01-15T02:00:00.000Z" }],
    })).toBe("backoff");
    expect(reconsiderationInputsChanged({
      ...base,
      discovered: [
        { sourceId: "SM_missing", sender: "user", sentAtUtc: "2026-01-15T02:00:00.000Z" },
        { sourceId: "SM_brand_new", sender: "user", sentAtUtc: "2026-01-15T02:40:00.000Z" },
      ],
    })).toBe("changed");
  });

  it("keeps the Hallway bounds and ranks packet retrieval by the effective timestamp", () => {
    expect(MORNING_TTO_THREAD_WINDOW_DAYS).toBe(21);
    expect(MORNING_TTO_THREAD_MAX_MESSAGES).toBe(30);
    expect(MORNING_TTO_THREAD_MAX_TOTAL_CHARS).toBe(12000);
    const discovery = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.tto_reconsideration_conversation_discovery"));
    expect(discovery).toContain("p_mode text DEFAULT 'discovery'");
    expect(discovery).toContain("THEN 120");
    expect(discovery).toContain("THEN 300");
    expect(discovery).toContain("LEAST(GREATEST(coalesce(p_limit, 30), 1), 30)");
    expect(discovery).toContain("DESC NULLS LAST");
    expect(discovery).toContain("<= p_now");
    expect(discovery).toContain("NULLIF(to_jsonb(j)->>'processed_at', '')");
    expect(discovery).toContain("NULLIF(to_jsonb(e)->>'sent_at', '')");
    const save = MIGRATION.slice(
      MIGRATION.indexOf("CREATE FUNCTION public.tto_save_tyler_draft_body"),
      MIGRATION.indexOf("REVOKE ALL ON FUNCTION public.tto_save_tyler_draft_body")
    );
    expect(save).toContain("'current_body_approval', false");
    expect(save).toContain("- 'reconsideration_failure_evidence'");
    expect(save).toContain("- 'reconsideration_retry_after'");
    expect(save).toContain("applies_to_body_version");
    expect(save).not.toContain("morning_relationship_packet_v1");
    const thread = readFileSync(join(process.cwd(), "src/lib/sms-recent-exact-thread-72h.ts"), "utf8");
    const packetAt = thread.indexOf("if (useScheduledPacketRetrieval)");
    const elseAt = thread.indexOf("} else {", packetAt);
    const packetBranch = thread.slice(packetAt, elseAt);
    expect(packetBranch).toContain('p_mode: "packet"');
    expect(packetBranch).toContain("retrieval_incomplete: true");
    expect(thread.slice(elseAt, elseAt + 1200)).toContain('table: "sms_inbound_messages"');
    const weekly = readFileSync(join(process.cwd(), "src/lib/weekly-tto-brief-interpreter.ts"), "utf8");
    const reactive = readFileSync(join(process.cwd(), "src/lib/inbound-pat-source-evidence.ts"), "utf8");
    expect(weekly).not.toContain("tto_reconsideration_conversation_discovery");
    expect(reactive).not.toContain("tto_reconsideration_conversation_discovery");
    expect(thread).not.toContain("morning-tto-brief-interpreter");
  });

  it("accepts one coherent delivery instant and rejects a contradictory tuple", () => {
    function preference(minute: number, timeZone: string) {
      return {
        ok: true as const,
        row: {
          weekly_schedule: {
            monday: minute,
            tuesday: minute,
            wednesday: minute,
            thursday: minute,
            friday: minute,
            saturday: minute,
            sunday: minute,
          },
          schedule_timezone: timeZone,
          pause_indefinite: false,
          pause_until: null,
          cadence_override: null,
          weekend_send_policy: null,
        },
      };
    }
    function resolved(memberLocalDate: string, minute: number, timeZone: string) {
      return resolveProactiveSchedule({
        preferenceRead: preference(minute, timeZone),
        clerkTimezone: timeZone,
        audienceTimezone: timeZone,
        memberLocalDate,
        proactiveDeliveryAllowed: true,
      });
    }
    const zones = ["America/Phoenix", "Pacific/Honolulu", "America/St_Johns", "Asia/Kolkata"];
    for (const timeZone of zones) {
      const live = resolved("2026-06-15", 7 * 60, timeZone);
      expect(live.kind).toBe("scheduled");
      if (live.kind !== "scheduled") continue;
      expect(scheduledDeliveryTupleIsCoherent({
        utcInstant: live.utcInstant,
        memberLocalDate: live.memberLocalDate,
        effectiveLocalMinute: live.effectiveLocalMinute,
        timeZone: live.timeZone,
        owner: live.owner,
        administrativeBatchDate: live.batchDate,
      })).toBe(true);
      const accepted = scheduledDeliveryForGeneration({
        requireScheduled: true,
        metadata: buildScheduledGenerationMetadata({ scheduled: live, trigger: "automatic_schedule" }),
        sendSlot: live.owner,
        fallbackOwner: live.owner,
        draftForDayKey: live.memberLocalDate,
      });
      expect(accepted).not.toBe("unresolved");
      expect(accepted).not.toBeNull();
    }
    const spring = resolved("2026-03-08", 2 * 60 + 30, "America/New_York");
    expect(spring.kind).toBe("scheduled");
    if (spring.kind === "scheduled") {
      expect(spring.effectiveLocalMinute).toBe(3 * 60);
      expect(scheduledDeliveryTupleIsCoherent({
        utcInstant: spring.utcInstant,
        memberLocalDate: spring.memberLocalDate,
        effectiveLocalMinute: spring.effectiveLocalMinute,
        timeZone: spring.timeZone,
        owner: spring.owner,
        administrativeBatchDate: spring.batchDate,
      })).toBe(true);
      expect(scheduledDeliveryForGeneration({
        requireScheduled: false,
        metadata: buildScheduledGenerationMetadata({
          scheduled: { ...spring, effectiveLocalMinute: 2 * 60 + 30 },
          trigger: "automatic_schedule",
        }),
        sendSlot: spring.owner,
        fallbackOwner: spring.owner,
        draftForDayKey: spring.memberLocalDate,
      })).toBe("unresolved");
    }
    const fallback = resolved("2026-11-01", 1 * 60 + 30, "America/New_York");
    expect(fallback.kind).toBe("scheduled");
    if (fallback.kind === "scheduled") {
      expect(scheduledDeliveryTupleIsCoherent({
        utcInstant: fallback.utcInstant,
        memberLocalDate: fallback.memberLocalDate,
        effectiveLocalMinute: fallback.effectiveLocalMinute,
        timeZone: fallback.timeZone,
        owner: fallback.owner,
        administrativeBatchDate: fallback.batchDate,
      })).toBe(true);
      const later = new Date(Date.parse(fallback.utcInstant) + 60 * 60 * 1000).toISOString();
      expect(scheduledDeliveryForGeneration({
        requireScheduled: true,
        metadata: buildScheduledGenerationMetadata({
          scheduled: { ...fallback, utcInstant: later },
          trigger: "automatic_schedule",
        }),
        sendSlot: fallback.owner,
        fallbackOwner: fallback.owner,
        draftForDayKey: fallback.memberLocalDate,
      })).toBe("unresolved");
    }
    expect(originalModelDeliveryFromMetadata({
      morning_relationship_packet_v1: {
        message_for: {
          timezone: "America/New_York",
          local_date: "2026-01-15",
          local_weekday: "Thursday",
          daypart: "morning",
          intended_receive_time_local: "07:00",
          utc_instant: "2026-01-15T12:00:00.000Z",
        },
      },
    }, false).message_for?.intended_receive_time_local).toBe("07:00");
  });
});

describe("edit-context reconsideration gate", () => {
  const now = new Date("2026-08-06T18:00:00.000Z");
  const morningMinute = 7 * 60;
  const eveningMinute = 20 * 60;
  const morningUtc = "2026-08-06T11:00:00.000Z";
  const eveningUtc = "2026-08-07T00:00:00.000Z";
  const oldBody = {
    generation_id: "gen-1",
    body_hash: "machine-body",
    edited_at: null,
    body_source: "machine",
    edited_by_tyler: false,
  };
  const newerEdit = {
    generation_id: "gen-1",
    body_hash: "tyler-body",
    edited_at: "2026-08-06T16:00:00.000Z",
    body_source: "tyler_edit",
    edited_by_tyler: true,
  };
  const sameWordsLater = { ...newerEdit, edited_at: "2026-08-06T17:00:00.000Z" };
  const blankEdit = { ...newerEdit, body_hash: null };
  const replacement = {
    generation_id: "gen-2",
    body_hash: "replacement-body",
    edited_at: null,
    body_source: "machine",
    edited_by_tyler: false,
  };

  function facts(minute: number, utc: string) {
    return {
      memberLocalDate: "2026-08-06",
      effectiveLocalMinute: minute,
      timeZone: "America/New_York",
      utcInstant: utc,
      owner: minute < 10 * 60 ? "morning" : "evening_checkin",
    };
  }

  function delivery(minute: number, utc: string) {
    return {
      utc_instant: utc,
      member_local_date: "2026-08-06",
      batch_date: "2026-08-06",
      effective_local_minute: minute,
      time_zone: "America/New_York",
      send_slot: minute < 10 * 60 ? "morning" : "evening_checkin",
      preference_updated_at: "2026-08-06T15:00:00.000Z",
    };
  }

  function contextFor(
    version: TtoBodyVersion,
    minute: number,
    utc: string,
    status: "known" | "unavailable" = "known"
  ): TtoEditDeliveryContext {
    return {
      status,
      member_local_date: "2026-08-06",
      effective_local_minute: minute,
      time_zone: "America/New_York",
      utc_instant: utc,
      owner: minute < 10 * 60 ? "morning" : "evening_checkin",
      body_hash: version.body_hash,
      generation_id: version.generation_id,
      edited_at: version.edited_at,
    };
  }

  function kept(version: TtoBodyVersion, minute: number, utc: string) {
    return bindFinishedConsiderationEvidence({
      evidence: evidence({
        considered_source_ids: ["SM_old"],
        delivery: delivery(minute, utc),
        existing_body_sha256: version.body_hash,
        existing_body_source: version.body_source,
        edited_by_tyler: version.edited_by_tyler,
        edited_at: version.edited_at,
      }),
      result: "keep",
      version,
    });
  }

  function decide(args: {
    considered: TtoInputEvidence;
    liveMinute: number;
    liveUtc: string;
    flag: boolean;
    failedAttempt?: TtoInputEvidence | null;
    retryAfter?: string | null;
    discovered?: Array<{ sourceId: string; sender: "user" | "coach"; sentAtUtc: string }>;
  }) {
    return reconsiderationInputsChanged({
      considered: args.considered,
      failedAttempt: args.failedAttempt ?? null,
      discovered: args.discovered ?? [
        { sourceId: "SM_old", sender: "coach", sentAtUtc: "2026-08-05T12:00:00.000Z" },
      ],
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      deliveryReadOk: true,
      delivery: {
        utcInstant: args.liveUtc,
        effectiveLocalMinute: args.liveMinute,
        timeZone: "America/New_York",
      },
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: args.retryAfter ?? null,
      now,
      editContextRequiresReconsideration: args.flag,
    });
  }

  it("reconsiders a 7 AM edit after an 8 PM KEEP, and skips an edit already at 8 PM", () => {
    const eveningKeep = {
      ...kept(oldBody, eveningMinute, eveningUtc),
      current_body_approval: false as const,
    };
    const sevenAm = contextFor(newerEdit, morningMinute, morningUtc);
    const eightPm = facts(eveningMinute, eveningUtc);
    const approvedOlderBody = kept(oldBody, eveningMinute, eveningUtc);
    expect(evidenceApprovesCurrentBody(eveningKeep, newerEdit)).toBe(false);
    expect(evidenceApprovesCurrentBody(approvedOlderBody, newerEdit)).toBe(false);
    expect(currentBodyEditContextRequiresReconsideration({
      context: sevenAm,
      currentBodyHash: newerEdit.body_hash,
      current: eightPm,
      considered: approvedOlderBody,
      currentVersion: newerEdit,
    })).toBe(true);
    const approvedForMorning = kept(newerEdit, morningMinute, morningUtc);
    expect(evidenceApprovesCurrentBody(approvedForMorning, newerEdit)).toBe(true);
    expect(currentBodyEditContextRequiresReconsideration({
      context: sevenAm,
      currentBodyHash: newerEdit.body_hash,
      current: eightPm,
      considered: approvedForMorning,
      currentVersion: newerEdit,
    })).toBe(true);
    expect(currentBodyEditContextRequiresReconsideration({
      context: sevenAm,
      currentBodyHash: newerEdit.body_hash,
      current: eightPm,
      considered: eveningKeep,
      currentVersion: newerEdit,
    })).toBe(true);
    expect(decide({
      considered: eveningKeep,
      liveMinute: eveningMinute,
      liveUtc: eveningUtc,
      flag: true,
    })).toBe("changed");

    const matching = contextFor(newerEdit, eveningMinute, eveningUtc);
    expect(currentBodyEditContextRequiresReconsideration({
      context: matching,
      currentBodyHash: newerEdit.body_hash,
      current: eightPm,
      considered: eveningKeep,
      currentVersion: newerEdit,
    })).toBe(false);
    expect(decide({
      considered: eveningKeep,
      liveMinute: eveningMinute,
      liveUtc: eveningUtc,
      flag: false,
    })).toBe("unchanged");
  });

  it("stops after the exact newer body is considered for 8 PM, including after REPLACE", () => {
    const eightPm = facts(eveningMinute, eveningUtc);
    const sevenAm = contextFor(newerEdit, morningMinute, morningUtc);
    const affirmed = kept(newerEdit, eveningMinute, eveningUtc);
    expect(evidenceApprovesCurrentBody(affirmed, newerEdit)).toBe(true);
    expect(currentBodyEditContextRequiresReconsideration({
      context: sevenAm,
      currentBodyHash: newerEdit.body_hash,
      current: eightPm,
      considered: affirmed,
      currentVersion: newerEdit,
    })).toBe(false);
    expect(decide({
      considered: affirmed,
      liveMinute: eveningMinute,
      liveUtc: eveningUtc,
      flag: false,
    })).toBe("unchanged");

    const replaced = bindFinishedConsiderationEvidence({
      evidence: evidence({
        considered_source_ids: ["SM_old"],
        delivery: delivery(eveningMinute, eveningUtc),
        existing_body_sha256: newerEdit.body_hash,
        model_existing_text_decision: "replace",
      }),
      result: "replace",
      version: replacement,
    });
    expect(evidenceApprovesCurrentBody(replaced, replacement)).toBe(true);
    expect(editContextBelongsToBodyVersion(sevenAm, replacement)).toBe(false);
    expect(currentBodyEditContextRequiresReconsideration({
      context: sevenAm,
      currentBodyHash: replacement.body_hash,
      current: eightPm,
      considered: replaced,
      currentVersion: replacement,
    })).toBe(false);
    expect(decide({
      considered: replaced,
      liveMinute: eveningMinute,
      liveUtc: eveningUtc,
      flag: false,
    })).toBe("unchanged");
  });

  it("keeps backoff for the same body and still notices a newer version or message", () => {
    const eveningKeep = {
      ...kept(oldBody, eveningMinute, eveningUtc),
      current_body_approval: false as const,
    };
    const failed = evidence({
      succeeded: false,
      considered_source_ids: ["SM_old"],
      delivery: delivery(eveningMinute, eveningUtc),
      applies_to_body_version: newerEdit,
      current_body_approval: false,
    });
    expect(failureAppliesToCurrentBody(failed, newerEdit)).toBe(true);
    expect(decide({
      considered: eveningKeep,
      liveMinute: eveningMinute,
      liveUtc: eveningUtc,
      flag: true,
      failedAttempt: failed,
      retryAfter: "2026-08-06T19:00:00.000Z",
    })).toBe("backoff");
    expect(failureAppliesToCurrentBody(failed, sameWordsLater)).toBe(false);
    expect(decide({
      considered: eveningKeep,
      liveMinute: eveningMinute,
      liveUtc: eveningUtc,
      flag: true,
    })).toBe("changed");
    expect(decide({
      considered: eveningKeep,
      liveMinute: eveningMinute,
      liveUtc: eveningUtc,
      flag: false,
      discovered: [
        { sourceId: "SM_old", sender: "coach", sentAtUtc: "2026-08-05T12:00:00.000Z" },
        { sourceId: "SM_new", sender: "user", sentAtUtc: "2026-08-06T17:30:00.000Z" },
      ],
    })).toBe("changed");
  });

  it("uses the edit instant for identical wording, a blank, a restored schedule, and unavailable context", () => {
    const eightPm = facts(eveningMinute, eveningUtc);
    const sevenAmFacts = facts(morningMinute, morningUtc);
    const prior = kept(newerEdit, eveningMinute, eveningUtc);
    const laterContext = contextFor(sameWordsLater, morningMinute, morningUtc);
    expect(newerEdit.body_hash).toBe(sameWordsLater.body_hash);
    expect(editContextBelongsToBodyVersion(laterContext, newerEdit)).toBe(false);
    expect(editContextBelongsToBodyVersion(
      contextFor(newerEdit, morningMinute, morningUtc),
      sameWordsLater
    )).toBe(false);
    expect(editContextBelongsToBodyVersion(
      { ...laterContext, edited_at: "2026-08-06T17:00:00+00:00" },
      sameWordsLater
    )).toBe(true);
    expect(editContextBelongsToBodyVersion(laterContext, sameWordsLater)).toBe(true);
    expect(evidenceApprovesCurrentBody(prior, sameWordsLater)).toBe(false);
    expect(currentBodyEditContextRequiresReconsideration({
      context: laterContext,
      currentBodyHash: sameWordsLater.body_hash,
      current: eightPm,
      considered: prior,
      currentVersion: sameWordsLater,
    })).toBe(true);

    const eveningKeep = {
      ...kept(oldBody, eveningMinute, eveningUtc),
      current_body_approval: false as const,
    };
    expect(currentBodyEditContextRequiresReconsideration({
      context: contextFor(blankEdit, morningMinute, morningUtc),
      currentBodyHash: null,
      current: eightPm,
      considered: eveningKeep,
      currentVersion: blankEdit,
    })).toBe(true);
    const blankPrior = kept(blankEdit, eveningMinute, eveningUtc);
    expect(currentBodyEditContextRequiresReconsideration({
      context: contextFor(blankEdit, morningMinute, morningUtc),
      currentBodyHash: null,
      current: eightPm,
      considered: blankPrior,
      currentVersion: blankEdit,
    })).toBe(false);
    const laterBlank = { ...blankEdit, edited_at: "2026-08-06T17:30:00.000Z" };
    expect(currentBodyEditContextRequiresReconsideration({
      context: contextFor(laterBlank, morningMinute, morningUtc),
      currentBodyHash: null,
      current: eightPm,
      considered: blankPrior,
      currentVersion: laterBlank,
    })).toBe(true);

    const restored = contextFor(newerEdit, morningMinute, morningUtc);
    expect(tylerEditDeliveryMateriallyDiffers({
      context: restored,
      currentBodyHash: newerEdit.body_hash,
      current: sevenAmFacts,
    })).toBe(false);
    expect(currentBodyEditContextRequiresReconsideration({
      context: restored,
      currentBodyHash: newerEdit.body_hash,
      current: sevenAmFacts,
      considered: prior,
      currentVersion: newerEdit,
    })).toBe(false);
    expect(decide({
      considered: prior,
      liveMinute: morningMinute,
      liveUtc: morningUtc,
      flag: false,
    })).toBe("changed");

    const unavailable = contextFor(newerEdit, morningMinute, morningUtc, "unavailable");
    expect(currentBodyEditContextRequiresReconsideration({
      context: unavailable,
      currentBodyHash: newerEdit.body_hash,
      current: eightPm,
      considered: prior,
      currentVersion: newerEdit,
    })).toBe(false);
    expect(MIGRATION).toContain("v_draft.edited_at IS DISTINCT FROM p_expected_edited_at");
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    const backoffAt = scheduler.indexOf('return "backoff"');
    const flagAt = scheduler.indexOf("args.editContextRequiresReconsideration === true");
    expect(backoffAt).toBeGreaterThan(0);
    expect(flagAt).toBeGreaterThan(backoffAt);
    expect(scheduler).toContain("currentBodyEditContextRequiresReconsideration({");
    expect(scheduler).toContain("!conversationIsNew &&\n        !materialScheduleChange");
    expect(scheduler.indexOf("if (candidate.scheduleOnly && checked.action === \"ready\")")).toBeGreaterThan(
      scheduler.indexOf("scheduleOnly: reconsiderationScheduleOnly(")
    );
    expect(scheduler.indexOf("const sundayAllowsShortcut")).toBeGreaterThan(
      scheduler.indexOf("if (candidate.scheduleOnly && checked.action === \"ready\")")
    );
  });
});

describe("scheduled daily delivery authority", () => {
  const instant = "2026-01-15T14:00:00.000Z";
  const live: ScheduledProactiveText = {
    kind: "scheduled",
    memberLocalDate: "2026-01-15",
    selectedLocalMinute: 540,
    effectiveLocalMinute: 540,
    timeZone: "America/New_York",
    timeZoneSource: "schedule",
    utcInstant: instant,
    easternDate: "2026-01-15",
    easternMinute: 540,
    owner: "morning",
    batchDate: "2026-01-15",
  };

  function authorize(args: {
    now: string;
    metadata?: Record<string, unknown> | null;
    body?: string;
    editedByTyler?: boolean;
    source?: string;
    conversation?: "same" | "new" | "unresolved";
    messageRequiredToday?: boolean | null;
    machineNoSendReason?: string | null;
    occurrenceState?: "generated" | "pending" | "claimed" | "failed" | "sent" | null;
    goal?: string;
  }) {
    return scheduledDailyBodyAuthorization({
      now: new Date(args.now),
      live,
      occurrenceState: args.occurrenceState ?? "generated",
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: args.body ?? "Walk after lunch.",
        bodyHash: "hash-current",
        bodySource: args.source ?? "machine",
        editedByTyler: args.editedByTyler === true,
        editedAt: args.editedByTyler ? "2026-01-15T13:00:00.000Z" : null,
      },
      machineShouldSend: args.machineNoSendReason ? false : true,
      machineNoSendReason: args.machineNoSendReason ?? null,
      messageRequiredToday: args.messageRequiredToday ?? null,
      metadata: args.metadata === undefined ? {
        scheduled_generation_convention: "member_local_delivery_v1",
        input_evidence: evidence({ succeeded: false, current_body_approval: undefined }),
      } : args.metadata,
      currentGoal: args.goal ?? "Walk after lunch",
      goalReadOk: true,
      conversation: args.conversation ?? "same",
      retrievalOk: args.conversation !== "unresolved",
    });
  }

  it("delivers only inside the 15-minute grace and never across the member-local date", () => {
    expect(evaluateScheduledDeliveryGrace({
      now: new Date("2026-01-15T13:59:59.000Z"),
      utcInstant: instant,
      memberLocalDate: "2026-01-15",
      timeZone: "America/New_York",
    })).toEqual({ due: false, reason: "before_instant" });
    expect(evaluateScheduledDeliveryGrace({
      now: new Date(instant),
      utcInstant: instant,
      memberLocalDate: "2026-01-15",
      timeZone: "America/New_York",
    }).due).toBe(true);
    expect(evaluateScheduledDeliveryGrace({
      now: new Date("2026-01-15T14:14:59.000Z"),
      utcInstant: instant,
      memberLocalDate: "2026-01-15",
      timeZone: "America/New_York",
    }).due).toBe(true);
    expect(evaluateScheduledDeliveryGrace({
      now: new Date("2026-01-15T14:15:00.000Z"),
      utcInstant: instant,
      memberLocalDate: "2026-01-15",
      timeZone: "America/New_York",
    })).toEqual({ due: false, reason: "grace_elapsed" });
    expect(evaluateScheduledDeliveryGrace({
      now: new Date("2026-01-16T05:01:00.000Z"),
      utcInstant: "2026-01-16T04:50:00.000Z",
      memberLocalDate: "2026-01-15",
      timeZone: "America/New_York",
    })).toEqual({ due: false, reason: "member_local_date_rolled" });
  });

  it("uses the resolved spring-forward instant and does not send before it", () => {
    const sunday = {
      monday: null, tuesday: null, wednesday: null, thursday: null, friday: null,
      saturday: null, sunday: 150,
    };
    const resolved = resolveProactiveSchedule({
      preferenceRead: {
        ok: true,
        row: {
          weekly_schedule: sunday,
          schedule_timezone: "America/Los_Angeles",
          pause_indefinite: false,
          pause_until: null,
          cadence_override: null,
          weekend_send_policy: "weekdays_only",
        },
      },
      clerkTimezone: "America/New_York",
      audienceTimezone: "America/Chicago",
      memberLocalDate: "2026-03-08",
      proactiveDeliveryAllowed: true,
    });
    expect(resolved.kind).toBe("scheduled");
    if (resolved.kind !== "scheduled") return;
    expect(resolved.timeZone).toBe("America/Los_Angeles");
    expect(resolved.effectiveLocalMinute).toBeGreaterThan(150);
    expect(evaluateScheduledDeliveryGrace({
      now: new Date(Date.parse(resolved.utcInstant) - 1000),
      utcInstant: resolved.utcInstant,
      memberLocalDate: resolved.memberLocalDate,
      timeZone: resolved.timeZone,
    }).due).toBe(false);
    expect(evaluateScheduledDeliveryGrace({
      now: new Date(resolved.utcInstant),
      utcInstant: resolved.utcInstant,
      memberLocalDate: resolved.memberLocalDate,
      timeZone: resolved.timeZone,
    }).due).toBe(true);
  });

  it("sends an initial generation and a current-context Tyler edit without another approval", () => {
    expect(authorize({ now: instant }).action).toBe("send");
    const context = {
      status: "known",
      ...evidence().delivery,
      edited_at: "2026-01-15T13:00:00.000Z",
      body_hash: "hash-current",
      edited_by_tyler: true,
      body_source: "tyler_edit",
      generation_id: "11111111-1111-4111-8111-111111111111",
    };
    expect(authorize({
      now: instant,
      editedByTyler: true,
      source: "tyler_edit",
      metadata: {
        scheduled_generation_convention: "member_local_delivery_v1",
        input_evidence: evidence({ succeeded: false }),
        tyler_edit_delivery_context: context,
        reconsideration_evidence: {
          ...evidence({ succeeded: true, current_body_approval: true, existing_body_sha256: "older-hash" }),
        },
      },
    }).action).toBe("send");
  });

  it("refuses a newer body, an unconsidered message, unresolved context, and a mismatched retained edit", () => {
    expect(authorize({
      now: instant,
      editedByTyler: true,
      source: "tyler_edit",
      metadata: {
        input_evidence: evidence({ succeeded: false }),
        tyler_edit_delivery_context: {
          status: "known",
          edited_at: "2026-01-15T13:00:00.000Z",
          body_hash: "hash-current",
          edited_by_tyler: true,
          body_source: "tyler_edit",
          generation_id: "11111111-1111-4111-8111-111111111111",
          delivery: { ...evidence().delivery, effective_local_minute: 1200 },
        },
        reconsideration_evidence: evidence({ succeeded: true, current_body_approval: true, existing_body_sha256: "older-hash" }),
      },
    })).toMatchObject({ action: "hold", reason: "edit_context_mismatch" });
    expect(authorize({ now: instant, conversation: "new" })).toMatchObject({
      action: "hold",
      reason: "unconsidered_member_information",
    });
    expect(authorize({
      now: instant,
      editedByTyler: true,
      source: "tyler_edit",
      metadata: {
        input_evidence: evidence({ succeeded: false }),
        tyler_edit_delivery_context: { status: "unavailable" },
      },
    })).toMatchObject({ action: "hold", reason: "edit_context_unavailable" });
    expect(authorize({
      now: instant,
      metadata: {
        scheduled_generation_convention: "member_local_delivery_v1",
        input_evidence: evidence({ succeeded: false }),
        reconsideration_evidence: {
          ...evidence({ succeeded: true, current_body_approval: true }),
          body_retention: "tyler_edit_policy",
          delivery_mismatch_unresolved: true,
        },
      },
    })).toMatchObject({ action: "hold", reason: "delivery_mismatch_unresolved" });
  });

  it("treats intentional space and a Tyler blank differently from a failed or empty body", () => {
    expect(authorize({
      now: instant,
      body: "",
      machineNoSendReason: "intentional_space",
      messageRequiredToday: false,
    })).toMatchObject({ action: "silence", reason: "intentional_space" });
    expect(authorize({
      now: instant,
      body: "",
      machineNoSendReason: "intentional_space",
      messageRequiredToday: true,
    })).toMatchObject({ action: "hold", reason: "required_touch_changed" });
    expect(authorize({
      now: instant,
      body: "",
      editedByTyler: true,
      source: "tyler_edit",
    })).toMatchObject({ action: "silence", reason: "tyler_blank" });
    expect(authorize({ now: instant, body: "" })).toMatchObject({ action: "hold", reason: "missing_body" });
    expect(authorize({ now: "2026-01-15T14:20:00.000Z" })).toMatchObject({ action: "hold", reason: "grace_elapsed" });
    expect(authorize({ now: instant, occurrenceState: "sent" })).toMatchObject({ action: "hold", reason: "occurrence_sent" });
    expect(authorize({ now: instant, occurrenceState: "pending" })).toMatchObject({ action: "hold", reason: "occurrence_pending" });
  });

  it("reserves one member-local day across owners without a historical unique index", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261125150000_sms_tto_scheduled_generation.sql"),
      "utf8"
    );
    expect(sql).toContain("tto_reserve_scheduled_daily_delivery");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("twilio_send_attempted");
    expect(sql).toContain("v_kind = 'delivery'");
    expect(sql).not.toContain("CREATE UNIQUE INDEX");
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    expect(scheduler).toContain("recoverSingleMember");
    expect(scheduler).toContain("scheduledOccurrenceGraceOpen");
  });
});

describe("stage 7 reliability corrections", () => {
  const zone = "America/New_York";
  const dueInstant = "2026-11-26T14:45:00.000Z";
  const stored = {
    utcInstant: dueInstant,
    memberLocalDate: "2026-11-26",
    timeZone: zone,
    effectiveLocalMinute: 9 * 60 + 45,
  };

  it("keeps a 9:45 delivery reconsiderable and refuses it at grace expiration", () => {
    expect(scheduledDeliveryRemainsActionable({
      now: new Date("2026-11-26T14:45:00.000Z"),
      utcInstant: dueInstant,
      memberLocalDate: stored.memberLocalDate,
      timeZone: zone,
    })).toBe(true);
    expect(existingGraceDeliveryShouldContinue({
      now: new Date("2026-11-26T14:50:00.000Z"),
      live: stored,
      stored,
    })).toBe(true);
    expect(existingGraceDeliveryShouldContinue({
      now: new Date("2026-11-26T15:00:00.000Z"),
      live: stored,
      stored,
    })).toBe(false);
    expect(evaluateScheduledDeliveryGrace({
      now: new Date("2026-11-26T15:00:00.000Z"),
      utcInstant: dueInstant,
      memberLocalDate: stored.memberLocalDate,
      timeZone: zone,
    })).toEqual({ due: false, reason: "grace_elapsed" });
  });

  it("does not continue a newly selected minute that is already past", () => {
    expect(existingGraceDeliveryShouldContinue({
      now: new Date("2026-11-26T14:50:00.000Z"),
      live: { ...stored, utcInstant: "2026-11-26T12:00:00.000Z", effectiveLocalMinute: 7 * 60 },
      stored,
    })).toBe(false);
  });

  it("treats equivalent edited_at representations as the same instant and rejects malformed ones", () => {
    expect(recordedInstantsMatch("2026-01-15T13:00:00.000Z", "2026-01-15T13:00:00+00:00")).toBe(true);
    expect(recordedInstantsMatch("not-a-time", "not-a-time")).toBe(false);
    expect(recordedInstantsMatch(null, null)).toBe(true);
    expect(recordedInstantsMatch(null, "2026-01-15T13:00:00.000Z")).toBe(false);
  });

  it("refuses a nonblank body that has no hash", () => {
    const decision = scheduledDailyBodyAuthorization({
      now: new Date(dueInstant),
      live: {
        memberLocalDate: "2026-11-26",
        effectiveLocalMinute: stored.effectiveLocalMinute,
        timeZone: zone,
        utcInstant: dueInstant,
        owner: "evening_checkin",
      },
      occurrenceState: "generated",
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: "Did you read?",
        bodyHash: null,
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      machineShouldSend: true,
      machineNoSendReason: null,
      messageRequiredToday: null,
      metadata: {
        scheduled_generation_convention: "member_local_delivery_v1",
        input_evidence: {
          succeeded: false,
          goal_text: "Read",
          delivery: { utc_instant: dueInstant, effective_local_minute: stored.effectiveLocalMinute, time_zone: zone },
        },
      },
      currentGoal: "Read",
      goalReadOk: true,
      conversation: "same",
      retrievalOk: true,
    });
    expect(decision).toEqual({ action: "hold", reason: "missing_body_hash" });
  });

  it("records the shared lock, lease, release, and eligibility transitions in the unexecuted migration", () => {
    const begin = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.tto_begin_scheduled_daily_provider_attempt"));
    expect(begin.indexOf("pg_advisory_xact_lock(hashtext(p_clerk_user_id), hashtext('scheduled-daily-member'))")).toBeLessThan(
      begin.indexOf("FOR UPDATE")
    );
    expect(MIGRATION).toContain("interval '2 minutes'");
    expect(MIGRATION).toContain("member_local_delivery_v1");
    expect(MIGRATION).toContain("provider_attempt_at");
    expect(MIGRATION).toContain("tto_release_proven_pre_provider");
    expect(MIGRATION).toContain("v_cur->>'state' = 'ineligible'");
    expect(MIGRATION).toContain("p_expected_edited_at");
    const reserve = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.tto_reserve_scheduled_daily_delivery"));
    expect(reserve.indexOf("pg_advisory_xact_lock")).toBeLessThan(reserve.indexOf("FOR UPDATE"));
  });

  it("shares the generation cap and retries failed rows before delivery", () => {
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    const automatic = scheduler.slice(scheduler.indexOf("async function runAutomaticScheduledGeneration"));
    expect(automatic.indexOf("runScheduledReconsideration")).toBeLessThan(automatic.indexOf("recoverAuthoritativeOccurrences"));
    expect(scheduler).toContain("includeFailed: true");
    expect(scheduler).toContain("requiredTouchChanged");
    expect(scheduler).toContain("tto_save_tyler_draft_body");
    expect(scheduler).toContain("recoverMembersWithoutOccurrences");
  });

  it("does not transfer over a null target edit or an already evaluated source", () => {
    const source = {
      sourceDraftId: "source-draft",
      sourceGenerationId: "source-gen",
      sourceBodyHash: "hash-a",
      sourceEditedAt: "2026-11-26T15:00:00.000Z",
      sourceBodySource: "tyler_edit",
      sourceEditedByTyler: true,
    };
    expect(shouldTransferCrossOwnerSource({
      sourceIsTyler: true,
      source,
      targetIsTyler: false,
      targetEditedAt: null,
      evaluated: null,
    })).toBe(true);
    expect(shouldTransferCrossOwnerSource({
      sourceIsTyler: true,
      source,
      targetIsTyler: true,
      targetEditedAt: null,
      evaluated: null,
    })).toBe(false);
    expect(shouldTransferCrossOwnerSource({
      sourceIsTyler: true,
      source,
      targetIsTyler: true,
      targetEditedAt: "2026-11-26T16:00:00.000Z",
      evaluated: null,
    })).toBe(false);
    expect(shouldTransferCrossOwnerSource({
      sourceIsTyler: true,
      source,
      targetIsTyler: false,
      targetEditedAt: null,
      evaluated: source,
    })).toBe(false);
    expect(shouldTransferCrossOwnerSource({
      sourceIsTyler: true,
      source: { ...source, sourceEditedAt: "2026-11-26T17:00:00.000Z", sourceBodyHash: "hash-b" },
      targetIsTyler: false,
      targetEditedAt: null,
      evaluated: source,
    })).toBe(true);
    expect(shouldTransferCrossOwnerSource({
      sourceIsTyler: true,
      source: { ...source, sourceBodyHash: null, sourceBodySource: "tyler_edit" },
      targetIsTyler: false,
      targetEditedAt: null,
      evaluated: null,
    })).toBe(true);
  });

  it("treats a restored owner as pending when the other slot already replaced that edit", () => {
    const current = {
      id: "draft-morning",
      current_generation_id: "gen-morning",
      current_body_hash: "old-hash",
      edited_at: "2026-11-26T15:00:00.000Z",
      current_body_source: "tyler_edit",
      edited_by_tyler: true,
    };
    const other = {
      id: "draft-evening",
      current_generation_id: "gen-evening",
      current_body_hash: "machine-hash",
      edited_at: null,
      current_body_source: "machine",
      edited_by_tyler: false,
    };
    const drafts = new Map<string, object>([["member|2026-11-27|evening_checkin", other]]);
    const generationMeta = new Map<string, Record<string, unknown>>([
      ["gen-evening", {
        reconsideration_evidence: {
          succeeded: true,
          evaluated_cross_owner_source: {
            sourceDraftId: "draft-morning",
            sourceGenerationId: "gen-morning",
            sourceBodyHash: "old-hash",
            sourceEditedAt: "2026-11-26T15:00:00.000Z",
            sourceBodySource: "tyler_edit",
            sourceEditedByTyler: true,
          },
        },
      }],
    ]);
    expect(crossOwnerActionForCandidate({
      clerkUserId: "member",
      memberLocalDate: "2026-11-27",
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      draft: current,
      drafts,
      generationMeta,
    })).toEqual({ transfer: false, moveBack: true });
    generationMeta.set("gen-morning", {
      reconsideration_evidence: {
        succeeded: true,
        current_body_approval: true,
        applies_to_body_version: {
          generation_id: "gen-morning",
          body_hash: "old-hash",
          edited_at: "2026-11-26T15:00:00.000Z",
          body_source: "tyler_edit",
          edited_by_tyler: true,
        },
      },
    });
    expect(crossOwnerActionForCandidate({
      clerkUserId: "member",
      memberLocalDate: "2026-11-27",
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      draft: current,
      drafts,
      generationMeta,
    })).toEqual({ transfer: false, moveBack: false });
    expect(crossOwnerActionForCandidate({
      clerkUserId: "member",
      memberLocalDate: "2026-11-27",
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      draft: {
        ...current,
        current_generation_id: "gen-replaced",
        current_body_hash: "replacement-hash",
        current_body_source: "machine",
        edited_by_tyler: false,
        edited_at: null,
      },
      drafts,
      generationMeta,
    })).toEqual({ transfer: false, moveBack: false });
    expect(crossOwnerActionForCandidate({
      clerkUserId: "member",
      memberLocalDate: "2026-11-27",
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      draft: current,
      drafts: new Map<string, object>([[
        "member|2026-11-27|evening_checkin",
        {
          ...other,
          current_body_hash: "newer-hash",
          current_body_source: "tyler_edit",
          edited_by_tyler: true,
          edited_at: "2026-11-26T18:00:00.000Z",
        },
      ]]),
      generationMeta,
    }).transfer).toBe(true);
  });

  it("uses one authoritative timezone and reserves the work cap before the claim await", () => {
    expect(authoritativeSchedulingTimezone({
      scheduleTimezone: "America/Chicago",
      clerkTimezone: "America/New_York",
      clerkReadOk: true,
      audienceTimezone: "America/Denver",
    })).toEqual({ zone: "America/Chicago", source: "schedule" });
    expect(authoritativeSchedulingTimezone({
      scheduleTimezone: null,
      clerkTimezone: "America/Denver",
      clerkReadOk: true,
      audienceTimezone: "America/New_York",
    })).toEqual({ zone: "America/Denver", source: "clerk" });
    expect(authoritativeSchedulingTimezone({
      scheduleTimezone: null,
      clerkTimezone: null,
      clerkReadOk: false,
      audienceTimezone: "America/Phoenix",
    })).toBeNull();
    expect(authoritativeSchedulingTimezone({
      scheduleTimezone: null,
      clerkTimezone: "not-a-zone",
      clerkReadOk: true,
      audienceTimezone: "Pacific/Honolulu",
    })).toEqual({ zone: "Pacific/Honolulu", source: "audience" });
    const phoenixEvening = getDateKeyInTimezone(new Date("2026-11-27T05:30:00.000Z"), "America/Phoenix");
    expect(phoenixEvening).toBe("2026-11-26");
    expect(dayKeyOffset(phoenixEvening, 1)).toBe("2026-11-27");
    const slots = { value: 7 };
    expect(reserveActualWorkSlot(slots, 8)).toBe(true);
    expect(reserveActualWorkSlot(slots, 8)).toBe(false);
    releaseActualWorkSlot(slots);
    expect(slots.value).toBe(7);
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    expect(scheduler).toContain("preserveTylerEdit: crossOwner.moveBack ? false : tylerHolds");
    expect(scheduler).toContain("transferredSource ?? evaluatedCrossOwnerSourceFromMetadata(claimedMeta)");
    const finish = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"), "utf8");
    expect(finish).toContain('args.result === "keep" && args.fence.transferredSourceEdit');
  });

  it("locks batch before draft, fences both versions, and discovers tomorrow", () => {
    const begin = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.tto_begin_scheduled_daily_provider_attempt"));
    const beginEnd = begin.indexOf("CREATE FUNCTION public.tto_abort_scheduled_daily_reservation");
    const beginBody = begin.slice(0, beginEnd);
    const batchLock = beginBody.indexOf("FROM public.sms_tto_generation_batches");
    const draftLock = beginBody.indexOf("FROM public.sms_daily_drafts");
    expect(batchLock).toBeGreaterThan(beginBody.indexOf("pg_advisory_xact_lock"));
    expect(draftLock).toBeGreaterThan(batchLock);
    expect(beginBody.indexOf("clock_timestamp()")).toBeGreaterThan(beginBody.indexOf("pg_advisory_xact_lock"));
    expect(beginBody).toContain("lease_expired");
    expect(beginBody).toContain("competing_reservation");
    expect(beginBody).toContain("member_local_date_rolled");
    expect(beginBody).toContain("cross_owner_changed");
    expect(beginBody).toContain("p_other_slot_fence");
    const save = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.tto_save_tyler_draft_body"));
    expect(save).toContain("p_transfer_fence jsonb");
    expect(save).toContain("IS DISTINCT FROM v_fence_edited");
    expect(save).toContain("cross_owner_source_edit");
    expect(MIGRATION).toContain("'execution_expired'");
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    const recovery = scheduler.slice(scheduler.indexOf("async function recoverMembersWithoutOccurrences"));
    expect(recovery).toContain("dayKeyOffset(todayKey, 1)");
    expect(recovery.indexOf("authoritativeSchedulingTimezone")).toBeLessThan(recovery.indexOf("getDateKeyInTimezone"));
    expect(scheduler).toContain("reserveActualWorkSlot");
    expect(scheduler.indexOf("reserveActualWorkSlot(actualWork, workCap)")).toBeLessThan(
      scheduler.indexOf("tto_claim_scheduled_generation", scheduler.indexOf("reserveActualWorkSlot(actualWork, workCap)"))
    );
    const send = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-send.ts"), "utf8");
    const filter = send.slice(send.indexOf("export async function orderPotentiallyDueMembers"));
    expect(filter).toContain("listClerkUsersByIds");
    expect(filter).toContain("if (!scheduleZone)");
    expect(send).toContain("beforeCreate");
    expect(send).toContain("p_reason: \"draft_changed\"");
    const morning = readFileSync(join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"), "utf8");
    expect(morning).toContain("executionGate.expired = true");
    expect(morning).toContain("executionGate");
  });
});

function sundayTape(fingerprint: string, ids: string[] = ["evt-1"]): SundayContextEvidence {
  return {
    accountability_status: "loaded",
    accountability_event_ids: ids,
    accountability_fingerprint: fingerprint,
    interruption_status: "none",
    interruption_occurred_at: null,
    interruption_reason_category: null,
    interruption_resume_hint: null,
  };
}

describe("stage 8 sunday coaching", () => {
  const discovered = [
    { sourceId: "SM_coach_1", sender: "coach" as const, sentAtUtc: "2026-01-14T18:00:00.000Z" },
  ];
  const delivery = {
    utcInstant: "2026-08-09T11:00:00.000Z",
    effectiveLocalMinute: 420,
    timeZone: "America/Phoenix",
  };
  const now = new Date("2026-08-08T20:00:00.000Z");

  it("uses the intended Sunday date and clock, not generation date, Eastern date, or noon", () => {
    for (const clock of ["07:00", "15:00", "21:00"]) {
      const message = buildMorningMessageFor({
        timezone: "America/Phoenix",
        draftForDayKey: "2026-08-09",
        daypart: "morning",
        intendedReceiveTimeLocal: clock,
        utcInstant: "2026-08-09T14:00:00.000Z",
        administrativeBatchDate: "2026-08-08",
      });
      expect(message.local_date).toBe("2026-08-09");
      expect(message.local_weekday).toBe("Sunday");
      expect(message.daypart).toBe("morning");
      expect(message.intended_receive_time_local).toBe(clock);
      expect(message.timezone).toBe("America/Phoenix");
      expect(message.administrative_batch_date).toBe("2026-08-08");
      expect(message.intended_receive_time_local).not.toBe("12:00");
    }
    const monday = buildMorningMessageFor({
      timezone: "America/Phoenix",
      draftForDayKey: "2026-08-10",
      daypart: "evening",
      intendedReceiveTimeLocal: "09:00",
    });
    expect(monday.local_weekday).toBe("Monday");
    expect(weekdayLongFromLocalDayKey("2026-08-09")).toBe("Sunday");
    expect(mondayThroughSundayEnding("2026-08-09")).toEqual({
      weekStartLocalDate: "2026-08-03",
      weekEndLocalDate: "2026-08-09",
    });
    expect(mondayThroughSundayEnding("2026-08-10")).toBeNull();
  });

  it("uses the authoritative schedule timezone for the week window", () => {
    const phoenix = weeklyAccountabilityWeekUtcRange({
      weekStartLocalDate: "2026-08-03",
      weekEndLocalDate: "2026-08-09",
      timezone: "America/Phoenix",
    });
    const eastern = weeklyAccountabilityWeekUtcRange({
      weekStartLocalDate: "2026-08-03",
      weekEndLocalDate: "2026-08-09",
      timezone: "America/New_York",
    });
    expect(phoenix?.weekStartUtcIso).not.toBe(eastern?.weekStartUtcIso);
  });

  it("drops future events before the cap and keeps the newest 50 in chronological order", () => {
    const past = { id: "past", occurred_at: "2026-08-04T15:00:00.000Z" };
    const future = Array.from({ length: 50 }, (_, index) => ({
      id: `future-${index}`,
      occurred_at: "2026-08-09T18:00:00.000Z",
    }));
    const selected = selectAccountabilityEventsBeforeCap(
      [...future, past],
      Date.parse("2026-08-08T20:00:00.000Z"),
      50
    );
    expect(selected).toEqual([past]);

    const history = Array.from({ length: 51 }, (_, index) => ({
      id: `evt-${String(index).padStart(2, "0")}`,
      occurred_at: new Date(Date.parse("2026-08-03T12:00:00.000Z") + index * 60_000).toISOString(),
    }));
    const newest = selectAccountabilityEventsBeforeCap(
      history,
      Date.parse("2026-08-08T20:00:00.000Z"),
      50
    );
    expect(newest).toHaveLength(50);
    expect(newest[0]?.id).toBe("evt-01");
    expect(newest[49]?.id).toBe("evt-50");
    expect(newest.map((event) => event.occurred_at)).toEqual(
      [...newest.map((event) => event.occurred_at)].sort()
    );
    const tied = selectAccountabilityEventsBeforeCap(
      [
        { id: "a", occurred_at: "2026-08-08T18:00:00.000Z" },
        { id: "b", occurred_at: "2026-08-08T18:00:00.000Z" },
      ],
      Date.parse("2026-08-08T20:00:00.000Z"),
      1
    );
    expect(tied.map((event) => event.id)).toEqual(["b"]);
  });

  it("reconsiders a new Sunday event once and ignores an unchanged tape", () => {
    const considered = evidence({
      sunday_context: sundayTape("evt-1|user_yes|2026-08-05T15:00:00.000Z|2026-08-05|app|Walked"),
      delivery: {
        utc_instant: delivery.utcInstant,
        member_local_date: "2026-08-09",
        batch_date: "2026-08-08",
        effective_local_minute: delivery.effectiveLocalMinute,
        time_zone: delivery.timeZone,
        send_slot: "morning",
      },
    });
    const base = {
      considered,
      failedAttempt: null,
      discovered,
      retrieval: "ok" as const,
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now,
    };
    expect(reconsiderationInputsChanged({
      ...base,
      sundayNow: sundayTape("evt-1|user_yes|2026-08-05T15:00:00.000Z|2026-08-05|app|Walked"),
    })).toBe("unchanged");
    expect(reconsiderationInputsChanged({
      ...base,
      sundayNow: sundayTape("evt-2|user_yes|2026-08-08T18:00:00.000Z|2026-08-08|app|Again", ["evt-2"]),
    })).toBe("changed");
    expect(reconsiderationInputsChanged({
      ...base,
      sundayNow: "not_sunday",
    })).toBe("unchanged");
    const sameTape = sundayTape("evt-1|user_yes|2026-08-05T15:00:00.000Z|2026-08-05|app|Walked");
    expect(reconsiderationInputsChanged({
      ...base,
      failedAttempt: evidence({ sunday_context: sameTape, delivery: considered.delivery }),
      retryAfter: "2026-08-08T21:00:00.000Z",
      sundayNow: sameTape,
    })).toBe("backoff");
    expect(reconsiderationInputsChanged({
      ...base,
      failedAttempt: evidence({ sunday_context: sameTape, delivery: considered.delivery }),
      retryAfter: "2026-08-08T21:00:00.000Z",
      sundayNow: sundayTape("evt-2|user_yes|2026-08-08T18:00:00.000Z|2026-08-08|app|Again", ["evt-2"]),
    })).toBe("changed");
    expect(reconsiderationInputsChanged({
      ...base,
      sundayNow: {
        ...sundayTape("evt-1"),
        accountability_status: "unavailable",
      },
    })).toBe("unresolved");
    expect(sundayContextChanged({
      considered: sundayTape("evt-1"),
      current: { ...sundayTape("evt-1"), interruption_status: "unavailable" },
    })).toBe("unresolved");
    expect(sundayContextChanged({
      considered: sundayTape("evt-1"),
      current: {
        ...sundayTape("evt-1"),
        interruption_status: "active",
        interruption_occurred_at: "2026-08-06T12:00:00.000Z",
        interruption_reason_category: "travel",
        interruption_resume_hint: "until monday",
      },
    })).toBe("changed");
  });

  it("holds a stale Sunday body and still allows intentional space and a Tyler blank when Sunday evidence is unchanged", () => {
    const tape = sundayTape("evt-1|user_yes|2026-08-05T15:00:00.000Z|2026-08-05|app|Walked");
    const live = {
      utcInstant: delivery.utcInstant,
      effectiveLocalMinute: delivery.effectiveLocalMinute,
      timeZone: delivery.timeZone,
      memberLocalDate: "2026-08-09",
      owner: "morning",
    };
    const metadata = {
      scheduled_generation_convention: "member_local_delivery_v1",
      input_evidence: evidence({
        succeeded: false,
        sunday_context: tape,
        delivery: {
          utc_instant: live.utcInstant,
          member_local_date: live.memberLocalDate,
          batch_date: "2026-08-08",
          effective_local_minute: live.effectiveLocalMinute,
          time_zone: live.timeZone,
          send_slot: "morning",
        },
      }),
    };
    const common = {
      now: new Date(delivery.utcInstant),
      live,
      occurrenceState: "generated" as const,
      machineShouldSend: true,
      machineNoSendReason: null,
      messageRequiredToday: false,
      metadata,
      currentGoal: "Walk after lunch",
      goalReadOk: true,
      conversation: "same" as const,
      retrievalOk: true,
    };
    expect(scheduledDailyBodyAuthorization({
      ...common,
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: "Walk after lunch.",
        bodyHash: "hash-current",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      sundayNow: tape,
    }).action).toBe("send");
    expect(scheduledDailyBodyAuthorization({
      ...common,
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: "Walk after lunch.",
        bodyHash: "hash-current",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      sundayNow: sundayTape("evt-new", ["evt-new"]),
    })).toEqual({ action: "hold", reason: "sunday_context_changed" });
    expect(scheduledDailyBodyAuthorization({
      ...common,
      machineShouldSend: false,
      machineNoSendReason: "intentional_space",
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: "",
        bodyHash: "hash-current",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      sundayNow: tape,
    })).toEqual({ action: "silence", reason: "intentional_space" });
    expect(scheduledDailyBodyAuthorization({
      ...common,
      machineShouldSend: false,
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: "",
        bodyHash: "hash-current",
        bodySource: "tyler_edit",
        editedByTyler: true,
        editedAt: "2026-08-08T18:00:00.000Z",
      },
      sundayNow: tape,
    })).toEqual({ action: "silence", reason: "tyler_blank" });
    expect(scheduledDailyBodyAuthorization({
      ...common,
      machineShouldSend: false,
      machineNoSendReason: "intentional_space",
      messageRequiredToday: true,
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: "",
        bodyHash: "hash-current",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      sundayNow: tape,
    })).toEqual({ action: "hold", reason: "required_touch_changed" });
  });

  it("disables Sunday and pauses proactive texts through the shared resolver", () => {
    const disabled = resolveProactiveSchedule({
      preferenceRead: {
        ok: true,
        row: {
          weekly_schedule: {
            monday: 420, tuesday: 420, wednesday: 420, thursday: 420, friday: 420,
            saturday: 420, sunday: null,
          },
          schedule_timezone: "America/Phoenix",
          pause_indefinite: false,
          pause_until: null,
          cadence_override: null,
          weekend_send_policy: null,
        },
      },
      clerkTimezone: "America/New_York",
      audienceTimezone: "America/Chicago",
      memberLocalDate: "2026-08-09",
      proactiveDeliveryAllowed: true,
    });
    expect(disabled).toMatchObject({ kind: "unscheduled", reason: "weekday_disabled" });
    const paused = resolveProactiveSchedule({
      preferenceRead: {
        ok: true,
        row: {
          weekly_schedule: null,
          schedule_timezone: "America/Phoenix",
          pause_indefinite: true,
          pause_until: null,
          cadence_override: null,
          weekend_send_policy: null,
        },
      },
      clerkTimezone: "America/New_York",
      audienceTimezone: "America/Chicago",
      memberLocalDate: "2026-08-09",
      proactiveDeliveryAllowed: true,
    });
    expect(paused).toMatchObject({ kind: "unscheduled", reason: "pause_indefinite" });
  });

  it("keeps Monday–Saturday free of Sunday reads and keeps historical Weekly discovery", () => {
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    const attach = readFileSync(join(process.cwd(), "src/lib/weekly-tto-relationship-packet.ts"), "utf8");
    const send = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-send.ts"), "utf8");
    const thread = readFileSync(join(process.cwd(), "src/lib/sms-recent-exact-thread-72h.ts"), "utf8");
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20261125150000_sms_tto_scheduled_generation.sql"),
      "utf8"
    );
    const feedback = readFileSync(
      join(process.cwd(), "src/app/admin/feedback/weekly-feedback-dashboard.tsx"),
      "utf8"
    );
    const interpreter = readFileSync(join(process.cwd(), "src/lib/morning-tto-brief-interpreter-v1.ts"), "utf8");
    const writer = readFileSync(join(process.cwd(), "src/lib/morning-tto-writer.ts"), "utf8");
    const attachFn = attach.slice(attach.indexOf("export async function attachSundayCoachingContext"));
    expect(attachFn.indexOf('local_weekday !== "Sunday"')).toBeLessThan(
      attachFn.indexOf("loadSundayAccountabilityTape")
    );
    expect(attachFn).not.toContain("loadWeeklyCoachingMemoryProjectionReadOnly");
    const reconsider = scheduler.slice(scheduler.indexOf("const goalReadOk = !ambiguousGoals.has"));
    expect(reconsider.indexOf('=== "Sunday"')).toBeLessThan(reconsider.indexOf("loadSundayContextForDelivery"));
    expect(send.indexOf('=== "Sunday"')).toBeLessThan(send.indexOf("await loadSundayContextForDelivery"));
    expect(thread).toContain("sms_weekly_send_events");
    expect(migration).toContain("sms_weekly_send_events");
    expect(migration).toContain("'weekly'");
    expect(feedback).toContain("/api/admin/weekly-feedback-digest");
    expect(feedback).not.toContain("weekly-generate");
    expect(interpreter).toContain("A recent member message, an unresolved need, or an urgent circumstance may take precedence.");
    expect(interpreter).toContain("Sunday is not by itself a reason to send.");
    expect(writer).toContain("Keep the ordinary daily length.");
    expect(writer).not.toContain("around noon");
  });

  it("reconsiders changed Sunday evidence through the interpreter and records that evidence", () => {
    const saturday = sundayCoaching([
      {
        id: "evt-1",
        event_type: "user_yes",
        occurred_at: "2026-08-05T15:00:00.000Z",
        local_day_key: "2026-08-05",
        source: "app",
        user_visible_proof_line: "Walked",
      },
    ]);
    const withAccomplishment = sundayCoaching([
      ...saturday.accountability_events.events,
      {
        id: "evt-2",
        event_type: "user_yes",
        occurred_at: "2026-08-08T23:00:00.000Z",
        local_day_key: "2026-08-08",
        source: "app",
        user_visible_proof_line: "Finished the walk",
      },
    ]);
    const withInterruption = sundayCoaching(saturday.accountability_events.events, {
      status: "active",
      occurred_at: "2026-08-06T12:00:00.000Z",
      reason_category: "travel",
      resume_hint: "until monday",
    });
    const initial = buildTtoInputEvidence({
      packet: sundayPacket(saturday),
      attemptId: "saturday-afternoon",
    });
    const initialSunday = sundayContextEvidenceFromCoaching(saturday);
    const accomplishment = sundayContextEvidenceFromCoaching(withAccomplishment);
    const interruption = sundayContextEvidenceFromCoaching(withInterruption);
    expect(initial.sunday_context).toEqual(initialSunday);
    expect(initial.succeeded).toBe(false);

    const considered = evidence({
      sunday_context: initialSunday,
      delivery: {
        utc_instant: delivery.utcInstant,
        member_local_date: "2026-08-09",
        batch_date: "2026-08-08",
        effective_local_minute: delivery.effectiveLocalMinute,
        time_zone: delivery.timeZone,
        send_slot: "morning",
      },
    });
    const stable = {
      moveBack: false,
      conversationIsNew: false,
      factsDifferFromEvidence: false,
      materialScheduleChange: false,
      goalUnchanged: true,
      zoneDrift: false,
    };
    expect(reconsiderationInputsChanged({
      considered,
      failedAttempt: null,
      discovered,
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now,
      sundayNow: accomplishment,
    })).toBe("changed");
    expect(reconsiderationScheduleOnly({
      ...stable,
      sundayNow: accomplishment,
      consideredSunday: initialSunday,
    })).toBe(false);
    expect(reconsiderationInputsChanged({
      considered,
      failedAttempt: null,
      discovered,
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now,
      sundayNow: interruption,
    })).toBe("changed");
    expect(reconsiderationScheduleOnly({
      ...stable,
      sundayNow: interruption,
      consideredSunday: initialSunday,
    })).toBe(false);

    const evaluated = buildTtoInputEvidence({
      packet: sundayPacket(withAccomplishment, [{
        source_id: "SM_user_evening",
        sender: "user",
        sent_at_utc: "2026-08-08T23:30:00.000Z",
        body: "I finished the walk.",
      }]),
      attemptId: "sunday-morning",
      existingBody: "Walk after lunch.",
      existingBodySource: "machine",
      delivery: {
        utc_instant: delivery.utcInstant,
        member_local_date: "2026-08-09",
        batch_date: "2026-08-08",
        effective_local_minute: delivery.effectiveLocalMinute,
        time_zone: delivery.timeZone,
        send_slot: "morning",
      },
    });
    expect(evaluated.considered_source_ids).toContain("SM_user_evening");
    expect(evaluated.sunday_context).toEqual(accomplishment);
    const affirmativeKeep = bindFinishedConsiderationEvidence({
      evidence: reconsiderationRetentionEvidence({
        evidence: evaluated,
        decision: "keep",
      }),
      result: "keep",
      version: {
        generation_id: "11111111-1111-4111-8111-111111111111",
        body_hash: "hash-current",
        edited_at: null,
        body_source: "machine",
        edited_by_tyler: false,
      },
    });
    expect(affirmativeKeep.body_retention).toBe("model_keep");
    expect(affirmativeKeep.model_existing_text_decision).toBe("keep");
    expect(affirmativeKeep.succeeded).toBe(true);
    expect(affirmativeKeep.sunday_context).toEqual(accomplishment);
    const replaced = bindFinishedConsiderationEvidence({
      evidence: { ...evaluated, succeeded: true },
      result: "replace",
      version: {
        generation_id: "22222222-2222-4222-8222-222222222222",
        body_hash: "hash-replaced",
        edited_at: null,
        body_source: "machine",
        edited_by_tyler: false,
      },
    });
    expect(replaced.succeeded).toBe(true);
    expect(replaced.sunday_context).toEqual(accomplishment);
    expect(replaced.applies_to_body_version?.generation_id).toBe("22222222-2222-4222-8222-222222222222");

    expect(reconsiderationInputsChanged({
      considered: affirmativeKeep,
      failedAttempt: null,
      discovered,
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now,
      sundayNow: accomplishment,
    })).toBe("unchanged");
    expect(reconsiderationScheduleOnly({
      ...stable,
      sundayNow: accomplishment,
      consideredSunday: affirmativeKeep.sunday_context,
    })).toBe(true);

    const duringExecution = sundayContextEvidenceFromCoaching(sundayCoaching([
      ...withAccomplishment.accountability_events.events,
      {
        id: "evt-3",
        event_type: "user_yes",
        occurred_at: "2026-08-09T12:00:00.000Z",
        local_day_key: "2026-08-09",
        source: "app",
        user_visible_proof_line: "One more block",
      },
    ]));
    expect(affirmativeKeep.sunday_context?.accountability_event_ids).not.toContain("evt-3");
    expect(reconsiderationInputsChanged({
      considered: affirmativeKeep,
      failedAttempt: null,
      discovered,
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now: new Date("2026-08-09T12:05:00.000Z"),
      sundayNow: duringExecution,
    })).toBe("changed");

    const failed = {
      ...retrievalFailureEvidence({
        claimOwnerId: "claim-1",
        expectedGenerationId: "11111111-1111-4111-8111-111111111111",
        expectedEditedAt: null,
        expectedBodyHash: "hash-current",
        expectedBodySource: "machine",
        expectedEditedByTyler: false,
        currentBody: "Walk after lunch.",
        delivery: considered.delivery,
        attemptedSundayContext: accomplishment,
      }),
      goal_text: "Walk after lunch",
    };
    expect(failed.succeeded).toBe(false);
    expect(failed.sunday_context_supplied_to_model).toBe(false);
    expect(failed.sunday_context).toEqual(accomplishment);
    expect(failed.evaluated_cross_owner_source).toBeUndefined();
    expect(reconsiderationInputsChanged({
      considered,
      failedAttempt: failed,
      discovered,
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: "2026-08-09T13:00:00.000Z",
      now: new Date("2026-08-09T12:30:00.000Z"),
      sundayNow: accomplishment,
    })).toBe("backoff");
    expect(reconsiderationInputsChanged({
      considered,
      failedAttempt: failed,
      discovered,
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: "2026-08-09T13:00:00.000Z",
      now: new Date("2026-08-09T12:30:00.000Z"),
      sundayNow: duringExecution,
    })).toBe("changed");
    const unavailableAttempt = retrievalFailureEvidence({
      claimOwnerId: "claim-1",
      expectedGenerationId: "11111111-1111-4111-8111-111111111111",
      expectedEditedAt: null,
      expectedBodyHash: "hash-current",
      expectedBodySource: "machine",
      expectedEditedByTyler: false,
      currentBody: "Walk after lunch.",
      delivery: considered.delivery,
      attemptedSundayContext: {
        ...accomplishment,
        accountability_status: "unavailable",
        accountability_event_ids: [],
        accountability_fingerprint: "",
      },
    });
    expect(unavailableAttempt.sunday_context?.accountability_status).toBe("unavailable");
    expect(unavailableAttempt.succeeded).toBe(false);

    const sourceEdit = {
      sourceDraftId: "draft-evening",
      sourceGenerationId: "33333333-3333-4333-8333-333333333333",
      sourceBodyHash: "hash-evening",
      sourceEditedAt: null,
      sourceBodySource: "tyler_edit",
      sourceEditedByTyler: true,
    };
    const transferred = reconsiderationRetentionEvidence({
      evidence: { ...evaluated, evaluated_cross_owner_source: sourceEdit },
      decision: "keep",
    });
    expect(transferred.sunday_context).toEqual(accomplishment);
    expect(transferred.evaluated_cross_owner_source).toEqual(sourceEdit);
    expect(reconsiderationScheduleOnly({
      ...stable,
      moveBack: false,
      sundayNow: accomplishment,
      consideredSunday: initialSunday,
    })).toBe(false);

    const policy = reconsiderationRetentionEvidence({
      evidence: {
        ...evaluated,
        edited_by_tyler: true,
        existing_body_source: "tyler_edit",
      },
      decision: "replace",
    });
    expect(reconsiderationAppliesKeep({ decision: "replace", preserveTylerEdit: true })).toBe(true);
    expect(policy.body_retention).toBe("tyler_edit_policy");
    expect(policy.model_existing_text_decision).toBe("replace");
    expect(policy.sunday_context).toEqual(accomplishment);

    const liveInstant = "2026-08-09T14:00:00.000Z";
    expect(evaluateScheduledDeliveryGrace({
      now: new Date("2026-08-09T14:10:00.000Z"),
      utcInstant: liveInstant,
      memberLocalDate: "2026-08-09",
      timeZone: "America/Phoenix",
    }).due).toBe(true);
    expect(scheduledDailyBodyAuthorization({
      now: new Date("2026-08-09T14:10:00.000Z"),
      live: {
        utcInstant: liveInstant,
        effectiveLocalMinute: 420,
        timeZone: "America/Phoenix",
        memberLocalDate: "2026-08-09",
        owner: "morning",
      },
      occurrenceState: "generated",
      draft: {
        generationId: "11111111-1111-4111-8111-111111111111",
        body: "Walk after lunch.",
        bodyHash: "hash-current",
        bodySource: "machine",
        editedByTyler: false,
        editedAt: null,
      },
      machineShouldSend: true,
      machineNoSendReason: null,
      messageRequiredToday: false,
      metadata: {
        reconsideration_evidence: {
          ...affirmativeKeep,
          goal_text: "Walk after lunch",
          existing_body_sha256: "hash-current",
          existing_body_source: "machine",
          edited_by_tyler: false,
          edited_at: null,
          delivery: {
            utc_instant: liveInstant,
            member_local_date: "2026-08-09",
            batch_date: "2026-08-08",
            effective_local_minute: 420,
            time_zone: "America/Phoenix",
            send_slot: "morning",
          },
        },
      },
      currentGoal: "Walk after lunch",
      goalReadOk: true,
      conversation: "same",
      retrievalOk: true,
      sundayNow: accomplishment,
    })).toEqual({ action: "send", body: "Walk after lunch." });

    expect(reconsiderationScheduleOnly({
      ...stable,
      sundayNow: "not_sunday",
      consideredSunday: initialSunday,
    })).toBe(true);
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    const generate = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"), "utf8");
    const send = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-send.ts"), "utf8");
    const shortcut = scheduler.indexOf("const sundayAllowsShortcut");
    expect(scheduler.indexOf("generateTylerTextOverviewEveningPreviewForUser", shortcut)).toBeGreaterThan(shortcut);
    expect(scheduler.indexOf("generateTylerTextOverviewDraftForUser", shortcut)).toBeGreaterThan(shortcut);
    expect(scheduler).toContain("attemptedSundayFailureFields(candidate.attemptedSunday)");
    expect(scheduler).toContain("successfulConsiderationEvidence(claimedMeta)?.goal_text ?? \"\"");
    expect(generate).toContain("preserveTylerEdit: args.reconsideration.preserveTylerEdit");
    const holds = scheduler.slice(scheduler.indexOf("const tylerHolds"), scheduler.indexOf("workable.push"));
    expect(holds).not.toContain("sunday");
    const goalGate = send.indexOf('if (!goal) return { outcome: "unresolved", reason: "goal_unresolved" }');
    expect(goalGate).toBeGreaterThan(-1);
    expect(send.indexOf("await loadSundayContextForDelivery")).toBeGreaterThan(goalGate);
    const empty = sundayContextEvidenceFromCoaching(sundayCoaching([]));
    expect(empty.accountability_status).toBe("loaded");
    expect(empty.accountability_event_ids).toEqual([]);
    expect(reconsiderationInputsChanged({
      considered: evidence({ sunday_context: empty, delivery: considered.delivery }),
      failedAttempt: null,
      discovered,
      retrieval: "ok",
      goalText: "Walk after lunch",
      goalReadOk: true,
      delivery,
      deliveryReadOk: true,
      scheduleChangedSinceSuccess: false,
      scheduleChangedSinceFailure: false,
      retryAfter: null,
      now,
      sundayNow: empty,
    })).toBe("unchanged");
  });
});

describe("stage 10 account-deletion fence", () => {
  const purgeAt = MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.purge_app_data_for_account_deletion");
  const purgeOpen = MIGRATION.indexOf("AS $purge_app_data$", purgeAt);
  const purge = MIGRATION.slice(purgeAt, MIGRATION.indexOf("\n$purge_app_data$", purgeOpen));
  const blocked = MIGRATION.slice(
    MIGRATION.indexOf("CREATE FUNCTION public.sms_account_deletion_member_blocked"),
    MIGRATION.indexOf("CREATE FUNCTION public.sms_tto_json_without_deleted_members")
  );
  const lockShared = MIGRATION.slice(
    MIGRATION.indexOf("CREATE FUNCTION public.sms_scheduled_member_deletion_lock_shared"),
    MIGRATION.indexOf("CREATE FUNCTION public.sms_account_deletion_member_blocked")
  );

  function body(name: string, next: string): string {
    const start = MIGRATION.indexOf(`CREATE FUNCTION public.${name}`);
    const end = MIGRATION.indexOf(next, start + 10);
    return MIGRATION.slice(start, end);
  }

  it("keeps the production purge deletes and strips only this member's batch JSON", () => {
    expect(purge).toContain("DELETE FROM public.sms_identities WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("DELETE FROM public.sms_audience WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("DELETE FROM public.sms_send_events WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("DELETE FROM public.sms_daily_drafts WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("DELETE FROM public.sms_daily_draft_generations WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("INSERT INTO public.sms_opt_out_tombstones");
    expect(purge).toContain("DELETE FROM public.v2_user_sms_comms_preferences WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("DELETE FROM public.v2_commitment WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("DELETE FROM public.important_people WHERE clerk_user_id = v_clerk;");
    expect(purge).toContain("p_lease_ms integer DEFAULT 120000");
    expect(purge).toContain("outcome := 'purged'");
    expect(purge).toContain("outcome := 'already_absent'");
    expect(purge).toContain("outcome := 'conflict'");
    expect(purge.indexOf("pg_advisory_xact_lock(\n    hashtext('sms_account_deletion_member')")).toBeLessThan(
      purge.indexOf("DELETE FROM public.sms_identities")
    );
    expect(purge.indexOf("hashtext('sms_account_deletion_member')")).toBeLessThan(
      purge.indexOf("FOR UPDATE")
    );
    expect(purge).toContain("element.value->>'clerk_user_id' IS DISTINCT FROM v_clerk");
    expect(purge).toContain("b.occurrences");
    expect(purge).toContain("b.non_scheduled");
    expect(purge).toContain("sms_tto_generation_batch_occurrences_removed");
    expect(purge).toContain("sms_tto_generation_batch_non_scheduled_removed");
    expect(purge).not.toContain("DELETE FROM public.sms_tto_generation_batches");
    expect(purge).not.toContain("initial_completed_at =");
    expect(purge).not.toContain("started_at =");
    expect(purge).toContain("ORDER BY b.id");
  });

  it("treats every deletion request, including completed, as a block", () => {
    expect(blocked).toContain("FROM public.account_deletion_requests");
    expect(blocked).toContain("WHERE clerk_user_id = p_clerk_user_id");
    expect(blocked).not.toContain("status");
  });

  it("locks members in sorted order before batch, claim, finish, save, and delivery writes", () => {
    expect(lockShared).toContain("ORDER BY 1");
    expect(lockShared).toContain("pg_advisory_xact_lock_shared");
    const open = body("tto_generation_batch_open", "CREATE FUNCTION public.tto_generation_batch_patch");
    expect(open.indexOf("sms_scheduled_member_deletion_lock_shared")).toBeLessThan(
      open.indexOf("INSERT INTO public.sms_tto_generation_batches")
    );
    expect(open).toContain("sms_tto_json_without_deleted_members");
    const patch = body("tto_generation_batch_patch", "CREATE FUNCTION public.tto_claim_scheduled_generation");
    expect(patch.indexOf("sms_scheduled_member_deletion_lock_shared")).toBeLessThan(patch.indexOf("FOR UPDATE"));
    expect(patch).toContain("sms_account_deletion_member_blocked(v_patch->>'clerk_user_id')");
    expect(patch).toContain("sms_account_deletion_member_blocked(v_append->>'clerk_user_id')");
    const claim = body("tto_claim_scheduled_generation", "CREATE FUNCTION public.tto_finish_generation_persistence");
    expect(claim.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(
      claim.indexOf("hashtext(p_draft_for_day_key || '|' || p_send_slot)")
    );
    expect(claim).toContain("'ineligible'::text, NULL::uuid, 'account_deletion'::text");
    const finish = body("tto_finish_generation_persistence", "CREATE FUNCTION public.tto_reconsideration_conversation_discovery");
    expect(finish.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(finish.indexOf("FOR UPDATE"));
    expect(finish).toContain("'account_deletion'::text");
    const save = body("tto_save_tyler_draft_body", "CREATE FUNCTION public.tto_reserve_scheduled_daily_delivery");
    expect(save.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(save.indexOf("FOR UPDATE"));
    expect(save).toContain("'account_deletion'");
    const reserve = body("tto_reserve_scheduled_daily_delivery", "CREATE FUNCTION public.tto_begin_scheduled_daily_provider_attempt");
    expect(reserve.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(
      reserve.indexOf("INSERT INTO public.sms_send_events")
    );
    expect(reserve).toContain("'account_deletion'::text");
    const finalize = body(
      "tto_finalize_scheduled_daily_acceptance",
      "CREATE FUNCTION public.tto_release_proven_pre_provider"
    );
    expect(finalize).not.toContain("INSERT INTO");
    expect(finalize.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(finalize.indexOf("FOR UPDATE"));
    const preferences = MIGRATION.slice(MIGRATION.indexOf("CREATE FUNCTION public.v2_upsert_sms_comms_preferences"));
    expect(preferences.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(
      preferences.indexOf("INSERT INTO public.v2_user_sms_comms_preferences")
    );
    expect(preferences).toContain("RAISE EXCEPTION 'account_deletion'");
    const insert = MIGRATION.slice(
      MIGRATION.indexOf("CREATE FUNCTION public.tto_insert_generation_row"),
      MIGRATION.indexOf("CREATE FUNCTION public.v2_upsert_sms_comms_preferences")
    );
    expect(insert.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(
      insert.indexOf("INSERT INTO public.sms_daily_draft_generations")
    );
    expect(insert).toContain("RAISE EXCEPTION 'account_deletion'");
    const bookkeeping = MIGRATION.slice(
      MIGRATION.indexOf("CREATE FUNCTION public.tto_record_scheduled_post_send_bookkeeping")
    );
    expect(bookkeeping.indexOf("pg_advisory_xact_lock_shared")).toBeLessThan(
      bookkeeping.indexOf("INSERT INTO public.v2_commitment_event")
    );
    expect(bookkeeping.indexOf("sms_account_deletion_member_blocked(v_clerk)")).toBeLessThan(
      bookkeeping.indexOf("INSERT INTO public.v2_commitment_sms_thread_memory")
    );
    expect(bookkeeping).toContain("GRANT EXECUTE ON FUNCTION public.tto_record_scheduled_post_send_bookkeeping");
    expect(bookkeeping).toContain("TO service_role");
  });

  it("routes generation inserts and preference writes through the fenced RPCs", () => {
    const generate = readFileSync(join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"), "utf8");
    const preferences = readFileSync(join(process.cwd(), "src/lib/v2-sms-comms-preferences.ts"), "utf8");
    const scheduler = readFileSync(join(process.cwd(), "src/lib/tto-scheduled-generate.ts"), "utf8");
    expect(generate).toContain('rpc("tto_insert_generation_row"');
    expect(preferences).toContain('rpc("v2_upsert_sms_comms_preferences"');
    expect(scheduler).toContain('if (text.includes("account_deletion")) return false;');
    expect(scheduler).toContain('| "ineligible"');
  });
});

function sundayCoaching(
  events: SundayCoachingContext["accountability_events"]["events"],
  interruption: SundayCoachingContext["planned_interruption"] = {
    status: "none",
    occurred_at: null,
    reason_category: null,
    resume_hint: null,
  }
): SundayCoachingContext {
  return {
    week_start_local_date: "2026-08-03",
    week_end_local_date: "2026-08-09",
    information_available_through_utc: "2026-08-08T20:00:00.000Z",
    accountability_events: { status: "loaded", events },
    planned_interruption: interruption,
  };
}

function sundayPacket(
  coaching: SundayCoachingContext,
  messages: Array<{ source_id: string; sender: "user" | "coach"; sent_at_utc: string; body: string }> = []
): MorningRelationshipPacket {
  return {
    exact_thread: { messages, omitted_older_turn_count: 0 },
    current_goal: { text: "Walk after lunch" },
    message_for: {
      local_date: "2026-08-09",
      timezone: "America/Phoenix",
      local_weekday: "Sunday",
      daypart: "morning",
      intended_receive_time_local: "07:00",
    },
    sunday_coaching: coaching,
  } as MorningRelationshipPacket;
}
