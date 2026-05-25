import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isSmsPrefsUiEnabled } from "@/lib/sms-preferences-flags";
import {
  assertSmsPreferencesPatchAllowed,
  buildSmsPreferencesViewModel,
  validateSmsPreferencesPatch,
} from "@/lib/sms-preferences-view";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  fetchV2UserSmsCommsPreferences,
  upsertV2UserSmsCommsPreferences,
} from "@/lib/v2-sms-comms-preferences";

export const dynamic = "force-dynamic";

function flagDisabledResponse() {
  return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
}

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

async function buildPreferencesResponse(userId: string) {
  const clerk = await loadClerkSmsContext(userId);
  if (!clerk) {
    return null;
  }

  const [prefs, commitment] = await Promise.all([
    fetchV2UserSmsCommsPreferences(userId),
    getActiveCommitment(userId),
  ]);

  return buildSmsPreferencesViewModel({
    uiEnabled: isSmsPrefsUiEnabled(),
    smsEnabled: clerk.smsEnabled,
    phoneNumber: clerk.phoneNumber,
    timezoneRaw: clerk.timezoneRaw,
    smsDisclosureAccepted: clerk.smsDisclosureAccepted,
    prefs,
    accountabilityPhase: commitment?.accountability_phase ?? null,
  });
}

export async function GET() {
  if (!isSmsPrefsUiEnabled()) {
    return flagDisabledResponse();
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return unauthorizedResponse();
    }

    const view = await buildPreferencesResponse(userId);
    if (!view) {
      return unauthorizedResponse();
    }

    return NextResponse.json(view);
  } catch (err) {
    console.error("[sms/preferences] GET failed", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isSmsPrefsUiEnabled()) {
    return flagDisabledResponse();
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return unauthorizedResponse();
    }

    const clerk = await loadClerkSmsContext(userId);
    if (!clerk) {
      return unauthorizedResponse();
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
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

    const upsertResult = await upsertV2UserSmsCommsPreferences({
      clerkUserId: userId,
      patch: validated.upsert.patch,
      clearPause: validated.upsert.clearPause,
      clearCadenceOverride: validated.upsert.clearCadenceOverride,
    });

    if (!upsertResult.ok) {
      return NextResponse.json(
        { ok: false, error: upsertResult.error ?? "Failed to save preferences" },
        { status: 500 }
      );
    }

    const view = await buildPreferencesResponse(userId);
    if (!view) {
      return unauthorizedResponse();
    }

    return NextResponse.json(view);
  } catch (err) {
    console.error("[sms/preferences] PATCH failed", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
