"use client";

import Link from "next/link";
import { useState } from "react";
import { IdentityBuilderClient } from "@/components/IdentityBuilderClient";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import type { IdentityEditDraft } from "@/lib/load-identity-edit-draft";
import type { ImportantPersonRow } from "@/lib/onboarding-identity-ui";

type Props = {
  draft: IdentityEditDraft;
};

export default function EditIdentityClient({ draft }: Props) {
  const [step, setStep] = useState<"edit" | "success">("edit");

  const importantPeople: ImportantPersonRow[] = draft.importantPeople.map((p) => ({
    display_name: p.display_name,
    relationship_type: p.relationship_type,
  }));

  if (step === "success") {
    return (
      <div className="mx-auto max-w-2xl min-w-0 px-6 py-8 pb-10 md:py-10">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-md shadow-gray-900/[0.05] ring-1 ring-black/[0.04] sm:p-8 space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-gray-900">Identity saved</h1>
            <p className="text-sm leading-relaxed text-gray-700">
              Does your current goal still fit who you&apos;re becoming?
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href={MEMBER_APP_HOME_PATH}
              className="inline-flex items-center justify-center rounded-md bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white"
            >
              Keep current goal
            </Link>
            <Link
              href="/dashboard/update-goal"
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-900"
            >
              Update my goal
            </Link>
            <Link
              href={MEMBER_APP_HOME_PATH}
              className="inline-flex items-center justify-center px-5 py-3 text-sm font-medium text-gray-700 underline underline-offset-2"
            >
              Back to Victory Room
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl min-w-0 px-6 py-8 pb-10 md:py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 md:text-3xl">
          Edit identity
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          Update who Coach Pat is helping you become. Your current goal stays the same unless you
          choose to change it after saving.
        </p>
      </header>

      <div className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-md shadow-gray-900/[0.05] ring-1 ring-black/[0.04] sm:p-8">
        <IdentityBuilderClient
          mode="app_edit"
          saveEndpoint="/api/v2/identity/edit"
          backHref={MEMBER_APP_HOME_PATH}
          backLabel="Back to Victory Room"
          continueLabel="Save identity"
          expectedActiveVersionId={draft.activeIdentityVersionId}
          initialPreferredName={draft.preferredName}
          initialIdentityAnchor={draft.identityAnchorText}
          initialIngredientIds={draft.ingredientIds}
          initialOtherText={draft.otherText}
          initialImportantPeople={importantPeople}
          onSaveSuccess={async () => {
            setStep("success");
          }}
        />
      </div>
    </div>
  );
}
