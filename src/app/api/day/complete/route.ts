import { auth } from "@clerk/nextjs/server";

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

    if (typeof pageDay !== "number") {
      return new Response(JSON.stringify({ error: "Invalid day" }), {
        status: 400,
      });
    }

    // Fetch user
    const userRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      },
    });

    if (!userRes.ok) {
      throw new Error("Failed to fetch user for day completion");
    }

    const user = await userRes.json();
    const metadata = user.public_metadata || {};

    const currentDay =
      typeof metadata.currentDay === "number" ? metadata.currentDay : 1;

    // 🔒 Only allow completing the current day
    if (pageDay !== currentDay) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
      });
    }

    const totalDaysCompleted =
      typeof metadata.totalDaysCompleted === "number"
        ? metadata.totalDaysCompleted
        : 0;

    const daysInRow =
      typeof metadata.daysInRow === "number" ? metadata.daysInRow : 0;

    await updateMetadata(userId, {
      currentDay: currentDay + 1,
      totalDaysCompleted: totalDaysCompleted + 1,
      daysInRow: daysInRow + 1,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("DAY COMPLETE ERROR:", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), {
      status: 500,
    });
  }
}
