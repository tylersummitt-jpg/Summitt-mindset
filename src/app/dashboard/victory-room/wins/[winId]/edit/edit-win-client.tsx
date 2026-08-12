"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { VictoryWinMediaImage } from "@/components/VictoryWinMediaImage";
import {
  vrAccentLink,
  vrBodyMuted,
  vrLabel,
  vrSectionCard,
  vrSectionTitle,
} from "@/components/victory-room-visual";
import type { PublicWinMediaDto } from "@/lib/v2-win-public-read";
import {
  MANUAL_WIN_DETAILS_MAX,
  MANUAL_WIN_TITLE_MAX,
  type ManualWinSeasonOption,
} from "@/lib/v2-win-manual-fields";
import { uploadVictoryMediaTempObject } from "@/lib/victory-media/browser-put-temp-upload";
import {
  canPreviewVictoryMediaClientMime,
  resolveVictoryMediaClientMime,
  type VictoryMediaClientAllowedMime,
} from "@/lib/victory-media/client-upload-mime";
import { VICTORY_MEDIA_MAX_UPLOAD_BYTES } from "@/lib/victory-media/constants";

type Props = {
  winId: string;
  /** YYYY-MM-DD max selectable (today in user TZ). */
  maxOccurredOn: string;
  initialOccurredOn: string;
  initialTitle: string;
  initialDetails: string;
  initialSeasonId: string;
  expectedUpdatedAt: string;
  seasonOptions: ManualWinSeasonOption[];
  cancelHref: string;
  orphanCommitmentNotice: boolean;
  /** Optional signed card media from server enrichment. */
  media?: PublicWinMediaDto | null;
};

type ReplacePhase = "idle" | "ready" | "uploading" | "replacing" | "failed";

const inputClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#0a0e16] px-4 py-3 text-base text-stone-100 placeholder:text-stone-500 outline-none focus:border-amber-500/40";

const FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

