import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AskPatClient from "./ask-pat-client";
import { UsableScreenMarker } from "@/components/mobile-measurement-client";
import { MemberSurfaceVisit } from "@/components/member-surface-visit";
import { isNativeSummittMindsetAppRequest, detectSummittMindsetPlatformRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { signInPathForClient } from "@/lib/native-app/membership-paths";

export default async function AskPatPage() {
  const user = await currentUser();
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  const nativePlatform = await detectSummittMindsetPlatformRequest();

  if (!user) {
    redirect(signInPathForClient(isNativeApp));
  }

  const publicMetadata = user.publicMetadata as any;
  const isSubscribed = publicMetadata?.summittSubscribed === true;

  return (
    <>
      <MemberSurfaceVisit surface="ask_pat" />
      <UsableScreenMarker surface="ask_pat" />
      <AskPatClient
        isSubscribed={isSubscribed}
        isNativeSummittMindsetApp={isNativeApp}
        nativePlatform={nativePlatform}
        firstName={user.firstName || "Member"}
      />
    </>
  );
}
