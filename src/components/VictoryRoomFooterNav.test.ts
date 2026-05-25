import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VictoryRoomFooterNav } from "@/components/VictoryRoomFooterNav";

describe("VictoryRoomFooterNav", () => {
  it("links to Account without Daily OS", () => {
    const html = renderToStaticMarkup(React.createElement(VictoryRoomFooterNav));
    expect(html).not.toContain("Daily OS");
    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain('href="/user"');
    expect(html).toContain("Account");
  });
});
