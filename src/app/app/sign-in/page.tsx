import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AppEmailCodeSignIn from "@/components/app-sign-in/AppEmailCodeSignIn";
import { APP_POST_AUTH_PATH } from "@/lib/app-sign-in/app-sign-in-constants";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in or create a Summitt Mindset account with your email.",
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Dedicated native-app auth surface (DEC-018 / APP-061).
 * Public. Email verification-code Sign in + Create account.
 * Same Clerk instance as the website. No social providers. No purchase.
 * Ignores client-supplied redirect query params — post-auth uses /post-sign-in.
 */
export default async function AppSignInPage() {
  const { userId } = await auth();
  if (userId) {
    redirect(APP_POST_AUTH_PATH);
  }

  return (
    <main className="min-h-[70vh] w-full overflow-x-hidden bg-[var(--bg)]">
      <AppEmailCodeSignIn />
    </main>
  );
}
