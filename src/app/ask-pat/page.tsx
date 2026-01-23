import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AskPatClient from "./ask-pat-client";

export default async function AskPatPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const publicMetadata = user.publicMetadata as any;
  const isSubscribed = publicMetadata?.summittSubscribed === true;

  return (
    <AskPatClient
      isSubscribed={isSubscribed}
      firstName={user.firstName || "Member"}
    />
  );
}
