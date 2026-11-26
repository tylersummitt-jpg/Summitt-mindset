import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { evaluateEntitlementRestorationForAccountDeletion } from "@/lib/account-deletion/deletion-guards";
import { isValidIanaTimezone } from "@/lib/timezone";
import {
  assertSmsPreferencesPatchAllowed,
  buildSmsPreferencesViewModel,
  validateSmsPreferencesPatch,
} from "@/lib/sms-preferences-view";
import type { SmsPreferencesView } from "@/lib/sms-preferences-types";
import { supabaseServer } from "@/lib/supabase-server";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  readV2UserSmsCommsPreferences,
  upsertV2UserSmsCommsPreferences,
  type V2UserSmsCommsPreferencesRow,
} from "@/lib/v2-sms-comms-preferences";

export const dynamic = "force-dynamic";

function unauthorizedResponse() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

async function loadClerkSmsContext(userId: string) {
  const user = await currentUser();
  if (!user || user.id !== userId) {
    return null;
  }
  const md = user.publicMetadata as Record<string, unknown>;
  return {
    smsEnabled: md.smsEnabled === true,
    phoneNumber: md.phoneNumber,
    timezoneRaw: md.timezone,
    smsDisclosureAccepted: md.smsDisclosureAccepted === true,
  };
}

function clerkZoneIsAuthoritative(timezoneRaw: unknown, scheduleTimezone: string | null): boolean {
  if (scheduleTimezone?.trim()) return true;
  return typeof timezoneRaw === "string" && isValidIanaTimezone(timezoneRaw.trim());
}

async function readAudienceTimezone(userId: string): Promise<
  { unreadable: false; timezone: string | null } | { unreadable: true; timezone: null }
> {
  try {
    const { data, error } = await supabaseServer
      .from("sms_audience")
      .select("timezone")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    if (error) return { unreadable: true, timezone: null };
    const timezone = (data as { timezone?: unknown } | null)?.timezone;
    return { unreadable: false, timezone: typeof timezone === "string" ? timezone : null };
  } catch {
    return { unreadable: true, timezone: null };
  }
}

async function readCommitmentPhase(userId: string): Promise<
  | { known: true; phase: SmsPreferencesView["accountabilityPhase"] }
  | { known: false }
> {
  try {
    const commitment = await getActiveCommitment(userId);
    return { known: true, phase: commitment?.accountability_phase ?? null };
  } catch {
    return { known: false };
  }
}

