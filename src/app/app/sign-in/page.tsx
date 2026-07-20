import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AppEmailCodeSignIn from "@/components/app-sign-in/AppEmailCodeSignIn";
import { APP_SIGN_IN_SUCCESS_PATH } from "@/lib/app-sign-in/app-sign-in-constants";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Summitt Mindset with your email.",
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Dedicated native-app sign-in surface (DEC-018 / APP-061).
 * Public. Email verification-code only. Same Clerk instance as the website.
 * Ignores client-supplied redirect query params — always lands on Victory Room.
 */
export default async function AppSignInPage() {
  const { userId } = await auth();
  if (userId) {
    redirect(APP_SIGN_IN_SUCCESS_PATH);
  }

  return (
    <main className="min-h-[70vh] w-full overflow-x-hidden bg-[var(--bg)]">
      <AppEmailCodeSignIn />
    </main>
  );
}
