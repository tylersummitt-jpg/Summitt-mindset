import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECORDING_EMPTY_MESSAGE,
  RECORDING_TIMESLICE_MS,
  canSaveRecording,
  chooseRecordingMime,
  createRecordingSink,
  previewNeedsDurationSeek,
} from "@/lib/personal-videos/recording";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

afterEach(() => {
  vi.useRealTimers();
});

describe("personal video recording", () => {
  it("keeps a nonempty recording and waits for data that arrives after stop", async () => {
    vi.useFakeTimers();
    const sink = createRecordingSink("video/mp4");
    sink.push(new Blob(["head"], { type: "video/mp4" }));
    sink.beginStop();
    sink.push(new Blob(["tail"], { type: "video/mp4" }));
    const pending = sink.finished;
    await vi.advanceTimersByTimeAsync(200);
    const blob = await pending;
    expect(blob?.size).toBe(8);
    expect(canSaveRecording(blob)).toBe(true);
  });

  it("refuses an empty recording", async () => {
    vi.useFakeTimers();
    const sink = createRecordingSink("video/mp4");
    sink.push(new Blob([], { type: "video/mp4" }));
    sink.beginStop();
    const pending = sink.finished;
    await vi.advanceTimersByTimeAsync(200);
    const blob = await pending;
    expect(blob).toBeNull();
    expect(canSaveRecording(blob)).toBe(false);
    expect(RECORDING_EMPTY_MESSAGE).toBe("Your video wasn't recorded. Please try again.");
  });

  it("uses a supported format and a timeslice so Safari flushes frames", () => {
    const supported = (type: string) => type === "video/mp4" || type.startsWith("video/webm");
    expect(chooseRecordingMime(SAFARI_MAC, supported)).toBe("video/mp4");
    expect(chooseRecordingMime(SAFARI_IPHONE, supported)).toBe("video/mp4");
    expect(chooseRecordingMime(CHROME, supported)).toBe("video/webm;codecs=vp9,opus");
    expect(chooseRecordingMime(SAFARI_MAC, () => false)).toBe("");
    expect(RECORDING_TIMESLICE_MS).toBeGreaterThan(0);
    expect(previewNeedsDurationSeek(0)).toBe(true);
    expect(previewNeedsDurationSeek(Number.POSITIVE_INFINITY)).toBe(true);
    expect(previewNeedsDurationSeek(4)).toBe(false);

    const client = readFileSync(
      join(process.cwd(), "src/app/admin/personal-videos/personal-videos-client.tsx"),
      "utf8"
    );
    expect(client).toContain("recorder.start(RECORDING_TIMESLICE_MS)");
    expect(client).toContain("canSaveRecording");
    expect(client).toContain("RECORDING_EMPTY_MESSAGE");
    expect(client).toContain("requestData");
    expect(client).toContain('key="live"');
    expect(client).toContain("key={previewUrl}");
  });
});
