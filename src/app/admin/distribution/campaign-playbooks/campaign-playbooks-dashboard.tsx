"use client";

import { useEffect, useState } from "react";

import type { PlaybookReadiness, PlaybookVersion } from "@/lib/acquisition/playbook";

const CATALOG = [
  ["definite_dozen", "Pat Summitt Definite Dozen team discussion guide"],
  ["playbook", "Pat Summitt basketball special-situations playbook"],
  ["definite_dozen_ad", "Pat Summitt Definite Dozen athletic director discussion guide"],
] as const;

type VideoChoice = { id: string; status: string; createdAt: string };
type Listed = PlaybookVersion & { readiness: PlaybookReadiness };

const EMPTY = {
  campaignId: "",
  name: "",
  audience: "",
  offerLabel: "",
  offerKey: "",
  resources: [] as string[],
  manualResource: "",
  personalVideoId: "",
  permittedActions: [] as string[],
  replyGuidance: "",
  fulfillment: "catalog",
};

export default function CampaignPlaybooksDashboard({ videos }: { videos: VideoChoice[] }) {
  const [form, setForm] = useState(EMPTY);
  const [rows, setRows] = useState<Listed[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", { cache: "no-store" });
    const body = await res.json().catch(() => null) as { ok?: boolean; playbooks?: Listed[]; error?: string } | null;
    if (!body?.ok || !body.playbooks) {
      setMessage(body?.error ?? "Campaign playbooks could not be read.");
      return;
    }
    setRows(body.playbooks);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function setField(key: keyof typeof EMPTY, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggle(list: "resources" | "permittedActions", value: string) {
    setForm((current) => {
      const values = current[list];
      return { ...current, [list]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
    });
  }

  async function save() {
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "save", ...form }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; version?: number } | null;
    setMessage(body?.ok ? `Saved version ${body.version}. A paused or retired campaign stays closed. The safety switches were not changed.` : body?.error ?? "The playbook was not saved.");
    if (body?.ok) await load();
  }

  async function status(campaignId: string, intent: "pause" | "resume" | "retire") {
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, campaignId }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setMessage(body?.ok ? "Status saved. The safety switches were not changed." : body?.error ?? "The status was not changed.");
    if (body?.ok) await load();
  }

  return (
    <div className="space-y-6">
      <form className="space-y-3 rounded border border-gray-200 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="block text-sm text-gray-800">Instantly campaign ID
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.campaignId} onChange={(event) => setField("campaignId", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Name
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.name} onChange={(event) => setField("name", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Audience
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.audience} onChange={(event) => setField("audience", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Offer name
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.offerLabel} onChange={(event) => setField("offerLabel", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Offer key, if one already exists
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.offerKey} onChange={(event) => setField("offerKey", event.target.value)} />
        </label>
        <fieldset className="text-sm text-gray-800">
          <legend>Catalog PDFs</legend>
          {CATALOG.map(([key, label]) => (
            <label key={key} className="mt-1 block">
              <input type="checkbox" checked={form.resources.includes(key)} onChange={() => toggle("resources", key)} /> {label}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm text-gray-800">Other resource, not delivered automatically
          <textarea className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.manualResource} onChange={(event) => setField("manualResource", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Personal video from the existing library
          <select className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.personalVideoId} onChange={(event) => setField("personalVideoId", event.target.value)}>
            <option value="">No video</option>
            {videos.map((video) => (
              <option key={video.id} value={video.id} disabled={video.status !== "ready"}>{video.status} · {video.id}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-gray-800">Fulfillment
          <select className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.fulfillment} onChange={(event) => setField("fulfillment", event.target.value)}>
            <option value="catalog">Catalog PDF</option>
            <option value="video">Personal video</option>
            <option value="catalog_and_video">PDF and video, separately</option>
            <option value="manual">Separate fulfillment, no automatic send</option>
            <option value="none">No resource</option>
          </select>
        </label>
        <fieldset className="text-sm text-gray-800">
          <legend>Permitted sends</legend>
          <label className="mt-1 block"><input type="checkbox" checked={form.permittedActions.includes("send_asset")} onChange={() => toggle("permittedActions", "send_asset")} /> Send the catalog PDF when the reply accepts it</label>
          <label className="mt-1 block"><input type="checkbox" checked={form.permittedActions.includes("send_video")} onChange={() => toggle("permittedActions", "send_video")} /> Send the personal video when the reply accepts it</label>
        </fieldset>
        <label className="block text-sm text-gray-800">Reply guidance
          <textarea className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.replyGuidance} onChange={(event) => setField("replyGuidance", event.target.value)} />
        </label>
        <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white" type="submit">Save playbook version</button>
      </form>
      {message ? <p className="text-sm text-gray-800">{message}</p> : null}
      <div className="space-y-3">
        {rows.map((row) => (
          <article key={row.id} className="rounded border border-gray-200 p-4 text-sm text-gray-800">
            <p className="font-medium">{row.name} · version {row.version} · {row.status}</p>
            <p>{row.audience}</p>
            <p className="break-all text-gray-600">{row.campaignId}</p>
            <p>{row.readiness.ready ? "Ready for a permitted send." : "Not ready for automatic fulfillment."}</p>
            <p>Instantly stop-on-reply: {row.readiness.instantlySequenceStop}.</p>
            <p>Approved knowledge: {row.readiness.knowledge}. Campaign attribution: {row.readiness.attribution}. Separate journeys for one person: {row.readiness.independentJourneys}.</p>
            {row.readiness.gaps.map((gap) => <p key={gap}>{gap}</p>)}
            {row.status === "current" ? <button className="mt-2 underline" type="button" onClick={() => void status(row.campaignId, "pause")}>Pause</button> : null}
            {row.status === "paused" || row.status === "retired" ? <button className="mt-2 underline" type="button" onClick={() => void status(row.campaignId, "resume")}>Resume</button> : null}
            {row.status === "current" || row.status === "paused" ? <button className="mt-2 ml-3 underline" type="button" onClick={() => void status(row.campaignId, "retire")}>Retire</button> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
