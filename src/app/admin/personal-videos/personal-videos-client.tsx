"use client";

import { useEffect, useRef, useState } from "react";

import {
  RECORDING_EMPTY_MESSAGE,
  RECORDING_TIMESLICE_MS,
  canSaveRecording,
  chooseRecordingMime,
  createRecordingSink,
  previewNeedsDurationSeek,
} from "@/lib/personal-videos/recording";
import {
  isPersonalVideoByteSize,
  PERSONAL_VIDEO_TOO_LARGE_MESSAGE,
} from "@/lib/personal-videos/upload-limit";

type VideoStatus = "uploading" | "processing" | "ready" | "failed";

type RecentVideo = {
  id: string;
  status: VideoStatus;
  createdAt: string;
  watchPath: string | null;
  linkSentAt: string | null;
};

type Phase = "camera" | "recording" | "preview" | "saving" | "processing" | "ready" | "error";

function uploadToVimeo(uploadLink: string, blob: Blob, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PATCH", uploadLink);
    xhr.setRequestHeader("Tus-Resumable", "1.0.0");
    xhr.setRequestHeader("Upload-Offset", "0");
    xhr.setRequestHeader("Content-Type", "application/offset+octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("upload_failed"));
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.send(blob);
  });
}

async function readStatus(id: string): Promise<RecentVideo> {
  const response = await fetch(`/api/admin/personal-videos/${id}`, { cache: "no-store" });
  if (!response.ok) throw new Error("status_failed");
  return (await response.json()) as RecentVideo;
}

