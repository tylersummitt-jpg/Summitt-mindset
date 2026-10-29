"use client";

import { useEffect, useMemo, useState } from "react";

import {
  accountSwitchLines,
  copiedPlaybookTarget,
  filterCampaigns,
  launchChecklist,
  postReplyLabel,
  type CatalogCampaign,
} from "@/lib/acquisition/campaign-catalog";
import type { PendingFulfillmentView } from "@/lib/acquisition/campaign-activation";
import type { PlaybookVersion } from "@/lib/acquisition/playbook";
import { VideoFirstLeadPanel } from "@/app/admin/distribution/campaign-playbooks/video-first-lead-panel";

const CATALOG = [
  ["definite_dozen", "Pat Summitt Definite Dozen team discussion guide"],
  ["playbook", "Pat Summitt basketball special-situations playbook"],
  ["definite_dozen_ad", "Pat Summitt Definite Dozen athletic director discussion guide"],
] as const;

type VideoChoice = { id: string; status: string; createdAt: string; publicToken: string };
type Gates = { automation: string; interpretation: string; sending: string; blocklist: string };

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

const FILTERS = {
  query: "",
  instantly: "all",
  playbook: "all",
  automation: "all",
  page: 1,
  pageSize: 25,
};

export default function CampaignPlaybooksDashboard({ videos }: { videos: VideoChoice[] }) {
  const [form, setForm] = useState(EMPTY);
  const [campaigns, setCampaigns] = useState<CatalogCampaign[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookVersion[]>([]);
  const [gates, setGates] = useState<Gates | null>(null);
  const [pending, setPending] = useState<PendingFulfillmentView[]>([]);
  const [instantly, setInstantly] = useState<"ready" | "unavailable">("unavailable");
  const [truncated, setTruncated] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [filters, setFilters] = useState(FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copySource, setCopySource] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", { cache: "no-store" });
    const body = await res.json().catch(() => null) as {
      ok?: boolean;
      error?: string;
      campaigns?: CatalogCampaign[];
      playbooks?: PlaybookVersion[];
      gates?: Gates | null;
      pending?: PendingFulfillmentView[];
      instantly?: "ready" | "unavailable";
      truncated?: boolean;
      activationError?: string | null;
    } | null;
    if (!body?.ok || !body.campaigns || !body.playbooks) {
      setMessage(body?.error ?? "Campaign playbooks could not be read.");
      return;
    }
    setCampaigns(body.campaigns);
    setPlaybooks(body.playbooks);
    setGates(body.gates ?? null);
    setPending(body.pending ?? []);
    setInstantly(body.instantly ?? "unavailable");
    setTruncated(Boolean(body.truncated));
    setActivationError(body.activationError ?? null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const page = useMemo(() => filterCampaigns(campaigns, filters), [campaigns, filters]);
  const selected = campaigns.find((campaign) => campaign.id === selectedId) ?? null;

  function setField(key: keyof typeof EMPTY, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggle(list: "resources" | "permittedActions", value: string) {
    setForm((current) => {
      const values = current[list];
      return { ...current, [list]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
    });
  }

  function playbookFor(campaignId: string): PlaybookVersion | null {
    return playbooks.find((row) => row.campaignId === campaignId) ?? null;
  }

  function loadForm(campaignId: string) {
    const playbook = playbookFor(campaignId);
    setCopySource(null);
    setForm(playbook ? {
      campaignId,
      name: playbook.name,
      audience: playbook.audience,
      offerLabel: playbook.offerLabel ?? "",
      offerKey: playbook.offerKey ?? "",
      resources: [...playbook.resources],
      manualResource: playbook.manualResource ?? "",
      personalVideoId: playbook.personalVideoId ?? "",
      permittedActions: [...playbook.permittedActions],
      replyGuidance: playbook.replyGuidance ?? "",
      fulfillment: playbook.fulfillment,
    } : { ...EMPTY, campaignId });
  }

  function choose(campaignId: string) {
    setSelectedId(campaignId);
    if (copySource && copySource !== campaignId) {
      setForm((current) => ({ ...current, campaignId }));
      setMessage("This copy will be saved on the selected campaign. The original campaign history stays in place.");
      return;
    }
    loadForm(campaignId);
  }

  function startCopy() {
    if (!form.campaignId) return;
    setCopySource(form.campaignId);
    setForm((current) => ({ ...current, campaignId: "" }));
    setMessage("Choose a different campaign. Saving creates a new version there and leaves the original history in place.");
  }

  async function save() {
    setMessage(null);
    if (copySource) {
      const target = copiedPlaybookTarget(copySource, form.campaignId);
      if (!target.ok) {
        setMessage(target.error);
        return;
      }
    }
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "save", ...form }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; version?: number } | null;
    setMessage(body?.ok ? `Saved version ${body.version}. This does not activate automated replies or fulfillment.` : body?.error ?? "The playbook was not saved.");
    if (body?.ok) {
      setCopySource(null);
      await load();
    }
  }

  async function status(campaignId: string, intent: "pause" | "resume" | "retire") {
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, campaignId }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setMessage(body?.ok ? "Playbook status saved. Post-reply automation was not changed." : body?.error ?? "The status was not changed.");
    if (body?.ok) await load();
  }

  async function automation(campaignId: string, intent: "activate" | "pause_automation" | "resume_automation" | "finish") {
    const prompt = intent === "finish"
      ? "Finish this campaign? The playbook retires and future automated replies and fulfillment stop. Accepted sends stay accepted."
      : intent === "pause_automation"
        ? "Pause post-reply automation for this campaign only? This does not pause the playbook record and does not pause Instantly. Accepted sends stay accepted."
        : "Turn on post-reply automation for this campaign only? Instantly keeps sending its own sequence. Account-wide switches stay as they are. Replies and scheduled work from before now stay held.";
    if (!window.confirm(prompt)) return;
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, campaignId }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; activatedAt?: string | null } | null;
    const held = !gates || (gates.automation !== "pilot" && gates.automation !== "active") || gates.sending !== "on";
    setMessage(body?.ok
      ? intent === "pause_automation" || intent === "finish"
        ? "Post-reply automation is closed for that campaign. Accepted sends stay accepted."
        : held
          ? `Post-reply automation is on for that campaign${body.activatedAt ? ` since ${body.activatedAt}` : ""}. Mail stays held because the account-wide switches are off. Earlier replies and scheduled work stay held.`
          : `Post-reply automation is on for that campaign${body.activatedAt ? ` since ${body.activatedAt}` : ""}. Earlier replies and scheduled work stay held.`
      : body?.error ?? "Automation was not changed.");
    if (body?.ok) await load();
  }

  async function release(actionId: string) {
    const held = !gates || (gates.automation !== "pilot" && gates.automation !== "active");
    if (!window.confirm(held
      ? "Release this one scheduled action? It stays held until account-wide fulfillment is on. Other held actions stay held."
      : "Release this one scheduled action? It can send on the next pass. Other held actions stay held.")) return;
    setMessage(null);
    const res = await fetch("/api/admin/acquisition/campaign-playbooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "release", actionId }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setMessage(body?.ok
      ? held
        ? "That action is released into the send window. It will not send while account-wide fulfillment is off."
        : "That scheduled action can send on the next pass."
      : body?.error ?? "The action was not released.");
    if (body?.ok) await load();
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-gray-200 p-4 text-sm text-gray-800">
        <h2 className="font-medium">What this page controls</h2>
        <p className="mt-2">Instantly cold email and Summitt Mindset replies are separate. A saved playbook, and a campaign marked on, do not mean mail is going out.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {accountSwitchLines(gates).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="mt-2">
          {instantly === "ready"
            ? "Campaign names below come from Instantly. Search the name."
            : "Instantly names and cold-email statuses are unavailable. No name was filled in."}
        </p>
        {activationError ? <p className="mt-2">{activationError}</p> : null}
        {truncated ? <p className="mt-2">The campaign list is truncated. A missing row may still exist.</p> : null}
      </section>

      <Checklist
        campaign={selected}
        instantly={instantly}
        copySource={copySource}
        draft={form}
        gates={gates}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Search campaigns"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder="Search name or id"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value, page: 1 })}
          />
          <select aria-label="Instantly status" className="rounded border border-gray-300 px-2 py-1 text-sm" value={filters.instantly} onChange={(event) => setFilters({ ...filters, instantly: event.target.value, page: 1 })}>
            <option value="all">All Instantly statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="running">Running subsequences</option>
            <option value="other">Other</option>
            <option value="unavailable">Unavailable</option>
            <option value="unknown">Unknown</option>
          </select>
          <select aria-label="Playbook status" className="rounded border border-gray-300 px-2 py-1 text-sm" value={filters.playbook} onChange={(event) => setFilters({ ...filters, playbook: event.target.value, page: 1 })}>
            <option value="all">All playbook statuses</option>
            <option value="none">No playbook</option>
            <option value="current">Saved</option>
            <option value="paused">Paused</option>
            <option value="retired">Retired</option>
            <option value="superseded">Superseded</option>
          </select>
          <select aria-label="Post-reply automation" className="rounded border border-gray-300 px-2 py-1 text-sm" value={filters.automation} onChange={(event) => setFilters({ ...filters, automation: event.target.value, page: 1 })}>
            <option value="all">All automation statuses</option>
            <option value="not_activated">Not activated</option>
            <option value="inactive">Inactive</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="finished">Finished</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>
        <p className="text-sm text-gray-600">{page.total} campaigns. Page {page.page} of {page.pages}.</p>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-left text-sm text-gray-800">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Instantly cold email</th>
                <th className="px-3 py-2">Playbook</th>
                <th className="px-3 py-2">Summitt replies</th>
                <th className="px-3 py-2">Audience and offer</th>
                <th className="px-3 py-2">Outstanding</th>
                <th className="px-3 py-2">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-3" colSpan={7}>No campaign matches this search.</td>
                </tr>
              ) : null}
              {page.rows.map((campaign) => (
                <tr key={campaign.id} className={campaign.id === selectedId ? "bg-gray-50" : undefined}>
                  <td className="px-3 py-2">
                    <button className="underline" type="button" onClick={() => choose(campaign.id)}>
                      {campaign.name ?? "Name unavailable"}
                    </button>
                    <span className="mt-1 block break-all text-xs text-gray-500">{campaign.id}</span>
                  </td>
                  <td className="px-3 py-2">{campaign.instantlyStatus}</td>
                  <td className="px-3 py-2">{playbookLabel(campaign.playbookStatus)}{campaign.playbookVersion ? ` v${campaign.playbookVersion}` : ""}</td>
                  <td className="px-3 py-2">{postReplyLabel({ automation: campaign.automation, gates })}</td>
                  <td className="px-3 py-2">{summary(campaign)}</td>
                  <td className="px-3 py-2">{campaign.outstanding}</td>
                  <td className="px-3 py-2">{activityLabel(campaign)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-3 text-sm">
          <button className="underline" type="button" disabled={page.page <= 1} onClick={() => setFilters({ ...filters, page: page.page - 1 })}>Previous</button>
          <button className="underline" type="button" disabled={page.page >= page.pages} onClick={() => setFilters({ ...filters, page: page.page + 1 })}>Next</button>
        </div>
      </section>

      {selected ? (
        <section className="space-y-3 rounded border border-gray-200 p-4 text-sm text-gray-800">
          <h2 className="font-medium">{selected.name ?? "Name unavailable"}</h2>
          <p>Instantly cold email: {selected.instantlyStatus}. Summitt replies: {postReplyLabel({ automation: selected.automation, gates })}.</p>
          <p>Playbook: {playbookLabel(selected.playbookStatus)}{selected.playbookVersion ? `, version ${selected.playbookVersion}` : ""}. {selected.activatedAt ? `Post-reply window opened ${selected.activatedAt}.` : "There is no open post-reply window."}</p>
          <p>{selected.legacyResource ? `Existing resource promise: ${selected.legacyResource}. Saving a playbook leaves that promise in place.` : "No older resource promise is stored for this campaign."}</p>
          <p>Outstanding fulfillment: {selected.outstanding}. Work from before the post-reply window stays held.</p>
          {selected.playbookStatus === "current" ? <button className="underline" type="button" onClick={() => void status(selected.id, "pause")}>Pause playbook</button> : null}
          {selected.playbookStatus === "paused" || selected.playbookStatus === "retired" ? <button className="underline" type="button" onClick={() => void status(selected.id, "resume")}>Resume playbook</button> : null}
          {selected.playbookStatus === "current" || selected.playbookStatus === "paused" ? <button className="ml-3 underline" type="button" onClick={() => void status(selected.id, "retire")}>Retire playbook</button> : null}
          <div className="mt-2 space-x-3">
            {selected.automation === "active" ? <button className="underline" type="button" onClick={() => void automation(selected.id, "pause_automation")}>Pause Summitt replies</button> : null}
            {selected.automation === "paused" || selected.automation === "inactive" || selected.automation === "finished" ? <button className="underline" type="button" onClick={() => void automation(selected.id, "resume_automation")}>Turn Summitt replies back on</button> : null}
            {selected.automation === "not_activated" ? <button className="underline" type="button" onClick={() => void automation(selected.id, "activate")}>Turn on Summitt replies</button> : null}
            <button className="underline" type="button" onClick={() => void automation(selected.id, "finish")}>Finish campaign</button>
          </div>
        </section>
      ) : null}

      {selected && !copySource ? (
        <VideoFirstLeadPanel
          campaignId={selected.id}
          campaignName={selected.name ?? "this campaign"}
          videos={videos}
          sourceOptions={campaigns
            .filter((campaign) => campaign.id)
            .map((campaign) => ({ id: campaign.id, name: campaign.name ?? campaign.id }))}
        />
      ) : null}

      {selected || copySource || instantly !== "ready" || truncated ? (
      <form className="space-y-3 rounded border border-gray-200 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h2 className="text-sm font-medium text-gray-900">{copySource ? "Copy this setup onto another campaign" : "Confirm the setup"}</h2>
        <p className="text-sm text-gray-700">The same fields work for every audience. Saving writes a playbook version and does not send mail.</p>
        {instantly === "ready" && !truncated ? (
          <p className="text-sm text-gray-800">Campaign: {selected ? (selected.name ?? "Name unavailable") : "Choose a campaign above."}{form.campaignId ? ` Id ${form.campaignId}` : ""}</p>
        ) : (
          <label className="block text-sm text-gray-800">Instantly campaign id, only when the campaign is missing from the list
            <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.campaignId} onChange={(event) => setField("campaignId", event.target.value)} />
          </label>
        )}
        <label className="block text-sm text-gray-800">Name on the playbook
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.name} onChange={(event) => setField("name", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Audience
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.audience} onChange={(event) => setField("audience", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Offer
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.offerLabel} onChange={(event) => setField("offerLabel", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Offer key, leave blank unless this offer already has one
          <input className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.offerKey} onChange={(event) => setField("offerKey", event.target.value)} />
        </label>
        <fieldset className="text-sm text-gray-800">
          <legend>Resource</legend>
          {CATALOG.map(([key, label]) => (
            <label key={key} className="mt-1 block">
              <input type="checkbox" checked={form.resources.includes(key)} onChange={() => toggle("resources", key)} /> {label}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm text-gray-800">Other resource, not delivered automatically
          <textarea className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.manualResource} onChange={(event) => setField("manualResource", event.target.value)} />
        </label>
        <label className="block text-sm text-gray-800">Video
          <select className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.personalVideoId} onChange={(event) => setField("personalVideoId", event.target.value)}>
            <option value="">No video</option>
            {videos.map((video) => (
              <option key={video.id} value={video.id} disabled={video.status !== "ready"}>{video.status} · {video.createdAt.slice(0, 10)} · {video.id}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-gray-800">Fulfillment
          <select className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.fulfillment} onChange={(event) => setField("fulfillment", event.target.value)}>
            <option value="catalog">Resource</option>
            <option value="video">Video</option>
            <option value="catalog_and_video">Resource and video, separately</option>
            <option value="manual">Separate fulfillment, no automatic send</option>
            <option value="none">No resource</option>
          </select>
        </label>
        <fieldset className="text-sm text-gray-800">
          <legend>Permitted actions</legend>
          <label className="mt-1 block"><input type="checkbox" checked={form.permittedActions.includes("send_asset")} onChange={() => toggle("permittedActions", "send_asset")} /> Send the resource when the reply accepts it</label>
          <label className="mt-1 block"><input type="checkbox" checked={form.permittedActions.includes("send_video")} onChange={() => toggle("permittedActions", "send_video")} /> Send the video when the reply accepts it</label>
        </fieldset>
        <label className="block text-sm text-gray-800">AI guidance
          <textarea className="mt-1 w-full rounded border border-gray-300 px-2 py-1" value={form.replyGuidance} onChange={(event) => setField("replyGuidance", event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-3">
          <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white" type="submit">Save playbook version</button>
          {form.campaignId && !copySource ? <button className="rounded border border-gray-300 px-3 py-2 text-sm" type="button" onClick={startCopy}>Copy onto another campaign</button> : null}
          {copySource ? <button className="rounded border border-gray-300 px-3 py-2 text-sm" type="button" onClick={() => loadForm(copySource)}>Cancel copy</button> : null}
        </div>
      </form>
      ) : (
        <p className="text-sm text-gray-800">Choose a campaign in the list. The setup form opens for that campaign.</p>
      )}
      {message ? <p className="text-sm text-gray-800">{message}</p> : null}

      <section className="space-y-3 rounded border border-gray-200 p-4 text-sm text-gray-800">
        <h2 className="font-medium">Held fulfillment</h2>
        <p>Each release covers one scheduled action. There is no bulk release. An action scheduled before activation stays held until that action is released.</p>
        {pending.length >= 100 ? <p>This list shows 100 held actions. The outstanding count includes the actions that were scanned.</p> : null}
        {pending.length === 0 ? <p>No scheduled or claimed fulfillment is in this list.</p> : null}
        {pending.map((item) => (
          <article key={item.id} className="rounded border border-gray-100 p-3">
            <p className="break-all">{campaignName(campaigns, item.campaignId)} · {item.actionType} · {item.status}</p>
            <p>Scheduled {item.scheduledAt ?? "at an unknown time"}.</p>
            <p>{fulfillmentLine(item, gates)}</p>
            {item.status === "scheduled" && !item.willSend && item.campaignId && campaigns.find((campaign) => campaign.id === item.campaignId)?.automation === "active" ? (
              <button className="mt-2 underline" type="button" onClick={() => void release(item.id)}>Release this scheduled action</button>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}

function playbookLabel(status: string): string {
  if (status === "none") return "No playbook";
  if (status === "current") return "Saved";
  if (status === "paused") return "Paused";
  if (status === "retired") return "Retired";
  if (status === "superseded") return "Replaced";
  return status;
}

function Checklist({
  campaign,
  instantly,
  copySource,
  draft,
  gates,
}: {
  campaign: CatalogCampaign | null;
  instantly: "ready" | "unavailable";
  copySource: string | null;
  draft: typeof EMPTY;
  gates: Gates | null;
}) {
  const checklist = launchChecklist({ campaign, instantly, copySource, draft, gates });
  return (
    <section className="rounded border border-gray-200 p-4 text-sm text-gray-800">
      <h2 className="font-medium">Setup checklist</h2>
      <p className="mt-2">Next: {checklist.next}</p>
      <ol className="mt-3 space-y-2">
        {checklist.steps.map((step) => (
          <li key={step.step}>
            <span className="font-medium">{step.step}. {step.title} — {markLabel(step.mark)}.</span> {step.detail}
          </li>
        ))}
      </ol>
    </section>
  );
}

function markLabel(mark: "done" | "needs_you" | "held" | "unverified"): string {
  if (mark === "done") return "Done";
  if (mark === "needs_you") return "Do this";
  if (mark === "held") return "Held";
  return "Not verified";
}

function fulfillmentLine(item: PendingFulfillmentView, gates: Gates | null): string {
  if (item.status === "claimed") return "Already claimed. Pausing does not cancel it.";
  if (!item.willSend) return "This action will not send. It stays held.";
  if (!gates || (gates.automation !== "pilot" && gates.automation !== "active")) {
    return "This action is inside the campaign window. It will not send while account-wide fulfillment is off.";
  }
  return "This action can send on the next pass.";
}

function summary(campaign: CatalogCampaign): string {
  const parts = [campaign.audience, campaign.offerLabel, ...campaign.resources].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No playbook summary";
}

function activityLabel(campaign: CatalogCampaign): string {
  if (campaign.activity === "unavailable") return "Unavailable";
  if (campaign.activity === "not_in_window") return "Not in the latest 1,000 events";
  return campaign.lastActivity ?? "Unavailable";
}

function campaignName(campaigns: readonly CatalogCampaign[], campaignId: string | null): string {
  if (!campaignId) return "No campaign";
  return campaigns.find((campaign) => campaign.id === campaignId)?.name ?? campaignId;
}
