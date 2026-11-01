import { describe, expect, it } from "vitest";

import { watchMeasurementNote } from "@/lib/acquisition/distribution-command";
import {
  accumulateForwardPlayback,
  accumulatedShare,
  acquisitionVideoEventId,
  crossedMilestones,
  emptyPlaybackProgress,
  MAX_CONTINUOUS_PLAYBACK_GAP_SECONDS,
  playedShare,
  preferredPlayedShare,
} from "@/lib/acquisition/video-milestones";

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

  it("prefers usable played ranges and treats empty ranges as unavailable", () => {
    expect(preferredPlayedShare([{ start: 0, end: 50 }], 100)).toBe(0.5);
    expect(preferredPlayedShare([[0, 50]], 100)).toBe(0.5);
    expect(preferredPlayedShare([], 100)).toBeNull();
    expect(preferredPlayedShare(null, 100)).toBeNull();
  });

  it("accumulates natural forward playback through 25, 50, 75, and 95", () => {
    let progress = emptyPlaybackProgress();
    for (let seconds = 0; seconds <= 97; seconds += 1) {
      progress = accumulateForwardPlayback({ progress, seconds, duration: 100 });
    }
    expect(accumulatedShare(progress, 100)).toBeGreaterThanOrEqual(0.95);
    const events = crossedMilestones({
      playedFraction: accumulatedShare(progress, 100),
      ended: false,
      already: new Set(),
    });
    expect(events).toEqual([
      "personal_video_watched_25",
      "personal_video_watched_50",
      "personal_video_watched_75",
      "personal_video_watched_95",
    ]);
  });

  it("does not credit a forward seek as watched time", () => {
    let progress = emptyPlaybackProgress();
    progress = accumulateForwardPlayback({ progress, seconds: 1, duration: 100 });
    progress = accumulateForwardPlayback({ progress, seconds: 2, duration: 100 });
    progress = accumulateForwardPlayback({
      progress,
      seconds: 2 + MAX_CONTINUOUS_PLAYBACK_GAP_SECONDS + 1,
      duration: 100,
    });
    expect(progress.watchedSeconds).toBeCloseTo(1, 5);
    expect(accumulatedShare(progress, 100)).toBeCloseTo(0.01, 5);
    expect(crossedMilestones({ playedFraction: 0.01, ended: false, already: new Set() })).toEqual([]);
  });

  it("pauses, resumes, rewinds, and replays without double-counting", () => {
    let progress = emptyPlaybackProgress();
    for (let seconds = 10; seconds <= 30; seconds += 1) {
      progress = accumulateForwardPlayback({ progress, seconds, duration: 100 });
    }
    // Pause then resume at the same playhead.
    progress = accumulateForwardPlayback({ progress, seconds: 30, duration: 100 });
    progress = accumulateForwardPlayback({ progress, seconds: 31, duration: 100 });
    // Rewind and replay a watched span — replay does not add more than already watched.
    progress = accumulateForwardPlayback({ progress, seconds: 5, duration: 100 });
    for (let seconds = 6; seconds <= 15; seconds += 1) {
      progress = accumulateForwardPlayback({ progress, seconds, duration: 100 });
    }
    expect(progress.watchedSeconds).toBeCloseTo(31, 5);
    expect(accumulatedShare(progress, 100)).toBeCloseTo(0.31, 5);
  });

  it("ignores duplicate and out-of-order milestone emissions", () => {
    const already = new Set(["personal_video_watched_25"]);
    expect(
      crossedMilestones({ playedFraction: 0.6, ended: false, already }),
    ).toEqual(["personal_video_watched_50"]);
    expect(
      crossedMilestones({
        playedFraction: 0.2,
        ended: true,
        already: new Set(["personal_video_watched_95"]),
      }),
    ).toEqual([]);
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
    expect(watchMeasurementNote({ videoVisitPeople: 4, videoPlayerReadyPeople: 4, videoPlayPeople: 2 })).toMatch(
      /observed playback progress/,
    );
  });
});
