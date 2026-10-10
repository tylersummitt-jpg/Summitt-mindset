import { NextResponse } from "next/server";
import { enrollChallengeEmail } from "@/lib/challenge-runtime";

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Enter a valid email address." },
      { status: 400 }
    );
  }

  const email = typeof body.email === "string" ? body.email : "";
  const result = await enrollChallengeEmail(email);
  return NextResponse.json(
    { ok: result.ok, message: result.message },
    { status: result.status }
  );
}
