import { NextResponse } from "next/server";

import { validateCronSecretRequest } from "@/lib/cron-auth";
import { runHourlyMetaConversionMaintenance } from "@/lib/meta-capi-stripe-conversions";
import { runRecoveryCron } from "@/lib/recovery.server";
import { alertStrandedNewCustomerTrials } from "@/lib/stripe-first-checkout/stranded-trial";

export async function GET(request: Request) {
  if (!validateCronSecretRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRecoveryCron();
  try {
    await alertStrandedNewCustomerTrials();
  } catch (err) {
    console.error("[stripe-first] stranded trial scan failed", {
      reason: err instanceof Error ? err.message : "scan_failed",
    });
  }
  try {
    await runHourlyMetaConversionMaintenance();
  } catch (err) {
    console.error("[meta-capi] hourly maintenance failed", {
      reason: err instanceof Error ? err.message : "maintenance_failed",
    });
  }
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  return GET(request);
}
