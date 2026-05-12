import { supabaseServer } from "@/lib/supabase-server";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PERSIST_ATTEMPTS = 3;

/**
 * Writes Ask Pat answer fields to ask_pat_questions with short retries.
 * Does not throw — callers decide UX when ok is false.
 */
export async function persistAskPatAnswerWithRetries(args: {
  questionRowId: string | null;
  answerText: string;
  model: string;
  safetyStatus: string;
  answerMetadata: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; lastMessage: string; lastCode?: string }> {
  if (!args.questionRowId) {
    return { ok: true };
  }

  let lastMessage = "unknown";
  let lastCode: string | undefined;

  for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++) {
    try {
      const { error } = await supabaseServer
        .from("ask_pat_questions")
        .update({
          answer_text: args.answerText,
          answered_at: new Date().toISOString(),
          model: args.model,
          safety_status: args.safetyStatus,
          answer_metadata: args.answerMetadata,
        })
        .eq("id", args.questionRowId);

      if (!error) {
        return { ok: true };
      }

      lastMessage = error.message;
      lastCode = error.code;

      if (attempt < PERSIST_ATTEMPTS) {
        await sleep(attempt === 1 ? 50 : 100);
      }
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err);
      lastCode = undefined;
      if (attempt < PERSIST_ATTEMPTS) {
        await sleep(attempt === 1 ? 50 : 100);
      }
    }
  }

  console.error(
    JSON.stringify({
      event: "ask_pat_answer_persistence_failed",
      stage: "answer_persistence_failed",
      question_row_id: args.questionRowId,
      supabase_error_message: lastMessage,
      supabase_error_code: lastCode ?? null,
      answer_length: args.answerText.length,
      safety_status: args.safetyStatus,
    })
  );

  return { ok: false, lastMessage, lastCode };
}
