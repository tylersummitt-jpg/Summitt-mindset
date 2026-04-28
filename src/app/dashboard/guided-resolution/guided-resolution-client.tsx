"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type View = "identity" | "commitment" | "tighten" | "none" | "expired";

export default function GuidedResolutionClient(props: {
  view: View;
  prefilledIdentity: string;
  prefilledCommitment: string;
  prefilledTighten: string;
}) {
  const router = useRouter();
  const [identityText, setIdentityText] = useState(props.prefilledIdentity);
  const [commitmentText, setCommitmentText] = useState(props.prefilledCommitment);
  const [tightenText, setTightenText] = useState(props.prefilledTighten);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function postJson(url: string, json: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
  }

  async function onSaveIdentity() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/v2/guided-resolution/identity", {
        identity_anchor_text: identityText,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveCommitment() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/v2/guided-resolution/commitment", {
        behavior_statement: commitmentText,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveTighten() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/v2/guided-resolution/tighten", {
        proposal_binding_text: tightenText,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAbandon() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/v2/guided-resolution/abandon", {});
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }

  if (props.view === "expired") {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold text-neutral-100">Link expired</h1>
        <p className="mt-3 text-sm text-neutral-400">
          This guided update window closed. You can change your identity or commitment anytime from
          your usual settings when you are ready.
        </p>
        <button
          type="button"
          className="mt-6 rounded-md bg-neutral-700 px-4 py-2 text-sm text-white hover:bg-neutral-600"
          onClick={() => router.push("/dashboard")}
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (props.view === "none") {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold text-neutral-100">Nothing to finish</h1>
        <p className="mt-3 text-sm text-neutral-400">
          There is no guided update waiting. If you still want to make a change, use your profile or
          accountability settings from the dashboard.
        </p>
        <button
          type="button"
          className="mt-6 rounded-md bg-neutral-700 px-4 py-2 text-sm text-white hover:bg-neutral-600"
          onClick={() => router.push("/dashboard")}
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const title =
    props.view === "identity"
      ? "Update your identity line"
      : props.view === "commitment"
        ? "Update your focus"
        : "Set a smaller bar";

  const subtitle =
    props.view === "identity"
      ? "You chose CHANGE on the alignment check. Save when this still feels right."
      : props.view === "commitment"
        ? "You chose NEW on the alignment check. One line is enough—we will hold you to it."
        : "You chose TIGHTEN. Edit the suggested smaller bar, then save. We will text you YES/NO to lock it in—reply on SMS to confirm.";

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-xl font-semibold text-neutral-100">{title}</h1>
      <p className="mt-2 text-sm text-neutral-400">{subtitle}</p>

      {error ? (
        <p className="mt-4 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</p>
      ) : null}

      {props.view === "identity" ? (
        <label className="mt-6 block">
          <span className="text-sm font-medium text-neutral-300">Identity line</span>
          <textarea
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            rows={4}
            value={identityText}
            onChange={(e) => setIdentityText(e.target.value)}
            disabled={busy}
          />
        </label>
      ) : props.view === "commitment" ? (
        <label className="mt-6 block">
          <span className="text-sm font-medium text-neutral-300">Accountability focus</span>
          <textarea
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            rows={4}
            value={commitmentText}
            onChange={(e) => setCommitmentText(e.target.value)}
            disabled={busy}
          />
        </label>
      ) : (
        <label className="mt-6 block">
          <span className="text-sm font-medium text-neutral-300">Smaller bar (proposal)</span>
          <textarea
            className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            rows={4}
            value={tightenText}
            onChange={(e) => setTightenText(e.target.value)}
            disabled={busy}
          />
        </label>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          disabled={busy}
          onClick={
            props.view === "identity"
              ? onSaveIdentity
              : props.view === "commitment"
                ? onSaveCommitment
                : onSaveTighten
          }
        >
          Save
        </button>
        <button
          type="button"
          className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          disabled={busy}
          onClick={onAbandon}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
