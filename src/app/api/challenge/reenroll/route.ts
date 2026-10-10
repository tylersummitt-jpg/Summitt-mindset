import { NextResponse } from "next/server";
import { readChallengeActionRequest } from "@/lib/challenge-sequence";
import { reenrollChallengeToken } from "@/lib/challenge-runtime";

export async function POST(request: Request) {
  const { token, preferRedirect } = await readChallengeActionRequest(request);
  const result = await reenrollChallengeToken(token);
  if (!preferRedirect) {
    return NextResponse.json(
      { ok: result.ok, message: result.message },
      { status: result.status }
    );
  }
  const url = new URL("/challenge/unsubscribe", request.url);
  if (token) url.searchParams.set("token", token);
  if (result.ok && result.message.startsWith("You're back")) {
    url.searchParams.set("reenrolled", "1");
  } else if (result.message.includes("already complete")) {
    url.searchParams.set("complete", "1");
  } else if (!result.ok) {
    url.searchParams.set("reenroll_error", "1");
  }
  return NextResponse.redirect(url, 303);
}
