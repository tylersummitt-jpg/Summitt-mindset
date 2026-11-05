import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { signInPathForClient } from "@/lib/native-app/membership-paths";
import {
  cancelModeFromFacts,
  readAppleGrant,
  stripeSubscriptionIdFromMetadata,
  type CancelFlowMode,
} from "@/lib/exit-survey";
import { supabaseServer } from "@/lib/supabase-server";

import CancelFlowClient from "./cancel-flow-client";

async function appleGrantForUser(userId: string): Promise<boolean | null> {
  return readAppleGrant(async () => {
    const { data, error } = await supabaseServer
      .from("apple_subscriptions")
      .select("product_id, status, expires_at")
      .eq("clerk_user_id", userId);
    return { error, rows: data };
  });
}

export default async function CancelPage() {
  const user = await currentUser();

  if (!user) {
    const isNativeApp = await isNativeSummittMindsetAppRequest();
    redirect(signInPathForClient(isNativeApp));
  }

  const metadata = user.publicMetadata as { summittSubscribed?: unknown };

  if (!metadata?.summittSubscribed) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const stripeSubscriptionId = stripeSubscriptionIdFromMetadata(user.publicMetadata);
  const appleGrant = stripeSubscriptionId ? await appleGrantForUser(user.id) : null;
  const mode: CancelFlowMode = cancelModeFromFacts({
    stripeSubscriptionId,
    appleGrant,
  });

  return (
    <main className="max-w-xl mx-auto px-6 py-14 space-y-6">
      <h1 className="text-3xl font-bold">Before you go…</h1>
      <p className="text-sm text-gray-600">
        Two short questions. You can skip either one.
      </p>
      <CancelFlowClient mode={mode} />
    </main>
  );
}
