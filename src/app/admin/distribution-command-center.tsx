"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  showCount,
  showRate,
  sortCampaigns,
  type CampaignView,
  type DistributionCommandReport,
  type Trust,
} from "@/lib/acquisition/distribution-command";
import type { GrowthDateRange } from "@/lib/admin-subscriber-growth-pure";

const STATUSES = ["all", "active", "paused", "completed", "running", "draft", "other", "unknown", "finished"] as const;
type StatusFilter = (typeof STATUSES)[number];
type SortKey = "name" | "webhook_sends" | "webhook_replies" | "instantly_contacted";

function TrustMark({ trust }: { trust: Trust }) {
  return <span className="mt-1 block text-xs font-medium uppercase tracking-wide text-gray-500">{trust}</span>;
}

function Card({ label, value, trust, note }: { label: string; value: string; trust: Trust; note: string }) {
  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      <TrustMark trust={trust} />
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </div>
  );
}

function campaignHref(range: GrowthDateRange, id: string | null): string {
  const params = new URLSearchParams({ range });
  if (id) params.set("emailCampaign", id);
  return `/admin/distribution?${params.toString()}`;
}

export function DistributionCommandCenter({
  report,
  range,
  selectedCampaignId,
}: {
  report: DistributionCommandReport;
  range: GrowthDateRange;
  selectedCampaignId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [age, setAge] = useState<"7" | "14" | "30">("7");
  const [view, setView] = useState<"calendar" | "age">("calendar");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = report.campaigns.filter((campaign) => {
      if (status === "finished") return false;
      if (status !== "all" && campaign.statusFilter !== status) return false;
      if (!needle) return true;
      return campaign.id.toLowerCase().includes(needle) || (campaign.name ?? "").toLowerCase().includes(needle);
    });
    return sortCampaigns(rows, { sort, view, age });
  }, [age, query, report.campaigns, sort, status, view]);

  const selected = report.campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const replyRate = showRate(report.webhookReplyPeople, report.peopleWithWebhookSend);
  const trackingOn = report.campaigns.filter((campaign) => campaign.openTracking === true).length;
  const trackingOff = report.campaigns.filter((campaign) => campaign.openTracking === false).length;
  const trackingUnknown = report.campaigns.filter((campaign) => campaign.openTracking == null).length;

  if (!report.readable) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Cold email</h2>
        <p className="text-sm text-gray-800">{report.note}</p>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Cold email</h2>
        <p className="text-sm text-gray-700">{report.note}</p>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
            <p className="font-medium text-gray-900">Is the email machine healthy?</p>
            <p className="mt-1">Not proven. Inbox placement is unavailable.</p>
            <TrustMark trust="UNAVAILABLE" />
          </div>
          <div className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
            <p className="font-medium text-gray-900">Which campaigns are winning?</p>
            <p className="mt-1">None are ranked. Journey-verified trial and paid counts are shown, and they are not a ranking.</p>
            <TrustMark trust="NOT YET TRUSTWORTHY" />
          </div>
          <div className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
            <p className="font-medium text-gray-900">What needs attention?</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {report.attention.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Executive scorecard — {report.rangeLabel}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="People stored" value={showCount(report.peopleStored, "people")} trust="PARTIAL" note="Rows in our database. Not people contacted, and not Instantly's list size. All time." />
          <Card label="Webhook contacts" value={showCount(report.peopleWithWebhookSend, "people")} trust="PARTIAL" note="Distinct people with an email_sent webhook in this range." />
          <Card label="Recorded sends" value={showCount(report.webhookSends, "events")} trust="PARTIAL" note="email_sent events in this range. Not unique people." />
          <Card label="Unique replies" value={showCount(report.webhookReplyPeople, "people")} trust="PARTIAL" note={replyRate ? `${replyRate} of webhook contacts. ${report.webhookReplyEvents ?? "Unavailable"} reply events. lead_interested is excluded.` : "No webhook-contact denominator in this range. This is not a 0% reply rate."} />
          <Card label="Positive replies" value="Unavailable" trust="NOT YET TRUSTWORTHY" note={`${showCount(report.interestedWebhookPeople, "people")} have a lead_interested webhook. That label is not a positive reply.`} />
          <Card label="Instantly unique replies" value={showCount(report.instantly.overview?.replyCountUnique ?? null, "leads")} trust={report.instantly.overview?.replyCountUnique == null ? "UNAVAILABLE" : "PARTIAL"} note={report.instantly.overviewError ?? "Instantly's first reply per lead, excluding automatic replies. Not merged with our webhooks."} />
          <Card label="PDFs confirmed delivered" value={showCount(report.fulfillment == null ? null : report.fulfillment["send_asset:delivered"] ?? 0, "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} note="Current outbox, not the date range. Accepted by Resend is not delivered." />
          <Card label="Journey-verified trials" value={showCount(report.attributedTrialPeople, "people")} trust={report.attributedTrialPeople == null ? "UNAVAILABLE" : "TRUSTWORTHY"} note="Distinct people whose trial event stores the campaign from a journey that belongs to them. An email match is not included." />
          <Card label="Journey-verified paid members" value={showCount(report.attributedPaidPeople, "people")} trust={report.attributedPaidPeople == null ? "UNAVAILABLE" : "TRUSTWORTHY"} note="The first paid event for that subscription. A trial that later pays is counted here once, and it stays in the trial count." />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Funnel</h2>
        <p className="text-sm text-gray-600">Each row names its own denominator. People, events, and actions are not added together.</p>
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm text-gray-800">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">Trust</th>
              </tr>
            </thead>
            <tbody>
              <FunnelRow stage="People stored" count={showCount(report.peopleStored, "people")} trust="PARTIAL" />
              <FunnelRow stage="Webhook contacts in range" count={showCount(report.peopleWithWebhookSend, "people")} trust="PARTIAL" />
              <FunnelRow stage="Lead snapshot without a send webhook in range" count={showCount(report.peopleWithSnapshotOnly, "people")} trust="PARTIAL" />
              <FunnelRow stage="Send events in range" count={showCount(report.webhookSends, "events")} trust="PARTIAL" />
              <FunnelRow stage="Reply people in range" count={showCount(report.webhookReplyPeople, "people")} trust="PARTIAL" />
              <FunnelRow stage="Positive replies" count="Unavailable" trust="NOT YET TRUSTWORTHY" />
              <FunnelRow stage="PDF accepted, not confirmed delivered" count={showCount(report.fulfillment == null ? null : (report.fulfillment["send_asset:accepted"] ?? 0), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "PARTIAL"} />
              <FunnelRow stage="PDF delivered" count={showCount(report.fulfillment == null ? null : (report.fulfillment["send_asset:delivered"] ?? 0), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} />
              <FunnelRow stage="Videos sent" count={showCount(videoActions(report), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} />
              <FunnelRow stage="Video engagement" count={showCount(report.videoEvents, "events")} trust="TRUSTWORTHY" />
              <FunnelRow stage="Journey-verified trials" count={showCount(report.attributedTrialPeople, "people")} trust={report.attributedTrialPeople == null ? "UNAVAILABLE" : "TRUSTWORTHY"} />
              <FunnelRow stage="Journey-verified paid members" count={showCount(report.attributedPaidPeople, "people")} trust={report.attributedPaidPeople == null ? "UNAVAILABLE" : "TRUSTWORTHY"} />
              <FunnelRow stage="Email-only trials, not campaign credit" count={showCount(report.emailOnlyTrialPeople, "people")} trust={report.emailOnlyTrialPeople == null ? "UNAVAILABLE" : "PARTIAL"} />
              <FunnelRow stage="Collected revenue" count="Unavailable" trust="UNAVAILABLE" />
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Sending health</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card label="Instantly leads contacted" value={showCount(report.instantly.overview?.contactedCount ?? null, "leads")} trust={report.instantly.overview?.contactedCount == null ? "UNAVAILABLE" : "PARTIAL"} note={report.instantly.overview ? `${showCount(report.instantly.overview.emailsSentCount, "emails sent")} by Instantly in this calendar range. This is Instantly's own total, not a sum of campaign rows.` : report.instantly.overviewError ?? "Instantly overview was not read."} />
          <Card label="Bounced leads" value={showCount(report.instantly.overview?.bouncedCount ?? null, "leads")} trust={report.instantly.overview?.bouncedCount == null ? "UNAVAILABLE" : "PARTIAL"} note="Instantly's bounced-lead count. Hard and soft are not separated." />
          <Card label="Unsubscribes" value={showCount(report.instantly.overview?.unsubscribedCount ?? null, "leads")} trust={report.instantly.overview?.unsubscribedCount == null ? "UNAVAILABLE" : "PARTIAL"} note="Instantly's count for this calendar range. Not a rate until the contacted denominator is the same source." />
          <Card label="Spam complaints" value="Unavailable" trust="UNAVAILABLE" note="Cold-mail complaints are not in this analytics response. Estimated spam placement is not a complaint count." />
          <Card label="People currently suppressed" value={showCount(report.suppressedPeople, "people")} trust="PARTIAL" note="Current person state. Not a bounce rate and not filtered by the date range." />
          <Card label="Inbox placement" value="Unavailable" trust="UNAVAILABLE" note={`Open tracking is on for ${trackingOn}, off for ${trackingOff}, and unknown for ${trackingUnknown}. Open counts are withheld either way.`} />
        </div>
        <DailyTable title="Recorded send events by day" rows={report.ledgerDaily.map((row) => [row.date, String(row.sends)])} empty="No email_sent webhooks in this range. That is not proof Instantly sent nothing." />
        <DailyTable
          title="Instantly daily totals, all campaigns"
          rows={(report.instantly.daily ?? []).map((row) => [row.date, showCount(row.sent, "sent"), showCount(row.contacted, "contacted"), showCount(row.uniqueReplies, "unique replies")])}
          empty={report.instantly.dailyError ?? "Instantly did not return a daily series. This is not zero."}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Campaigns</h2>
        <p className="text-sm text-gray-600">
          {report.campaigns.length} campaigns in this read. Search and status filters stay on this page. Verified trial and paid counts are shown and are not a ranking. Sorting by revenue or positive replies is withheld.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search campaign name or id"
            aria-label="Search campaigns"
            className="rounded border border-gray-300 px-3 py-1 text-sm"
          />
          <select aria-label="Campaign status" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm">
            {STATUSES.map((item) => <option key={item} value={item}>{item === "all" ? "All statuses" : item}</option>)}
          </select>
          <select aria-label="Sort campaigns" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm">
            <option value="name">Name</option>
            <option value="webhook_sends">Recorded sends</option>
            <option value="webhook_replies">Webhook reply people</option>
            <option value="instantly_contacted">Instantly contacted</option>
          </select>
          <button type="button" onClick={() => setView("calendar")} className={view === "calendar" ? "rounded bg-gray-900 px-3 py-1 text-sm text-white" : "rounded border border-gray-300 bg-white px-3 py-1 text-sm"}>Calendar range</button>
          <button type="button" onClick={() => setView("age")} className={view === "age" ? "rounded bg-gray-900 px-3 py-1 text-sm text-white" : "rounded border border-gray-300 bg-white px-3 py-1 text-sm"}>Campaign age</button>
          {view === "age" ? (
            <select aria-label="Campaign age window" value={age} onChange={(event) => setAge(event.target.value as "7" | "14" | "30")} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm">
              <option value="7">First 7 days</option>
              <option value="14">First 14 days</option>
              <option value="30">First 30 days</option>
            </select>
          ) : null}
        </div>
        {status === "finished" ? (
          <p className="text-sm text-gray-700">Finished is reserved for an experiment that has actually been reviewed. Instantly Completed is not finished. No campaign is in that state.</p>
        ) : null}
        <p className="text-sm text-gray-600">Offer and audience filters are unavailable. Offer is stored on {showCount(report.offerFilled, "people")}. Role is stored on {showCount(report.roleFilled, "people")}. Sport is stored on {showCount(report.sportFilled, "people")}. Geography is filled on {showCount(report.geographyFilled, "people")} across {report.geographyDistinct ?? "an unknown number of"} distinct values, and those values are not a state breakdown.</p>
        <div className="max-h-96 overflow-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm text-gray-800">
            <thead className="sticky top-0 border-b border-gray-200 bg-white text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Status</th>
                {view === "calendar" ? (
                  <>
                    <th className="px-3 py-2">People stored</th>
                    <th className="px-3 py-2">Webhook contacts</th>
                    <th className="px-3 py-2">Webhook replies</th>
                    <th className="px-3 py-2">Instantly contacted</th>
                    <th className="px-3 py-2">Instantly unique replies</th>
                    <th className="px-3 py-2">Verified trials</th>
                    <th className="px-3 py-2">Verified paid</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-2">Age window</th>
                    <th className="px-3 py-2">Contacts</th>
                    <th className="px-3 py-2">Replies</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((campaign) => {
                const slice = campaign.age[age];
                return (
                  <tr key={campaign.id} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <Link href={campaignHref(range, campaign.id)} className="underline">{campaign.name ?? campaign.id}</Link>
                      <span className="mt-1 block text-xs text-gray-500">{campaign.id}</span>
                    </td>
                    <td className="px-3 py-2">{campaign.statusLabel}</td>
                    {view === "calendar" ? (
                      <>
                        <td className="px-3 py-2">{campaign.peopleStored}</td>
                        <td className="px-3 py-2">{showCount(campaign.webhookContacted, "")}</td>
                        <td className="px-3 py-2">{showCount(campaign.webhookReplyPeople, "")}</td>
                        <td className="px-3 py-2">{showCount(campaign.instantlyContacted, "")}</td>
                        <td className="px-3 py-2">{showCount(campaign.instantlyUniqueReplies, "")}</td>
                        <td className="px-3 py-2">{campaign.attributedTrials}</td>
                        <td className="px-3 py-2">{campaign.attributedPaid}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2">{slice.state}</td>
                        <td className="px-3 py-2">{showCount(slice.contacted, "")}</td>
                        <td className="px-3 py-2">{showCount(slice.replyPeople, "")}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selected ? <CampaignDetail campaign={selected} range={range} steps={report.instantly.selectedSteps} daily={report.instantly.selectedDaily} error={report.instantly.selectedError} /> : (
          <p className="text-sm text-gray-600">Select a campaign to see its webhook steps, fulfillment, and, when Instantly is available, its own daily series.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Mailboxes and domains</h2>
        <p className="text-sm text-gray-600">A mailbox can send for more than one campaign. Ledger volume is webhook sends in this range. Instantly daily volume is unavailable when the account list is over 200 or the range is over 31 days. {report.instantly.accountDailyError ?? "Account status is Instantly's raw code, not a health score."}</p>
        <div className="max-h-80 overflow-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Mailboxes</th>
                <th className="px-3 py-2">Recorded sends</th>
              </tr>
            </thead>
            <tbody>
              {report.domains.map((domain) => (
                <tr key={domain.domain} className="border-t border-gray-100">
                  <td className="px-3 py-2">{domain.domain}</td>
                  <td className="px-3 py-2">{domain.mailboxes}</td>
                  <td className="px-3 py-2">{domain.ledgerSends}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="max-h-80 overflow-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Mailbox</th>
                <th className="px-3 py-2">Campaigns</th>
                <th className="px-3 py-2">Recorded sends</th>
                <th className="px-3 py-2">Instantly sent</th>
                <th className="px-3 py-2">Instantly bounced</th>
              </tr>
            </thead>
            <tbody>
              {report.mailboxes.map((mailbox) => (
                <tr key={mailbox.email} className="border-t border-gray-100">
                  <td className="px-3 py-2">{mailbox.email}<span className="mt-1 block text-xs text-gray-500">{mailbox.domain} · status {mailbox.statusCode ?? "unknown"}</span></td>
                  <td className="px-3 py-2">{mailbox.campaignIds.length === 0 ? "Not in this webhook range" : mailbox.campaignIds.join(", ")}</td>
                  <td className="px-3 py-2">{mailbox.ledgerSends}</td>
                  <td className="px-3 py-2">{showCount(mailbox.instantlySent, "")}</td>
                  <td className="px-3 py-2">{showCount(mailbox.instantlyBounced, "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Steps and variants</h2>
        <p className="text-sm text-gray-600">Instantly's unscoped steps response has no campaign id, so it is a workspace mix. It is not a comparison between campaigns. Copy subject lines are not stored.</p>
        <StepTable rows={report.instantly.steps} empty={report.instantly.stepsError ?? "Instantly steps were not read. This is not zero."} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">AI replies and fulfillment</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Inbound messages" value={showCount(report.messages.inbound, "messages")} trust="PARTIAL" note={`${showCount(report.messages.interpreted, "interpreted")}, ${showCount(report.messages.stored, "still stored")}.`} />
          <Card label="Needs a person" value={showCount(outcomeCount(report, "needs_human"), "messages")} trust="PARTIAL" note="needs_human only. Other outcomes are listed below." />
          <Card label="Outbound sent" value={showCount(report.messages.outboundSent, "messages")} trust="PARTIAL" note="Status sent. The row does not say whether a person or the model sent it." />
          <Card label="Scheduled PDFs" value={showCount(report.fulfillment == null ? null : report.fulfillment["send_asset:scheduled"] ?? 0, "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} note="Current outbox. Scheduled is not sent." />
        </div>
        <p className="text-sm text-gray-700">
          Outcomes: {report.messages.outcomes.length === 0 ? "none in this range" : report.messages.outcomes.map((item) => `${item.outcome} ${item.count}`).join(", ")}.
          Journeys open {showCount(report.journeysOpen, "")}, closed {showCount(report.journeysClosed, "")}, people without a journey {showCount(report.peopleWithoutJourney, "")}.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Trials, paid members, and the next decision</h2>
        <p className="text-sm text-gray-800">{report.nextDecision}</p>
        <p className="text-sm text-gray-600">
          Journey-verified trials in this range: {showCount(report.attributedTrialPeople, "people")}. Journey-verified paid members: {showCount(report.attributedPaidPeople, "people")}. Email-only trials, with no campaign credit: {showCount(report.emailOnlyTrialPeople, "people")}. Email-only paid members: {showCount(report.emailOnlyPaidPeople, "people")}. Collected revenue, MRR, and a first-touch guess are unavailable. Company trial counts stay in the website section below and are not added to these rows.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Measurement gaps</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          {report.gaps.map((gap) => <li key={gap}>{gap}</li>)}
          <li>Unknown webhook events in this range: {showCount(report.unknownWebhookEvents, "events")}. {report.unknownWebhookTypes.map((item) => `${item.type} ${item.events}`).join(", ") || "No preserved raw type."}</li>
          <li>Preserved sequence-finished events in this range: {showCount(report.sequenceFinishedEvents, "events")}. These are not the unknown events.</li>
        </ul>
      </section>
    </div>
  );
}

function videoActions(report: DistributionCommandReport): number | null {
  if (!report.fulfillment) return null;
  return Object.entries(report.fulfillment).reduce((sum, [key, count]) => (key.startsWith("send_video:") ? sum + count : sum), 0);
}

function outcomeCount(report: DistributionCommandReport, outcome: string): number | null {
  if (report.messages.inbound == null) return null;
  return report.messages.outcomes.find((item) => item.outcome === outcome)?.count ?? 0;
}

function FunnelRow({ stage, count, trust }: { stage: string; count: string; trust: Trust }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-3 py-2">{stage}</td>
      <td className="px-3 py-2">{count}</td>
      <td className="px-3 py-2">{trust}</td>
    </tr>
  );
}

function DailyTable({ title, rows, empty }: { title: string; rows: string[][]; empty: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-gray-600">{empty}</p> : (
        <div className="max-h-60 overflow-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.join("|")} className="border-t border-gray-100">
                  {row.map((cell) => <td key={cell} className="px-3 py-1">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StepTable({ rows, empty }: { rows: DistributionCommandReport["instantly"]["steps"]; empty: string }) {
  if (!rows) return <p className="text-sm text-gray-600">{empty}</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-600">Instantly returned no step rows for this request.</p>;
  return (
    <div className="max-h-80 overflow-auto rounded border border-gray-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Step</th>
            <th className="px-3 py-2">Variant</th>
            <th className="px-3 py-2">Sent</th>
            <th className="px-3 py-2">Unique replies</th>
            <th className="px-3 py-2">Instantly opportunities</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.step}-${row.variant}-${index}`} className="border-t border-gray-100">
              <td className="px-3 py-2">{row.step ?? "Not attributed"}</td>
              <td className="px-3 py-2">{row.variantLabel}</td>
              <td className="px-3 py-2">{showCount(row.sent, "")}</td>
              <td className="px-3 py-2">{showCount(row.uniqueReplies, "")}</td>
              <td className="px-3 py-2">{showCount(row.opportunities, "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignDetail({
  campaign,
  range,
  steps,
  daily,
  error,
}: {
  campaign: CampaignView;
  range: GrowthDateRange;
  steps: DistributionCommandReport["instantly"]["selectedSteps"];
  daily: DistributionCommandReport["instantly"]["selectedDaily"];
  error: string | null;
}) {
  return (
    <div className="space-y-2 rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">{campaign.name ?? campaign.id}</h3>
        <Link href={campaignHref(range, null)} className="underline">All campaigns</Link>
      </div>
      <p>{campaign.completionNote}</p>
      <p>Offer: not stored. Open tracking: {campaign.openTracking == null ? "unknown" : campaign.openTracking ? "on, counts withheld" : "off"}. Link tracking: {campaign.linkTracking == null ? "unknown" : campaign.linkTracking ? "on, counts withheld" : "off"}.</p>
      <p>Scheduled PDFs {showCount(campaign.scheduledAssets, "actions")}. Accepted {showCount(campaign.acceptedAssets, "actions")}. Delivered {showCount(campaign.deliveredAssets, "actions")}.</p>
      <p>Webhook steps in this range, partial:</p>
      <ul className="list-disc pl-5">
        {campaign.steps.length === 0 ? <li>No recorded step on a send webhook in this range.</li> : campaign.steps.map((step) => (
          <li key={step.step}>Step {step.step}: {step.sends} sends, {step.people} people, {step.replyPeople} reply people.</li>
        ))}
      </ul>
      <p>Instantly steps for this campaign only. {error ?? "Opportunities are Instantly's label."}</p>
      <StepTable rows={steps} empty={error ?? "Instantly did not return steps for this campaign. This is not zero."} />
      <DailyTable title="Instantly daily series for this campaign" rows={(daily ?? []).map((row) => [row.date, showCount(row.sent, "sent"), showCount(row.uniqueReplies, "unique replies")])} empty={error ?? "Instantly did not return a daily series for this campaign. The all-campaign series above is not this campaign."} />
    </div>
  );
}
