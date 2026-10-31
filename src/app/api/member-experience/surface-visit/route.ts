import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { detectSummittMindsetPlatformFromRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { isMemberSurface, type MemberSurface } from "@/lib/member-surface";
import {
  memberExperiencePlatform,
  recordMemberExperienceEvent,
} from "@/lib/member-experience-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 2048;

function surfaceFromBody(body: unknown): MemberSurface | null {
  if (!body || typeof body !== "object") return null;
  const surface = (body as { surface?: unknown }).surface;
  return isMemberSurface(surface) ? surface : null;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const user = await currentUser();
  if (!user || user.id !== userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const surface = surfaceFromBody(parsed);
  if (!surface) return NextResponse.json({ ok: false }, { status: 400 });
  if (!isSubscribedFromPublicMetadata(user.publicMetadata)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const recorded = await recordMemberExperienceEvent({
    clerkUserId: user.id,
    metadata: user.publicMetadata,
    eventType: "member_surface_visited",
    surface,
    platform: memberExperiencePlatform(detectSummittMindsetPlatformFromRequest(req)),
  });
  if (recorded.status === "rejected") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (recorded.status === "failed") {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
