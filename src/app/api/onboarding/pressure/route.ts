/**
 * Legacy onboarding step removed — use POST /api/onboarding/commitment instead.
 */
export async function POST() {
  return Response.json(
    {
      error: "This onboarding step was removed. Save your commitment at /api/onboarding/commitment.",
    },
    { status: 410 }
  );
}
