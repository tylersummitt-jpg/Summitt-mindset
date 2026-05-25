import { auth } from "@clerk/nextjs/server";
import { handleGenerateGoalOptionsRequest } from "@/lib/generate-goal-options-handler";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const areaId = typeof body.selected_area_id === "string" ? body.selected_area_id : "";

  const result = await handleGenerateGoalOptionsRequest(userId, areaId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ options: result.options });
}
