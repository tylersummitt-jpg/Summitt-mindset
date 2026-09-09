import { describe, expect, it } from "vitest";

import { buildTrackingLink, normalizeTrackingToken } from "@/lib/tracking-link-builder-pure";

describe("tracking link builder", () => {
  it("builds Instagram Organic Bio without a content ID", () => {
    const result = buildTrackingLink({
      platform: "instagram",
      trafficType: "organic",
      campaign: "organic",
      contentType: "bio",
      contentId: "",
    });
    expect(result).toMatchObject({
      ok: true,
      utm_source: "instagram",
      utm_medium: "organic_social",
      utm_campaign: "organic",
      utm_content: "bio",
      url: "https://summittmindset.com/?utm_source=instagram&utm_medium=organic_social&utm_campaign=organic&utm_content=bio",
      summary: "Instagram · Organic · bio",
    });
  });

  it("builds Instagram Organic Story + psm047", () => {
    const result = buildTrackingLink({
      platform: "instagram",
      trafficType: "organic",
      campaign: "organic",
      contentType: "story",
      contentId: "psm047",
    });
    expect(result).toMatchObject({
      ok: true,
      utm_source: "instagram",
      utm_medium: "organic_social",
      utm_campaign: "organic",
      utm_content: "story_psm047",
      url: "https://summittmindset.com/?utm_source=instagram&utm_medium=organic_social&utm_campaign=organic&utm_content=story_psm047",
    });
  });

  it("builds Facebook Organic Post + psm051", () => {
    const result = buildTrackingLink({
      platform: "facebook",
      trafficType: "organic",
      campaign: "organic",
      contentType: "post",
      contentId: "psm051",
    });
    expect(result).toMatchObject({
      ok: true,
      utm_source: "facebook",
      utm_medium: "organic_social",
      utm_campaign: "organic",
      utm_content: "post_psm051",
      url: "https://summittmindset.com/?utm_source=facebook&utm_medium=organic_social&utm_campaign=organic&utm_content=post_psm051",
    });
  });

  it("builds TikTok Organic Video + psm052", () => {
    const result = buildTrackingLink({
      platform: "tiktok",
      trafficType: "organic",
      campaign: "organic",
      contentType: "video",
      contentId: "psm052",
    });
    expect(result).toMatchObject({
      ok: true,
      utm_source: "tiktok",
      utm_medium: "organic_social",
      utm_campaign: "organic",
      utm_content: "video_psm052",
      url: "https://summittmindset.com/?utm_source=tiktok&utm_medium=organic_social&utm_campaign=organic&utm_content=video_psm052",
    });
  });

  it("builds X Organic Post", () => {
    const result = buildTrackingLink({
      platform: "x",
      trafficType: "organic",
      campaign: "organic",
      contentType: "post",
      contentId: "psm050",
    });
    expect(result).toMatchObject({
      ok: true,
      utm_source: "x",
      utm_medium: "organic_social",
      utm_campaign: "organic",
      utm_content: "post_psm050",
      url: "https://summittmindset.com/?utm_source=x&utm_medium=organic_social&utm_campaign=organic&utm_content=post_psm050",
    });
  });

  it("builds Facebook Paid Ad + fall_challenge + video_01", () => {
    const result = buildTrackingLink({
      platform: "facebook",
      trafficType: "paid",
      campaign: "fall_challenge",
      contentType: "video",
      contentId: "video_01",
    });
    expect(result).toMatchObject({
      ok: true,
      utm_source: "facebook",
      utm_medium: "paid_social",
      utm_campaign: "fall_challenge",
      utm_content: "video_01",
      url: "https://summittmindset.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign=fall_challenge&utm_content=video_01",
      summary: "Facebook · Paid Ad · fall_challenge · video_01",
    });
  });

  it("builds Instagram Paid Ad testimonial without double-prefixing", () => {
    const result = buildTrackingLink({
      platform: "instagram",
      trafficType: "paid",
      campaign: "testimonial_push",
      contentType: "testimonial_ad",
      contentId: "testimonial_kathy01",
    });
    expect(result).toMatchObject({
      ok: true,
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "testimonial_push",
      utm_content: "testimonial_kathy01",
      url: "https://summittmindset.com/?utm_source=instagram&utm_medium=paid_social&utm_campaign=testimonial_push&utm_content=testimonial_kathy01",
    });
  });

  it("normalizes campaign spaces and case", () => {
    expect(normalizeTrackingToken("Fall Challenge")).toBe("fall_challenge");
    const result = buildTrackingLink({
      platform: "facebook",
      trafficType: "paid",
      campaign: "Fall Challenge",
      contentType: "video",
      contentId: "01",
    });
    expect(result.ok && result.utm_campaign).toBe("fall_challenge");
  });

  it("normalizes content and strips unsafe characters", () => {
    expect(normalizeTrackingToken(" PSM-047 ")).toBe("psm-047");
    expect(normalizeTrackingToken("<script>psm047</script>")).toBe("scriptpsm047script");
    const result = buildTrackingLink({
      platform: "instagram",
      trafficType: "organic",
      campaign: "organic",
      contentType: "story",
      contentId: "story_psm047",
    });
    expect(result.ok && result.utm_content).toBe("story_psm047");
  });

  it("requires a content ID for non-Bio types", () => {
    const result = buildTrackingLink({
      platform: "x",
      trafficType: "organic",
      campaign: "organic",
      contentType: "post",
      contentId: "",
    });
    expect(result).toEqual({ ok: false, error: "Add a name or ID for this post." });
  });
});
