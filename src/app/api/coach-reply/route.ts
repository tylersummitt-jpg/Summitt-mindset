// src/app/api/coach-reply/route.ts

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { coachEngine } from "@/lib/coach-engine";

export const runtime = "nodejs";

const MAX_COACH_REPLIES_PER_DAY = 20;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated" },
        { status: 200 }
      );
    }

    // ================================
    // Body
    // ================================
    const body = await req.json();

    const day = Number(body?.day);
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!Number.isFinite(day) || day < 1 || message.length === 0) {
      return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 200 });
    }

    // ================================
    // Canonical coach pipeline
    // ================================
    const result = await coachEngine({
      userId,
      dayNumber: day,
      userMessage: message,
      source: "app",
      maxCoachRepliesPerDay: MAX_COACH_REPLIES_PER_DAY,
    });

    // Domain errors return 200 (consistent with your API philosophy)
    if (!result.ok) {
      return NextResponse.json(result, { status: 200 });
    }

    return NextResponse.json(
      { ok: true, thread: result.thread },
      { status: 200 }
    );
  } catch (err) {
    console.error("[COACH REPLY ERROR]", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}