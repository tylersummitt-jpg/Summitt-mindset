import { NextResponse } from "next/server";

import {
  ACQUISITION_ASSET_FILES,
  readAcquisitionAsset,
  type AcquisitionFileKey,
} from "@/lib/acquisition/assets";

export async function freePdfDownloadResponse(asset: AcquisitionFileKey): Promise<NextResponse> {
  const bytes = await readAcquisitionAsset(asset);
  const file = ACQUISITION_ASSET_FILES[asset];
  if (!bytes) {
    return new NextResponse("This PDF is unavailable right now.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
