"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  actionCount,
  sentActionCount,
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
            <p className="mt-1">None are ranked. Compare one column at a time. Instantly&apos;s contacted count is not the same source as our webhook replies. Journey-verified trials are not a ranking.</p>
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
        <p className="text-sm text-gray-600">People, events, and actions are not added together. A visit is not a play. A play is the first press of play, not a completed watch. Accepted by the email provider is not delivered.</p>
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm text-gray-800">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Trust</th>
              </tr>
            </thead>
            <tbody>
              <FunnelRow stage="People stored" count={showCount(report.peopleStored, "people")} trust="PARTIAL" />
              <FunnelRow stage="Webhook contacts in range" count={showCount(report.peopleWithWebhookSend, "people")} trust="PARTIAL" />
              <FunnelRow stage="Lead snapshot without a send webhook in range" count={showCount(report.peopleWithSnapshotOnly, "people")} trust="PARTIAL" />
              <FunnelRow stage="Send events in range" count={showCount(report.webhookSends, "events")} trust="PARTIAL" />
              <FunnelRow stage="Reply people in range" count={showCount(report.webhookReplyPeople, "people")} trust="PARTIAL" />
              <FunnelRow stage="Positive replies from lead_interested" count="Unavailable" trust="NOT YET TRUSTWORTHY" when="Not a reply" />
              <FunnelRow stage="Confirmed resource requests" count={showCount(report.resourceRequestPeople, "people")} trust={report.resourceRequestPeople == null ? "UNAVAILABLE" : "PARTIAL"} when="This date range" />
              <FunnelRow stage="PDFs accepted, not confirmed delivered" count={showCount(actionCount(report.fulfillment, "send_asset", "accepted"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "PARTIAL"} when="Right now" />
              <FunnelRow stage="PDFs confirmed delivered" count={showCount(actionCount(report.fulfillment, "send_asset", "delivered"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} when="Right now" />
              <FunnelRow stage="PDFs still scheduled" count={showCount(actionCount(report.fulfillment, "send_asset", "scheduled"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} when="Right now" />
              <FunnelRow stage="PDFs claimed and not sent" count={showCount(actionCount(report.fulfillment, "send_asset", "claimed"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} when="Right now" />
              <FunnelRow stage="Personal videos accepted or delivered" count={showCount(sentActionCount(report.fulfillment, "send_video"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "PARTIAL"} when="Right now" />
              <FunnelRow stage="First reminders still scheduled" count={showCount(actionCount(report.fulfillment, "send_video_reminder", "scheduled"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} when="Right now" />
              <FunnelRow stage="First reminders accepted or delivered" count={showCount(sentActionCount(report.fulfillment, "send_video_reminder"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "PARTIAL"} when="Right now" />
              <FunnelRow stage="Final reminders still scheduled" count={showCount(actionCount(report.fulfillment, "send_video_reminder_final", "scheduled"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "TRUSTWORTHY"} when="Right now" />
              <FunnelRow stage="Final reminders accepted or delivered" count={showCount(sentActionCount(report.fulfillment, "send_video_reminder_final"), "actions")} trust={report.fulfillment == null ? "UNAVAILABLE" : "PARTIAL"} when="Right now" />
              <FunnelRow stage="Reminders canceled by a recorded play" count="Unavailable" trust="UNAVAILABLE" when="Reason not stored" />
              <FunnelRow stage="Video page visits" count={showCount(report.videoVisitPeople, "people")} trust={report.videoVisitPeople == null ? "UNAVAILABLE" : "PARTIAL"} when="This date range" />
              <FunnelRow stage="Video plays" count={showCount(report.videoPlayPeople, "people")} trust={report.videoPlayPeople == null ? "UNAVAILABLE" : "PARTIAL"} when="This date range" />
              <FunnelRow stage="Video trial-button clicks" count={showCount(report.videoCtaPeople, "people")} trust={report.videoCtaPeople == null ? "UNAVAILABLE" : "PARTIAL"} when="This date range" />
              <FunnelRow stage="Journey-verified trials" count={showCount(report.attributedTrialPeople, "people")} trust={report.attributedTrialPeople == null ? "UNAVAILABLE" : "TRUSTWORTHY"} when="This date range" />
              <FunnelRow stage="Journey-verified paid members" count={showCount(report.attributedPaidPeople, "people")} trust={report.attributedPaidPeople == null ? "UNAVAILABLE" : "TRUSTWORTHY"} when="This date range" />
              <FunnelRow stage="Email-only trials, not campaign credit" count={showCount(report.emailOnlyTrialPeople, "people")} trust={report.emailOnlyTrialPeople == null ? "UNAVAILABLE" : "PARTIAL"} when="This date range" />
              <FunnelRow stage="Collected revenue" count="Unavailable" trust="UNAVAILABLE" when="Not stored" />
            </tbody>
          </table>
        </div>
        <RateList report={report} />
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
          {report.campaigns.length} campaigns in this read. Search and status filters stay on this page. Compare one column at a time. Instantly contacted is not added to webhook replies. Verified trial and paid counts are shown and are not a ranking. Video plays stay unavailable on a campaign when the event has no campaign id. That is not zero. Sorting by revenue is withheld.
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
                    <th className="px-3 py-2">Reply rate</th>
                    <th className="px-3 py-2">Instantly sent</th>
                    <th className="px-3 py-2">Resource requests</th>
                    <th className="px-3 py-2">PDFs delivered now</th>
                    <th className="px-3 py-2">Videos sent now</th>
                    <th className="px-3 py-2">Video plays</th>
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
                        <td className="px-3 py-2">{showRate(campaign.webhookReplyPeople, campaign.webhookContacted) ?? "Not calculated"}</td>
                        <td className="px-3 py-2">{showCount(campaign.instantlySent, "")}</td>
                        <td className="px-3 py-2">{showCount(campaign.resourceRequestPeople, "")}</td>
                        <td className="px-3 py-2">{showCount(campaign.deliveredAssets, "")}</td>
                        <td className="px-3 py-2">{showCount(sentPair(campaign.videoAccepted, campaign.videoDelivered), "")}</td>
                        <td className="px-3 py-2">{showCount(campaign.videoPlayPeople, "")}</td>
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

function sentPair(accepted: number | null, delivered: number | null): number | null {
  if (accepted == null || delivered == null) return null;
  return accepted + delivered;
}

function outcomeCount(report: DistributionCommandReport, outcome: string): number | null {
  if (report.messages.inbound == null) return null;
  return report.messages.outcomes.find((item) => item.outcome === outcome)?.count ?? 0;
}

function FunnelRow({ stage, count, trust, when = "See the row" }: { stage: string; count: string; trust: Trust; when?: string }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-3 py-2">{stage}</td>
      <td className="px-3 py-2">{count}</td>
      <td className="px-3 py-2">{when}</td>
      <td className="px-3 py-2">{trust}</td>
    </tr>
  );
}

function RateList({ report }: { report: DistributionCommandReport }) {
  const rows = [
    ["Reply rate", report.rates.reply, report.rates.notes.reply],
    ["Resource request to delivery", report.rates.resourceToDelivery, report.rates.notes.resourceToDelivery],
    ["Video sent to play", report.rates.videoSentToPlay, report.rates.notes.videoSentToPlay],
    ["Play to trial-button click", report.rates.playToCta, report.rates.notes.playToCta],
    ["Play to trial", report.rates.videoToTrial, report.rates.notes.videoToTrial],
    ["Trial to paid", report.rates.trialToPaid, report.rates.notes.trialToPaid],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value, note]) => (
        <div key={label} className="rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">
          <p className="font-medium text-gray-900">{label}</p>
          <p className="mt-1">{value ?? "Not calculated"}</p>
          <p className="mt-1 text-xs text-gray-500">{note}</p>
        </div>
      ))}
    </div>
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
      <p>Cold emails sent by Instantly: {showCount(campaign.instantlySent, "emails")}. That number is not added to {showCount(campaign.webhookSends, "webhook sends")}.</p>
      <p>Webhook reply rate: {showRate(campaign.webhookReplyPeople, campaign.webhookContacted) ?? "Not calculated"}. Confirmed resource requests: {showCount(campaign.resourceRequestPeople, "people")}. lead_interested is not included.</p>
      <p>PDFs right now — scheduled {showCount(campaign.scheduledAssets, "actions")}, claimed {showCount(campaign.claimedAssets, "actions")}, accepted and not delivered {showCount(campaign.acceptedAssets, "actions")}, delivered {showCount(campaign.deliveredAssets, "actions")}.</p>
      <p>Personal videos right now — scheduled {showCount(campaign.videoScheduled, "actions")}, claimed {showCount(campaign.videoClaimed, "actions")}, accepted {showCount(campaign.videoAccepted, "actions")}, delivered {showCount(campaign.videoDelivered, "actions")}.</p>
      <p>First reminder — scheduled {showCount(campaign.firstReminderScheduled, "actions")}, claimed {showCount(campaign.firstReminderClaimed, "actions")}, accepted {showCount(campaign.firstReminderAccepted, "actions")}, delivered {showCount(campaign.firstReminderDelivered, "actions")}.</p>
      <p>Final reminder — scheduled {showCount(campaign.finalReminderScheduled, "actions")}, claimed {showCount(campaign.finalReminderClaimed, "actions")}, accepted {showCount(campaign.finalReminderAccepted, "actions")}, delivered {showCount(campaign.finalReminderDelivered, "actions")}.</p>
      <p>Reminders currently canceled: {showCount(campaign.remindersCanceled, "actions")}. Canceled by a recorded play: unavailable. The cancellation does not store a reason.</p>
      <p>Video page visits: {showCount(campaign.videoVisitPeople, "people")}. Plays: {showCount(campaign.videoPlayPeople, "people")}. Trial-button clicks: {showCount(campaign.videoCtaPeople, "people")}. Unavailable means the event did not store this campaign. A visit is not a play, and a play is not a completed watch.</p>
      <p>Journey-verified trials: {campaign.attributedTrials}. Journey-verified paid members: {campaign.attributedPaid}. An email match is not included.</p>
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
