import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

/**
 * ======================================================
 * Weekly Retention Intelligence Digest (CANONICAL)
 * ======================================================
 *
 * Outputs every Friday:
 * - Top friction reasons
 * - Top churn reasons
 * - Top testimonial language (Stream B)
 *
 * Stream B must pull from BOTH:
 * - feedback_events (Day 7 promoter seeds)
 * - testimonials table (Day 30 stories)
 *
 * Internal brain forever.
 */

export const runtime = "nodejs";

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

export async function GET() {
  // 🔒 Tyler-only
  await requireTylerAdmin();

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const sinceIso = since.toISOString();

  // ======================================================
  // ✅ 1) Top Friction Reasons (Stream A)
  // ======================================================
  const { data: friction } = await supabaseServer
    .from("feedback_events")
    .select("reason_code")
    .eq("type", "friction")
    .gte("created_at", sinceIso);

  const frictionCounts: Record<string, number> = {};

  friction?.forEach((f) => {
    if (!f.reason_code) return;
    frictionCounts[f.reason_code] =
      (frictionCounts[f.reason_code] || 0) + 1;
  });

  const topFriction = Object.entries(frictionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // ======================================================
  // ✅ 2) Top Churn Reasons (Stream C)
  // ======================================================
  const { data: churn } = await supabaseServer
    .from("feedback_events")
    .select("reason_code")
    .eq("type", "churn")
    .gte("created_at", sinceIso);

  const churnCounts: Record<string, number> = {};

  churn?.forEach((c) => {
    if (!c.reason_code) return;
    churnCounts[c.reason_code] =
      (churnCounts[c.reason_code] || 0) + 1;
  });

  const topChurn = Object.entries(churnCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // ======================================================
  // ✅ 3) Strongest Member Language (Stream B)
  // ======================================================
  // Source A: Day 7 promoter seeds (feedback_events)
  const { data: promoterSeeds } = await supabaseServer
    .from("feedback_events")
    .select("message")
    .eq("moment", "day7_promoter_seed")
    .eq("type", "testimonial_seed")
    .gte("created_at", sinceIso);

  const seedPhrases =
    promoterSeeds
      ?.map((t) => normalizeText(t.message))
      .filter(Boolean) || [];

  // Source B: Day 30 stories (testimonials table)
  const { data: testimonialStories } = await supabaseServer
    .from("testimonials")
    .select("quote")
    .gte("created_at", sinceIso);

  const storyPhrases =
    testimonialStories
      ?.map((t) => normalizeText(t.quote))
      .filter(Boolean) || [];

  // Combine (keep it calm and simple)
  const combined = [...seedPhrases, ...storyPhrases];

  // Take top 5 max (we don’t need a wall of text)
  const topLanguage = combined.slice(0, 5);

  // ======================================================
  // ✅ Return Digest Payload
  // ======================================================
  return NextResponse.json({
    ok: true,
    weekWindowDays: 7,
    friction: topFriction,
    churn: topChurn,
    testimonialLanguage: topLanguage,
    meta: {
      sources: {
        promoterSeeds: seedPhrases.length,
        testimonialStories: storyPhrases.length,
      },
    },
  });
}
