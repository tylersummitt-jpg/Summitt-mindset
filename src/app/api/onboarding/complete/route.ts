import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";

export async function POST() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    // ✅ Completion = Habit Begins
    await updateClerkPublicMetadata(userId, {
      onboardingCompleted: true,
      currentDay: 1,

      // Future retention defaults
      smsEnabled: true,
      smsTimePreference: "morning",
      timezone: "America/New_York",
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING COMPLETE ERROR:", err);

    return new Response(
      JSON.stringify({ error: "Something went wrong" }),
      { status: 500 }
    );
  }
}
