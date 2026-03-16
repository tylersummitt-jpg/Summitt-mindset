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
      preferred_name,
      life_desires,
      ninety_day_vision,
      support_area
    } = body;

    const { error } = await supabaseServer
      .from("user_profiles")
      .upsert(
        {
          clerk_user_id: userId,
          preferred_name: preferred_name || null,
          life_desires,
          ninety_day_vision,
          support_area
        },
        { onConflict: "clerk_user_id" }
      );

    if (error) {
      console.error("Identity onboarding error:", error);
      return new Response("Database error", { status: 500 });
    }

    return Response.json({ success: true });

  } catch (err) {
    console.error(err);
    return new Response("Server error", { status: 500 });
  }
}