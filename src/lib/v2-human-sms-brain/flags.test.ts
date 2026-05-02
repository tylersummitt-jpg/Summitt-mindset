import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  shouldRunCommitmentInterpreterForPendingResolution,
  shouldRunHumanSmsPipelineForContractConsent,
  shouldRunHumanSmsPipelineForPendingResolution,
} from "@/lib/v2-human-sms-brain/flags";

describe("Phase 1 flags — legacy when unset", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    delete process.env.V2_HUMAN_SMS_PHASE1_PENDING_RESOLUTION;
    delete process.env.V2_HUMAN_SMS_PHASE1_CONTRACT_CONSENT;
    delete process.env.V2_COMMITMENT_MEANING_INTERPRETER_ENABLED;
    delete process.env.V2_HUMAN_SMS_BRAIN_ENABLED;
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE;
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("pending pipeline off without explicit phase slice + brain/validator", () => {
    expect(shouldRunHumanSmsPipelineForPendingResolution()).toBe(false);
    expect(shouldRunCommitmentInterpreterForPendingResolution()).toBe(false);
  });

  it("contract consent pipeline off without explicit phase slice + brain/validator", () => {
    expect(shouldRunHumanSmsPipelineForContractConsent()).toBe(false);
  });

  it("pending pipeline on when phase + validator enforce", () => {
    process.env.V2_HUMAN_SMS_PHASE1_PENDING_RESOLUTION = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";
    expect(shouldRunHumanSmsPipelineForPendingResolution()).toBe(true);
  });
});
