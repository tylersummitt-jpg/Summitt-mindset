import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/IdentityBuilderClient", () => ({
  IdentityBuilderClient: () => React.createElement("div", { "data-testid": "builder" }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href, ...rest }, children),
}));

import EditIdentityClient from "@/app/dashboard/edit-identity/edit-identity-client";

const draft = {
  preferredName: "Alex",
  identityAnchorText: "I keep my word.",
  activeIdentityVersionId: "ver_1",
  ingredientIds: ["dad"],
  otherText: null,
  intakeOrigin: "generated" as const,
  useMineAnyway: false,
  clarityScore: 80,
  importantPeople: [],
};

describe("EditIdentityClient", () => {
  it("renders edit identity header and builder", () => {
    const html = renderToStaticMarkup(React.createElement(EditIdentityClient, { draft }));
    expect(html).toContain("Edit identity");
    expect(html).toContain('data-testid="builder"');
  });
});
