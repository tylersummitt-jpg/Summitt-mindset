"use client";

import { useMemo, useState } from "react";

import type { DistributionIntelligence, DistributionMetricRow } from "@/lib/distribution-intelligence";
import { CONTENT_PRODUCTIONS } from "@/lib/content-production";
import { APPROVED_LANDING_DESTINATIONS } from "@/lib/landing-experiment-shared";
import {
  DISTRIBUTION_PLATFORMS,
  buildDistributionTrackingLink,
} from "@/lib/distribution-tracking-link";
import {
  TRACKING_CONTENT_TYPES,
  TRACKING_TRAFFIC_TYPES,
  type TrackingContentTypeId,
  type TrackingTrafficTypeId,
} from "@/lib/tracking-link-builder-pure";

const fieldClass = "mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm";

export function DistributionIntelligencePanel({
  intel,
}: {
  intel: DistributionIntelligence;
}) {
  const [production, setProduction] = useState("all");
  const content = useMemo(
    () =>
      production === "all"
        ? intel.content
        : intel.content.filter((row) => row.production === production),
    [intel.content, production]
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-lg font-semibold text-gray-900">Channel performance</h2>
        <details className="rounded border border-gray-200 bg-white px-4 py-3">
          <summary className="cursor-pointer font-medium text-gray-900">How this works</summary>
          <div className="mt-3 space-y-2">
            <p>
              Channel performance counts visitors, trials, and confirmed paying members by the
              first place we can name. Content performance does the same for one campaign and
              one post or ad.
            </p>
            <p>
              A channel is the platform or source, such as Instagram or Meta ads. A campaign is
              the name shared by several posts. A content id is one post, ad, email, or newsletter.
            </p>
            <p>
              First-touch means the first recorded source stays. A later visit does not replace it.
            </p>
            <p>
              Unknown stays unknown. A post without a tracking link is not counted as zero customers.
            </p>
            <p>
              Paid membership and day 30, 60, and 90 retention use the same paid cohort as the
              Retention page. People who are not old enough are left out of the rate.
            </p>
            <p>
              Brooke-created, AI-assisted, and Hybrid describe how a post was made. They are
              labels someone chooses on the tracking link. They are not a controlled experiment,
              and older posts stay Unknown.
            </p>
            <p>
              Spend not recorded is not zero dollars. Campaign spend is not exact spending
              for one post. Cost is shown only when spend and the matching count were both
              recorded. This page does not call a channel profitable.
            </p>
            <p>
              The page adds up existing records when it loads. Tyler or Brooke copies a tracking
              link onto a post. The page does not change ads, send messages, or pick a winner.
            </p>
            <p>
              Cold email, newsletters, and Pinterest can still show as Direct. Likes, shares,
              and views from social networks are not connected. Apple payment history still has
              no trustworthy first-payment time, so historic Apple retention is incomplete.
              Production class is known only for future tracked visits. A difference between
              Brooke-created and AI-assisted content is not proof of causation. Profit and
              lifetime value are not calculated yet. The later goal is to see which posts bring
              members who stay, after spend and the cost of serving them.
            </p>
          </div>
        </details>
        <p>{intel.note}</p>
        <p>{intel.observational}</p>
        <p>
          CTA clicks are counted on Landing Page Performance. They are not split by post here.
          A click is not a trial.
        </p>
        {intel.readable ? <MetricList rows={intel.channels} mode="channel" /> : null}
        {intel.hiddenChannels > 0 ? (
          <p>{intel.hiddenChannels} more channels are not shown.</p>
        ) : null}
        <p>Trials without a first-touch row: {intel.unattributedTrials}.</p>
        <p>Paid members without a first-touch row: {intel.unattributedPaid}.</p>
      </section>

      <DistributionTrackingLink />

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-lg font-semibold text-gray-900">Content performance</h2>
        <label className="block text-xs text-gray-600">
          Production class
          <select
            className={fieldClass}
            value={production}
            onChange={(event) => setProduction(event.target.value)}
          >
            <option value="all">All</option>
            {CONTENT_PRODUCTIONS.map((row) => (
              <option key={row.id} value={row.label}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        {intel.readable ? <MetricList rows={content} mode="content" /> : null}
        {intel.hiddenContent > 0 ? (
          <p>{intel.hiddenContent} more content rows are not shown.</p>
        ) : null}
      </section>
    </div>
  );
}

function MetricList({
  rows,
  mode,
}: {
  rows: DistributionMetricRow[];
  mode: "channel" | "content";
}) {
  if (rows.length === 0) {
    return <p>No rows for this view. That is not the same as zero customers.</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <article
          key={`${mode}-${row.channel}-${row.campaign}-${row.content}-${row.production}`}
          className="rounded border border-gray-200 bg-white px-4 py-3"
        >
          <h3 className="font-medium text-gray-900">
            {mode === "channel"
              ? row.channel
              : `${row.platform} · ${row.campaign} · ${row.content}`}
          </h3>
          {mode === "content" ? <p>Production: {row.production}</p> : null}
          <p>Visitors: {row.visitors}</p>
          <p>Trials: {row.trials}</p>
          <p>Confirmed paying members: {row.paid}</p>
          <p>Trial-to-paid: {row.trialToPaid}</p>
          <p>Mature retention: {row.retention}</p>
          <p>Spend: {row.spend}</p>
          <p>Cost per trial: {row.costPerTrial}</p>
          <p>Cost per confirmed paying member: {row.costPerPaid}</p>
          <p className="text-gray-600">{row.coverage}</p>
        </article>
      ))}
    </div>
  );
}

