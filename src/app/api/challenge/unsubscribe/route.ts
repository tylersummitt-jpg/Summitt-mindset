import { NextResponse } from "next/server";
import { readChallengeActionRequest } from "@/lib/challenge-sequence";
import { unsubscribeChallengeToken } from "@/lib/challenge-runtime";

function redirectTo(request: Request, token: string, done: boolean): NextResponse {
  const url = new URL("/challenge/unsubscribe", request.url);
  if (token) url.searchParams.set("token", token);
  if (done) url.searchParams.set("done", "1");
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const { token, preferRedirect } = await readChallengeActionRequest(request);
  const result = await unsubscribeChallengeToken(token);
  if (preferRedirect) {
    if (result === "missing") {
      const url = new URL("/challenge/unsubscribe", request.url);
      url.searchParams.set("invalid", "1");
      return NextResponse.redirect(url, 303);
    }
    return redirectTo(request, token, true);
  }
  if (result === "missing") {
    return NextResponse.json({ ok: false, message: "This unsubscribe link is invalid." }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    message: "You won't receive further challenge emails.",
  });
}
