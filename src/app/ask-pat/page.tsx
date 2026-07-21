import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AskPatClient from "./ask-pat-client";
import { isNativeSummittMindsetIosRequest } from "@/lib/native-app/is-native-summitt-mindset-ios-request";
import { signInPathForClient } from "@/lib/native-app/membership-paths";

export default async function AskPatPage() {
  const user = await currentUser();
  const isNativeIos = await isNativeSummittMindsetIosRequest();

  if (!user) {
    redirect(signInPathForClient(isNativeIos));
  }

  const publicMetadata = user.publicMetadata as any;
  const isSubscribed = publicMetadata?.summittSubscribed === true;

  return (
    <AskPatClient
      isSubscribed={isSubscribed}
      isNativeSummittMindsetIos={isNativeIos}
      firstName={user.firstName || "Member"}
    />
  );
}
