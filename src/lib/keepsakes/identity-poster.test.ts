import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  IDENTITY_POSTER_PAGE,
  buildIdentityPosterPdf,
  layoutIdentityPoster,
  posterLinesPreserveIdentity,
} from "@/lib/keepsakes/identity-poster";

const ownerMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn());
const ops = vi.hoisted(() => [] as string[]);
const profile = vi.hoisted(() => ({
  current: {
    data: { identity_anchor_text: "I keep my word." } as { identity_anchor_text: string | null } | null,
    error: null as { message: string } | null,
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));
vi.mock("@/lib/auth/require-tyler-admin", () => ({
  isTylerOwnerSession: () => ownerMock(),
  requireTylerAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from(table: string) {
      ops.push(`from:${table}`);
      const api = {
        select(columns: string) {
          ops.push(`select:${columns}`);
          return api;
        },
        eq(column: string, value: string) {
          ops.push(`eq:${column}:${value}`);
          return api;
        },
        update() {
          ops.push("update");
          return api;
        },
        insert() {
          ops.push("insert");
          return api;
        },
        upsert() {
          ops.push("upsert");
          return api;
        },
        maybeSingle: async () => profile.current,
      };
      return api;
    },
  },
}));

function pdfDrawnText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf("stream", cursor);
    if (start < 0) break;
    let dataStart = start + "stream".length;
    if (raw[dataStart] === 0x0d && raw[dataStart + 1] === 0x0a) dataStart += 2;
    else if (raw[dataStart] === 0x0a) dataStart += 1;
    const end = raw.indexOf("endstream", dataStart);
    if (end < 0) break;
    const slice = raw.subarray(dataStart, end);
    try {
      parts.push(inflateSync(slice).toString("latin1"));
    } catch {
      parts.push(slice.toString("latin1"));
    }
    cursor = end + "endstream".length;
  }
  const drawn: string[] = [];
  for (const match of parts.join("\n").matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = match[1] ?? "";
    if (hex.length < 2 || hex.length % 2 !== 0) continue;
    drawn.push(Buffer.from(hex, "hex").toString("latin1"));
  }
  return drawn.join("\n");
}

async function expectPosterPdf(bytes: Uint8Array, identity: string) {
  expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getTitle()).toBe("Identity Poster");
  expect(doc.getTitle() ?? "").not.toContain(identity);
  const { width, height } = doc.getPage(0).getSize();
  expect(width).toBe(IDENTITY_POSTER_PAGE.width);
  expect(height).toBe(IDENTITY_POSTER_PAGE.height);
  const layout = await layoutIdentityPoster({ identity, template: "classic" });
  expect(posterLinesPreserveIdentity(identity, layout.lines)).toBe(true);
  const measure = await PDFDocument.create();
  const font = await measure.embedFont(StandardFonts.TimesRoman);
  const encoded = pdfDrawnText(bytes);
  for (const line of layout.lines) {
    const visible = line.trim();
    if (!visible) continue;
    const expected = Buffer.from(font.encodeText(visible).toString().replace(/[<>]/g, ""), "hex").toString(
      "latin1"
    );
    expect(encoded).toContain(expected);
  }
  expect(bytes.byteLength).toBeGreaterThan(500);
}

describe("identity poster pdf", () => {
  it("keeps a 220-character identity, a long word, newlines, and supported letters", async () => {
    const max = `${"W".repeat(211)} café end`;
    expect(max).toHaveLength(220);
    const fitted = await layoutIdentityPoster({ identity: max, template: "classic" });
    expect(fitted.fontSize).toBeGreaterThanOrEqual(24);
    const longWord = "Supercalifragilisticexpialidocious".repeat(3);
    const shaped = "First line\r\nI’m becoming — “steady”\nThird";
    for (const identity of [max, longWord, shaped, "  I keep my word.  "]) {
      for (const template of ["classic", "bold", "minimal"] as const) {
        const layout = await layoutIdentityPoster({ identity, template });
        expect(posterLinesPreserveIdentity(identity, layout.lines)).toBe(true);
        const bytes = await buildIdentityPosterPdf({ identity, template });
        const again = await buildIdentityPosterPdf({ identity, template });
        expect(Buffer.from(bytes).equals(Buffer.from(again))).toBe(true);
        expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
      }
    }
    const classic = await buildIdentityPosterPdf({ identity: shaped, template: "classic" });
    const bold = await buildIdentityPosterPdf({ identity: shaped, template: "bold" });
    const minimal = await buildIdentityPosterPdf({ identity: shaped, template: "minimal" });
    expect(Buffer.from(classic).equals(Buffer.from(bold))).toBe(false);
    expect(Buffer.from(bold).equals(Buffer.from(minimal))).toBe(false);
    await expectPosterPdf(classic, shaped);
  });

  it("refuses a character the poster font cannot encode and does not rewrite it", async () => {
    const identity = "I am steady 🌟";
    await expect(layoutIdentityPoster({ identity, template: "classic" })).rejects.toMatchObject({
      code: "unsupported_character",
    });
    await expect(buildIdentityPosterPdf({ identity, template: "bold" })).rejects.toMatchObject({
      code: "unsupported_character",
    });
  });
});

