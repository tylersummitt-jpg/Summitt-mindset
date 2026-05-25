"use client";

import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  countSelectedIngredients,
  IDENTITY_INGREDIENTS,
  IDENTITY_INGREDIENT_OTHER_ID,
  getMutualExclusiveGroupMembers,
  MAX_IDENTITY_INGREDIENTS,
  normalizeIngredientIds,
  toggleIdentityIngredient,
} from "@/lib/onboarding-identity-templates";
import {
  buildImportantPeopleFromFields,
  importantPeopleFieldsFromRows,
  isGenericWeakIdentityAnchor,
  showsGrandkidsNamesField,
  showsKidsNamesField,
  showsLeadServeField,
  showsSpouseNameField,
  WEAK_IDENTITY_PROMPT,
  WEAK_IDENTITY_SUGGESTIONS,
  type ImportantPeopleFieldValues,
  type ImportantPersonRow,
} from "@/lib/onboarding-identity-ui";

const WRITE_OWN_PLACEHOLDER =
  "I am committed to being a steady presence for my family and a consistent leader for my organization.";

export const GENERATION_FAILURE_ESCAPE_MESSAGE =
  "Coach Pat couldn't generate options right now. You can still write your own.";

export const EDIT_GENERATED_OPTION_LABEL = "Edit this below";

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function strFromSaved(v: string | null | undefined): string {
  return typeof v === "string" ? v : "";
}

export type IdentityBuilderInitial = {
  initialPreferredName?: string | null;
  initialIdentityAnchor?: string | null;
  initialIngredientIds?: string[];
  initialOtherText?: string | null;
  initialImportantPeople?: ImportantPersonRow[];
  initialGeneratedOptions?: string[];
  initialEditorMode?: "closed" | "write-own" | "edit";
  initialGenerationFailed?: boolean;
};

export type IdentityBuilderCopy = {
  nameSectionTitle?: string;
  nameSectionHelper?: string;
  identityTitle?: string;
  identityIntro?: string;
  identityHelper?: string;
};

export type IdentityBuilderClientProps = IdentityBuilderInitial & {
  mode: "onboarding" | "app_edit";
  saveEndpoint: string;
  generateEndpoint?: string;
  backHref: string;
  continueLabel: string;
  backLabel?: string;
  copy?: IdentityBuilderCopy;
  expectedActiveVersionId?: string | null;
  onSaveSuccess: (result: {
    versionId?: string;
    identity_anchor_text?: string;
  }) => void | Promise<void>;
};

const DEFAULT_COPY: Required<IdentityBuilderCopy> = {
  nameSectionTitle: "What should Coach Pat call you?",
  nameSectionHelper:
    "Use your first name or a nickname. This is how Coach Pat will address you in texts.",
  identityTitle: "My Identity",
  identityIntro: "Let's build the identity statement Coach Pat will hold you to.",
  identityHelper:
    "Choose what matters most right now. Coach Pat will help turn it into one clear line.",
};

const APP_EDIT_DEFAULT_COPY: Partial<IdentityBuilderCopy> = {
  identityIntro: "Update the identity statement Coach Pat will hold you to.",
  identityHelper:
    "Adjust what matters most right now. Your current goal stays the same unless you choose to change it after saving.",
};

