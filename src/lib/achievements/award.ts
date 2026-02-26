// src/lib/achievements/award.ts

import { supabaseServer } from "@/lib/supabase-server";
import { ACHIEVEMENTS, AchievementKey } from "@/lib/achievements/definitions";

export async function awardAchievementsIfEligible({
  userId,
  totalDaysCompleted,
}: {
  userId: string;
  totalDaysCompleted: number;
}): Promise<{ unlocked: AchievementKey[] }> {
  const unlocked: AchievementKey[] = [];

  for (const def of ACHIEVEMENTS) {
    if (!def.when({ totalDaysCompleted })) continue;

    // Idempotent: PK prevents duplicates
    const { error } = await supabaseServer
      .from("achievements_unlocked")
      .insert({
        clerk_user_id: userId,
        achievement_key: def.key,
        metadata: {
          title: def.title,
          totalDaysCompleted,
        },
      });

    // 23505 = duplicate key => already unlocked; ignore
    const code = (error as any)?.code;
    if (error && code !== "23505") {
      console.error("[awardAchievementsIfEligible] insert error:", error);
      continue;
    }

    // If no error, it was inserted newly (unlocked now)
    if (!error) unlocked.push(def.key);
  }

  return { unlocked };
}