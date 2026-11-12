import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { CHECKOUT_BINDING_COOKIE } from "@/lib/stripe-first-checkout/constants";
import { noteSignInClientReached } from "@/lib/stripe-first-checkout/signup-diagnostics";

export const runtime = "nodejs";

/** Records that the sign-in page called us. The request body is ignored. */
export async function POST() {
  try {
    const jar = await cookies();
    const binding = jar.get(CHECKOUT_BINDING_COOKIE)?.value;
    if (binding) await noteSignInClientReached(binding);
  } catch {
    console.warn("[stripe-first] signup diagnostic failed");
  }
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
