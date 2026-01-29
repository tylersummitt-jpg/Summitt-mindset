import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await req.json();

    await supabaseServer.from("day1_feedback").insert({
      clerk_user_id: userId,
      was_easy: body.wasEasy,
      message: body.message || null,
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("DAY1 FEEDBACK ERROR:", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
