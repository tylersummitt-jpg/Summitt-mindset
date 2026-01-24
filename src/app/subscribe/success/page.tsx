"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";

type ConfirmState = "idle" | "saving" | "success" | "error";

function SubscribeSuccessInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoaded } = useUser();

  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<ConfirmState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !isLoaded) return;

    async function confirm() {
      try {
        setState("saving");
        const res = await fetch("/api/stripe/confirm-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        if (!res.ok) throw new Error(await res.text());
        await res.json();
        if (user) await user.reload();
        setState("success");
      } catch (err: any) {
        setError(err.message);
        setState("error");
      }
    }

    confirm();
  }, [sessionId, isLoaded, user]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      {state === "saving" && <p>Finalizing your membership…</p>}
      {state === "success" && <button onClick={() => router.push("/dashboard")}>Go to Dashboard</button>}
      {state === "error" && <p className="text-red-600">{error}</p>}
    </main>
  );
}

export default function SubscribeSuccessPage() {
  return (
    <Suspense fallback={<p>Finalizing…</p>}>
      <SubscribeSuccessInner />
    </Suspense>
  );
}
