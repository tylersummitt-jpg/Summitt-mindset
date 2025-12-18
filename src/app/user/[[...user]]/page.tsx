"use client";

import {
  UserProfile,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
} from "@clerk/nextjs";

export default function UserProfilePage() {
  return (
    <>
      <SignedIn>
        <div className="min-h-[80vh] flex items-center justify-center">
          <UserProfile />
        </div>
      </SignedIn>

      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
