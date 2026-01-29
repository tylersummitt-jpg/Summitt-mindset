import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await req.json();

    await updateClerkPublicMetadata(userId, {
      onboardingPreferences: body,
      smsEnabled: body.smsEnabled ?? true,
      smsTimePreference: body.smsTimePreference ?? "morning",
      timezone: body.timezone ?? "America/New_York",
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("PREFERENCES ERROR:", err);

    return new Response(
      JSON.stringify({ error: "Something went wrong" }),
      { status: 500 }
    );
  }
}