function DistributionTrackingLink() {
  const [destination, setDestination] = useState<(typeof APPROVED_LANDING_DESTINATIONS)[number]>("/");
  const [platform, setPlatform] = useState<(typeof DISTRIBUTION_PLATFORMS)[number]["id"]>("instagram");
  const [trafficType, setTrafficType] = useState<TrackingTrafficTypeId>("organic");
  const [campaign, setCampaign] = useState("");
  const [contentType, setContentType] = useState<TrackingContentTypeId>("post");
  const [contentId, setContentId] = useState("");
  const [production, setProduction] = useState("unknown");
  const [copied, setCopied] = useState(false);
  const result = buildDistributionTrackingLink({
    destination,
    platform,
    trafficType,
    campaign,
    contentType,
    contentId,
    production,
  });

  return (
    <section className="space-y-3 text-sm text-gray-700">
      <h2 className="text-lg font-semibold text-gray-900">Tracking link</h2>
      <p>
        Builds the same kind of link as Subscriber Growth, for the homepage or one of the four
        landing pages. Brooke&apos;s form is unchanged.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-600">
          Destination
          <select
            className={fieldClass}
            value={destination}
            onChange={(event) =>
              setDestination(event.target.value as (typeof APPROVED_LANDING_DESTINATIONS)[number])
            }
          >
            {APPROVED_LANDING_DESTINATIONS.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Platform
          <select
            className={fieldClass}
            value={platform}
            onChange={(event) =>
              setPlatform(event.target.value as (typeof DISTRIBUTION_PLATFORMS)[number]["id"])
            }
          >
            {DISTRIBUTION_PLATFORMS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Traffic type
          <select
            className={fieldClass}
            value={trafficType}
            onChange={(event) => setTrafficType(event.target.value as TrackingTrafficTypeId)}
          >
            {TRACKING_TRAFFIC_TYPES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Campaign
          <input className={fieldClass} value={campaign} onChange={(event) => setCampaign(event.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          Content type
          <select
            className={fieldClass}
            value={contentType}
            onChange={(event) => setContentType(event.target.value as TrackingContentTypeId)}
          >
            {TRACKING_CONTENT_TYPES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Content id
          <input className={fieldClass} value={contentId} onChange={(event) => setContentId(event.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          Production class
          <select className={fieldClass} value={production} onChange={(event) => setProduction(event.target.value)}>
            {CONTENT_PRODUCTIONS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {result.ok ? (
        <div className="space-y-2">
          <p className="break-all rounded border border-gray-200 bg-white px-3 py-2">{result.url}</p>
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-3 py-1 text-sm"
            onClick={() => {
              void navigator.clipboard.writeText(result.url).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : (
        <p>{result.error}</p>
      )}
    </section>
  );
}
