import { describe, expect, it } from "vitest";

import { mergeSplitInboundRawBodies } from "./sms-inbound-split-body";

describe("mergeSplitInboundRawBodies", () => {
  it("joins segments with newlines in order", () => {
    expect(mergeSplitInboundRawBodies(["2pm", "Or 9:30pm"])).toBe("2pm\nOr 9:30pm");
  });

  it("drops empty fragments", () => {
    expect(mergeSplitInboundRawBodies(["  ", "ok", ""])).toBe("ok");
  });
});
