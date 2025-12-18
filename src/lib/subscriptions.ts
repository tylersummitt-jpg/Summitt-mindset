// src/lib/subscriptions.ts
import { db } from "@/lib/db"; // adjust if your db client lives somewhere else

export async function getUserActiveSubscription(userId: string) {
  return await db.subscription.findFirst({
    where: {
      userId,
      status: {
        in: ["active", "trialing"],
      },
    },
  });
}
