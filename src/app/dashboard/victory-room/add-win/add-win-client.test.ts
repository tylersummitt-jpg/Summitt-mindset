/** @vitest-environment jsdom */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const putMock = vi.fn();
vi.mock("@/lib/victory-media/browser-put-temp-upload", () => ({
  uploadVictoryMediaTempObject: (...args: unknown[]) => putMock(...args),
}));

import AddWinClient from "@/app/dashboard/victory-room/add-win/add-win-client";
import { VICTORY_MEDIA_MAX_UPLOAD_BYTES } from "@/lib/victory-media/constants";

const baseProps = {
  timeZone: "America/New_York",
  defaultOccurredOn: "2026-08-08",
  lockedSeason: null as null | {
    seasonId: string;
    seasonName: string;
    goalLabel: string | null;
  },
  seasonOptions: [
    {
      seasonId: "s2",
      seasonName: "Season 2",
      goalLabel: "Lift weights for 30 minutes a day",
      status: "active" as const,
      startedAt: "2026-08-01T12:00:00Z",
      endedAt: null,
      isCurrent: true,
      pickerLabel: "Season 2\nLift weights for 30 minutes a day\nAug 1, 2026 – Current",
    },
  ],
  cancelHref: "/dashboard/victory-room",
};

function makeFile(name: string, type: string, size = 100): File {
  const buf = new Uint8Array(Math.min(size, 64));
  const file = new File([buf], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("AddWinClient static markup", () => {
  it("Overall form defaults Overall only and shows Season picker", () => {
    const html = renderToStaticMarkup(React.createElement(AddWinClient, baseProps));
    expect(html).toContain("Add a Win");
    expect(html).toContain("What happened?");
    expect(html).toContain("Details");
    expect(html).toContain("Add a photo");
    expect(html).toContain("Date");
    expect(html).toContain("Overall only");
    expect(html).toContain("Save Win");
    expect(html).not.toMatch(/streak|score|badge|points|achievement/i);
  });

  it("photo input sits after details and before date", () => {
    const html = renderToStaticMarkup(React.createElement(AddWinClient, baseProps));
    const detailsIdx = html.indexOf('id="win-details"');
    const photoIdx = html.indexOf('id="win-photo"');
    const dateIdx = html.indexOf('id="win-date"');
    expect(detailsIdx).toBeGreaterThan(-1);
    expect(photoIdx).toBeGreaterThan(detailsIdx);
    expect(dateIdx).toBeGreaterThan(photoIdx);
  });

  it("Season form shows fixed context and has no picker", () => {
    const html = renderToStaticMarkup(
      React.createElement(AddWinClient, {
        ...baseProps,
        lockedSeason: {
          seasonId: "s2",
          seasonName: "Season 2",
          goalLabel: "Lift weights for 30 minutes a day",
        },
        seasonOptions: [],
        cancelHref: "/dashboard/victory-room/seasons/s2",
      })
    );
    expect(html).toContain("Saving to");
    expect(html).not.toContain('id="win-season"');
  });

  it("accept list and no capture/multiple; no service-role or durable path helpers", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/add-win/add-win-client.tsx"),
      "utf8"
    );
    expect(clientSrc).toContain("FILE_ACCEPT");
    expect(clientSrc).toContain(
      "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
    );
    expect(clientSrc).toContain("accept={FILE_ACCEPT}");
    expect(clientSrc).not.toContain("capture=");
    expect(clientSrc).not.toMatch(/\bmultiple\b/);
    expect(clientSrc).not.toContain("supabase-server");
    expect(clientSrc).not.toContain("SUPABASE_SERVICE_ROLE");
    expect(clientSrc).not.toContain("victoryMediaMasterPath");
    expect(clientSrc).not.toContain("victoryMediaCardPath");
    expect(clientSrc).not.toContain("storageMasterPath");
    expect(clientSrc).not.toContain("storageCardPath");
    expect(clientSrc).toContain("/api/v2/wins/manual");
    expect(clientSrc).toContain("client_request_id");
  });
});

