import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IdentityBuilderClient } from "@/components/IdentityBuilderClient";
import IdentityClient from "@/app/onboarding/identity/identity-client";

const IDENTITY =
  "A steadier parent who follows through on small promises every day.";
const SAVE_FALSE_FAILURE = "We couldn’t save your identity. Please try again.";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("IdentityBuilderClient save success contract", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("onboarding canonical 200 calls onSaveSuccess and does not show false-failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        versionId: "ver_1",
        identity_anchor_text: IDENTITY,
      })
    );
    const onSaveSuccess = vi.fn();
    render(
      <IdentityBuilderClient
        mode="onboarding"
        saveEndpoint="/api/onboarding/identity"
        backHref="/onboarding"
        continueLabel="Continue to My Current Goal →"
        initialPreferredName="Alex"
        initialIdentityAnchor={IDENTITY}
        onSaveSuccess={onSaveSuccess}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Continue to My Current Goal →" })
    );

    await waitFor(() => {
      expect(onSaveSuccess).toHaveBeenCalledWith({
        versionId: "ver_1",
        identity_anchor_text: IDENTITY,
      });
    });
    expect(screen.queryByText(SAVE_FALSE_FAILURE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding/identity",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("onboarding IdentityClient advances to Current Goal on canonical 200", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        versionId: "ver_1",
        identity_anchor_text: IDENTITY,
      })
    );
    render(
      <IdentityClient
        initialPreferredName="Alex"
        initialIdentityAnchor={IDENTITY}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Continue to My Current Goal →" })
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/onboarding/commitment");
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText(SAVE_FALSE_FAILURE)).toBeNull();
  });

  it("rejects the pre-fix 200 { success, versionId } body as a false failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { success: true, versionId: "ver_1" })
    );
    const onSaveSuccess = vi.fn();
    render(
      <IdentityBuilderClient
        mode="onboarding"
        saveEndpoint="/api/onboarding/identity"
        backHref="/onboarding"
        continueLabel="Continue to My Current Goal →"
        initialPreferredName="Alex"
        initialIdentityAnchor={IDENTITY}
        onSaveSuccess={onSaveSuccess}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Continue to My Current Goal →" })
    );

    expect(await screen.findByText(SAVE_FALSE_FAILURE)).toBeTruthy();
    expect(onSaveSuccess).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("surfaces 500 persistence failure without calling onSaveSuccess", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(500, {
        error: "We couldn’t save this step. Please try again.",
      })
    );
    const onSaveSuccess = vi.fn();
    render(
      <IdentityBuilderClient
        mode="onboarding"
        saveEndpoint="/api/onboarding/identity"
        backHref="/onboarding"
        continueLabel="Continue to My Current Goal →"
        initialPreferredName="Alex"
        initialIdentityAnchor={IDENTITY}
        onSaveSuccess={onSaveSuccess}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Continue to My Current Goal →" })
    );

    expect(
      await screen.findByText("We couldn’t save this step. Please try again.")
    ).toBeTruthy();
    expect(screen.queryByText(SAVE_FALSE_FAILURE)).toBeNull();
    expect(onSaveSuccess).not.toHaveBeenCalled();
  });

  it("Edit Identity still succeeds only on canonical 200", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        versionId: "ver_edit",
        identity_anchor_text: IDENTITY,
      })
    );
    const onSaveSuccess = vi.fn();
    render(
      <IdentityBuilderClient
        mode="app_edit"
        saveEndpoint="/api/v2/identity/edit"
        backHref="/dashboard"
        continueLabel="Save identity"
        expectedActiveVersionId="ver_old"
        initialPreferredName="Alex"
        initialIdentityAnchor={IDENTITY}
        onSaveSuccess={onSaveSuccess}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Save identity" }));

    await waitFor(() => {
      expect(onSaveSuccess).toHaveBeenCalledWith({
        versionId: "ver_edit",
        identity_anchor_text: IDENTITY,
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/identity/edit",
      expect.objectContaining({ method: "POST" })
    );
    const posted = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    ) as { expected_active_version_id?: string };
    expect(posted.expected_active_version_id).toBe("ver_old");
    expect(screen.queryByText(SAVE_FALSE_FAILURE)).toBeNull();
  });
});
