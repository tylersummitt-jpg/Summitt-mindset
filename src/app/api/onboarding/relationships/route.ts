/**
 * POST /api/onboarding/relationships (RETIRED)
 *
 * Legacy relationships intake was merged into POST /api/onboarding/identity.
 * Writable access is disabled so legacy profile people fields cannot bypass the SoB identity path.
 */
export async function POST() {
  return Response.json(
    {
      error:
        "Relationships onboarding is retired. Use POST /api/onboarding/identity for identity and optional important people.",
    },
    { status: 410 }
  );
}
