import { describe, expect, it } from "vitest";

import { acquisitionVideoEventId, crossedMilestones, playedShare } from "@/lib/acquisition/video-milestones";
import { watchMeasurementNote } from "@/lib/acquisition/distribution-command";

describe("video watch milestones", () => {
  it("counts played ranges and ignores a seek that adds no played time", () => {
    expect(playedShare([{ start: 0, end: 10 }], 100)).toBe(0.1);
    expect(playedShare([{ start: 40, end: 40 }], 100)).toBe(0);
    expect(playedShare(null, 100)).toBeNull();
    const first = crossedMilestones({ playedFraction: 0.1, ended: false, already: new Set() });
    expect(first).toEqual([]);
    const quarter = crossedMilestones({ playedFraction: 0.3, ended: false, already: new Set() });
    expect(quarter).toEqual(["personal_video_watched_25"]);
    const again = crossedMilestones({ playedFraction: 0.3, ended: false, already: new Set(quarter) });
    expect(again).toEqual([]);
    const done = crossedMilestones({ playedFraction: null, ended: true, already: new Set() });
    expect(done).toEqual(["personal_video_watched_95"]);
  });

  it("keeps two campaigns that share a recipient on separate event ids", () => {
    const one = acquisitionVideoEventId({ recipientId: "rec", eventType: "personal_video_played", journeyId: "journey-a" });
    const two = acquisitionVideoEventId({ recipientId: "rec", eventType: "personal_video_played", journeyId: "journey-b" });
    expect(one).not.toBe(two);
    expect(one).toContain("journey-a");
  });

  it("distinguishes a missing player from a player that connected and was not played", () => {
    expect(watchMeasurementNote({ videoVisitPeople: 4, videoPlayerReadyPeople: 0, videoPlayPeople: 0 })).toMatch(/missing playback/);
    expect(watchMeasurementNote({ videoVisitPeople: 4, videoPlayerReadyPeople: 4, videoPlayPeople: 0 })).toMatch(/no play was recorded/);
  });
});
