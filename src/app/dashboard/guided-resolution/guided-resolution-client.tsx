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

  const memberShellClass = "mx-auto max-w-2xl px-6 py-10";

  if (props.view === "expired") {
    return (
      <div className={memberShellClass}>
        <h1 className="text-xl font-semibold text-gray-900">Link expired</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          This guided update window closed. You can change your identity or commitment anytime from
          your usual settings when you are ready.
        </p>
        <button
          type="button"
          className="mt-6 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          onClick={() => router.push("/dashboard")}
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (props.view === "none") {
    return (
      <div className={memberShellClass}>
        <h1 className="text-xl font-semibold text-gray-900">Nothing to finish</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          There is no guided update waiting. If you still want to make a change, use your profile or
          accountability settings from the dashboard.
        </p>
        <button
          type="button"
          className="mt-6 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
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

  const textareaClass =
    "mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500";

  return (
    <div className={memberShellClass}>
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{subtitle}</p>

      {error ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {props.view === "identity" ? (
        <label className="mt-6 block">
          <span className="text-sm font-medium text-gray-800">Identity line</span>
          <textarea
            className={textareaClass}
            rows={4}
            value={identityText}
            onChange={(e) => setIdentityText(e.target.value)}
            disabled={busy}
          />
        </label>
      ) : props.view === "commitment" ? (
        <label className="mt-6 block">
          <span className="text-sm font-medium text-gray-800">Accountability focus</span>
          <textarea
            className={textareaClass}
            rows={4}
            value={commitmentText}
            onChange={(e) => setCommitmentText(e.target.value)}
            disabled={busy}
          />
        </label>
      ) : (
        <label className="mt-6 block">
          <span className="text-sm font-medium text-gray-800">Smaller bar (proposal)</span>
          <textarea
            className={textareaClass}
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
          className="member-attention-cta disabled:cursor-not-allowed disabled:opacity-50"
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
          className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={onAbandon}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
