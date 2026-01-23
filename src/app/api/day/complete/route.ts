import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  resolveUserTimezone,
  getDateKeyInTimezone,
} from "@/lib/timezone";

/**
 * Safely merge Clerk public_metadata using REST API
 */
async function updateMetadata(userId: string, newFields: any) {
  const userRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
    },
  });

  if (!userRes.ok) {
    throw new Error("Failed to fetch user from Clerk");
  }

  const user = await userRes.json();
  const existingMetadata = user.public_metadata || {};

  const mergedMetadata = {
    ...existingMetadata,
    ...newFields,
  };

  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
    },
    body: JSON.stringify({
      public_metadata: mergedMetadata,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to update metadata");
  }
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await req.json();
    const pageDay = body?.day;
    const videoIdShown =
      typeof body?.videoIdShown === "string" &&
      body.videoIdShown.trim().length > 0
        ? body.videoIdShown.trim()
        : null;

    if (typeof pageDay !== "number") {
      return new Response(JSON.stringify({ error: "Invalid day" }), {
        status: 400,
      });
    }

    // ----------------------------
    // Fetch user + metadata
    // ----------------------------
    const userRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    });

    if (!userRes.ok) {
      throw new Error("Failed to fetch user");
    }

    const user = await userRes.json();
    const metadata = user.public_metadata || {};

    const currentDay =
      typeof metadata.currentDay === "number" ? metadata.currentDay : 1;

    // ----------------------------
    // 🔒 Prevent completing out of order
    // ----------------------------
    if (pageDay !== currentDay) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
      });
    }

    // ----------------------------
    // 🗓️ CALENDAR GUARD (timezone-safe)
    // ----------------------------
    const timezone = resolveUserTimezone(metadata.timezone);
    const now = new Date();
    const todayKey = getDateKeyInTimezone(now, timezone);

    if (metadata.lastCompletedAt) {
      const lastDate = new Date(metadata.lastCompletedAt);
      const lastKey = getDateKeyInTimezone(lastDate, timezone);

      if (lastKey === todayKey) {
        return new Response(
          JSON.stringify({
            ok: false,
            reason: "already_completed_today",
          }),
          { status: 200 }
        );
      }
    }

    // ----------------------------
    // 🧠 DAILY PROMPT MUST EXIST
    // ----------------------------
    const { data: promptRow } = await supabaseServer
      .from("daily_prompts")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_number", pageDay)
      .single();

    if (!promptRow) {
      return new Response(
        JSON.stringify({ ok: false, reason: "prompt_missing" }),
        { status: 400 }
      );
    }

    // ----------------------------
    // ✍️ JOURNAL REQUIRED
    // ----------------------------
    const { data: journalRow } = await supabaseServer
      .from("journal_entries")
      .select("content")
      .eq("clerk_user_id", userId)
      .eq("day_number", pageDay)
      .single();

    const normalizedJournal = normalizeText(journalRow?.content ?? "");

    if (!normalizedJournal) {
      return new Response(
        JSON.stringify({ ok: false, reason: "journal_required" }),
        { status: 200 }
      );
    }

    // ----------------------------
    // 📌 DAILY SUMMARY
    // ----------------------------
    await supabaseServer.from("daily_summaries").upsert(
      {
        clerk_user_id: userId,
        day_number: pageDay,
        daily_summaries: normalizedJournal.slice(0, 240),
      },
      { onConflict: "clerk_user_id,day_number" }
    );

    // ----------------------------
    // 📅 WEEKLY SUMMARY (every 7 days)
    // ----------------------------
    if (pageDay % 7 === 0) {
      const weekEnd = pageDay;
      const weekStart = pageDay - 6;

      const { data: summaries } = await supabaseServer
        .from("daily_summaries")
        .select("daily_summaries")
        .eq("clerk_user_id", userId)
        .gte("day_number", weekStart)
        .lte("day_number", weekEnd)
        .order("day_number");

      if (summaries?.length) {
        const text = summaries
          .map((s) => s.daily_summaries || "")
          .join(" ");

        await supabaseServer.from("weekly_summaries").upsert(
          {
            clerk_user_id: userId,
            week_start_day: weekStart,
            week_end_day: weekEnd,
            weekly_summary: text.slice(0, 500),
          },
          { onConflict: "clerk_user_id,week_start_day" }
        );
      }
    }

    // ----------------------------
    // 🎥 TRACK SHOWN VIDEO IDS
    // ----------------------------
    const nextShownVideoIds =
      videoIdShown && Array.isArray(metadata.shownVideoIds)
        ? [...new Set([...metadata.shownVideoIds, videoIdShown])].slice(0, 80)
        : metadata.shownVideoIds || [];

    // ----------------------------
    // 🔐 UPDATE CLERK METADATA
    // ----------------------------
    await updateMetadata(userId, {
      currentDay: currentDay + 1,
      totalDaysCompleted: (metadata.totalDaysCompleted ?? 0) + 1,
      daysInRow: (metadata.daysInRow ?? 0) + 1,
      lastCompletedAt: now.toISOString(),
      shownVideoIds: nextShownVideoIds,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("DAY COMPLETE ERROR:", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
