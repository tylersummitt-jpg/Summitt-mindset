"use client";

import { useEffect, useState } from "react";

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

type ClearanceBatch = {
  ok: true;
  campaignName: string;
  mode: "update_existing" | "import_csv";
  eligible: number;
  excluded: number;
  unverified: number;
  failed: number;
  reused: number;
  missingFirst: number;
  missingLast: number;
  replaced: number;
  nextCursor: string | null;
  halted: string | null;
  csv: string;
  skipCsv: string;
  skips: Array<{ email: string; reason: string; kind?: "excluded" | "unverified" }>;
  failures: Array<{ email: string; reason: string }>;
};

type ClearanceTotals = {
  eligible: number;
  excluded: number;
  unverified: number;
  failed: number;
  reused: number;
  missingFirst: number;
  missingLast: number;
  replaced: number;
  mode: "update_existing" | "import_csv" | null;
  csvParts: string[];
  skips: Array<{ email: string; reason: string; kind?: "excluded" | "unverified" }>;
  failures: Array<{ email: string; reason: string }>;
};

type VideoChoice = { id: string; status: string; createdAt: string; publicToken: string };
type SourceOption = { id: string; name: string };

export function VideoFirstLeadPanel({
  campaignId,
  campaignName,
  videos,
  sourceOptions,
}: {
  campaignId: string;
  campaignName: string;
  videos: VideoChoice[];
  sourceOptions: SourceOption[];
}) {
  const ready = videos.filter((video) => video.status === "ready");
  const [videoId, setVideoId] = useState(ready[0]?.id ?? "");
  const [sourceCampaignId, setSourceCampaignId] = useState(campaignId);
  const [extraSourceIds, setExtraSourceIds] = useState<string[]>([]);
  const [pairCampaignId, setPairCampaignId] = useState("");
  const [playbookUrl, setPlaybookUrl] = useState<string | null>(null);
  const [kitUrl, setKitUrl] = useState<string | null>(null);
  const [letterNote, setLetterNote] = useState<string | null>(null);
  const [letter, setLetter] = useState<{
    eligible: number;
    excluded: number;
    unverified: number;
    groups: Array<{ campaignId: string; count: number; csv: string }>;
    skips: Array<{ email: string; reason: string; reasons?: string[]; kind?: "excluded" | "unverified" }>;
  } | null>(null);
  const [prospects, setProspects] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<PrepareResult | null>(null);
  const [existing, setExisting] = useState<ExistingTotals | null>(null);
  const [existingNote, setExistingNote] = useState<string | null>(null);
  const [clearance, setClearance] = useState<ClearanceTotals | null>(null);
  const [clearanceNote, setClearanceNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"file" | "existing" | "clearance" | "link" | "kit" | "letter" | null>(null);

  useEffect(() => {
    setSourceCampaignId(campaignId);
    setClearance(null);
    setClearanceNote(null);
  }, [campaignId]);

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

  async function copyPlaybookLink() {
    setBusy("link");
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/playbook-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    const body = await res.json().catch(() => null) as { ok: true; url: string } | { ok: false; error?: string } | null;
    setBusy(null);
    if (!body || body.ok !== true) {
      setPlaybookUrl(null);
      setMessage(body && "error" in body ? body.error ?? "The signed link was not created." : "The signed link was not created.");
      return;
    }
    setPlaybookUrl(body.url);
    setMessage("Signed playbook link is ready. No email was sent.");
  }

  async function copyLeadershipKitLink() {
    setBusy("kit");
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/playbook-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, kind: "kit" }),
    });
    const body = await res.json().catch(() => null) as { ok: true; url: string } | { ok: false; error?: string } | null;
    setBusy(null);
    if (!body || body.ok !== true) {
      setKitUrl(null);
      setMessage(body && "error" in body ? body.error ?? "The signed link was not created." : "The signed link was not created.");
      return;
    }
    setKitUrl(body.url);
    setMessage("Signed Leadership Kit offer link is ready. No email was sent.");
  }

  async function postLetter(payload: Record<string, unknown>) {
    let res: Response;
    try {
      res = await fetch("/api/admin/acquisition/letter-audience", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return { ok: false as const, error: "Eligibility check stopped before the server responded. No import file was created. Nothing was written." };
    }
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!body || body.ok !== true) {
      const reported = body && typeof body.error === "string" ? body.error : "";
      return {
        ok: false as const,
        error: reported || `Eligibility check stopped (HTTP ${res.status}). No import file was created. Nothing was written.`,
      };
    }
    return body as { ok: true } & Record<string, unknown>;
  }

  async function checkLetterEligibility() {
    setBusy("letter");
    setLetter(null);
    setLetterNote(null);
    const sourceCampaignIds = [...new Set([sourceCampaignId, ...extraSourceIds].filter(Boolean))];
    const shared = {
      sourceCampaignIds,
      launchCampaignId: campaignId,
      pairCampaignId: pairCampaignId || null,
    };
    const history = await postLetter({ phase: "history", ...shared });
    if (!history.ok) {
      setBusy(null);
      setLetterNote(history.error);
      return;
    }
    if (history.complete === true) {
      setBusy(null);
      setLetter(letterFromBody(history));
      setLetterNote(typeof history.note === "string" ? history.note : null);
      return;
    }
    const manifest = typeof history.manifest === "string" ? history.manifest : "";
    const tickets = Array.isArray(history.tickets) ? history.tickets : [];
    const historySkips = Array.isArray(history.skips) ? history.skips : [];
    const pending = tickets.flatMap((ticket) => {
      const row = ticket as { lead?: unknown };
      return row.lead ? [row.lead] : [];
    });
    const batchSize = typeof history.batchSize === "number" && history.batchSize > 0 ? history.batchSize : 20;
    const outcomes = [];
    for (let index = 0; index < tickets.length; index += batchSize) {
      const checked = Math.min(index, tickets.length);
      setLetterNote(`Membership checks: ${checked} of ${tickets.length}. This is not a cleared audience. Nothing was written.`);
      const facts = await postLetter({
        phase: "facts",
        ...shared,
        manifest,
        tickets: tickets.slice(index, index + batchSize),
      });
      if (!facts.ok) {
        setBusy(null);
        setLetter(null);
        setLetterNote(facts.error);
        return;
      }
      if (Array.isArray(facts.outcomes)) outcomes.push(...facts.outcomes);
    }
    const finished = await postLetter({
      phase: "finish",
      ...shared,
      manifest,
      pending,
      historySkips,
      outcomes,
    });
    setBusy(null);
    if (!finished.ok || finished.complete !== true) {
      setLetter(null);
      setLetterNote(finished.ok ? "Clearance is incomplete, so no import file was created. Nothing was written." : finished.error);
      return;
    }
    setLetter(letterFromBody(finished));
    setLetterNote(typeof finished.note === "string" ? finished.note : null);
  }

  async function checkAndPrepare() {
    setBusy("clearance");
    setMessage(null);
    setClearanceNote(null);
    const totals: ClearanceTotals = {
      eligible: 0,
      excluded: 0,
      unverified: 0,
      failed: 0,
      reused: 0,
      missingFirst: 0,
      missingLast: 0,
      replaced: 0,
      mode: null,
      csvParts: [],
      skips: [],
      failures: [],
    };
    setClearance(totals);
    let cursor: string | null = null;
    for (let page = 0; page < 500; page += 1) {
      const res = await fetch("/api/admin/acquisition/audience-clearance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          launchCampaignId: campaignId,
          sourceCampaignId,
          personalVideoId: videoId,
          startingAfter: cursor,
        }),
      });
      const body = await res.json().catch(() => null) as ClearanceBatch | { ok: false; error?: string } | null;
      if (!body || body.ok !== true) {
        setBusy(null);
        setClearance({ ...totals });
        setClearanceNote(body && "error" in body ? body.error ?? "Audience clearance stopped." : "Audience clearance stopped.");
        return;
      }
      totals.eligible += body.eligible;
      totals.excluded += body.excluded;
      totals.unverified += body.unverified;
      totals.failed += body.failed;
      totals.reused += body.reused;
      totals.missingFirst += body.missingFirst;
      totals.missingLast += body.missingLast;
      totals.replaced += body.replaced;
      totals.mode = body.mode;
      if (body.csv.trim()) totals.csvParts.push(body.csv);
      totals.skips.push(...body.skips);
      totals.failures.push(...body.failures);
      setClearance({ ...totals, skips: [...totals.skips], failures: [...totals.failures], csvParts: [...totals.csvParts] });
      if (body.halted) {
        setBusy(null);
        setClearanceNote(body.halted);
        return;
      }
      if (!body.nextCursor) {
        setBusy(null);
        setClearanceNote(body.mode === "import_csv"
          ? "Eligible leads are ready to import into the launch campaign. Unverified people were left out. No email was sent."
          : "Eligible Instantly leads were checked and prepared through the end of the list. No email was sent.");
        return;
      }
      cursor = body.nextCursor;
    }
    setBusy(null);
    setClearanceNote("Clearance stopped at the page limit. Run it again to continue. Already prepared people keep the same link.");
  }

  const clearanceCsv = mergeCsvParts(clearance?.csvParts ?? []);
  const clearanceSkipCsv = reasonCsv(clearance?.skips ?? []);

  return (
    <section className="space-y-3 rounded border border-gray-200 p-4 text-sm text-gray-800">
      <h2 className="font-medium">Prepare video links for {campaignName}</h2>
      <div className="space-y-2 border-b border-gray-200 pb-3">
        <h3 className="font-medium">Personal letter</h3>
        <p>Check eligibility without a video. This does not import leads or send email. A signed link is created only for a campaign whose saved playbook has sending off.</p>
        <div className="flex flex-wrap gap-2">
          <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50" type="button" disabled={busy !== null} onClick={() => void copyPlaybookLink()}>
            {busy === "link" ? "Signing" : "Copy signed playbook link"}
          </button>
          <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50" type="button" disabled={busy !== null} onClick={() => void copyLeadershipKitLink()}>
            {busy === "kit" ? "Signing" : "Copy signed Leadership Kit offer link"}
          </button>
        </div>
        {playbookUrl ? <input aria-label="Signed playbook link" className="mt-2 w-full rounded border border-gray-300 px-2 py-1" readOnly value={playbookUrl} /> : null}
        {kitUrl ? <input aria-label="Signed Leadership Kit offer link" className="mt-2 w-full rounded border border-gray-300 px-2 py-1" readOnly value={kitUrl} /> : null}
        <label className="block">Source audience
          <select aria-label="Letter source audience" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={sourceCampaignId} onChange={(event) => setSourceCampaignId(event.target.value)}>
            {sourceOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <label className="block">Additional letter audiences
          <select aria-label="Additional letter audiences" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" multiple size={4} value={extraSourceIds} onChange={(event) => setExtraSourceIds(Array.from(event.target.selectedOptions).map((option) => option.value))}>
            {sourceOptions.filter((option) => option.id !== sourceCampaignId).map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <p>Coaches who appear on more than one selected list are counted once. Downloads appear only after every coach in that combined list is checked.</p>
        <label className="block">Split eligible coaches with
          <select aria-label="Pair campaign" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={pairCampaignId} onChange={(event) => setPairCampaignId(event.target.value)}>
            <option value="">Do not split</option>
            {sourceOptions.filter((option) => option.id !== campaignId).map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50" type="button" disabled={busy !== null || !sourceCampaignId} onClick={() => void checkLetterEligibility()}>
          {busy === "letter" ? "Checking eligibility" : "Check eligibility"}
        </button>
        {letter ? <p>Eligible {letter.eligible}. Excluded {letter.excluded}. Unverified {letter.unverified}.</p> : null}
        {letterNote ? <p>{letterNote}</p> : null}
        {letter?.groups.map((group) => group.count > 0 ? (
          <Download key={group.campaignId} label={`Download cleared list for ${group.campaignId}`} filename={`letter-${group.campaignId}.csv`} text={group.csv} />
        ) : null)}
        {letter && letter.skips.length > 0 ? <Download label="Download excluded and unverified" filename="letter-left-out.csv" text={letterReasonCsv(letter.skips)} /> : null}
      </div>
      <label className="block">Video
        <select aria-label="Personal video" className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={videoId} onChange={(event) => setVideoId(event.target.value)}>
          {ready.length === 0 ? <option value="">No ready video</option> : null}
          {ready.map((video) => (
            <option key={video.id} value={video.id}>/for/{video.publicToken}</option>
          ))}
        </select>
      </label>

      <div className="space-y-2 border-t border-gray-200 pt-3">
        <h3 className="font-medium">Check and Prepare Audience</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Choose the launch campaign above, then choose its source audience.</li>
          <li>Run Check and Prepare Audience. Instantly verification, opt-outs, live membership, held fulfillment, and overlapping launch journeys are checked.</li>
          <li>Review eligible, excluded, and unverified counts. Unverified people are not imported.</li>
          <li>For empty replacement campaigns, download the Instantly import file. For campaigns that already hold the leads, video_url is written in Instantly when the key allows updates.</li>
        </ol>
        <label className="block">Source audience
          <select
            aria-label="Source audience"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            value={sourceCampaignId}
            onChange={(event) => setSourceCampaignId(event.target.value)}
          >
            {sourceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}{option.id === campaignId ? " (this launch campaign)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50" type="button" disabled={busy !== null || !videoId || !sourceCampaignId} onClick={() => void checkAndPrepare()}>
          {busy === "clearance" ? "Checking and preparing" : "Check and Prepare Audience"}
        </button>
        {clearance ? (
          <p>
            Eligible {clearance.eligible}. Excluded {clearance.excluded}. Unverified {clearance.unverified}. Failed {clearance.failed}. Same journey reused {clearance.reused}. Replaced an older video_url on {clearance.replaced}. Missing first name {clearance.missingFirst}. Missing last name {clearance.missingLast}.
          </p>
        ) : null}
        {clearanceNote ? <p>{clearanceNote}</p> : null}
        {clearance && clearance.eligible > 0 && clearanceCsv ? <Download label="Download Instantly import file" filename={`${campaignName.replace(/[^\w.-]+/g, "-").slice(0, 40) || "leads"}.csv`} text={clearanceCsv} /> : null}
        {clearance && clearance.skips.length > 0 ? <Download label="Download excluded and unverified" filename="audience-left-out.csv" text={clearanceSkipCsv} /> : null}
        {clearance && clearance.failures.length > 0 ? <Download label="Download failed Instantly updates" filename="audience-failed.csv" text={reasonCsv(clearance.failures)} /> : null}
      </div>

      <div className="space-y-2 border-t border-gray-200 pt-3">
        <h3 className="font-medium">Paste a one-off list</h3>
        <p>Use this only when the Instantly source audience is not the right list. Opt-outs, complaints, bounces, trials, paying members, and held fulfillment stay out.</p>
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
      </div>

      <div className="space-y-2 border-t border-gray-200 pt-3">
        <h3 className="font-medium">Prepare existing Instantly leads</h3>
        <p>Older path for writing video_url onto leads already in {campaignName}. Prefer Check and Prepare Audience for the launch.</p>
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

function mergeCsvParts(parts: string[]): string {
  const rows: string[] = [];
  let header = "";
  for (const part of parts) {
    const lines = part.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    if (!header) {
      header = lines[0] ?? "email,first_name,last_name,video_url";
      rows.push(header);
    }
    for (const line of lines.slice(1)) rows.push(line);
  }
  return rows.length > 0 ? `${rows.join("\n")}\n` : "";
}

function letterFromBody(body: Record<string, unknown>): {
  eligible: number;
  excluded: number;
  unverified: number;
  groups: Array<{ campaignId: string; count: number; csv: string }>;
  skips: Array<{ email: string; reason: string; reasons?: string[]; kind?: "excluded" | "unverified" }>;
} {
  return {
    eligible: typeof body.eligible === "number" ? body.eligible : 0,
    excluded: typeof body.excluded === "number" ? body.excluded : 0,
    unverified: typeof body.unverified === "number" ? body.unverified : 0,
    groups: Array.isArray(body.groups) ? body.groups as Array<{ campaignId: string; count: number; csv: string }> : [],
    skips: Array.isArray(body.skips) ? body.skips as Array<{ email: string; reason: string; reasons?: string[]; kind?: "excluded" | "unverified" }> : [],
  };
}

function letterReasonCsv(rows: Array<{ email: string; reason: string; reasons?: string[]; kind?: string }>): string {
  const lines = ["email,reason,all_reasons,kind"];
  for (const row of rows) {
    const all = row.reasons?.join("; ") || row.reason;
    const kind = row.kind ?? "";
    lines.push([row.email, row.reason, all, kind].map((value) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(","));
  }
  return `${lines.join("\n")}\n`;
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
