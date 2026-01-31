"use client";

import {
  UserProfile,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
} from "@clerk/nextjs";

import ManageMembershipButton from "@/components/manage-membership-button";

export default function UserProfilePage() {
  return (
    <>
      <SignedIn>
        <main className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-16">
          {/* ✅ Membership Management */}
          <section className="text-center space-y-3">
            <h1 className="text-2xl font-semibold">Account</h1>
            <p className="text-sm text-gray-600">
              Manage your membership, billing, and profile settings.
            </p>

            <ManageMembershipButton />
          </section>

          {/* ✅ Clerk Profile */}
          <div className="w-full max-w-4xl">
            <UserProfile />
          </div>
        </main>
      </SignedIn>

      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
