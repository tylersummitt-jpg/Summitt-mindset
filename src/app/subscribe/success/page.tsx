"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SubscribeSuccessPage() {
  const router = useRouter();

  useEffect(() => {
    // Give webhook 2 seconds to hydrate Clerk metadata
    const t = setTimeout(() => {
      router.push("/dashboard");
    }, 2000);

    return () => clearTimeout(t);
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-center px-6">
      <div className="space-y-4 max-w-md">
        <h1 className="text-3xl font-semibold">
          Welcome to Summitt Mindset.
        </h1>

        <p className="text-gray-600">
          Your membership is active.
          <br />
          Coach Pat will meet you inside today’s practice.
        </p>

        <p className="text-sm text-gray-500">
          Taking you to Day 1…
        </p>
      </div>
    </main>
  );
}