describe("keepsake studio access", () => {
  beforeEach(() => {
    ops.length = 0;
    ownerMock.mockReset();
    authMock.mockReset();
    profile.current = { data: { identity_anchor_text: "I keep my word." }, error: null };
    ownerMock.mockResolvedValue(true);
    authMock.mockResolvedValue({ userId: "user_tyler" });
  });

  async function pageHtml(template?: string) {
    const { default: Page } = await import("@/app/admin/keepsakes/page");
    const element = await Page({
      searchParams: template === undefined ? {} : { template },
    });
    return renderToStaticMarkup(element);
  }

  async function getPdf(query: string) {
    const { GET } = await import("@/app/api/admin/keepsakes/identity-poster/route");
    return GET(new Request(`https://summitt.test/api/admin/keepsakes/identity-poster${query}`));
  }

  it("lets the owner preview and download the same pdf", async () => {
    const html = await pageHtml("bold");
    expect(html).toContain("Keepsake Studio");
    expect(html).toContain('data="/api/admin/keepsakes/identity-poster?template=bold"');
    expect(html).toContain('href="/api/admin/keepsakes/identity-poster?template=bold&amp;download=1"');
    expect(html).toContain("I keep my word.");
    expect(html).not.toContain("user_tyler");
    expect(html).not.toContain("clerk_user_id");

    const inline = await getPdf("?template=bold");
    const download = await getPdf("?template=bold&download=1&clerk_user_id=user_other");
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toContain("application/pdf");
    expect(inline.headers.get("cache-control")).toBe("private, no-store");
    expect(inline.headers.get("content-disposition")).toContain("inline");
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("content-disposition")).not.toContain("I keep my word.");
    const inlineBytes = new Uint8Array(await inline.arrayBuffer());
    const downloadBytes = new Uint8Array(await download.arrayBuffer());
    expect(Buffer.from(inlineBytes).equals(Buffer.from(downloadBytes))).toBe(true);
    await expectPosterPdf(inlineBytes, "I keep my word.");
    expect(ops.filter((op) => op.startsWith("eq:"))).toEqual([
      "eq:clerk_user_id:user_tyler",
      "eq:clerk_user_id:user_tyler",
      "eq:clerk_user_id:user_tyler",
    ]);
    expect(ops.some((op) => op === "update" || op === "insert" || op === "upsert")).toBe(false);
  });

  it("shows a missing identity without generating a pdf or writing a profile", async () => {
    profile.current = { data: { identity_anchor_text: "   " }, error: null };
    const html = await pageHtml();
    expect(html).toContain("No Identity is saved on this account yet.");
    expect(html).not.toContain("/api/admin/keepsakes/identity-poster");
    const response = await getPdf("?template=classic");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "identity_missing" });
    expect(ops.some((op) => op === "update" || op === "insert" || op === "upsert")).toBe(false);
  });

  it("rejects an unknown template before reading a profile", async () => {
    const response = await getPdf("?template=poster%20drop%20table");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown template" });
    expect(ops).toEqual([]);
    const html = await pageHtml("nope");
    expect(html).toContain('data="/api/admin/keepsakes/identity-poster?template=classic"');
  });

  it("denies a signed-out request, another admin, and an ordinary member", async () => {
    authMock.mockResolvedValue({ userId: null });
    ownerMock.mockResolvedValue(false);
    const signedOut = await getPdf("?template=classic");
    expect(signedOut.status).toBe(401);
    await expect(pageHtml()).rejects.toThrow("NEXT_NOT_FOUND");

    authMock.mockResolvedValue({ userId: "user_brooke" });
    ownerMock.mockResolvedValue(false);
    const brooke = await getPdf("?template=classic");
    expect(brooke.status).toBe(403);
    expect(await brooke.json()).toEqual({ error: "Forbidden" });
    await expect(pageHtml()).rejects.toThrow("NEXT_NOT_FOUND");

    authMock.mockResolvedValue({ userId: "user_member" });
    const member = await getPdf("?template=minimal&clerk_user_id=user_tyler");
    expect(member.status).toBe(403);
    expect(ops).toEqual([]);
  });

  it("does not log or return the identity when the font cannot print it", async () => {
    profile.current = { data: { identity_anchor_text: "I am steady 🌟" }, error: null };
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    const response = await getPdf("?template=classic");
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toBe('{"error":"unsupported_character"}');
    expect(body).not.toContain("steady");
    expect(JSON.stringify(errors)).not.toContain("steady");
    const html = await pageHtml();
    expect(html).toContain("cannot print");
    expect(html).not.toContain("/api/admin/keepsakes/identity-poster");
    spy.mockRestore();
  });

  it("keeps the Keepsake Studio link inside the owner navigation only", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/admin/layout.tsx"), "utf8");
    const ownerNav = layout.slice(layout.indexOf("{tyler ? ("), layout.indexOf(") : null}"));
    expect(ownerNav).toContain('href="/admin/keepsakes"');
    expect(ownerNav).toContain("Keepsake Studio");
    expect(ownerNav).toContain('href="/admin/personal-videos"');
    expect(layout.slice(0, layout.indexOf("{tyler ? (")).includes("/admin/keepsakes")).toBe(false);
    expect(layout).toContain('href="/admin/subscriber-growth"');
    expect(layout).toContain("requireTylerAdmin()");
  });
});
