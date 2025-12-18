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

  // 2. Merge metadata (CRITICAL)
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
    const text = await res.text();
    throw new Error(`Failed to update metadata: ${text}`);
  }
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

    await updateMetadata(userId, {
      onboardingPreferences: body,
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
