import { NextResponse } from "next/server";

import {
  IdentityPosterUnsupportedCharacterError,
  buildIdentityPosterPdf,
  parseIdentityPosterTemplate,
} from "@/lib/keepsakes/identity-poster";
import { authorizeKeepsakeOwner, loadSignedInOwnerIdentity } from "@/lib/keepsakes/load-owner-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function denied(status: 401 | 403 | 500) {
  const error = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Unavailable";
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(req: Request) {
  const access = await authorizeKeepsakeOwner();
  if (!access.ok) return denied(access.status);

  const url = new URL(req.url);
  const template = parseIdentityPosterTemplate(url.searchParams.get("template"));
  if (!template) {
    return NextResponse.json({ error: "Unknown template" }, { status: 400, headers: NO_STORE });
  }

  const loaded = await loadSignedInOwnerIdentity();
  if (!loaded.ok) return denied(loaded.status);
  if (!loaded.identity) {
    return NextResponse.json({ error: "identity_missing" }, { status: 404, headers: NO_STORE });
  }

  try {
    const bytes = await buildIdentityPosterPdf({ identity: loaded.identity, template });
    const download = url.searchParams.get("download") === "1";
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="identity-poster.pdf"`,
      },
    });
  } catch (err) {
    if (err instanceof IdentityPosterUnsupportedCharacterError) {
      return NextResponse.json({ error: "unsupported_character" }, { status: 422, headers: NO_STORE });
    }
    console.error("[keepsake-studio] pdf failed", {
      message: err instanceof Error ? err.message : "pdf_failed",
    });
    return NextResponse.json({ error: "pdf_failed" }, { status: 500, headers: NO_STORE });
  }
}