export function PersonalVideosClient({ initialRecent }: { initialRecent: RecentVideo[] | null }) {
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [watchPath, setWatchPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<RecentVideo[] | null>(initialRecent);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function openCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage("This browser cannot use the camera.");
        setPhase("error");
        return;
      }
      try {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: { ideal: 48000 }, channelCount: { ideal: 1 } },
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (liveRef.current) {
          liveRef.current.srcObject = stream;
          await liveRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch {
        if (!cancelled) {
          setMessage("Camera or microphone permission is needed before recording.");
          setPhase("error");
        }
      }
    }
    if (phase === "camera") void openCamera();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function releaseStream() {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveRef.current) liveRef.current.srcObject = null;
    setCameraReady(false);
  }

  function showEmptyRecording() {
    setBlob(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setMessage(RECORDING_EMPTY_MESSAGE);
    setPhase("error");
  }

  function startRecording() {
    const stream = streamRef.current;
    const mimeType =
      typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
        ? chooseRecordingMime(navigator.userAgent, (type) => MediaRecorder.isTypeSupported(type))
        : "";
    if (!stream || typeof MediaRecorder === "undefined" || !mimeType) {
      setMessage("This browser cannot record video.");
      setPhase("error");
      return;
    }
    const sink = createRecordingSink(mimeType);
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      sink.push(event.data);
    };
    recorder.onstop = () => {
      sink.beginStop();
    };
    recorder.onerror = () => {
      if (recorder.state === "inactive") {
        sink.beginStop();
        return;
      }
      try {
        recorder.stop();
      } catch {
        sink.beginStop();
      }
    };
    recorderRef.current = recorder;
    try {
      recorder.start(RECORDING_TIMESLICE_MS);
    } catch {
      setMessage("This browser cannot record video.");
      setPhase("error");
      return;
    }
    setPhase("recording");
    setMessage(null);
    void sink.finished.then((recorded) => {
      releaseStream();
      if (!canSaveRecording(recorded)) {
        showEmptyRecording();
        return;
      }
      const url = URL.createObjectURL(recorded);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setBlob(recorded);
      setMessage(null);
      setPhase("preview");
    });
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    try {
      recorder.requestData();
    } catch {
      // stop() still asks the browser for the final chunk.
    }
    recorder.stop();
  }

  function rerecord() {
    releaseStream();
    setBlob(null);
    setWatchPath(null);
    setCopied(false);
    setProgress(0);
    setMessage(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPhase("camera");
  }

  async function saveVideo() {
    if (!canSaveRecording(blob)) {
      showEmptyRecording();
      return;
    }
    if (!isPersonalVideoByteSize(blob.size)) {
      setMessage(PERSONAL_VIDEO_TOO_LARGE_MESSAGE);
      setPhase("error");
      return;
    }
    setPhase("saving");
    setProgress(0);
    setMessage("Uploading to Vimeo…");
    let pendingId: string | null = null;
    let uploaded = false;
    try {
      const created = await fetch("/api/admin/personal-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ byteSize: blob.size }),
      });
      const body = (await created.json().catch(() => null)) as {
        id?: string;
        uploadLink?: string;
        error?: string;
      } | null;
      if (!created.ok || !body?.id || !body.uploadLink) {
        setMessage(
          body?.error === "invalid_video"
            ? PERSONAL_VIDEO_TOO_LARGE_MESSAGE
            : "Vimeo did not accept this recording. Try Save Video again."
        );
        setPhase("error");
        return;
      }
      pendingId = body.id;
      await uploadToVimeo(body.uploadLink, blob, setProgress);
      uploaded = true;
      setMessage("Vimeo is preparing the video…");
      setPhase("processing");
      const ready = await waitUntilReady(body.id);
      setWatchPath(ready.watchPath);
      setRecent((current) => [ready, ...(current ?? []).filter((item) => item.id !== ready.id)]);
      setPhase("ready");
      setMessage(null);
    } catch (error) {
      if (error instanceof Error && error.message === "still_processing" && pendingId) {
        const video = await readStatus(pendingId).catch(() => null);
        if (video) {
          setRecent((current) => [video, ...(current ?? []).filter((item) => item.id !== video.id)]);
        }
        setBlob(null);
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
        setPhase("camera");
        setMessage("Vimeo is still preparing this video. It is in Recent Videos. Press Check, then Copy Link when it is ready.");
        return;
      }
      if (pendingId && !uploaded) {
        await fetch(`/api/admin/personal-videos/${pendingId}`, { method: "DELETE" }).catch(() => undefined);
      }
      setMessage(
        error instanceof Error && error.message === "failed"
          ? "Vimeo could not prepare this video. Record it again, or try Save Video."
          : "The upload stopped. Your recording is still here. Try Save Video again."
      );
      setPhase("error");
    }
  }

  async function waitUntilReady(id: string): Promise<RecentVideo> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const video = await readStatus(id);
        if (video.status === "ready" && video.watchPath) return video;
        if (video.status === "failed") throw new Error("failed");
      } catch (error) {
        if (error instanceof Error && error.message === "failed") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("still_processing");
  }

  async function copyLink(path: string) {
    const url = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  async function checkOne(id: string) {
    const video = await readStatus(id).catch(() => null);
    if (!video) return;
    setRecent((current) => (current ?? []).map((item) => (item.id === video.id ? video : item)));
  }

  async function markSent(id: string) {
    const response = await fetch(`/api/admin/personal-videos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sent: true }),
    });
    if (!response.ok) return;
    const video = (await response.json()) as RecentVideo;
    setRecent((current) => (current ?? []).map((item) => (item.id === video.id ? { ...item, ...video } : item)));
  }

  async function removeVideo(id: string) {
    const response = await fetch(`/api/admin/personal-videos/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("That video could not be deleted. It is still in the list.");
      return;
    }
    setRecent((current) => (current ?? []).filter((item) => item.id !== id));
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold text-stone-900">Personal Videos</h1>
      <p className="mt-1 text-sm text-stone-600">Record, save, and copy a private viewing link.</p>

      <div className="mt-6 overflow-hidden rounded-2xl bg-black shadow-sm">
        {previewUrl && phase !== "camera" && phase !== "recording" ? (
          <video
            key={previewUrl}
            src={previewUrl}
            className="aspect-video w-full"
            controls
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (!previewNeedsDurationSeek(video.duration)) return;
              video.muted = true;
              void video
                .play()
                .then(() => {
                  video.pause();
                  video.currentTime = 0;
                  video.muted = false;
                })
                .catch(() => undefined);
            }}
          />
        ) : phase === "error" ? (
          <div className="flex aspect-video items-center justify-center px-6 text-center text-sm text-white">
            {message ?? RECORDING_EMPTY_MESSAGE}
          </div>
        ) : (
          <video key="live" ref={liveRef} className="aspect-video w-full" muted playsInline autoPlay />
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {phase === "camera" ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={!cameraReady}
            className="rounded-full bg-red-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Record
          </button>
        ) : null}
        {phase === "recording" ? (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white"
          >
            Stop
          </button>
        ) : null}
        {canSaveRecording(blob) && (phase === "preview" || phase === "error") ? (
          <button
            type="button"
            onClick={() => void saveVideo()}
            className="rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white"
          >
            Save Video
          </button>
        ) : null}
        {phase === "preview" || phase === "error" ? (
          <button
            type="button"
            onClick={rerecord}
            className="rounded-full border border-stone-300 px-6 py-3 text-sm font-semibold text-stone-800"
          >
            Rerecord
          </button>
        ) : null}
        {phase === "ready" && watchPath ? (
          <>
            <button
              type="button"
              onClick={() => void copyLink(watchPath)}
              className="rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white"
            >
              {copied ? "Copied" : "Copy Link"}
            </button>
            <button
              type="button"
              onClick={rerecord}
              className="rounded-full border border-stone-300 px-6 py-3 text-sm font-semibold text-stone-800"
            >
              Record Another
            </button>
          </>
        ) : null}
      </div>

      {phase === "saving" && blob ? (
        <p className="mt-3 text-sm text-stone-700">Uploading… {progress}%</p>
      ) : null}
      {phase === "processing" ? <p className="mt-3 text-sm text-stone-700">{message}</p> : null}
      {message && phase === "error" ? <p className="mt-3 text-sm text-red-700">{message}</p> : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-stone-900">Recent Videos</h2>
        {recent == null ? (
          <p className="mt-2 text-sm text-stone-600">Recent videos are not available yet.</p>
        ) : recent.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">No videos yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
            {recent.map((video) => (
              <li key={video.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm text-stone-800">
                    {new Date(video.createdAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <p className="text-xs uppercase tracking-wide text-stone-500">
                    {video.status}
                    {video.linkSentAt ? " · Sent" : ""}
                  </p>
                </div>
                <div className="flex gap-3 text-sm">
                  {video.watchPath ? (
                    <>
                      <button type="button" className="underline" onClick={() => void copyLink(video.watchPath!)}>
                        Copy Link
                      </button>
                      <a className="underline" href={video.watchPath} target="_blank" rel="noreferrer">
                        Watch
                      </a>
                      {video.linkSentAt ? (
                        <span>Sent</span>
                      ) : (
                        <button type="button" className="underline" onClick={() => void markSent(video.id)}>
                          Mark as sent
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" className="underline" onClick={() => void checkOne(video.id)}>
                      Check
                    </button>
                  )}
                  <button type="button" className="underline text-red-700" onClick={() => void removeVideo(video.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
