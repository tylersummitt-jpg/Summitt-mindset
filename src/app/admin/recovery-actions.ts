"use server";

import { revalidatePath } from "next/cache";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import { markRecoveryReplyHandled, pauseRecoverySettings } from "@/lib/recovery.server";

export async function pauseRecoveryAutomation(_formData: FormData): Promise<void> {
  await requireTylerAdmin();
  const result = await pauseRecoverySettings();
  if (result.ok) revalidatePath("/admin/distribution");
}

export async function markRecoveryHandled(formData: FormData): Promise<void> {
  await requireTylerAdmin();
  const replyId = formData.get("replyId");
  if (typeof replyId !== "string") return;
  const result = await markRecoveryReplyHandled(replyId);
  if (result.ok) revalidatePath("/admin/distribution");
}
