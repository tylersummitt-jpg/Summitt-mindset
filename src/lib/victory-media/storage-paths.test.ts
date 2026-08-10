import { describe, expect, it } from "vitest";

import {
  VictoryMediaPathError,
  victoryMediaCardPath,
  victoryMediaMasterPath,
  victoryMediaMmsTempPath,
  victoryMediaTempUploadPath,
} from "@/lib/victory-media/storage-paths";

const USER = "user_2AbCdEfGhIjKlMnOpQrStUv";
const MEDIA = "550e8400-e29b-41d4-a716-446655440000";
const UPLOAD = "660e8400-e29b-41d4-a716-446655440001";
const JOB = "770e8400-e29b-41d4-a716-446655440002";

describe("victory-media storage paths", () => {
  it("builds deterministic master/card paths without win_id", () => {
    expect(victoryMediaMasterPath(USER, MEDIA)).toBe(
      `${USER}/${MEDIA}/master.jpg`
    );
    expect(victoryMediaCardPath(USER, MEDIA)).toBe(`${USER}/${MEDIA}/card.jpg`);
    expect(victoryMediaMasterPath(USER, MEDIA)).not.toContain("win");
    expect(victoryMediaCardPath(USER, MEDIA.toUpperCase())).toBe(
      `${USER}/${MEDIA}/card.jpg`
    );
  });

  it("builds temp upload and MMS temp paths", () => {
    expect(victoryMediaTempUploadPath(USER, UPLOAD, "heic")).toBe(
      `${USER}/temp/${UPLOAD}.heic`
    );
    expect(victoryMediaTempUploadPath(USER, UPLOAD)).toBe(
      `${USER}/temp/${UPLOAD}.bin`
    );
    expect(victoryMediaMmsTempPath(USER, JOB, "jpg")).toBe(
      `${USER}/mms-temp/${JOB}.jpg`
    );
  });

  it("rejects path traversal and invalid IDs", () => {
    expect(() => victoryMediaMasterPath("../evil", MEDIA)).toThrow(
      VictoryMediaPathError
    );
    expect(() => victoryMediaMasterPath("user/../x", MEDIA)).toThrow(
      VictoryMediaPathError
    );
    expect(() => victoryMediaMasterPath(USER, "../media")).toThrow(
      VictoryMediaPathError
    );
    expect(() => victoryMediaMasterPath(USER, "not-a-uuid")).toThrow(
      VictoryMediaPathError
    );
    expect(() => victoryMediaTempUploadPath(USER, UPLOAD, "../x")).toThrow(
      VictoryMediaPathError
    );
    expect(() => victoryMediaMmsTempPath(USER, "bad")).toThrow(
      VictoryMediaPathError
    );
  });

  it("is deterministic across repeated calls", () => {
    expect(victoryMediaMasterPath(USER, MEDIA)).toBe(
      victoryMediaMasterPath(USER, MEDIA)
    );
    expect(victoryMediaTempUploadPath(USER, UPLOAD, "png")).toBe(
      victoryMediaTempUploadPath(USER, UPLOAD, "png")
    );
  });
});