describe("AddWinClient photo flows", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    replaceMock.mockReset();
    refreshMock.mockReset();
    putMock.mockReset();
    putMock.mockResolvedValue({ ok: true });

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    createObjectURL = vi.fn(() => "blob:preview-1");
    revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function fillRequiredAndSubmit() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/What happened/i), "Owned the apology");
    await user.click(screen.getByRole("button", { name: "Save Win" }));
    return user;
  }

  it("no photo: POST manual once, no media calls, navigates", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/v2/wins/manual") {
        return jsonResponse({
          ok: true,
          status: "inserted",
          win_id: "win-1",
          redirect_to: "/dashboard/victory-room",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    render(React.createElement(AddWinClient, baseProps));
    await fillRequiredAndSubmit();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard/victory-room");
    });
    expect(refreshMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/wins/manual");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("JPEG success: Win → intent → PUT → finalize → navigate (exact order)", async () => {
    const order: string[] = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      order.push(`fetch:${url}`);
      if (url === "/api/v2/wins/manual") {
        return jsonResponse({
          ok: true,
          status: "inserted",
          win_id: "win-jpeg",
          redirect_to: "/dashboard/victory-room",
        });
      }
      if (url === "/api/victory-media/upload-intent") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body.declaredMime).toBe("image/jpeg");
        expect(body.winId).toBe("win-jpeg");
        return jsonResponse({
          ok: true,
          uploadId: "up-1",
          signedUrl: "https://signed.example/put?token=t",
          token: "t",
          path: "user/temp/up-1.bin",
          bucket: "victory-media",
          maxBytes: VICTORY_MEDIA_MAX_UPLOAD_BYTES,
          allowedMimeTypes: [],
        });
      }
      if (url === "/api/victory-media/finalize-upload") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body.winId).toBe("win-jpeg");
        expect(body.uploadId).toBe("up-1");
        expect(body.declaredMime).toBe("image/jpeg");
        return jsonResponse({
          ok: true,
          status: "attached",
          media: { id: "m1", winId: "win-jpeg" },
          tempCleanup: "deleted",
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    putMock.mockImplementation(async () => {
      order.push("put");
      return { ok: true };
    });

    render(React.createElement(AddWinClient, baseProps));
    const input = screen.getByLabelText(/Add a photo/i) as HTMLInputElement;
    const file = makeFile("shot.jpg", "image/jpeg", 1200);
    await userEvent.upload(input, file);
    expect(createObjectURL).toHaveBeenCalled();
    expect(screen.getByText(/Selected:/)).toBeTruthy();

    await fillRequiredAndSubmit();

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard/victory-room");
    });
    expect(order).toEqual([
      "fetch:/api/v2/wins/manual",
      "fetch:/api/victory-media/upload-intent",
      "put",
      "fetch:/api/victory-media/finalize-upload",
    ]);
  });

  it("blank-type HEIC uses extension MIME and skips preview", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/v2/wins/manual") {
        return jsonResponse({
          ok: true,
          win_id: "win-heic",
          redirect_to: "/dashboard/victory-room",
        });
      }
      if (url === "/api/victory-media/upload-intent") {
        return jsonResponse({
          ok: true,
          uploadId: "up-h",
          signedUrl: "https://signed.example/put?token=t",
        });
      }
      if (url === "/api/victory-media/finalize-upload") {
        return jsonResponse({ ok: true, status: "attached", media: {} });
      }
      throw new Error(url);
    });

    render(React.createElement(AddWinClient, baseProps));
    const input = screen.getByLabelText(/Add a photo/i) as HTMLInputElement;
    const file = makeFile("IMG_001.HEIC", "", 2000);
    await userEvent.upload(input, file);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText(/IMG_001.HEIC/)).toBeTruthy();

    await fillRequiredAndSubmit();
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());

    const intentBody = JSON.parse(
      String(fetchMock.mock.calls.find((c) => c[0] === "/api/victory-media/upload-intent")?.[1]?.body)
    );
    expect(intentBody.declaredMime).toBe("image/heic");
    expect(putMock).toHaveBeenCalledWith(
      expect.objectContaining({ declaredMime: "image/heic" })
    );
  });

  it.each([
    ["gif.gif", "image/gif"],
    ["x.avif", "image/avif"],
    ["x.svg", "image/svg+xml"],
  ])("rejects %s photo selection; Win still saveable", async (name, type) => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/v2/wins/manual") {
        return jsonResponse({
          ok: true,
          win_id: "win-2",
          redirect_to: "/dashboard/victory-room",
        });
      }
      throw new Error(url);
    });

    render(React.createElement(AddWinClient, baseProps));
    const input = screen.getByLabelText(/Add a photo/i) as HTMLInputElement;
    // Bypass native accept filtering so onChange receives the unsupported file.
    fireEvent.change(input, { target: { files: [makeFile(name, type, 100)] } });
    expect(screen.getByRole("alert").textContent).toMatch(/isn’t supported/i);

    await fillRequiredAndSubmit();
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("rejects oversized photo selection", async () => {
    render(React.createElement(AddWinClient, baseProps));
    const input = screen.getByLabelText(/Add a photo/i) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [makeFile("big.jpg", "image/jpeg", VICTORY_MEDIA_MAX_UPLOAD_BYTES + 1)],
      },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/too large/i);
  });

  it("Win POST failure: no media calls; form error restored", async () => {
    fetchMock.mockResolvedValue(
      await jsonResponse({ ok: false, error: "Say what happened." }, 400)
    );
    render(React.createElement(AddWinClient, baseProps));
    const input = screen.getByLabelText(/Add a photo/i) as HTMLInputElement;
    await userEvent.upload(input, makeFile("ok.jpg", "image/jpeg", 10));
    await fillRequiredAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Say what happened.");
    });
    expect(putMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("victory-media"))
    ).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Save Win" })).toBeTruthy();
  });

  it("media failure after Win: shows saved state; Retry does not re-POST Win", async () => {
    let intentCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/v2/wins/manual") {
        return jsonResponse({
          ok: true,
          win_id: "win-retry",
          redirect_to: "/dashboard/victory-room",
        });
      }
      if (url === "/api/victory-media/upload-intent") {
        intentCalls += 1;
        if (intentCalls === 1) {
          return jsonResponse(
            { ok: false, code: "signed_upload_failed", error: "fail" },
            500
          );
        }
        return jsonResponse({
          ok: true,
          uploadId: "up-2",
          signedUrl: "https://signed.example/put2?token=t",
        });
      }
      if (url === "/api/victory-media/finalize-upload") {
        return jsonResponse({ ok: true, status: "attached", media: {} });
      }
      throw new Error(url);
    });

    render(React.createElement(AddWinClient, baseProps));
    await userEvent.upload(
      screen.getByLabelText(/Add a photo/i),
      makeFile("ok.jpg", "image/jpeg", 10)
    );
    await fillRequiredAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("Your Win was saved.")).toBeTruthy();
    });
    expect(screen.getByText("The photo couldn’t be attached.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue to Victory Room" })).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();

    const winPosts = fetchMock.mock.calls.filter((c) => c[0] === "/api/v2/wins/manual");
    expect(winPosts).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Retry photo" }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard/victory-room"));

    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/v2/wins/manual")).toHaveLength(1);
    expect(intentCalls).toBe(2);
    expect(putMock).toHaveBeenCalledTimes(1);
    const finalizeBody = JSON.parse(
      String(
        fetchMock.mock.calls.find((c) => c[0] === "/api/victory-media/finalize-upload")?.[1]
          ?.body
      )
    );
    expect(finalizeBody.winId).toBe("win-retry");
  });

  it("Continue without photo navigates without retry", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/v2/wins/manual") {
        return jsonResponse({
          ok: true,
          win_id: "win-cont",
          redirect_to: "/dashboard/victory-room/all-proof",
        });
      }
      if (url === "/api/victory-media/upload-intent") {
        return jsonResponse({ ok: false, code: "unsupported_mime" }, 400);
      }
      throw new Error(url);
    });

    render(
      React.createElement(AddWinClient, {
        ...baseProps,
        cancelHref: "/dashboard/victory-room/all-proof",
      })
    );
    await userEvent.upload(
      screen.getByLabelText(/Add a photo/i),
      makeFile("ok.jpg", "image/jpeg", 10)
    );
    await fillRequiredAndSubmit();
    await waitFor(() => screen.getByText("Your Win was saved."));

    await userEvent.click(screen.getByRole("button", { name: "Continue to Victory Room" }));
    expect(replaceMock).toHaveBeenCalledWith("/dashboard/victory-room/all-proof");
    expect(refreshMock).toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("PUT failure after Win shows saved/photo-failed; HEIC preview never created", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/v2/wins/manual") {
        return jsonResponse({ ok: true, win_id: "win-put", redirect_to: "/dashboard/victory-room" });
      }
      if (url === "/api/victory-media/upload-intent") {
        return jsonResponse({
          ok: true,
          uploadId: "up",
          signedUrl: "https://signed.example/x?token=t",
        });
      }
      throw new Error(url);
    });
    putMock.mockResolvedValue({ ok: false, reason: "network" });

    render(React.createElement(AddWinClient, baseProps));
    await userEvent.upload(
      screen.getByLabelText(/Add a photo/i),
      makeFile("a.heif", "", 10)
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    await fillRequiredAndSubmit();
    await waitFor(() => screen.getByText("Your Win was saved."));
    expect(screen.getByText(/network problem/i)).toBeTruthy();
  });

  it("revokes preview on remove", async () => {
    render(React.createElement(AddWinClient, baseProps));
    await userEvent.upload(
      screen.getByLabelText(/Add a photo/i),
      makeFile("a.png", "image/png", 10)
    );
    expect(createObjectURL).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("revokes preview on unmount", async () => {
    const view = render(React.createElement(AddWinClient, baseProps));
    await userEvent.upload(
      screen.getByLabelText(/Add a photo/i),
      makeFile("a.webp", "image/webp", 10)
    );
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });
});

describe("AddWinClient source policy", () => {
  it("picker uses behavior_statement-derived labels never legacy title hygiene", () => {
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/add-win/page.tsx"),
      "utf8"
    );
    const persistSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-manual-persist.ts"),
      "utf8"
    );
    expect(pageSrc).toContain("behavior_statement");
    expect(pageSrc).toContain("formatUserFacingGoal");
    expect(persistSrc).toContain("behavior_statement");
    expect(persistSrc).not.toMatch(/commitment\.title|legacy.*title/i);
  });

  it("mobile-safe structure uses full-width controls", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/add-win/add-win-client.tsx"),
      "utf8"
    );
    expect(clientSrc).toContain("w-full");
    expect(clientSrc).toContain("text-base");
  });
});
