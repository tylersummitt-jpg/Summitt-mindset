// src/app/sign-out/page.tsx

"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useEffect } from "react";

/**
 * ======================================================
 * Sign Out Page (CANONICAL)
 * ======================================================
 *
 * This page exists for one reason:
 * - Give us a guaranteed way to sign out
 * - Works in dev + production
 * - Removes reliance on Clerk UI
 *
 * Behavior:
 * - Immediately signs the user out
 * - Sends them back to /
 */

export default function SignOutPage() {
  /**
   * NOTE:
   * SignOutButton requires a click.
   * But we can auto-click it for a clean UX.
   */

  useEffect(() => {
    const btn = document.getElementById("auto-signout-btn");
    if (btn) btn.click();
  }, []);

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-semibold">Signing you out…</h1>
        <p className="text-sm text-gray-600">
          Just a second. You’ll be returned to the homepage.
        </p>

        {/* This auto-clicks instantly on page load */}
        <SignOutButton redirectUrl="/">
          <button
            id="auto-signout-btn"
            className="hidden"
            aria-hidden="true"
          />
        </SignOutButton>
      </div>
    </main>
  );
}
