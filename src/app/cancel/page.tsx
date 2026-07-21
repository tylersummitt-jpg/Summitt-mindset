import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { isNativeSummittMindsetIosRequest } from "@/lib/native-app/is-native-summitt-mindset-ios-request";
import { signInPathForClient } from "@/lib/native-app/membership-paths";
import CancelFlowClient from "./cancel-flow-client";

export default async function CancelPage() {
  const user = await currentUser();

  if (!user) {
    const isNativeIos = await isNativeSummittMindsetIosRequest();
    redirect(signInPathForClient(isNativeIos));
  }

  const metadata = user.publicMetadata as any;

  // ✅ Only subscribed members can cancel
  if (!metadata?.summittSubscribed) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  return (
    <main className="max-w-xl mx-auto px-6 py-14 space-y-6">
      <h1 className="text-3xl font-bold">Before you go…</h1>

      <p className="text-sm text-gray-600">
        Summitt Mindset exists to stay calm and useful.  
        One honest answer helps us get better.
      </p>

      <CancelFlowClient />
    </main>
  );
}