export function IdentityBuilderClient({
  mode,
  saveEndpoint,
  generateEndpoint = "/api/onboarding/generate-identity-options",
  backHref,
  continueLabel,
  backLabel = "Back",
  copy: copyOverrides,
  expectedActiveVersionId,
  onSaveSuccess,
  initialPreferredName,
  initialIdentityAnchor,
  initialIngredientIds = [],
  initialOtherText = null,
  initialImportantPeople = [],
  initialGeneratedOptions = [],
  initialEditorMode = "closed",
  initialGenerationFailed = false,
}: IdentityBuilderClientProps): ReactElement {
  const modeCopy = mode === "app_edit" ? APP_EDIT_DEFAULT_COPY : {};
  const copy = { ...DEFAULT_COPY, ...modeCopy, ...copyOverrides };

  const resumeIdentity = strFromSaved(initialIdentityAnchor);

  const [preferredName, setPreferredName] = useState(() =>
    strFromSaved(initialPreferredName)
  );
  const [ingredientIds, setIngredientIds] = useState<string[]>(() =>
    normalizeIngredientIds(initialIngredientIds)
  );
  const [otherText, setOtherText] = useState(() => strFromSaved(initialOtherText));
  const [identityAnchor, setIdentityAnchor] = useState(() => resumeIdentity);
  const [peopleFields, setPeopleFields] = useState<ImportantPeopleFieldValues>(() =>
    importantPeopleFieldsFromRows(initialImportantPeople)
  );

  const [generatedOptions, setGeneratedOptions] = useState<string[]>(initialGeneratedOptions);
  const [generating, setGenerating] = useState(false);
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(initialGeneratedOptions.length > 0);
  const [selectedGeneratedOption, setSelectedGeneratedOption] = useState<string | null>(() =>
    resumeIdentity && initialGeneratedOptions.includes(resumeIdentity) ? resumeIdentity : null
  );
  const [editorMode, setEditorMode] = useState<"closed" | "write-own" | "edit">(
    initialEditorMode
  );
  const [intakeOrigin, setIntakeOrigin] = useState<"user_written" | "generated" | "template">(
    resumeIdentity ? "generated" : "user_written"
  );
  const [weakAccept, setWeakAccept] = useState(false);
  const [showWeakPanel, setShowWeakPanel] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(initialGenerationFailed);

  const identityEditorRef = useRef<HTMLTextAreaElement>(null);
  const pendingGeneratedEditorFocus = useRef(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingredientLimitNotice, setIngredientLimitNotice] = useState(false);

  const importantPeople = useMemo(
    () => buildImportantPeopleFromFields(ingredientIds, peopleFields),
    [ingredientIds, peopleFields]
  );

  const showOtherField = ingredientIds.includes(IDENTITY_INGREDIENT_OTHER_ID);
  const showKidsField = showsKidsNamesField(ingredientIds);
  const showSpouseField = showsSpouseNameField(ingredientIds);
  const showGrandkidsField = showsGrandkidsNamesField(ingredientIds);
  const showLeadServeField = showsLeadServeField(ingredientIds);
  const showImportantPeopleSection =
    showKidsField || showSpouseField || showGrandkidsField || showLeadServeField;

  const selectedIngredientCount = useMemo(
    () => countSelectedIngredients(ingredientIds),
    [ingredientIds]
  );

  const hasFinalIdentity = normalizeText(identityAnchor).length > 0;
  const showGeneratedOptions = generatedOptions.length > 0;
  const showPostGenerateActions = hasGeneratedOnce && showGeneratedOptions;
  const showGenerationFailureEscape = generationFailed && !showGeneratedOptions;
  const showEditorTextarea = editorMode === "write-own" || editorMode === "edit";
  const showResumeIdentity =
    resumeIdentity.length > 0 &&
    !showGeneratedOptions &&
    !showEditorTextarea &&
    editorMode === "closed";

  const canContinue =
    normalizeText(preferredName).length > 0 &&
    hasFinalIdentity &&
    !(showWeakPanel && !weakAccept);

  useEffect(() => {
    if (!pendingGeneratedEditorFocus.current || editorMode !== "edit") return;
    pendingGeneratedEditorFocus.current = false;
    const el = identityEditorRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    });
  }, [editorMode]);

  function toggleIngredient(id: string) {
    setIngredientLimitNotice(false);
    const { next, limitReached } = toggleIdentityIngredient(ingredientIds, id);
    if (limitReached) {
      setIngredientLimitNotice(true);
      return;
    }
    setIngredientIds(next);
  }

  function updatePeopleField<K extends keyof ImportantPeopleFieldValues>(
    key: K,
    value: ImportantPeopleFieldValues[K]
  ) {
    setPeopleFields((prev) => ({ ...prev, [key]: value }));
  }

  function markGenerationFailed() {
    setGenerationFailed(true);
    setGeneratedOptions([]);
  }

  async function handleGenerate() {
    setError(null);
    setShowWeakPanel(false);
    setWeakAccept(false);

    const name = normalizeText(preferredName);
    if (!name) {
      setError("Add what Coach Pat should call you.");
      return;
    }
    if (ingredientIds.length === 0) {
      setError("Choose at least one identity ingredient first.");
      return;
    }

    setGenerating(true);
    try {
      const draftWords =
        resumeIdentity && normalizeText(identityAnchor)
          ? normalizeText(identityAnchor)
          : null;
      const res = await fetch(generateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          preferred_name: name,
          ingredient_ids: ingredientIds,
          other_text: showOtherField ? otherText.trim() || null : null,
          important_people: importantPeople,
          user_written_words: draftWords,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        options?: unknown;
      };
      if (!res.ok) {
        markGenerationFailed();
        return;
      }
      const options = Array.isArray(data.options)
        ? data.options.filter(
            (option): option is string =>
              typeof option === "string" && normalizeText(option).length >= 12
          )
        : [];
      if (options.length === 0) {
        markGenerationFailed();
        return;
      }
      setGenerationFailed(false);
      setGeneratedOptions(options);
      setHasGeneratedOnce(true);
      setEditorMode("closed");
    } catch {
      markGenerationFailed();
    } finally {
      setGenerating(false);
    }
  }

  function useGeneratedOption(option: string) {
    setIdentityAnchor(option);
    setSelectedGeneratedOption(option);
    setIntakeOrigin("generated");
    setEditorMode("closed");
    setShowWeakPanel(false);
    setWeakAccept(false);
  }

  function editGeneratedOption(option: string) {
    setIdentityAnchor(option);
    setSelectedGeneratedOption(option);
    setIntakeOrigin("user_written");
    pendingGeneratedEditorFocus.current = true;
    setEditorMode("edit");
    setShowWeakPanel(false);
    setWeakAccept(false);
  }

  function startWriteOwn() {
    setIdentityAnchor("");
    setSelectedGeneratedOption(null);
    setEditorMode("write-own");
    setIntakeOrigin("user_written");
    setShowWeakPanel(false);
    setWeakAccept(false);
  }

  function startEditSavedIdentity() {
    setEditorMode("edit");
    setIntakeOrigin("user_written");
    setShowWeakPanel(false);
  }

  function useSuggestion(suggestion: string) {
    setIdentityAnchor(suggestion);
    setSelectedGeneratedOption(null);
    setIntakeOrigin("generated");
    setEditorMode("closed");
    setShowWeakPanel(false);
    setWeakAccept(false);
  }

  async function handleContinue() {
    setError(null);

    const name = normalizeText(preferredName);
    if (!name) {
      setError("Add what Coach Pat should call you.");
      return;
    }

    const anchor = normalizeText(identityAnchor);
    if (!anchor) {
      setError("Choose or write your identity statement.");
      return;
    }

    if (isGenericWeakIdentityAnchor(anchor) && !weakAccept) {
      setShowWeakPanel(true);
      return;
    }

    const payload: Record<string, unknown> = {
      preferred_name: name,
      identity_anchor_text: anchor,
      ingredient_ids: ingredientIds,
      other_text: showOtherField ? otherText.trim() || null : null,
      intake_origin: intakeOrigin,
      intake_weak_accept: weakAccept,
      use_mine_anyway: weakAccept,
      important_people: importantPeople,
      replace_important_people: true,
    };

    if (expectedActiveVersionId) {
      payload.expected_active_version_id = expectedActiveVersionId;
    }

    setSaving(true);

    try {
      const res = await fetch(saveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        versionId?: string;
        identity_anchor_text?: string;
        ok?: boolean;
        success?: boolean;
      };

      if (!res.ok) {
        if (res.status === 401) {
          setError("Your session expired. Please sign in again.");
        } else if (res.status === 409) {
          setError(
            typeof data?.error === "string"
              ? data.error
              : "Your identity was updated elsewhere. Refresh and try again."
          );
        } else if (typeof data?.error === "string") {
          const msg = data.error;
          if (msg.toLowerCase().includes("anyway") || msg.includes("specific")) {
            setShowWeakPanel(true);
          } else {
            setError(msg);
          }
        } else {
          setError("Something went wrong. Please try again.");
        }
        setSaving(false);
        return;
      }

      await onSaveSuccess({
        versionId: data.versionId,
        identity_anchor_text: data.identity_anchor_text ?? anchor,
      });
      setSaving(false);
    } catch {
      setError("Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-xl font-bold text-gray-900">{copy.nameSectionTitle}</h2>
        <p className="text-sm text-gray-600">{copy.nameSectionHelper}</p>
        <input
          type="text"
          value={preferredName}
          onChange={(e) => setPreferredName(e.target.value)}
          className="w-full border rounded-lg p-4 text-sm"
          placeholder="Your first name or nickname"
          aria-label="What should Coach Pat call you?"
        />
      </section>

      <section className="space-y-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-gray-900">{copy.identityTitle}</h2>
          <p className="text-gray-700">{copy.identityIntro}</p>
          <p className="text-sm text-gray-600">{copy.identityHelper}</p>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-900">
            Select all that apply. Pick a few that fit. You can change this later.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Pick up to {MAX_IDENTITY_INGREDIENTS}. {selectedIngredientCount}/
            {MAX_IDENTITY_INGREDIENTS} selected
          </p>
          {ingredientLimitNotice ? (
            <p className="mt-2 text-xs text-amber-800">
              You can pick up to {MAX_IDENTITY_INGREDIENTS} for now.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {IDENTITY_INGREDIENTS.map((item) => {
              const on = ingredientIds.includes(item.id);
              const groupMembers = getMutualExclusiveGroupMembers(item.id);
              const groupHasSelection =
                groupMembers != null && groupMembers.some((gid) => ingredientIds.includes(gid));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleIngredient(item.id)}
                  className={[
                    "px-3 py-1.5 rounded-full text-sm border transition text-left",
                    on
                      ? "bg-[var(--brand)] text-white border-[var(--brand)]"
                      : groupHasSelection && groupMembers?.includes(item.id)
                        ? "bg-white text-gray-700 border-gray-300 hover:border-[var(--brand)]"
                        : "bg-white text-gray-700 border-gray-300",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {showOtherField ? (
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">
              What would you add?
            </label>
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              className="w-full border rounded-lg p-4 text-sm"
              placeholder="Example: artist, musician, volunteer, protector, builder, etc."
            />
          </div>
        ) : null}

        {showImportantPeopleSection ? (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-900">Optional — for Coach Pat only</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              Names stay private. They are never shown publicly or to affiliates, and Pat uses them
              sparingly.
            </p>

            {showKidsField ? (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Kids&apos; first names <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={peopleFields.kidsNames}
                  onChange={(e) => updatePeopleField("kidsNames", e.target.value)}
                  className="w-full border rounded-lg p-3 text-sm bg-white"
                  placeholder="Child name(s)"
                />
              </div>
            ) : null}

            {showSpouseField ? (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Spouse or partner&apos;s first name{" "}
                  <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={peopleFields.spouseName}
                  onChange={(e) => updatePeopleField("spouseName", e.target.value)}
                  className="w-full border rounded-lg p-3 text-sm bg-white"
                  placeholder="Your spouse or partner's first name"
                />
              </div>
            ) : null}

            {showGrandkidsField ? (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Grandkids&apos; first names{" "}
                  <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={peopleFields.grandkidsNames}
                  onChange={(e) => updatePeopleField("grandkidsNames", e.target.value)}
                  className="w-full border rounded-lg p-3 text-sm bg-white"
                  placeholder="Grandchild name(s)"
                />
              </div>
            ) : null}

            {showLeadServeField ? (
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Who do you lead or serve?{" "}
                  <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={peopleFields.leadServeText}
                  onChange={(e) => updatePeopleField("leadServeText", e.target.value)}
                  className="w-full border rounded-lg p-3 text-sm bg-white"
                  placeholder="My team, players, students, staff, etc."
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {!hasGeneratedOnce && !showResumeIdentity ? (
          <div className="space-y-2">
            {showGenerationFailureEscape ? (
              <p className="text-sm text-gray-700">{GENERATION_FAILURE_ESCAPE_MESSAGE}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || ingredientIds.length === 0}
                className="w-full sm:w-auto bg-[var(--brand)] text-white px-5 py-3 rounded-md text-sm font-semibold disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate identity statements"}
              </button>
              {showGenerationFailureEscape ? (
                <button
                  type="button"
                  onClick={startWriteOwn}
                  className="px-4 py-2 rounded-md border text-sm font-medium"
                >
                  Write my own
                </button>
              ) : null}
            </div>
            {ingredientIds.length === 0 ? (
              <p className="text-xs text-gray-500">Choose at least one identity ingredient first.</p>
            ) : null}
          </div>
        ) : null}

        {showResumeIdentity ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-900">Your identity statement</p>
            <div className="rounded-lg border-2 border-[var(--brand)] bg-white p-4 text-sm text-gray-800">
              {identityAnchor}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || ingredientIds.length === 0}
                className="px-4 py-2 rounded-md border text-sm font-medium disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate more"}
              </button>
              <button
                type="button"
                onClick={startEditSavedIdentity}
                className="px-4 py-2 rounded-md border text-sm font-medium"
              >
                Edit this
              </button>
            </div>
          </div>
        ) : null}

        {showGeneratedOptions ? (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-gray-900">Choose a statement</p>
            <ul className="space-y-3">
              {generatedOptions.map((opt) => {
                const selected = selectedGeneratedOption === opt;
                return (
                  <li key={opt}>
                    <div
                      className={[
                        "rounded-lg border p-4 text-sm text-gray-800",
                        selected ? "border-2 border-[var(--brand)] bg-white" : "border-gray-200",
                      ].join(" ")}
                    >
                      {opt}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => useGeneratedOption(opt)}
                        className="text-sm font-medium text-[var(--brand)] underline underline-offset-2"
                      >
                        Use this
                      </button>
                      <button
                        type="button"
                        onClick={() => editGeneratedOption(opt)}
                        className="text-sm font-medium text-gray-700 underline underline-offset-2"
                        aria-label={`${EDIT_GENERATED_OPTION_LABEL}: ${opt}`}
                      >
                        {EDIT_GENERATED_OPTION_LABEL}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {showEditorTextarea ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-900">
              {editorMode === "write-own" ? "Write your identity statement" : "Edit your statement"}
            </p>
            <textarea
              ref={identityEditorRef}
              value={identityAnchor}
              onChange={(e) => {
                setIdentityAnchor(e.target.value);
                setIntakeOrigin("user_written");
                setSelectedGeneratedOption(null);
                setWeakAccept(false);
                setShowWeakPanel(false);
              }}
              rows={3}
              className="w-full border rounded-lg p-4 text-sm"
              placeholder={editorMode === "write-own" ? WRITE_OWN_PLACEHOLDER : undefined}
              aria-label={
                editorMode === "write-own"
                  ? "Write your identity statement"
                  : "Edit your identity statement below"
              }
            />
          </div>
        ) : null}

        {showPostGenerateActions ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || ingredientIds.length === 0}
              className="px-4 py-2 rounded-md border text-sm font-medium disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate more"}
            </button>
            <button
              type="button"
              onClick={startWriteOwn}
              className="px-4 py-2 rounded-md border text-sm font-medium"
            >
              Write my own
            </button>
          </div>
        ) : null}

        {showWeakPanel ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 space-y-4">
            <p>{WEAK_IDENTITY_PROMPT}</p>
            <ul className="space-y-2">
              {WEAK_IDENTITY_SUGGESTIONS.map((suggestion) => (
                <li key={suggestion} className="rounded-md border border-amber-100 bg-white/70 p-3">
                  {suggestion}
                  <button
                    type="button"
                    onClick={() => useSuggestion(suggestion)}
                    className="mt-2 block text-sm font-medium text-[var(--brand)] underline underline-offset-2"
                  >
                    Use suggestion
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setWeakAccept(true);
                  setShowWeakPanel(false);
                }}
                className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium"
              >
                Use mine anyway
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || ingredientIds.length === 0}
                className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                Generate more
              </button>
              <button
                type="button"
                onClick={() => {
                  if (identityAnchor) {
                    setEditorMode("edit");
                  } else {
                    startWriteOwn();
                  }
                }}
                className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium"
              >
                Edit
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-4">
        <Link href={backHref} className="text-gray-600 text-sm underline">
          {backLabel}
        </Link>
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving || !canContinue}
          className="flex-1 bg-[var(--brand)] text-white py-3 rounded-md font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : continueLabel}
        </button>
      </div>
    </div>
  );
}
