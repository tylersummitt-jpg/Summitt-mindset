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

type ExistingBatch = {
  ok: true;
  completed: number;
  excluded: number;
  failed: number;
  reused: number;
  missingFirst: number;
  missingLast: number;
  replaced: number;
  nextCursor: string | null;
  halted: string | null;
  skips: Array<{ email: string; reason: string }>;
  failures: Array<{ email: string; reason: string }>;
};

type ExistingTotals = {
  completed: number;
  excluded: number;
  failed: number;
  reused: number;
  missingFirst: number;
  missingLast: number;
  replaced: number;
  skips: Array<{ email: string; reason: string }>;
  failures: Array<{ email: string; reason: string }>;
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
  const [existing, setExisting] = useState<ExistingTotals | null>(null);
  const [existingNote, setExistingNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"file" | "existing" | null>(null);

  async function prepare() {
    setBusy("file");
    setMessage(null);
    setResult(null);
    const res = await fetch("/api/admin/acquisition/video-first-leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, personalVideoId: videoId, prospects }),
    });
    const body = await res.json().catch(() => null) as PrepareResult | { ok: false; error?: string } | null;
    setBusy(null);
    if (!body || body.ok !== true) {
      setMessage(body && "error" in body ? body.error ?? "The list was not prepared." : "The list was not prepared.");
      return;
    }
    setResult(body);
    setMessage(body.prepared === 0
      ? "No address was safe to include. Nothing was put in the Instantly file."
      : `${body.prepared} ${body.prepared === 1 ? "lead is" : "leads are"} in the file. ${body.reused} already had this campaign's video link and kept the same one.`);
  }

  async function prepareExisting() {
    setBusy("existing");
    setMessage(null);
    setExistingNote(null);
    const totals: ExistingTotals = {
      completed: 0,
      excluded: 0,
      failed: 0,
      reused: 0,
      missingFirst: 0,
      missingLast: 0,
      replaced: 0,
      skips: [],
      failures: [],
    };
    setExisting(totals);
    let cursor: string | null = null;
    for (let page = 0; page < 500; page += 1) {
      const res = await fetch("/api/admin/acquisition/video-first-existing-leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, personalVideoId: videoId, startingAfter: cursor }),
      });
      const body = await res.json().catch(() => null) as ExistingBatch | { ok: false; error?: string } | null;
      if (!body || body.ok !== true) {
        setBusy(null);
        setExisting({ ...totals });
        setExistingNote(body && "error" in body ? body.error ?? "The Instantly update stopped." : "The Instantly update stopped.");
        return;
      }
      totals.completed += body.completed;
      totals.excluded += body.excluded;
      totals.failed += body.failed;
      totals.reused += body.reused;
      totals.missingFirst += body.missingFirst;
      totals.missingLast += body.missingLast;
      totals.replaced += body.replaced;
      totals.skips.push(...body.skips);
      totals.failures.push(...body.failures);
      setExisting({ ...totals, skips: [...totals.skips], failures: [...totals.failures] });
      if (body.halted) {
        setBusy(null);
        setExistingNote(body.halted);
        return;
      }
      if (!body.nextCursor) {
        setBusy(null);
        setExistingNote("Existing Instantly leads were updated through the end of the list. No email was sent and the sequence was left where it is.");
        return;
      }
      cursor = body.nextCursor;
    }
    setBusy(null);
    setExistingNote("The update stopped at the page limit. Run it again to continue. Completed leads keep the same link.");
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
      <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50" type="button" disabled={busy !== null} onClick={() => void prepare()}>
        {busy === "file" ? "Preparing" : "Prepare the Instantly file"}
      </button>
      {message ? <p>{message}</p> : null}
      {result && result.invalid > 0 ? <p>{result.invalid} {result.invalid === 1 ? "row was" : "rows were"} not an email address.</p> : null}
      {result && result.skips.length > 0 ? <p>{result.skips.length} {result.skips.length === 1 ? "person was" : "people were"} left out. Download the reason file. They are not in the Instantly file.</p> : null}
      {result && result.prepared > 0 ? <Download label="Download Instantly file" filename={`${result.campaignName.replace(/[^\w.-]+/g, "-").slice(0, 40) || "leads"}.csv`} text={result.csv} /> : null}
      {result && result.skips.length > 0 ? <Download label="Download people left out" filename="left-out.csv" text={result.skipCsv} /> : null}
      <div className="space-y-2 border-t border-gray-200 pt-3">
        <h3 className="font-medium">Prepare existing Instantly leads</h3>
        <p>Reads the leads already in {campaignName}, applies the same eligibility checks, and writes each eligible lead&apos;s {"{{video_url}}"} in Instantly. A lead who already has this link keeps it. Opt-outs, bounces, unsubscribes, trials, paying members, and held fulfillments stay out. This leaves the sequence step where it is, sends no email, and releases no held PDF.</p>
        <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50" type="button" disabled={busy !== null || !videoId} onClick={() => void prepareExisting()}>
          {busy === "existing" ? "Updating Instantly leads" : "Prepare existing Instantly leads"}
        </button>
        {existing ? (
          <p>
            Completed {existing.completed}. Excluded {existing.excluded}. Failed {existing.failed}. Same journey reused {existing.reused}. Replaced an older video_url on {existing.replaced}. Missing first name {existing.missingFirst}. Missing last name {existing.missingLast}.
          </p>
        ) : null}
        {existingNote ? <p>{existingNote}</p> : null}
        {existing && existing.failures.length > 0 ? <Download label="Download failed leads" filename="failed-leads.csv" text={reasonCsv(existing.failures)} /> : null}
        {existing && existing.skips.length > 0 ? <Download label="Download excluded leads" filename="excluded-leads.csv" text={reasonCsv(existing.skips)} /> : null}
      </div>
    </section>
  );
}

function reasonCsv(rows: Array<{ email: string; reason: string }>): string {
  const lines = ["email,reason"];
  for (const row of rows) {
    lines.push([row.email, row.reason].map((value) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(","));
  }
  return `${lines.join("\n")}\n`;
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
