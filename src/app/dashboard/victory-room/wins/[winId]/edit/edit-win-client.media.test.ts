/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
    push: vi.fn(),
  }),
}));

import EditWinClient from "@/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client";

const WIN = "550e8400-e29b-41d4-a716-446655440010";
const MEDIA_ID = "550e8400-e29b-41d4-a716-446655440020";
const CARD_URL = "https://example.supabase.co/storage/v1/object/sign/victory-media/u/m/card.jpg?token=abc";

const baseProps = {
  winId: WIN,
  maxOccurredOn: "2026-08-09",
  initialOccurredOn: "2026-08-08",
  initialTitle: "Lifted",
  initialDetails: "Felt strong",
  initialSeasonId: "s2",
  expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
  seasonOptions: [
    {
      seasonId: "s2",
      seasonName: "Season 2",
      goalLabel: "Lift",
      status: "active" as const,
      startedAt: "2026-08-01T00:00:00Z",
      endedAt: null,
      isCurrent: true,
      pickerLabel: "Season 2\nLift\nAug 1, 2026 – Current",
    },
  ],
  cancelHref: "/dashboard/victory-room",
  orphanCommitmentNotice: false,
};

const media = {
  id: MEDIA_ID,
  cardUrl: CARD_URL,
  width: 800,
  height: 600,
};

describe("Edit Win media awareness", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    replaceMock.mockClear();
    refreshMock.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("1. no-media Edit Win unchanged (no Photo / Remove / Replace / upload)", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditWinClient, { ...baseProps, media: null })
    );
    expect(html).toContain("Edit Win");
    expect(html).toContain("Save Changes");
    expect(html).toContain('value="Lifted"');
    expect(html).not.toContain(">Photo<");
    expect(html).not.toContain("Remove photo");
    expect(html).not.toContain("Replace");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("storage_");
    expect(html).not.toContain("master.jpg");
  });

  it("2–5. media Win shows card image, dims, Remove only when media", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditWinClient, { ...baseProps, media })
    );
    expect(html).toContain("Photo");
    expect(html).toContain(CARD_URL);
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
    expect(html).toContain("Remove photo");
    expect(html).not.toContain("storage_master");
    expect(html).not.toContain("storage_card_path");
    expect(html).not.toContain("master.jpg");
    expect(html).not.toMatch(/Replace/i);
    expect(html).not.toContain('type="file"');

    const noMedia = renderToStaticMarkup(
      React.createElement(EditWinClient, { ...baseProps, media: null })
    );
    expect(noMedia).not.toContain("Remove photo");
  });

  it("6–8. confirmation opens with copy; Cancel leaves photo", async () => {
    const user = userEvent.setup();
    render(React.createElement(EditWinClient, { ...baseProps, media }));

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByText("Remove this photo?")).toBeTruthy();
    expect(
      screen.getByText(
        /This permanently removes the photo\. Your Win stays in Victory Room\. This can’t be undone\./
      )
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Remove this photo?")).toBeNull();
    expect(screen.getByRole("img", { name: /photo attached/i })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("9–14. confirm DELETE win route; local hide; no refresh; stay on Edit", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "removed" }),
    });
    render(React.createElement(EditWinClient, { ...baseProps, media }));

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/victory-media/win/${WIN}`);
    expect(init).toMatchObject({ method: "DELETE", credentials: "include" });
    expect(init).not.toHaveProperty("body");

    await waitFor(() =>
      expect(screen.queryByRole("img", { name: /photo attached/i })).toBeNull()
    );
    expect(screen.queryByText("Photo")).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Edit Win" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
  });

  it("12b. already_absent → local photo hide; no refresh", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "already_absent" }),
    });
    render(React.createElement(EditWinClient, { ...baseProps, media }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: /photo attached/i })).toBeNull()
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("15–17. failure keeps photo + unsaved form; §15 unsaved title survives success", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        ok: false,
        error: "We couldn’t remove the photo. Please try again.",
      }),
    });

    render(React.createElement(EditWinClient, { ...baseProps, media }));
    const title = screen.getByLabelText("What happened?");
    await user.clear(title);
    await user.type(title, "Unsaved changed title");

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));

    await waitFor(() =>
      expect(screen.getByText(/couldn’t remove the photo/i)).toBeTruthy()
    );
    expect(screen.getByRole("img", { name: /photo attached/i })).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe("Unsaved changed title");
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(
        ([u]) => !String(u).includes("/api/v2/wins/")
      )
    ).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "removed" }),
    });
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: /photo attached/i })).toBeNull()
    );
    expect((title as HTMLInputElement).value).toBe("Unsaved changed title");
    expect(refreshMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
    const methods = fetchMock.mock.calls.map(([, init]) => init?.method);
    expect(methods.every((m) => m === "DELETE")).toBe(true);
    expect(methods.some((m) => m === "PATCH")).toBe(false);
  });

  it("18–20. Save after photo removal still PATCHes; remove itself never PATCHes", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, status: "removed" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          updated_at: "2026-08-09T13:00:00.000Z",
        }),
      });

    render(React.createElement(EditWinClient, { ...baseProps, media }));
    const title = screen.getByLabelText("What happened?");
    await user.clear(title);
    await user.type(title, "Saved after remove");

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: /photo attached/i })).toBeNull()
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [patchUrl, patchInit] = fetchMock.mock.calls[1]!;
    expect(patchUrl).toBe(`/api/v2/wins/${WIN}`);
    expect(patchInit.method).toBe("PATCH");
    const body = JSON.parse(patchInit.body as string) as Record<string, unknown>;
    expect(body.title).toBe("Saved after remove");
    expect(body).toHaveProperty("expected_updated_at");
    expect(body).not.toHaveProperty("media");
    expect(body).not.toHaveProperty("cardUrl");
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });

  it("22–24. no Replace / upload; page uses enricher; Remove backend untouched", () => {
    const clientSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client.tsx"
      ),
      "utf8"
    );
    expect(clientSrc).not.toMatch(/Replace photo/i);
    expect(clientSrc).not.toContain('type="file"');
    expect(clientSrc).toContain("setCurrentMedia(null)");
    const start = clientSrc.indexOf("async function onConfirmRemovePhoto");
    const end = clientSrc.indexOf("return (", start);
    const removeBody = clientSrc.slice(start, end);
    expect(removeBody).not.toContain("router.refresh");
    expect(removeBody).not.toContain("router.replace");
    expect(removeBody).toContain("/api/victory-media/win/");

    const pageSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/dashboard/victory-room/wins/[winId]/edit/page.tsx"
      ),
      "utf8"
    );
    expect(pageSrc).toContain("enrichPublicWinsWithMedia");
    expect(pageSrc).toContain("media={media}");
    expect(pageSrc).not.toContain("createSignedUrl(");
    expect(pageSrc).not.toContain("storage_master_path");

    const removeHelper = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/lib/victory-media/remove-victory-win-media.ts"
      ),
      "utf8"
    );
    expect(removeHelper).toContain("removeVictoryWinMediaForUser");
  });
});
