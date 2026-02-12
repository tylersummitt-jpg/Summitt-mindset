import { auth } from "@clerk/nextjs/server";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";

type SmsTimePreference = "morning" | "afternoon" | "evening";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await req.json().catch(() => ({}));

    const smsEnabled = body?.smsEnabled === true;

    const prefRaw = body?.smsTimePreference;
    const allowed: SmsTimePreference[] = ["morning", "afternoon", "evening"];

    const smsTimePreference: SmsTimePreference =
      allowed.includes(prefRaw) ? prefRaw : "morning";

    const smsDisclosureAccepted = body?.smsDisclosureAccepted === true;

    // If they enabled SMS, we require disclosure acceptance (consent moment)
    if (smsEnabled && !smsDisclosureAccepted) {
      return new Response(
        JSON.stringify({ error: "Consent is required to enable SMS." }),
        { status: 400 }
      );
    }

    await updateClerkPublicMetadata(userId, {
      smsEnabled,
      smsTimePreference,

      // Compliance / audit breadcrumbs
      smsDisclosureAccepted: smsEnabled ? true : false,
      smsStopHelpDisclosureShownAt: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING SMS ERROR:", err);

    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
