import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

import {
  resolveTrainingCampDay,
  type TrainingCampTrack,
} from "@/lib/training-camp-resolver";
import { generateCoachPatNote } from "@/lib/coach-pat-generator";

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const dayParam = url.searchParams.get("day");
    const dayNumber = Number(dayParam);

    if (!Number.isFinite(dayNumber) || dayNumber < 1) {
      return NextResponse.json({ error: "Invalid day" }, { status: 400 });
    }

    // ----------------------------
    // Resolve Training Camp practice
    // ----------------------------
    const trackRaw = user.publicMetadata?.trainingCampTrack;
    const trainingCampTrack: TrainingCampTrack =
      trackRaw === "women" ? "women" : "standard";

    const practice = await resolveTrainingCampDay({
      dayNumber,
      trainingCampTrack,
    });

    const actionItem =
      practice?.action_item ??
      "Show up today with intention and hold the standard, even in small moments.";

    // ----------------------------
    // Identity (LIGHT, SAFE)
    // ----------------------------
    const preferredName =
      typeof user.firstName === "string" && user.firstName.trim().length > 0
        ? user.firstName.trim()
        : undefined;

    const primaryGoal =
      typeof user.publicMetadata?.summittGoal === "string" &&
      user.publicMetadata.summittGoal.trim().length > 0
        ? user.publicMetadata.summittGoal.trim()
        : undefined;

    // ----------------------------
    // Generate ephemeral Coach Pat note
    // ----------------------------
    const note = await generateCoachPatNote({
      userId,
      dayNumber,
      actionItem,
      preferredName,
      primaryGoal,
    });

    return NextResponse.json({ note });
  } catch (err) {
    console.error("Coach Pat daily API error:", err);
    return NextResponse.json(
      { error: "Failed to generate Coach Pat note" },
      { status: 500 }
    );
  }
}
