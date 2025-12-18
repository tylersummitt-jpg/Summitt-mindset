import { auth } from "@clerk/nextjs/server";

async function updateMetadata(userId: string, newFields: any) {
  // 1. Fetch existing user
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

  // 2. Merge metadata safely (CRITICAL)
  const mergedMetadata = {
    ...existingMetadata,
    ...newFields,
  };

  // 3. Patch merged metadata
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

export async function POST() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    await updateMetadata(userId, {
      onboardingCompleted: true,
      currentDay: 1, // 🔥 DAY PROGRESSION STARTS HERE
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("ONBOARDING COMPLETE ERROR:", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
