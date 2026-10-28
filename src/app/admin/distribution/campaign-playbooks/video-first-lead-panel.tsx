"use client";

import { useState } from "react";

type PrepareResult = {
  ok: true;
  campaignName: string;
  prepared: number;
  reused: number;
  invalid: number;
  csv: string;
  skipCsv: string;
  skips: Array<{ email: string; reason: string }>;
};

type VideoChoice = { id: string; status: string; createdAt: string; publicToken: string };

export function VideoFirstLeadPanel({
  campaignId,
  campaignName,
  videos,
}: {
  campaignId: string;
  campaignName: string;
  videos: VideoChoice[];
}) {
  const ready = videos.filter((video) => video.status === "ready");
  const [videoId, setVideoId] = useState(ready[0]?.id ?? "");
  const [prospects, setProspects] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<PrepareResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    setBusy(true);
    setMessage(null);
    setResult(null);
    const res = await fetch("/api/admin/acquisition/video-first-leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, personalVideoId: videoId, prospects }),
    });
    const body = await res.json().catch(() => null) as PrepareResult | { ok: false; error?: string } | null;
    setBusy(false);
    if (!body || body.ok !== true) {
      setMessage(body && "error" in body ? body.error ?? "The list was not prepared." : "The list was not prepared.");
      return;
    }
    setResult(body);
    setMessage(body.prepared === 0
      ? "No address was safe to include. Nothing was put in the Instantly file."
      : `${body.prepared} ${body.prepared === 1 ? "lead is" : "leads are"} in the file. ${body.reused} already had this campaign's video link and kept the same one.`);
  }

  return (
    <section className="space-y-3 rounded border border-gray-200 p-4 text-sm text-gray-800">
      <h2 className="font-medium">Prepare video links for {campaignName}</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Choose the personal video for this campaign. Preparing saves a new playbook version for that video and leaves the older version, its events, and its scheduled actions in place.</li>
        <li>Paste the prospect list. People who were emailed before can be included. Opt-outs, complaints, bounces, trials, paying members, and anyone with a scheduled or claimed fulfillment action are left out.</li>
        <li>Prepare the file. This page does not upload it, send email, or release a held PDF.</li>
        <li>Give the file to ChatGPT Work after the email copy is approved. The three Instantly emails use {"{{video_url}}"}.</li>
      </ol>
      <label className="block">Video
        <select aria-label="Personal video" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={videoId} onChange={(event) => setVideoId(event.target.value)}>
          {ready.length === 0 ? <option value="">No ready video</option> : null}
          {ready.map((video) => (
            <option key={video.id} value={video.id}>/for/{video.publicToken}</option>
          ))}
        </select>
      </label>
      <textarea
        aria-label="Prospect emails"
        className="min-h-32 w-full rounded border border-gray-300 px-2 py-1"
        value={prospects}
        onChange={(event) => setProspects(event.target.value)}
        placeholder={"coach@school.edu\nad@school.edu, Pat, Summitt"}
      />
      <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50" type="button" disabled={busy} onClick={() => void prepare()}>
        {busy ? "Preparing" : "Prepare the Instantly file"}
      </button>
      {message ? <p>{message}</p> : null}
      {result && result.invalid > 0 ? <p>{result.invalid} {result.invalid === 1 ? "row was" : "rows were"} not an email address.</p> : null}
      {result && result.skips.length > 0 ? <p>{result.skips.length} {result.skips.length === 1 ? "person was" : "people were"} left out. Download the reason file. They are not in the Instantly file.</p> : null}
      {result && result.prepared > 0 ? <Download label="Download Instantly file" filename={`${result.campaignName.replace(/[^\w.-]+/g, "-").slice(0, 40) || "leads"}.csv`} text={result.csv} /> : null}
      {result && result.skips.length > 0 ? <Download label="Download people left out" filename="left-out.csv" text={result.skipCsv} /> : null}
    </section>
  );
}

function Download({ label, filename, text }: { label: string; filename: string; text: string }) {
  return (
    <button
      className="mr-3 underline"
      type="button"
      onClick={() => {
        const blob = new Blob([text], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      {label}
    </button>
  );
}
