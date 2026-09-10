"use client";

import { useEffect, useMemo, useState } from "react";

import {
  TRACKING_CONTENT_TYPES,
  TRACKING_PLATFORMS,
  TRACKING_TRAFFIC_TYPES,
  buildTrackingLink,
  defaultCampaignForTrafficType,
  type TrackingContentTypeId,
  type TrackingPlatformId,
  type TrackingTrafficTypeId,
} from "@/lib/tracking-link-builder-pure";

const fieldClass = "mt-0.5 w-full rounded border border-gray-200 px-2 py-1 text-xs";

export function TrackingLinkBuilder() {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<TrackingPlatformId>("instagram");
  const [trafficType, setTrafficType] = useState<TrackingTrafficTypeId>("organic");
  const [campaign, setCampaign] = useState("organic");
  const [contentType, setContentType] = useState<TrackingContentTypeId>("bio");
  const [contentId, setContentId] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const result = useMemo(
    () =>
      buildTrackingLink({
        platform,
        trafficType,
        campaign,
        contentType,
        contentId,
      }),
    [platform, trafficType, campaign, contentType, contentId]
  );

  useEffect(() => {
    if (copyState !== "copied") return;
    const t = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(t);
  }, [copyState]);

  useEffect(() => {
    setCopyState("idle");
  }, [result]);

  async function copyLink() {
    if (!result.ok) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.url);
        setCopyState("copied");
        return;
      }
      const input = document.createElement("input");
      input.value = result.url;
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand("copy");
      input.remove();
      setCopyState(ok ? "copied" : "error");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium text-gray-700">
            Tracking Link Builder
          </div>
          <p className="text-[11px] text-gray-500">
            Create a trackable link for any social post or ad.
          </p>
          <p className="text-[10px] text-gray-500">
            Use the same Campaign name later in Add Ad Spend. Copy utm_campaign
            exactly.
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:border-gray-500"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Open"}
        </button>
      </div>
      {open ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-[11px] text-gray-600">
            Platform
            <select
              className={fieldClass}
              value={platform}
              onChange={(e) => setPlatform(e.target.value as TrackingPlatformId)}
            >
              {TRACKING_PLATFORMS.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-gray-600">
            Traffic type
            <select
              className={fieldClass}
              value={trafficType}
              onChange={(e) => {
                const next = e.target.value as TrackingTrafficTypeId;
                setTrafficType(next);
                if (next === "organic" && !campaign.trim()) {
                  setCampaign(defaultCampaignForTrafficType("organic"));
                }
              }}
            >
              {TRACKING_TRAFFIC_TYPES.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-gray-600">
            Campaign
            <input
              className={fieldClass}
              value={campaign}
              maxLength={80}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder={trafficType === "organic" ? "organic" : "fall_challenge"}
            />
          </label>
          <label className="text-[11px] text-gray-600">
            Content type
            <select
              className={fieldClass}
              value={contentType}
              onChange={(e) => setContentType(e.target.value as TrackingContentTypeId)}
            >
              {TRACKING_CONTENT_TYPES.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-gray-600 sm:col-span-2">
            {contentType === "bio" ? "Name or ID (optional)" : "Name or ID"}
            <input
              className={fieldClass}
              value={contentId}
              maxLength={80}
              onChange={(e) => setContentId(e.target.value)}
              placeholder={contentType === "bio" ? "leave blank for bio" : "psm047"}
            />
          </label>
          {result.ok ? (
            <div className="sm:col-span-2 rounded border border-gray-100 bg-gray-50 px-2 py-2">
              <p className="text-[11px] font-medium text-gray-800">{result.summary}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-gray-700">
                {result.url}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded bg-gray-900 px-3 py-1 text-[11px] font-medium text-white"
                  onClick={() => void copyLink()}
                >
                  Copy Link
                </button>
                {copyState === "copied" ? (
                  <span className="text-[11px] text-emerald-700">Copied</span>
                ) : null}
                {copyState === "error" ? (
                  <span className="text-[11px] text-red-700">Could not copy</span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="sm:col-span-2 text-[11px] text-gray-500">{result.error}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
