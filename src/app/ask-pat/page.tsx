import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AskPatClient from "./ask-pat-client";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { signInPathForClient } from "@/lib/native-app/membership-paths";

export default async function AskPatPage() {
  const user = await currentUser();
  const isNativeApp = await isNativeSummittMindsetAppRequest();

  if (!user) {
    redirect(signInPathForClient(isNativeApp));
  }

  const publicMetadata = user.publicMetadata as any;
  const isSubscribed = publicMetadata?.summittSubscribed === true;

  return (
    <AskPatClient
      isSubscribed={isSubscribed}
      isNativeSummittMindsetApp={isNativeApp}
      firstName={user.firstName || "Member"}
    />
  );
}