async function buildPreferencesResponse(
  userId: string,
  prefs: V2UserSmsCommsPreferencesRow | null,
  clerkOverride?: NonNullable<Awaited<ReturnType<typeof loadClerkSmsContext>>>,
  options?: { commitmentMode?: "strict" | "best_effort" }
): Promise<{ view: SmsPreferencesView; refreshRequired: boolean } | null> {
  const clerk = clerkOverride ?? (await loadClerkSmsContext(userId));
  if (!clerk) return null;

  let audienceTimezone: string | null = null;
  let audienceTimezoneUnreadable = false;
  if (!clerkZoneIsAuthoritative(clerk.timezoneRaw, prefs?.schedule_timezone ?? null)) {
    const audience = await readAudienceTimezone(userId);
    audienceTimezone = audience.timezone;
    audienceTimezoneUnreadable = audience.unreadable;
  }

  const bestEffort = options?.commitmentMode === "best_effort";
  let commitmentKnown = true;
  let accountabilityPhase: SmsPreferencesView["accountabilityPhase"] = null;
  if (bestEffort) {
    const commitment = await readCommitmentPhase(userId);
    commitmentKnown = commitment.known;
    accountabilityPhase = commitment.known ? commitment.phase : null;
  } else {
    const commitment = await getActiveCommitment(userId);
    accountabilityPhase = commitment?.accountability_phase ?? null;
  }
  const view = buildSmsPreferencesViewModel({
    uiEnabled: true,
    smsEnabled: clerk.smsEnabled,
    phoneNumber: clerk.phoneNumber,
    timezoneRaw: clerk.timezoneRaw,
    smsDisclosureAccepted: clerk.smsDisclosureAccepted,
    prefs,
    audienceTimezone,
    audienceTimezoneUnreadable,
    accountabilityPhase,
    commitmentKnown,
  });
  return { view, refreshRequired: false };
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return unauthorizedResponse();

    const clerk = await loadClerkSmsContext(userId);
    if (!clerk) return unauthorizedResponse();

    const read = await readV2UserSmsCommsPreferences(userId);
    if (!read.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not load text preferences.", consentKnown: true },
        { status: 503 }
      );
    }

    const built = await buildPreferencesResponse(userId, read.row, undefined, {
      commitmentMode: "best_effort",
    });
    if (!built) return unauthorizedResponse();
    return NextResponse.json(built.view);
  } catch (err) {
    console.error("[sms/preferences] GET failed", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return unauthorizedResponse();

    const clerk = await loadClerkSmsContext(userId);
    if (!clerk) return unauthorizedResponse();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (body && typeof body === "object" && "clerk_user_id" in body) {
      return NextResponse.json({ ok: false, error: "Unknown field: clerk_user_id" }, { status: 400 });
    }

    const validated = validateSmsPreferencesPatch(body);
    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: validated.status });
    }

    const allowed = assertSmsPreferencesPatchAllowed({
      smsEnabled: clerk.smsEnabled,
      body: body as Record<string, unknown>,
    });
    if (!allowed.ok) {
      return NextResponse.json({ ok: false, error: allowed.error }, { status: allowed.status });
    }

    const deletion = await evaluateEntitlementRestorationForAccountDeletion(userId);
    if (deletion.decision === "lookup_failed") {
      return NextResponse.json(
        { ok: false, error: "Could not confirm this account can save text preferences." },
        { status: 503 }
      );
    }
    if (deletion.decision === "blocked_due_to_deletion") {
      return NextResponse.json(
        { ok: false, error: "This account cannot save text preferences." },
        { status: 409 }
      );
    }

    let upsertResult: Awaited<ReturnType<typeof upsertV2UserSmsCommsPreferences>>;
    try {
      upsertResult = await upsertV2UserSmsCommsPreferences({
        clerkUserId: userId,
        patch: validated.upsert.patch,
        clearPause: validated.upsert.clearPause,
        clearIndefinitePause: validated.upsert.clearIndefinitePause,
        clearCadenceOverride: validated.upsert.clearCadenceOverride,
      });
    } catch {
      return NextResponse.json(
        {
          ok: false,
          persistence: "uncertain",
          error: "Could not confirm whether preferences were saved.",
        },
        { status: 503 }
      );
    }

    if (!upsertResult.ok || !upsertResult.row) {
      if (upsertResult.persistence === "rejected") {
        return NextResponse.json(
          {
            ok: false,
            persistence: "failed",
            error: upsertResult.error ?? "Failed to save preferences",
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          persistence: "uncertain",
          error: "Could not confirm whether preferences were saved.",
        },
        { status: 503 }
      );
    }

    try {
      const built = await buildPreferencesResponse(userId, upsertResult.row, clerk, {
        commitmentMode: "best_effort",
      });
      if (!built) {
        return NextResponse.json(
          {
            ok: true,
            preferencesPersisted: true,
            refreshRequired: true,
            persistence: "confirmed",
            smsEnabled: clerk.smsEnabled,
          },
          { status: 200 }
        );
      }
      return NextResponse.json({
        ...built.view,
        preferencesPersisted: true,
        refreshRequired: built.refreshRequired,
        persistence: "confirmed",
      });
    } catch {
      return NextResponse.json(
        {
          ok: true,
          preferencesPersisted: true,
          refreshRequired: true,
          persistence: "confirmed",
          smsEnabled: clerk.smsEnabled,
          weeklySchedule: upsertResult.row.weekly_schedule ?? null,
          weeklyScheduleExplicit: upsertResult.row.weekly_schedule != null,
          scheduleTimezone: upsertResult.row.schedule_timezone ?? null,
          pauseIndefinite: upsertResult.row.pause_indefinite === true,
          applicationPauseActive:
            upsertResult.row.pause_indefinite === true ||
            (typeof upsertResult.row.pause_until === "string" &&
              new Date(upsertResult.row.pause_until).getTime() > Date.now()),
        },
        { status: 200 }
      );
    }
  } catch (err) {
    console.error("[sms/preferences] PATCH failed", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
