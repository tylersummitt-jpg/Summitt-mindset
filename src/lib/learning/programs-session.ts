import "server-only";

import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { programsAccessRedirect } from "./programs-access";

export async function requireProgramsMemberId(): Promise<string> {
  const user = await currentUser();
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  const destination = programsAccessRedirect({
    userId: user?.id ?? null,
    metadata: user?.publicMetadata,
    isNativeApp,
  });
  if (destination) redirect(destination);
  if (!user?.id) redirect("/sign-in");
  return user.id;
}
