export const RECORDING_EMPTY_MESSAGE = "Your video wasn't recorded. Please try again.";

/** Periodic flush. Safari often emits nothing until stop unless start() gets a timeslice. */
export const RECORDING_TIMESLICE_MS = 250;

const SAFARI_MIME_CANDIDATES = ["video/mp4", "video/mp4;codecs=avc1.42E01E,mp4a.40.2"] as const;

const OTHER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
] as const;

export function isSafariBrowser(userAgent: string): boolean {
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(userAgent);
}

export function chooseRecordingMime(userAgent: string, isTypeSupported: (type: string) => boolean): string {
  const candidates = isSafariBrowser(userAgent) ? SAFARI_MIME_CANDIDATES : OTHER_MIME_CANDIDATES;
  return (
    candidates.find((type) => {
      try {
        return isTypeSupported(type);
      } catch {
        return false;
      }
    }) ?? ""
  );
}

export function canSaveRecording(blob: Blob | null | undefined): blob is Blob {
  return Boolean(blob && blob.size > 0);
}

export function assembleRecording(chunks: Blob[], mimeType: string): Blob | null {
  const present = chunks.filter((chunk) => chunk.size > 0);
  if (present.length === 0) return null;
  const blob = new Blob(present, { type: mimeType });
  return blob.size > 0 ? blob : null;
}

/** Safari can report 0 or Infinity for a file that still has frames. */
export function previewNeedsDurationSeek(duration: number): boolean {
  return !Number.isFinite(duration) || duration <= 0;
}

export type RecordingSink = {
  push(chunk: Blob): void;
  beginStop(): void;
  finished: Promise<Blob | null>;
};

export function createRecordingSink(mimeType: string, settleMs = 200): RecordingSink {
  const chunks: Blob[] = [];
  let stopped = false;
  let settled = false;
  let resolveFinished: (blob: Blob | null) => void = () => undefined;
  const finished = new Promise<Blob | null>((resolve) => {
    resolveFinished = resolve;
  });

  const finish = () => {
    if (!stopped || settled) return;
    settled = true;
    resolveFinished(assembleRecording(chunks, mimeType));
  };

  return {
    push(chunk) {
      if (!settled && chunk.size > 0) chunks.push(chunk);
    },
    beginStop() {
      if (stopped) return;
      stopped = true;
      setTimeout(finish, settleMs);
    },
    finished,
  };
}
