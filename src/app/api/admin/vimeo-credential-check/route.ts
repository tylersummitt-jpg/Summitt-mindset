import { NextResponse } from "next/server";

import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIMEO_HEADERS = {
  Accept: "application/vnd.vimeo.*+json;version=3.4",
} as const;

const REQUIRED_SCOPES = ["public", "private", "create", "edit", "upload", "delete"] as const;

/**
 * Temporary production check. Tyler only. Returns no token and no raw Vimeo body.
 * Remove this route after the credential check.
 */
export async function GET() {
  if (!(await isTylerOwnerSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = process.env.VIMEO_ACCESS_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({
      tokenAccepted: false,
      accountMatch: null,
      requiredScopesPresent: false,
      scopes: [],
      metadataRead: false,
      uploadCapability: "not_reported",
    });
  }

  const headers = {
    ...VIMEO_HEADERS,
    Authorization: `Bearer ${token}`,
  };

  let verify: unknown;
  let verifyOk = false;
  try {
    const verifyResponse = await fetch("https://api.vimeo.com/oauth/verify", {
      headers,
      cache: "no-store",
    });
    verifyOk = verifyResponse.ok;
    verify = verifyOk ? await verifyResponse.json() : null;
  } catch {
    verifyOk = false;
    verify = null;
  }

  if (!verifyOk || !verify || typeof verify !== "object") {
    return NextResponse.json({
      tokenAccepted: false,
      accountMatch: null,
      requiredScopesPresent: false,
      scopes: [],
      metadataRead: false,
      uploadCapability: "not_reported",
    });
  }

  const scopeText = "scope" in verify && typeof verify.scope === "string" ? verify.scope : "";
  const scopes = scopeText.split(/\s+/).filter(Boolean).sort();
  const user = "user" in verify && verify.user && typeof verify.user === "object" ? verify.user : null;
  const uri = user && "uri" in user && typeof user.uri === "string" ? user.uri : "";
  const accountDigits = uri.replace(/\D/g, "");
  const accountMatch = accountDigits.endsWith("4948");
  const requiredScopesPresent = REQUIRED_SCOPES.every((scope) => scopes.includes(scope));

  const uploadCapability = scopes.includes("upload") ? "scope_present" : "scope_absent";
  let metadataRead = false;
  try {
    const videoResponse = await fetch(
      "https://api.vimeo.com/videos/1150754357?fields=uri,status,privacy.view,transcode.status,pictures.sizes",
      { headers, cache: "no-store" }
    );
    if (videoResponse.ok) {
      const video = (await videoResponse.json()) as {
        privacy?: { view?: unknown };
        transcode?: { status?: unknown };
        pictures?: { sizes?: unknown };
      };
      const sizes = video.pictures?.sizes;
      metadataRead =
        typeof video.privacy?.view === "string" &&
        typeof video.transcode?.status === "string" &&
        Array.isArray(sizes) &&
        sizes.length > 0;
    }
  } catch {
    metadataRead = false;
  }

  return NextResponse.json(
    {
      tokenAccepted: true,
      accountMatch,
      requiredScopesPresent,
      scopes,
      metadataRead,
      uploadCapability,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
