import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { resolveUserTimezone } from "@/lib/timezone";

type TimeOfDay = "morning" | "midday" | "evening";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await req.json().catch(() => ({}));

    const timeOfDayRaw = body?.timeOfDay;
    const exactTimeRaw = body?.exactTime;
    const timezoneRaw = body?.timezone;

    const validSlots: TimeOfDay[] = ["morning", "midday", "evening"];

    if (!validSlots.includes(timeOfDayRaw)) {
      return new Response(JSON.stringify({ error: "Invalid time of day" }), {
        status: 400,
      });
    }

    const timezone = resolveUserTimezone(timezoneRaw);

    const exactTime =
      typeof exactTimeRaw === "string" && exactTimeRaw.length > 0
        ? exactTimeRaw
        : null;

    await updateClerkPublicMetadata(userId, {
      onboardingPracticeTimeOfDay: timeOfDayRaw,
      onboardingPracticeTimeExact: exactTime,
      timezone,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING SCHEDULE ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
