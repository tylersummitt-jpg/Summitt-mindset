"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  vrAccentLink,
  vrBody,
  vrBodyMuted,
  vrLabel,
  vrSectionCard,
  vrSectionTitle,
} from "@/components/victory-room-visual";
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

function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

type Props = {
  timeZone: string;
  defaultOccurredOn: string;
  /** When set, Season is fixed (no picker). */
  lockedSeason: {
    seasonId: string;
    seasonName: string;
    goalLabel: string | null;
  } | null;
  seasonOptions: ManualWinSeasonOption[];
  /** Where user came from for cancel link. */
  cancelHref: string;
};

type BusyPhase =
  | "idle"
  | "creating_win"
  | "uploading_photo"
  | "finalizing_photo"
  | "win_saved_photo_failed";

type PhotoFailureKind =
  | "unsupported"
  | "too_large"
  | "network"
  | "deletion"
  | "generic";

const inputClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#0a0e16] px-4 py-3 text-base text-stone-100 placeholder:text-stone-500 outline-none focus:border-amber-500/40";

const FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

function mapApiPhotoFailure(code: string | undefined): PhotoFailureKind {
  switch (code) {
    case "unsupported_mime":
    case "unsupported_format":
    case "dangerous_svg":
    case "animated_gif_not_supported":
      return "unsupported";
    case "too_large":
    case "too_large_bytes":
    case "too_many_pixels":
      return "too_large";
    case "account_deletion_in_progress":
      return "deletion";
    default:
      return "generic";
  }
}

function photoFailureDetail(kind: PhotoFailureKind): string {
  switch (kind) {
    case "unsupported":
      return "That image type isn’t supported. Use HEIC, JPEG, PNG, or WebP.";
    case "too_large":
      return "That image is too large. Choose a smaller photo, or continue without one.";
    case "network":
      return "A network problem interrupted the upload. You can try again.";
    case "deletion":
      return "Photo upload is unavailable right now. Your Win is still saved.";
    default:
      return "You can try attaching the photo again, or continue without one.";
  }
}

