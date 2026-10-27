"use client";

import { useEffect, useState } from "react";

import type { CampaignActivation, PendingFulfillmentView } from "@/lib/acquisition/campaign-activation";
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
  const [activations, setActivations] = useState<CampaignActivation[] | null>(null);
  const [pending, setPending] = useState<PendingFulfillmentView[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", { cache: "no-store" });
    const body = await res.json().catch(() => null) as {
      ok?: boolean;
      playbooks?: Listed[];
      error?: string;
      activation?: { ok?: boolean; activations?: CampaignActivation[]; pending?: PendingFulfillmentView[]; error?: string };
    } | null;
    if (!body?.ok || !body.playbooks) {
      setMessage(body?.error ?? "Campaign playbooks could not be read.");
      return;
    }
    setRows(body.playbooks);
    if (!body.activation?.ok || !body.activation.activations || !body.activation.pending) {
      setActivations(null);
      setPending([]);
      setMessage(body.activation?.error ?? "Campaign activation could not be read. Nothing was changed.");
      return;
    }
    setActivations(body.activation.activations);
    setPending(body.activation.pending);
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
    setMessage(body?.ok ? `Saved version ${body.version}. This does not activate automated replies or fulfillment.` : body?.error ?? "The playbook was not saved.");
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
    setMessage(body?.ok ? "Playbook status saved. Automated sending was not changed." : body?.error ?? "The status was not changed.");
    if (body?.ok) await load();
  }

  async function automation(campaignId: string, intent: "activate" | "pause_automation" | "resume_automation" | "finish") {
    const prompt = intent === "finish"
      ? "Finish this campaign? The playbook retires and future automated replies and fulfillment stop. Accepted sends stay accepted."
      : intent === "pause_automation"
        ? "Pause future automated replies and fulfillment for this campaign? Accepted sends stay accepted."
        : "Activate post-reply automation for this campaign only? Actions scheduled before now stay held.";
    if (!window.confirm(prompt)) return;
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, campaignId }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; activatedAt?: string | null } | null;
    setMessage(body?.ok
      ? intent === "pause_automation" || intent === "finish"
        ? "Future automation is paused for that campaign. Accepted sends stay accepted."
        : `Post-reply automation is active for that campaign${body.activatedAt ? ` since ${body.activatedAt}` : ""}.`
      : body?.error ?? "Automation was not changed.");
    if (body?.ok) await load();
  }

  async function release(actionId: string) {
    if (!window.confirm("Release this scheduled action? It can send on the next pass. Accepted history is not changed.")) return;
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "release", actionId }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setMessage(body?.ok ? "The scheduled action can send on the next pass." : body?.error ?? "The action was not released.");
    if (body?.ok) await load();
  }

  function activationFor(campaignId: string): CampaignActivation | null {
    return activations?.find((item) => item.id === campaignId) ?? null;
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
        {rows.map((row) => {
          const latest = !rows.some((other) => other.campaignId === row.campaignId && other.version > row.version);
          const activation = activationFor(row.campaignId);
          return (
            <article key={row.id} className="rounded border border-gray-200 p-4 text-sm text-gray-800">
              <p className="font-medium">{row.name} · version {row.version} · {row.status}</p>
              <p>{row.audience}</p>
              <p className="break-all text-gray-600">{row.campaignId}</p>
              <p>{row.readiness.ready ? "Playbook configuration is complete." : "Playbook configuration has gaps."}</p>
              <p>{activationText(activations, activation)}</p>
              <p>Instantly stop-on-reply: {row.readiness.instantlySequenceStop}. This stays unverified until Instantly confirms it.</p>
              <p>Approved knowledge: {row.readiness.knowledge}. Campaign attribution: {row.readiness.attribution}. Separate journeys for one person: {row.readiness.independentJourneys}.</p>
              {row.readiness.gaps.map((gap) => <p key={gap}>{gap}</p>)}
              {latest && activations ? <AutomationControls campaignId={row.campaignId} activation={activation} onAutomation={automation} /> : null}
              {row.status === "current" ? <button className="mt-2 underline" type="button" onClick={() => void status(row.campaignId, "pause")}>Pause playbook</button> : null}
              {row.status === "paused" || row.status === "retired" ? <button className="mt-2 underline" type="button" onClick={() => void status(row.campaignId, "resume")}>Resume playbook</button> : null}
              {row.status === "current" || row.status === "paused" ? <button className="mt-2 ml-3 underline" type="button" onClick={() => void status(row.campaignId, "retire")}>Retire playbook</button> : null}
            </article>
          );
        })}
      </div>
      <section className="space-y-3 rounded border border-gray-200 p-4 text-sm text-gray-800">
        <h2 className="font-medium">Pending fulfillment</h2>
        <p>Pausing stops future sends. It does not cancel an accepted send. An action scheduled before activation stays held until you release that action.</p>
        {activations && pending.length === 0 ? <p>No scheduled or claimed fulfillment is waiting.</p> : null}
        {!activations ? <p>Pending fulfillment is hidden because activation could not be read.</p> : null}
        {activations ? unassignedCampaigns(rows, pending).map((campaignId) => (
          <div key={campaignId}>
            <p className="break-all">No playbook for {campaignId}. {activationText(activations, activationFor(campaignId))}</p>
            <AutomationControls campaignId={campaignId} activation={activationFor(campaignId)} onAutomation={automation} />
          </div>
        )) : null}
        {pending.map((item) => (
          <article key={item.id} className="rounded border border-gray-100 p-3">
            <p className="break-all">{item.campaignId ?? "No campaign"} · {item.actionType} · {item.status}</p>
            <p>Scheduled {item.scheduledAt ?? "at an unknown time"}.</p>
            <p>{item.status === "claimed" ? "Already claimed. Pausing does not cancel it." : item.willSend ? "This action can send on the next pass." : "This action will not send."}</p>
            {item.status === "scheduled" && !item.willSend && item.campaignId && activationFor(item.campaignId)?.activatedAt ? (
              <button className="mt-2 underline" type="button" onClick={() => void release(item.id)}>Release this scheduled action</button>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}

function activationText(activations: CampaignActivation[] | null, activation: CampaignActivation | null): string {
  if (!activations) return "Post-reply automation could not be read.";
  if (!activation) return "Post-reply automation is not activated.";
  if (!activation.activatedAt) return "Post-reply automation is not sending. Future replies and fulfillment stay held. Accepted sends stay accepted.";
  return `Post-reply automation is active since ${activation.activatedAt}. Actions scheduled before that time will not send.`;
}

function unassignedCampaigns(rows: Listed[], pending: PendingFulfillmentView[]): string[] {
  const known = new Set(rows.map((row) => row.campaignId));
  const ids: string[] = [];
  for (const item of pending) {
    if (item.campaignId && !known.has(item.campaignId) && !ids.includes(item.campaignId)) ids.push(item.campaignId);
  }
  return ids;
}

function AutomationControls({
  campaignId,
  activation,
  onAutomation,
}: {
  campaignId: string;
  activation: CampaignActivation | null;
  onAutomation: (campaignId: string, intent: "activate" | "pause_automation" | "resume_automation" | "finish") => Promise<void>;
}) {
  const open = Boolean(activation?.activatedAt);
  return (
    <div className="mt-2 space-x-3">
      {open ? <button className="underline" type="button" onClick={() => void onAutomation(campaignId, "pause_automation")}>Pause automation</button> : null}
      {!open && activation ? <button className="underline" type="button" onClick={() => void onAutomation(campaignId, "resume_automation")}>Resume automation</button> : null}
      {!activation ? <button className="underline" type="button" onClick={() => void onAutomation(campaignId, "activate")}>Activate automation</button> : null}
      <button className="underline" type="button" onClick={() => void onAutomation(campaignId, "finish")}>Finish campaign</button>
    </div>
  );
}