export default function EditWinClient(props: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [details, setDetails] = useState(props.initialDetails);
  const [occurredOn, setOccurredOn] = useState(props.initialOccurredOn);
  const [seasonChoice, setSeasonChoice] = useState(props.initialSeasonId);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(props.expectedUpdatedAt);
  const [currentMedia, setCurrentMedia] = useState<PublicWinMediaDto | null>(
    props.media ?? null
  );
  /** Swap succeeded but signed card unavailable — do not show old photo as canonical. */
  const [photoReplacedPendingDisplay, setPhotoReplacedPendingDisplay] =
    useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);

  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementMime, setReplacementMime] =
    useState<VictoryMediaClientAllowedMime | null>(null);
  const [replacementPreviewUrl, setReplacementPreviewUrl] = useState<string | null>(
    null
  );
  const [replacePhase, setReplacePhase] = useState<ReplacePhase>("idle");
  const [replaceSelectionError, setReplaceSelectionError] = useState<string | null>(
    null
  );

  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const replacementPreviewRef = useRef<string | null>(null);

  const seasonSelectOptions = useMemo(() => props.seasonOptions, [props.seasonOptions]);
  const replaceBusy =
    replacePhase === "uploading" || replacePhase === "replacing";
  const formLocked = saveBusy || removeBusy || replaceBusy || confirmingRemove;

  function revokeReplacementPreview() {
    if (replacementPreviewRef.current) {
      URL.revokeObjectURL(replacementPreviewRef.current);
      replacementPreviewRef.current = null;
    }
    setReplacementPreviewUrl(null);
  }

  function clearReplacement(opts?: { keepSelectionError?: boolean }) {
    setReplacementFile(null);
    setReplacementMime(null);
    revokeReplacementPreview();
    setReplacePhase("idle");
    if (!opts?.keepSelectionError) {
      setReplaceSelectionError(null);
    }
    if (replaceFileInputRef.current) {
      replaceFileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    return () => {
      if (replacementPreviewRef.current) {
        URL.revokeObjectURL(replacementPreviewRef.current);
        replacementPreviewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!confirmingRemove) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConfirmingRemove(false);
        setMediaError(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmingRemove]);

  function onReplacementSelected(fileList: FileList | null) {
    if (formLocked && !replacementFile) return;
    if (replaceBusy) return;
    const file = fileList?.[0] ?? null;
    if (!file) return;

    const mime = resolveVictoryMediaClientMime({ name: file.name, type: file.type });
    if (!mime) {
      clearReplacement({ keepSelectionError: true });
      setReplaceSelectionError(
        "That image type isn’t supported. Use HEIC, JPEG, PNG, or WebP."
      );
      return;
    }
    if (file.size > VICTORY_MEDIA_MAX_UPLOAD_BYTES) {
      clearReplacement({ keepSelectionError: true });
      setReplaceSelectionError(
        "That image is too large (max 12 MB). Choose a smaller photo."
      );
      return;
    }

    revokeReplacementPreview();
    setReplacementFile(file);
    setReplacementMime(mime);
    setReplaceSelectionError(null);
    setMediaError(null);
    setMediaNotice(null);
    setReplacePhase("ready");
    setConfirmingRemove(false);

    if (canPreviewVictoryMediaClientMime(mime)) {
      const url = URL.createObjectURL(file);
      replacementPreviewRef.current = url;
      setReplacementPreviewUrl(url);
    }
  }

  async function onConfirmReplacePhoto() {
    if (replaceBusy || !replacementFile || !replacementMime || !currentMedia?.id) {
      return;
    }
    const expectedMediaId = currentMedia.id.trim();
    if (!expectedMediaId) return;

    setMediaError(null);
    setMediaNotice(null);
    setReplaceSelectionError(null);
    setReplacePhase("uploading");

    try {
      let intentRes: Response;
      try {
        intentRes = await fetch("/api/victory-media/upload-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            declaredMime: replacementMime,
            originalFilename: replacementFile.name,
            winId: props.winId,
          }),
        });
      } catch {
        throw new Error(
          "We couldn’t replace the photo. Your current photo is still there."
        );
      }

      const intentData = (await intentRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
        uploadId?: string;
        signedUrl?: string;
      };

      if (
        !intentRes.ok ||
        !intentData.ok ||
        !intentData.uploadId ||
        !intentData.signedUrl
      ) {
        if (
          intentData.code === "stale_media" ||
          intentRes.status === 409
        ) {
          throw new Error(
            intentData.error ||
              "This photo changed since you opened it. Refresh and try again."
          );
        }
        throw new Error(
          "We couldn’t replace the photo. Your current photo is still there."
        );
      }

      const put = await uploadVictoryMediaTempObject({
        signedUrl: intentData.signedUrl,
        file: replacementFile,
        declaredMime: replacementMime,
      });
      if (!put.ok) {
        throw new Error(
          "We couldn’t replace the photo. Your current photo is still there."
        );
      }

      setReplacePhase("replacing");

      let replaceRes: Response;
      try {
        replaceRes = await fetch(
          `/api/victory-media/win/${encodeURIComponent(props.winId)}/replace`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              uploadId: intentData.uploadId,
              expectedMediaId,
              declaredMime: replacementMime,
              originalFilename: replacementFile.name,
            }),
          }
        );
      } catch {
        throw new Error(
          "We couldn’t replace the photo. Your current photo is still there."
        );
      }

      const replaceData = (await replaceRes.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        error?: string;
        code?: string;
        media?: PublicWinMediaDto | null;
        cardSignFailed?: boolean;
      };

      if (replaceRes.status === 409 || replaceData.code === "stale_media") {
        setReplacePhase("failed");
        setMediaError(
          replaceData.error ||
            "This photo changed since you opened it. Refresh and try again."
        );
        return;
      }

      if (
        !replaceRes.ok ||
        !replaceData.ok ||
        (replaceData.status !== "replaced" && replaceData.status !== "existing")
      ) {
        throw new Error(
          replaceData.error ||
            "We couldn’t replace the photo. Your current photo is still there."
        );
      }

      const nextMedia = replaceData.media ?? null;
      if (
        nextMedia &&
        typeof nextMedia.id === "string" &&
        typeof nextMedia.cardUrl === "string" &&
        typeof nextMedia.width === "number" &&
        typeof nextMedia.height === "number"
      ) {
        setCurrentMedia({
          id: nextMedia.id,
          cardUrl: nextMedia.cardUrl,
          width: nextMedia.width,
          height: nextMedia.height,
        });
        setPhotoReplacedPendingDisplay(false);
        setMediaNotice(null);
      } else {
        // DB swap succeeded; signing failed — do not claim failure or keep old photo.
        setCurrentMedia(null);
        setPhotoReplacedPendingDisplay(true);
        setMediaNotice(
          "Photo replaced. It will appear after you refresh or return to Victory Room."
        );
      }

      clearReplacement();
      setReplacePhase("idle");
      setMediaError(null);
    } catch (err) {
      setReplacePhase("failed");
      setMediaError(
        err instanceof Error
          ? err.message
          : "We couldn’t replace the photo. Your current photo is still there."
      );
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        title,
        details: details.trim() ? details : null,
        occurred_on: occurredOn,
        season_id: seasonChoice.trim() ? seasonChoice.trim() : null,
        expected_updated_at: expectedUpdatedAt,
      };

      const res = await fetch(`/api/v2/wins/${encodeURIComponent(props.winId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        updated_at?: string;
        code?: string;
      };
      if (res.status === 409 || data.code === "conflict") {
        throw new Error(
          data.error || "This Win changed since you opened it. Refresh and try again."
        );
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (typeof data.updated_at === "string" && data.updated_at.trim()) {
        setExpectedUpdatedAt(data.updated_at.trim());
      }
      router.replace(props.cancelHref);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaveBusy(false);
    }
  }

  async function onConfirmRemovePhoto() {
    if (removeBusy || !currentMedia?.id) return;
    const expectedMediaId = currentMedia.id.trim();
    if (!expectedMediaId) return;
    setRemoveBusy(true);
    setMediaError(null);
    try {
      const res = await fetch(
        `/api/victory-media/win/${encodeURIComponent(props.winId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ expectedMediaId }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        error?: string;
        code?: string;
      };
      if (res.status === 409 || data.code === "stale_media") {
        throw new Error(
          data.error ||
            "This photo changed since you opened it. Refresh and try again."
        );
      }
      if (
        res.ok &&
        data.ok &&
        (data.status === "removed" || data.status === "already_absent")
      ) {
        setCurrentMedia(null);
        setPhotoReplacedPendingDisplay(false);
        setConfirmingRemove(false);
        setMediaError(null);
        setMediaNotice(null);
        clearReplacement();
        return;
      }
      throw new Error(
        data.error || "We couldn’t remove the photo. Please try again."
      );
    } catch (err) {
      setMediaError(
        err instanceof Error
          ? err.message
          : "We couldn’t remove the photo. Please try again."
      );
    } finally {
      setRemoveBusy(false);
    }
  }

  const showPhotoSection = Boolean(currentMedia) || photoReplacedPendingDisplay;

  return (
    <div className={vrSectionCard}>
      <p className="mb-6">
        <Link href={props.cancelHref} className={vrAccentLink}>
          ← Cancel
        </Link>
      </p>

      <h1 className={vrSectionTitle}>Edit Win</h1>

      {props.orphanCommitmentNotice ? (
        <p className={`${vrBodyMuted} mt-4 text-sm`}>
          This Win’s Season link isn’t on your list. Choosing Overall only will detach it; pick a
          Season to reattach.
        </p>
      ) : null}

      <form onSubmit={onSave} className="mt-8 space-y-6">
        <div>
          <label htmlFor="edit-win-title" className={vrLabel}>
            What happened?
          </label>
          <input
            id="edit-win-title"
            name="title"
            type="text"
            required
            maxLength={MANUAL_WIN_TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            placeholder="A real moment worth remembering"
            autoComplete="off"
          />
          <p className={`${vrBodyMuted} mt-2 text-xs`}>
            {title.trim().length}/{MANUAL_WIN_TITLE_MAX}
          </p>
        </div>

        <div>
          <label htmlFor="edit-win-details" className={vrLabel}>
            Details <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <textarea
            id="edit-win-details"
            name="details"
            rows={4}
            maxLength={MANUAL_WIN_DETAILS_MAX}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className={`${inputClass} resize-y min-h-[6rem]`}
            placeholder="Anything else you want to remember"
          />
          <p className={`${vrBodyMuted} mt-2 text-xs`}>
            {details.trim().length}/{MANUAL_WIN_DETAILS_MAX}
          </p>
        </div>

        {showPhotoSection ? (
          <div>
            <p className={vrLabel} id="edit-win-photo-label">
              Photo
            </p>
            <div aria-labelledby="edit-win-photo-label">
              {currentMedia ? (
                <VictoryWinMediaImage
                  cardUrl={currentMedia.cardUrl}
                  width={currentMedia.width}
                  height={currentMedia.height}
                />
              ) : photoReplacedPendingDisplay ? (
                <p className={`${vrBodyMuted} mt-2 text-sm`}>
                  Your new photo is saved. It will show after you refresh or return to Victory
                  Room.
                </p>
              ) : null}
            </div>

            {mediaNotice ? (
              <p className={`${vrBodyMuted} mt-3 text-sm`} role="status">
                {mediaNotice}
              </p>
            ) : null}

            <input
              ref={replaceFileInputRef}
              type="file"
              accept={FILE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                onReplacementSelected(e.target.files);
              }}
            />

            {confirmingRemove ? (
              <div className="mt-2">
                <p className="font-medium text-stone-100">Remove this photo?</p>
                <p className={`${vrBodyMuted} mt-2 text-sm`}>
                  This permanently removes the photo. Your Win stays in Victory Room. This
                  can’t be undone.
                </p>
                {mediaError ? (
                  <p className="mt-3 text-sm text-red-300" role="alert">
                    {mediaError}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={`${vrAccentLink} min-h-11 px-1`}
                    disabled={removeBusy}
                    onClick={() => {
                      setConfirmingRemove(false);
                      setMediaError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${vrAccentLink} min-h-11 px-1 text-red-300 decoration-red-400/40 hover:text-red-200`}
                    disabled={removeBusy}
                    onClick={() => void onConfirmRemovePhoto()}
                  >
                    {removeBusy ? "Removing…" : "Remove photo"}
                  </button>
                </div>
              </div>
            ) : replacementFile && replacementMime ? (
              <div className="mt-2">
                <p className={`${vrBodyMuted} text-sm`}>
                  New photo: <span className="text-stone-200">{replacementFile.name}</span>
                </p>
                {replacementPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview only
                  <img
                    src={replacementPreviewUrl}
                    alt=""
                    className="mt-3 max-h-40 rounded-lg object-contain"
                  />
                ) : null}
                {replaceSelectionError ? (
                  <p className="mt-3 text-sm text-red-300" role="alert">
                    {replaceSelectionError}
                  </p>
                ) : null}
                {mediaError ? (
                  <p className="mt-3 text-sm text-red-300" role="alert">
                    {mediaError}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={`${vrAccentLink} min-h-11 px-1`}
                    disabled={replaceBusy}
                    onClick={() => {
                      clearReplacement();
                      setMediaError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${vrAccentLink} min-h-11 px-1`}
                    disabled={replaceBusy || saveBusy}
                    onClick={() => void onConfirmReplacePhoto()}
                  >
                    {replacePhase === "uploading" || replacePhase === "replacing"
                      ? "Replacing photo…"
                      : "Replace photo"}
                  </button>
                </div>
              </div>
            ) : currentMedia ? (
              <div className="mt-2">
                {replaceSelectionError ? (
                  <p className="mb-3 text-sm text-red-300" role="alert">
                    {replaceSelectionError}
                  </p>
                ) : null}
                {mediaError ? (
                  <p className="mb-3 text-sm text-red-300" role="alert">
                    {mediaError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={`${vrAccentLink} min-h-11 px-1`}
                    disabled={formLocked}
                    onClick={() => {
                      setMediaError(null);
                      setReplaceSelectionError(null);
                      replaceFileInputRef.current?.click();
                    }}
                  >
                    Replace photo
                  </button>
                  <button
                    type="button"
                    className={`${vrAccentLink} min-h-11 px-1`}
                    disabled={formLocked}
                    onClick={() => {
                      setMediaError(null);
                      setConfirmingRemove(true);
                    }}
                  >
                    Remove photo
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <label htmlFor="edit-win-date" className={vrLabel}>
            Date
          </label>
          <input
            id="edit-win-date"
            name="occurred_on"
            type="date"
            required
            max={props.maxOccurredOn}
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="edit-win-season" className={vrLabel}>
            Season <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <select
            id="edit-win-season"
            name="season_id"
            value={seasonChoice}
            onChange={(e) => setSeasonChoice(e.target.value)}
            className={inputClass}
          >
            <option value="">Overall only</option>
            {seasonSelectOptions.map((opt) => (
              <option key={opt.seasonId} value={opt.seasonId}>
                {opt.pickerLabel.replace(/\n/g, " · ")}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p className="text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saveBusy || replaceBusy || removeBusy}
          className="inline-flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 px-5 py-3 text-base font-semibold text-amber-50 transition hover:bg-amber-500/25 disabled:opacity-60 sm:w-auto"
        >
          {saveBusy ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