export default function AddWinClient(props: Props) {
  const router = useRouter();
  const [clientRequestId] = useState(() => newClientRequestId());
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [occurredOn, setOccurredOn] = useState(props.defaultOccurredOn);
  const [seasonChoice, setSeasonChoice] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [selectedPhotoMime, setSelectedPhotoMime] =
    useState<VictoryMediaClientAllowedMime | null>(null);
  const [photoSelectionError, setPhotoSelectionError] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [savedWinId, setSavedWinId] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const [busyPhase, setBusyPhase] = useState<BusyPhase>("idle");
  const [photoFailure, setPhotoFailure] = useState<PhotoFailureKind | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const locked = props.lockedSeason != null;
  const seasonSelectOptions = useMemo(() => props.seasonOptions, [props.seasonOptions]);
  const winLocked = savedWinId != null;
  const busy =
    busyPhase === "creating_win" ||
    busyPhase === "uploading_photo" ||
    busyPhase === "finalizing_photo";

  function revokePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPhotoPreviewUrl(null);
  }

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  function clearPhotoSelection(opts?: { keepSelectionError?: boolean }) {
    setSelectedPhoto(null);
    setSelectedPhotoMime(null);
    revokePreview();
    if (!opts?.keepSelectionError) {
      setPhotoSelectionError(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function onPhotoSelected(fileList: FileList | null) {
    if (winLocked || busy) return;
    const file = fileList?.[0] ?? null;
    if (!file) return;

    const mime = resolveVictoryMediaClientMime({ name: file.name, type: file.type });
    if (!mime) {
      clearPhotoSelection({ keepSelectionError: true });
      setPhotoSelectionError(
        "That image type isn’t supported. Use HEIC, JPEG, PNG, or WebP — or save your Win without a photo."
      );
      return;
    }
    if (file.size > VICTORY_MEDIA_MAX_UPLOAD_BYTES) {
      clearPhotoSelection({ keepSelectionError: true });
      setPhotoSelectionError(
        "That image is too large (max 12 MB). Choose a smaller photo, or save your Win without one."
      );
      return;
    }

    revokePreview();
    setSelectedPhoto(file);
    setSelectedPhotoMime(mime);
    setPhotoSelectionError(null);

    if (canPreviewVictoryMediaClientMime(mime)) {
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPhotoPreviewUrl(url);
    }
  }

  function resolveNavDest(apiRedirect: string | undefined): string {
    if (
      locked &&
      typeof apiRedirect === "string" &&
      apiRedirect.startsWith("/dashboard/")
    ) {
      return apiRedirect;
    }
    return props.cancelHref;
  }

  function navigateAway(dest: string) {
    router.replace(dest);
    router.refresh();
  }

  async function attachPhotoToWin(args: {
    winId: string;
    file: File;
    mime: VictoryMediaClientAllowedMime;
  }): Promise<{ ok: true } | { ok: false; kind: PhotoFailureKind }> {
    setBusyPhase("uploading_photo");

    let intentRes: Response;
    try {
      intentRes = await fetch("/api/victory-media/upload-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          declaredMime: args.mime,
          originalFilename: args.file.name,
          winId: args.winId,
        }),
      });
    } catch {
      return { ok: false, kind: "network" };
    }

    const intentData = (await intentRes.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
      uploadId?: string;
      signedUrl?: string;
    };

    if (!intentRes.ok || !intentData.ok || !intentData.uploadId || !intentData.signedUrl) {
      return { ok: false, kind: mapApiPhotoFailure(intentData.code) };
    }

    const put = await uploadVictoryMediaTempObject({
      signedUrl: intentData.signedUrl,
      file: args.file,
      declaredMime: args.mime,
    });
    if (!put.ok) {
      return { ok: false, kind: put.reason === "network" ? "network" : "generic" };
    }

    setBusyPhase("finalizing_photo");

    let finalizeRes: Response;
    try {
      finalizeRes = await fetch("/api/victory-media/finalize-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          winId: args.winId,
          uploadId: intentData.uploadId,
          declaredMime: args.mime,
          originalFilename: args.file.name,
        }),
      });
    } catch {
      return { ok: false, kind: "network" };
    }

    const finalizeData = (await finalizeRes.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: string;
      code?: string;
      error?: string;
    };

    if (
      finalizeRes.ok &&
      finalizeData.ok &&
      (finalizeData.status === "attached" || finalizeData.status === "existing")
    ) {
      return { ok: true };
    }

    // Ambiguous already-attached: only treat explicit success statuses as success.
    // media_exists means another photo is present — do not claim success/overwrite.
    return { ok: false, kind: mapApiPhotoFailure(finalizeData.code) };
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (busy || winLocked) return;

    setError(null);
    setPhotoFailure(null);
    setBusyPhase("creating_win");

    try {
      const body: Record<string, unknown> = {
        client_request_id: clientRequestId,
        title,
        details: details.trim() ? details : null,
        occurred_on: occurredOn,
      };
      if (locked && props.lockedSeason) {
        body.season_id = props.lockedSeason.seasonId;
      } else if (seasonChoice.trim()) {
        body.season_id = seasonChoice.trim();
      }

      const res = await fetch("/api/v2/wins/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        redirect_to?: string;
        win_id?: string;
        status?: string;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const winId = typeof data.win_id === "string" ? data.win_id.trim() : "";
      if (!winId) {
        throw new Error("We couldn’t save this Win. Please try again.");
      }

      const dest = resolveNavDest(data.redirect_to);
      setSavedWinId(winId);
      setRedirectTo(dest);

      const photo = selectedPhoto;
      const mime = selectedPhotoMime;
      if (!photo || !mime) {
        setBusyPhase("idle");
        navigateAway(dest);
        return;
      }

      const media = await attachPhotoToWin({ winId, file: photo, mime });
      if (media.ok) {
        setBusyPhase("idle");
        navigateAway(dest);
        return;
      }

      setPhotoFailure(media.kind);
      setBusyPhase("win_saved_photo_failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusyPhase("idle");
    }
  }

  async function onRetryPhoto() {
    if (busyPhase !== "win_saved_photo_failed") return;
    if (!savedWinId || !selectedPhoto || !selectedPhotoMime || !redirectTo) return;

    setPhotoFailure(null);
    const media = await attachPhotoToWin({
      winId: savedWinId,
      file: selectedPhoto,
      mime: selectedPhotoMime,
    });
    if (media.ok) {
      setBusyPhase("idle");
      navigateAway(redirectTo);
      return;
    }
    setPhotoFailure(media.kind);
    setBusyPhase("win_saved_photo_failed");
  }

  function onContinueWithoutPhoto() {
    if (!redirectTo) return;
    navigateAway(redirectTo);
  }

  const submitLabel =
    busyPhase === "creating_win"
      ? "Saving Win…"
      : busyPhase === "uploading_photo" || busyPhase === "finalizing_photo"
        ? "Adding photo…"
        : "Save Win";

  return (
    <div className={vrSectionCard}>
      <p className="mb-6">
        <Link href={props.cancelHref} className={vrAccentLink}>
          ← Back
        </Link>
      </p>

      <h1 className={vrSectionTitle}>Add a Win</h1>

      {props.lockedSeason ? (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <p className={vrLabel}>Saving to</p>
          <p className={`${vrBody} mt-1 font-medium text-stone-100`}>
            {props.lockedSeason.seasonName}
          </p>
          {props.lockedSeason.goalLabel ? (
            <p className={`${vrBodyMuted} mt-1`}>{props.lockedSeason.goalLabel}</p>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={onSave} className="mt-8 space-y-6">
        <div>
          <label htmlFor="win-title" className={vrLabel}>
            What happened?
          </label>
          <input
            id="win-title"
            name="title"
            type="text"
            required
            maxLength={MANUAL_WIN_TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            placeholder="A real moment worth remembering"
            autoComplete="off"
            disabled={winLocked || busy}
            readOnly={winLocked}
          />
          <p className={`${vrBodyMuted} mt-2 text-xs`}>
            {title.trim().length}/{MANUAL_WIN_TITLE_MAX}
          </p>
        </div>

        <div>
          <label htmlFor="win-details" className={vrLabel}>
            Details <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <textarea
            id="win-details"
            name="details"
            rows={4}
            maxLength={MANUAL_WIN_DETAILS_MAX}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className={`${inputClass} resize-y min-h-[6rem]`}
            placeholder="Anything else you want to remember"
            disabled={winLocked || busy}
            readOnly={winLocked}
          />
          <p className={`${vrBodyMuted} mt-2 text-xs`}>
            {details.trim().length}/{MANUAL_WIN_DETAILS_MAX}
          </p>
        </div>

        <div>
          <label htmlFor="win-photo" className={vrLabel}>
            Add a photo <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <input
            ref={fileInputRef}
            id="win-photo"
            name="photo"
            type="file"
            accept={FILE_ACCEPT}
            disabled={winLocked || busy}
            onChange={(e) => onPhotoSelected(e.target.files)}
            className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-amber-500/20 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-amber-50`}
          />
          {selectedPhoto ? (
            <div className="mt-3 space-y-3">
              <p className={`${vrBodyMuted} break-all text-sm`}>
                Selected: <span className="text-stone-200">{selectedPhoto.name}</span>
              </p>
              {photoPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview only
                <img
                  src={photoPreviewUrl}
                  alt="Selected photo preview"
                  className="max-h-48 w-full max-w-sm rounded-xl object-contain"
                />
              ) : null}
              {!winLocked ? (
                <button
                  type="button"
                  onClick={() => clearPhotoSelection()}
                  disabled={busy}
                  className="text-sm font-medium text-amber-300 underline decoration-amber-500/50 underline-offset-4 hover:text-amber-200 disabled:opacity-60"
                >
                  Remove photo
                </button>
              ) : null}
            </div>
          ) : null}
          {photoSelectionError ? (
            <p className="mt-2 text-sm text-red-300" role="alert">
              {photoSelectionError}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="win-date" className={vrLabel}>
            Date
          </label>
          <input
            id="win-date"
            name="occurred_on"
            type="date"
            required
            max={props.defaultOccurredOn}
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className={inputClass}
            disabled={winLocked || busy}
            readOnly={winLocked}
          />
        </div>

        {!locked ? (
          <div>
            <label htmlFor="win-season" className={vrLabel}>
              Season <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <select
              id="win-season"
              name="season_id"
              value={seasonChoice}
              onChange={(e) => setSeasonChoice(e.target.value)}
              className={inputClass}
              disabled={winLocked || busy}
            >
              <option value="">Overall only</option>
              {seasonSelectOptions.map((opt) => (
                <option key={opt.seasonId} value={opt.seasonId}>
                  {opt.pickerLabel.replace(/\n/g, " · ")}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        {busyPhase === "win_saved_photo_failed" ? (
          <div
            className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-4"
            role="alert"
          >
            <p className="text-base font-medium text-stone-100">Your Win was saved.</p>
            <p className="mt-2 text-sm text-stone-300">The photo couldn’t be attached.</p>
            {photoFailure ? (
              <p className={`${vrBodyMuted} mt-2 text-sm`}>
                {photoFailureDetail(photoFailure)}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onRetryPhoto}
                disabled={busy}
                className="inline-flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 px-5 py-3 text-base font-semibold text-amber-50 transition hover:bg-amber-500/25 disabled:opacity-60 sm:w-auto"
              >
                Retry photo
              </button>
              <button
                type="button"
                onClick={onContinueWithoutPhoto}
                disabled={busy}
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/20 bg-transparent px-5 py-3 text-base font-semibold text-stone-200 transition hover:border-white/35 hover:bg-white/5 disabled:opacity-60 sm:w-auto"
              >
                Continue to Victory Room
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            disabled={busy || winLocked}
            className="inline-flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 px-5 py-3 text-base font-semibold text-amber-50 transition hover:bg-amber-500/25 disabled:opacity-60 sm:w-auto"
          >
            {submitLabel}
          </button>
        )}
      </form>
    </div>
  );
}
