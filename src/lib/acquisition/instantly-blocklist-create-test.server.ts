import "server-only";

import { runInstantlyBlocklistCreateTest } from "@/lib/acquisition/instantly-blocklist-create-test";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Temporary server adapter. Remove with the create-test route.
 * Reads one local stop row by the allowlisted address and claims one test row.
 * It does not update stop intents, people, journeys, events, suppressions, or settings.
 */

const CLAIM_ID = "once";

function hasRow(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0;
  return Boolean(data) && typeof data === "object";
}

export async function runOwnedBlocklistCreateTest(body: unknown) {
  return runInstantlyBlocklistCreateTest({
    body,
    apiKey: process.env.INSTANTLY_API_KEY ?? null,
    allowlist: process.env.INSTANTLY_BLOCKLIST_CREATE_TEST_EMAIL ?? null,
    findLocalIntent: async (email) => {
      const { data, error } = await supabaseServer
        .from("acquisition_instantly_blocks")
        .select("id")
        .eq("email_normalized", email)
        .limit(1);
      if (error) return "unreadable";
      return hasRow(data) ? "present" : "absent";
    },
    readClaim: async () => {
      const { data, error } = await supabaseServer
        .from("acquisition_blocklist_create_test")
        .select("id")
        .eq("id", CLAIM_ID)
        .limit(1);
      if (error) return "unreadable";
      return hasRow(data) ? "present" : "absent";
    },
    claimOnce: async () => {
      const { error } = await supabaseServer
        .from("acquisition_blocklist_create_test")
        .insert({ id: CLAIM_ID, outcome: "claimed" });
      if (!error) return "claimed";
      if ((error as { code?: string }).code === "23505") return "used";
      return "unavailable";
    },
    recordOutcome: async (outcome) => {
      await supabaseServer
        .from("acquisition_blocklist_create_test")
        .update({ outcome })
        .eq("id", CLAIM_ID);
    },
  });
}
