import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();

    const {
      pressure_summary,
      proud_of,
      best_self_trigger
    } = body;

    const { error } = await supabaseServer
      .from("user_profiles")
      .upsert(
        {
          clerk_user_id: userId,
          pressure_summary,
          proud_of,
          best_self_trigger
        },
        { onConflict: "clerk_user_id" }
      );

    if (error) {
      console.error("Pressure onboarding error:", error);
      return new Response("Database error", { status: 500 });
    }

    return Response.json({ success: true });

  } catch (err) {
    console.error(err);
    return new Response("Server error", { status: 500 });
  }
}