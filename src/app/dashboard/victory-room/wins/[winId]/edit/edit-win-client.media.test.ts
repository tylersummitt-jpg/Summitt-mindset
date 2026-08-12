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

vi.mock("@/lib/victory-media/browser-put-temp-upload", () => ({
  uploadVictoryMediaTempObject: vi.fn(async () => ({ ok: true })),
}));

import { uploadVictoryMediaTempObject } from "@/lib/victory-media/browser-put-temp-upload";
import EditWinClient from "@/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client";

const WIN = "550e8400-e29b-41d4-a716-446655440010";
const MEDIA_ID = "550e8400-e29b-41d4-a716-446655440020";
const UPLOAD_ID = "550e8400-e29b-41d4-a716-446655440030";
const CARD_URL =
  "https://example.supabase.co/storage/v1/object/sign/victory-media/u/m/card.jpg?token=abc";
const NEW_CARD_URL =
  "https://example.supabase.co/storage/v1/object/sign/victory-media/u/n/card.jpg?token=xyz";

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

describe("Edit Win media awareness + Replace", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    replaceMock.mockClear();
    refreshMock.mockClear();
    fetchMock.mockReset();
    vi.mocked(uploadVictoryMediaTempObject).mockClear();
    vi.mocked(uploadVictoryMediaTempObject).mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preview-1"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("1. no-media Edit Win unchanged (no Photo / Remove / Replace)", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditWinClient, { ...baseProps, media: null })
    );
    expect(html).toContain("Edit Win");
    expect(html).not.toContain(">Photo<");
    expect(html).not.toContain("Remove photo");
    expect(html).not.toContain("Replace photo");
  });

  it("2. media Win shows photo + Replace + Remove", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditWinClient, { ...baseProps, media })
    );
    expect(html).toContain("Photo");
    expect(html).toContain(CARD_URL);
    expect(html).toContain("Replace photo");
    expect(html).toContain("Remove photo");
  });

  it("9–14. Remove sends expectedMediaId; local hide; no refresh", async () => {
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
    expect(JSON.parse(init.body as string)).toEqual({
      expectedMediaId: MEDIA_ID,
    });

    await waitFor(() =>
      expect(screen.queryByRole("img", { name: /photo attached/i })).toBeNull()
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("stale Remove keeps photo + form", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        code: "stale_media",
        error: "This photo changed since you opened it. Refresh and try again.",
      }),
    });
    render(React.createElement(EditWinClient, { ...baseProps, media }));
    const title = screen.getByLabelText("What happened?");
    await user.clear(title);
    await user.type(title, "Unsaved title");

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));

    await waitFor(() =>
      expect(screen.getByText(/changed since you opened/i)).toBeTruthy()
    );
    expect(screen.getByRole("img", { name: /photo attached/i })).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe("Unsaved title");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("MIME helper + FILE_ACCEPT reused from Add Win patterns", () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client.tsx"
      ),
      "utf8"
    );
    expect(src).toContain("resolveVictoryMediaClientMime");
    expect(src).toContain("uploadVictoryMediaTempObject");
    expect(src).toContain("canPreviewVictoryMediaClientMime");
    expect(src).toContain("image/heic,image/heif");
    expect(src).toContain("/api/victory-media/upload-intent");
    expect(src).toContain("/replace");
    const replaceStart = src.indexOf("async function onConfirmReplacePhoto");
    const replaceEnd = src.indexOf("async function onSave", replaceStart);
    const replaceBody = src.slice(replaceStart, replaceEnd);
    expect(replaceBody).not.toContain("router.refresh");
    expect(replaceBody).not.toContain("router.replace");
  });

  it("replace success updates photo locally; preserves unsaved fields; no refresh", async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([1, 2, 3])], "new.jpg", {
      type: "image/jpeg",
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          uploadId: UPLOAD_ID,
          signedUrl: "https://signed.example/put",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: "replaced",
          media: {
            id: UPLOAD_ID,
            cardUrl: NEW_CARD_URL,
            width: 700,
            height: 500,
          },
        }),
      });

    render(React.createElement(EditWinClient, { ...baseProps, media }));
    const title = screen.getByLabelText("What happened?");
    await user.clear(title);
    await user.type(title, "Keep my draft");

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    await user.upload(input, file);

    expect(screen.getByRole("img", { name: /photo attached/i })).toBeTruthy();
    expect(screen.getByText(/new\.jpg/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Replace photo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/victory-media/upload-intent");
    expect(uploadVictoryMediaTempObject).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `/api/victory-media/win/${WIN}/replace`
    );
    const replaceBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(replaceBody).toEqual({
      uploadId: UPLOAD_ID,
      expectedMediaId: MEDIA_ID,
      declaredMime: "image/jpeg",
      originalFilename: "new.jpg",
    });

    await waitFor(() =>
      expect(
        (screen.getByRole("img", { name: /photo attached/i }) as HTMLImageElement)
          .src
      ).toContain("token=xyz")
    );
    expect((title as HTMLInputElement).value).toBe("Keep my draft");
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(([u]) => !String(u).includes("/api/v2/wins/"))
    ).toBe(true);
  });

  it("replace pre-swap failure keeps old photo", async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([1, 2, 3])], "bad.jpg", {
      type: "image/jpeg",
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        ok: false,
        code: "signed_upload_failed",
        error: "We couldn’t prepare this upload. Please try again.",
      }),
    });

    render(React.createElement(EditWinClient, { ...baseProps, media }));
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Replace photo" }));

    await waitFor(() =>
      expect(screen.getByText(/current photo is still there/i)).toBeTruthy()
    );
    expect(
      (screen.getByRole("img", { name: /photo attached/i }) as HTMLImageElement)
        .src
    ).toContain("token=abc");
  });

  it("replace success with null media does not claim failure", async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([1, 2, 3])], "new.jpg", {
      type: "image/jpeg",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          uploadId: UPLOAD_ID,
          signedUrl: "https://signed.example/put",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: "replaced",
          media: null,
          cardSignFailed: true,
        }),
      });

    render(React.createElement(EditWinClient, { ...baseProps, media }));
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Replace photo" }));

    await waitFor(() =>
      expect(screen.getByText(/Photo replaced/i)).toBeTruthy()
    );
    expect(screen.queryByText(/couldn’t replace/i)).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("oversized replacement leaves current photo", async () => {
    const user = userEvent.setup();
    const big = new File([new Uint8Array(12_000_001)], "big.jpg", {
      type: "image/jpeg",
    });
    Object.defineProperty(big, "size", { value: 12_000_001 });
    render(React.createElement(EditWinClient, { ...baseProps, media }));
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, big);
    await waitFor(() =>
      expect(screen.getByText(/too large/i)).toBeTruthy()
    );
    expect(
      (screen.getByRole("img", { name: /photo attached/i }) as HTMLImageElement)
        .src
    ).toContain("token=abc");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("page still uses enricher; remove never refreshes", () => {
    const clientSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client.tsx"
      ),
      "utf8"
    );
    const start = clientSrc.indexOf("async function onConfirmRemovePhoto");
    const end = clientSrc.indexOf("const showPhotoSection", start);
    const removeBody = clientSrc.slice(start, end);
    expect(removeBody).not.toContain("router.refresh");
    expect(removeBody).toContain("expectedMediaId");

    const pageSrc = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/dashboard/victory-room/wins/[winId]/edit/page.tsx"
      ),
      "utf8"
    );
    expect(pageSrc).toContain("enrichPublicWinsWithMedia");
  });
});
