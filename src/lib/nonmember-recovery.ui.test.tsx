/** @vitest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NonmemberRecoveryPanel } from "@/app/admin/nonmember-recovery-panel";
import { emptyNonmemberCensus } from "@/lib/nonmember-census";
import { buildNonmemberRecovery } from "@/lib/nonmember-recovery";

describe("nonmember recovery explanation", () => {
  it("keeps How this works collapsed", () => {
    const view = render(
      <NonmemberRecoveryPanel recovery={buildNonmemberRecovery(emptyNonmemberCensus())} />
    );
    const details = view.container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("How this works");
    expect(view.container.textContent).toContain("Nonmember recovery");
    expect(details?.textContent).toContain("does not require advance marketing");
    expect(details?.textContent).toContain("does not override an unsubscribe");
    expect(details?.textContent).toContain("does not send");
    expect(details?.textContent).toContain("immediately before sending");
  });
});
