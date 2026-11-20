import { freePdfDownloadResponse } from "@/lib/free-pdf-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return freePdfDownloadResponse("definite_dozen");
}
