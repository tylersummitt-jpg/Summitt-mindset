import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getTopRelevantChunks } from "@/lib/ask-pat/chunks";
import { supabaseServer } from "@/lib/supabase-server";
import { auth } from "@clerk/nextjs/server";
import { buildProfileContext } from "@/lib/profile-context";
import { getDisplayNameForUser } from "@/lib/resolve-preferred-name";
import { finalizeWithName } from "@/lib/format-with-name";
import {
  assertTextSafeForBrand,
  ASK_PAT_INPUT_BLOCKED_FALLBACK,
  ASK_PAT_OUTPUT_FALLBACK,
  lexicalSafetyPass,
  PAT_BRAND_SAFETY_RULES,
  sanitizeModelOutput,
} from "@/lib/ai-safety";
import { persistAskPatAnswerWithRetries } from "@/lib/ask-pat/persist-ask-pat-answer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ASK_PAT_PER_DAY = 10;

/** Chat completion model — logged to ask_pat_questions.model; must match `chat.completions.create` below. */
const ASK_PAT_CHAT_MODEL = "gpt-4.1-mini";

/**
 * NOTE TO SELF (ChatGPT):
 * Ask Pat questions must NOT be stored in journal_entries.
 * journal_entries has UNIQUE (clerk_user_id, day_number) and is reserved for Daily OS journaling.
 * Ask Pat is unlimited per day/lifetime, so it writes to ask_pat_questions instead.
 */

/**
 * Phase 0: Ask Pat observability — structured JSON logs for stage timings and outcomes.
 * Does not log user question text, AI answer text, or profile PII.
 * Future phases (reliability audit): OpenAI/Supabase timeouts, AbortController, client loading caps.
 */
type AskPatStageOutcome = "success" | "failure";

function logAskPatStage(payload: {
  requestId: string;
  stage: string;
  duration_ms: number;
  outcome: AskPatStageOutcome;
  error_type?: string;
}) {
  console.log(
    JSON.stringify({
      event: "ask_pat_stage",
      version: "observability_v0",
      ...payload,
    })
  );
}

function logAskPatTotal(payload: { requestId: string; duration_ms: number; outcome: string }) {
  console.log(
    JSON.stringify({
      event: "ask_pat_request_total",
      version: "observability_v0",
      ...payload,
    })
  );
}

function errorTypeFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.constructor?.name ?? "Error";
  return typeof err === "string" ? "string" : typeof err;
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing in environment");
  }
  return new OpenAI({ apiKey });
}

function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function buildProfileBlock(profile: {
  identity?: string;
  relationships?: string;
  work?: string;
  health?: string;
  pressure?: string;
}): string {
  const lines: string[] = [];

  if (profile.identity) lines.push(`IDENTITY: ${profile.identity}`);
  if (profile.relationships) lines.push(`RELATIONSHIPS: ${profile.relationships}`);
  if (profile.work) lines.push(`WORK: ${profile.work}`);
  if (profile.health) lines.push(`HEALTH: ${profile.health}`);
  if (profile.pressure) lines.push(`PRESSURE: ${profile.pressure}`);

  return lines.length ? lines.join("\n") : "PROFILE: none";
}

const ASK_PAT_GENERATION_ERROR_STUB =
  "Coach Pat couldn't finish this answer. Please try again.";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const requestStart = Date.now();
  let questionRowId: string | null = null;

  try {
    let stageStart = Date.now();
    const { userId } = await auth();
    logAskPatStage({
      requestId,
      stage: "auth",
      duration_ms: Date.now() - stageStart,
      outcome: userId ? "success" : "failure",
      error_type: userId ? undefined : "unauthorized",
    });
    if (!userId) {
      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "401_unauthorized",
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const question = body?.question;

    if (!question || typeof question !== "string") {
      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "400_missing_question",
      });
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    const trimmedQuestion = normalizeText(question);
    if (!trimmedQuestion) {
      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "400_empty_question",
      });
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();

    stageStart = Date.now();
    let inputSafe;
    try {
      inputSafe = await assertTextSafeForBrand(openai, trimmedQuestion);
      logAskPatStage({
        requestId,
        stage: "moderation_in",
        duration_ms: Date.now() - stageStart,
        outcome: inputSafe.ok ? "success" : "failure",
        error_type: inputSafe.ok ? undefined : "input_blocked",
      });
    } catch (err) {
      logAskPatStage({
        requestId,
        stage: "moderation_in",
        duration_ms: Date.now() - stageStart,
        outcome: "failure",
        error_type: errorTypeFromUnknown(err),
      });
      throw err;
    }
    if (!inputSafe.ok) {
      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "200_input_blocked",
      });
      return NextResponse.json({
        answer: ASK_PAT_INPUT_BLOCKED_FALLBACK,
        ok: true,
      });
    }

    const dayKey = todayKeyUTC();

    stageStart = Date.now();
    const { data: usageRows, error: usageErr } = await supabaseServer
      .from("ask_pat_usage")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey);
    logAskPatStage({
      requestId,
      stage: "usage_select",
      duration_ms: Date.now() - stageStart,
      outcome: usageErr ? "failure" : "success",
      error_type: usageErr ? "postgrest_error" : undefined,
    });

    if (usageErr) {
      console.error(
        JSON.stringify({
          event: "ask_pat_error",
          version: "observability_v0",
          request_id: requestId,
          stage: "usage_select",
          error_type: "postgrest_error",
          supabase_message: usageErr.message,
          supabase_code: usageErr.code ?? null,
        })
      );

      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "200_usage_check_failed",
      });
      return NextResponse.json(
        {
          error: "Ask Pat is temporarily unavailable. Please try again later.",
          reason: "usage_check_failed",
        },
        { status: 200 }
      );
    }

    const usedCount = usageRows?.length ?? 0;

    if (usedCount >= MAX_ASK_PAT_PER_DAY) {
      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "200_rate_limited",
      });
      return NextResponse.json(
        {
          error:
            "You’ve hit today’s Ask Pat limit. Come back tomorrow — one good question a day compounds.",
          reason: "rate_limited",
          limitPerDay: MAX_ASK_PAT_PER_DAY,
        },
        { status: 200 }
      );
    }

    stageStart = Date.now();
    const { error: insertUsageErr } = await supabaseServer
      .from("ask_pat_usage")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
      });
    logAskPatStage({
      requestId,
      stage: "usage_insert",
      duration_ms: Date.now() - stageStart,
      outcome: insertUsageErr ? "failure" : "success",
      error_type: insertUsageErr ? "postgrest_error" : undefined,
    });

    if (insertUsageErr) {
      console.error(
        JSON.stringify({
          event: "ask_pat_error",
          version: "observability_v0",
          request_id: requestId,
          stage: "usage_insert",
          error_type: "postgrest_error",
          supabase_message: insertUsageErr.message,
          supabase_code: insertUsageErr.code ?? null,
        })
      );

      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "200_usage_insert_failed",
      });
      return NextResponse.json(
        {
          error: "Ask Pat is temporarily unavailable. Please try again later.",
          reason: "usage_insert_failed",
        },
        { status: 200 }
      );
    }

    stageStart = Date.now();
    const { data: insertedQuestion, error: askPatSaveErr } = await supabaseServer
      .from("ask_pat_questions")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
        question: trimmedQuestion,
      })
      .select("id")
      .single();
    logAskPatStage({
      requestId,
      stage: "question_insert",
      duration_ms: Date.now() - stageStart,
      outcome: askPatSaveErr ? "failure" : "success",
      error_type: askPatSaveErr ? "postgrest_error" : undefined,
    });

    if (askPatSaveErr) {
      console.error(
        JSON.stringify({
          event: "ask_pat_error",
          version: "observability_v0",
          request_id: requestId,
          stage: "question_insert",
          error_type: "postgrest_error",
          supabase_message: askPatSaveErr.message,
          supabase_code: askPatSaveErr.code ?? null,
        })
      );
    }

    if (insertedQuestion?.id != null) {
      questionRowId = String(insertedQuestion.id);
    }

    stageStart = Date.now();
    let profile;
    try {
      profile = await buildProfileContext(userId);
      logAskPatStage({
        requestId,
        stage: "profile_context",
        duration_ms: Date.now() - stageStart,
        outcome: "success",
      });
    } catch (err) {
      logAskPatStage({
        requestId,
        stage: "profile_context",
        duration_ms: Date.now() - stageStart,
        outcome: "failure",
        error_type: errorTypeFromUnknown(err),
      });
      throw err;
    }

    const memoryLines: string[] = [];

    stageStart = Date.now();
    const { data: dailySummaries, error: dailyErr } = await supabaseServer
      .from("daily_summaries")
      .select("daily_summaries, day_number")
      .eq("clerk_user_id", userId)
      .order("day_number", { ascending: false })
      .limit(7);
    logAskPatStage({
      requestId,
      stage: "daily_summaries",
      duration_ms: Date.now() - stageStart,
      outcome: dailyErr ? "failure" : "success",
      error_type: dailyErr ? "postgrest_error" : undefined,
    });

    if (dailyErr) {
      console.error(
        JSON.stringify({
          event: "ask_pat_error",
          version: "observability_v0",
          request_id: requestId,
          stage: "daily_summaries",
          error_type: "postgrest_error",
          supabase_message: dailyErr.message,
          supabase_code: dailyErr.code ?? null,
        })
      );
    }

    if (dailySummaries && dailySummaries.length > 0) {
      memoryLines.push("RECENT DAILY PRACTICE:");
      for (const row of dailySummaries.reverse()) {
        memoryLines.push(`- Day ${row.day_number}: ${row.daily_summaries}`);
      }
    }

    stageStart = Date.now();
    const { data: weeklySummary, error: weeklyErr } = await supabaseServer
      .from("weekly_summaries")
      .select("weekly_summary")
      .eq("clerk_user_id", userId)
      .order("week_end_day", { ascending: false })
      .limit(1)
      .maybeSingle();
    logAskPatStage({
      requestId,
      stage: "weekly_summaries",
      duration_ms: Date.now() - stageStart,
      outcome: weeklyErr ? "failure" : "success",
      error_type: weeklyErr ? "postgrest_error" : undefined,
    });

    if (weeklyErr) {
      console.error(
        JSON.stringify({
          event: "ask_pat_error",
          version: "observability_v0",
          request_id: requestId,
          stage: "weekly_summaries",
          error_type: "postgrest_error",
          supabase_message: weeklyErr.message,
          supabase_code: weeklyErr.code ?? null,
        })
      );
    }

    if (weeklySummary?.weekly_summary) {
      memoryLines.push("");
      memoryLines.push("WEEKLY REFLECTION:");
      memoryLines.push(weeklySummary.weekly_summary);
    }

    const athleteContext =
      memoryLines.length > 0
        ? memoryLines.join("\n")
        : "No recent practice reflections available.";

    stageStart = Date.now();
    let embed;
    try {
      embed = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: trimmedQuestion,
      });
    } catch (err) {
      logAskPatStage({
        requestId,
        stage: "embeddings",
        duration_ms: Date.now() - stageStart,
        outcome: "failure",
        error_type: errorTypeFromUnknown(err),
      });
      throw err;
    }

    const queryEmbedding = embed.data[0]?.embedding;
    logAskPatStage({
      requestId,
      stage: "embeddings",
      duration_ms: Date.now() - stageStart,
      outcome: queryEmbedding ? "success" : "failure",
      error_type: queryEmbedding ? undefined : "empty_embedding",
    });
    if (!queryEmbedding) throw new Error("Embedding failed.");

    stageStart = Date.now();
    let topChunks;
    try {
      topChunks = getTopRelevantChunks(queryEmbedding, 6);
      logAskPatStage({
        requestId,
        stage: "chunks",
        duration_ms: Date.now() - stageStart,
        outcome: "success",
      });
    } catch (err) {
      logAskPatStage({
        requestId,
        stage: "chunks",
        duration_ms: Date.now() - stageStart,
        outcome: "failure",
        error_type: errorTypeFromUnknown(err),
      });
      throw err;
    }

    const bookContext =
      topChunks.length > 0
        ? topChunks
            .map(
              (chunk, idx) =>
                `Excerpt ${idx + 1} (Book: ${chunk.bookId}, Section: ${chunk.sectionTitle}):\n${chunk.text}`
            )
            .join("\n\n")
        : "No relevant excerpts were found.";

    const systemPrompt = `
You are **Pat Summitt**, legendary head coach of the University of Tennessee Lady Volunteers.

You are coaching THIS PERSON — not a generic leader.

====================
PERSONAL CONTEXT
${buildProfileBlock(profile)}
====================

====================
ATHLETE CONTEXT (REAL PRACTICE & REFLECTION)
${athleteContext}
====================

COACHING INSTRUCTIONS
- User profile information may be outdated. If the user has said something more recent that conflicts with their profile, prioritize the user's recent statements over the profile.
- Use the personal context when it truly helps, but do not lean on too many personal details at once.
- Reference patterns you see in their practice when relevant.
- Be honest, firm, and specific.
- Do not summarize their reflections — coach them.
- Never mention how you know anything about them.
- Do not say "you said" or "you wrote."

STYLE RULES
- Teach through real stories from your career.
- No corporate language.
- No fluff.

ANSWER STRUCTURE
1. Open with a story
2. Teach the principle
3. Coach the user directly
4. End with a Summitt-style challenge

SOURCE MATERIAL (FROM YOUR BOOKS)
${bookContext}

${PAT_BRAND_SAFETY_RULES}
`.trim();

    stageStart = Date.now();
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: ASK_PAT_CHAT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trimmedQuestion },
        ],
        temperature: 0.6,
      });
      logAskPatStage({
        requestId,
        stage: "chat_completion",
        duration_ms: Date.now() - stageStart,
        outcome: "success",
      });
    } catch (err) {
      logAskPatStage({
        requestId,
        stage: "chat_completion",
        duration_ms: Date.now() - stageStart,
        outcome: "failure",
        error_type: errorTypeFromUnknown(err),
      });
      throw err;
    }

    let answer =
      completion.choices[0]?.message?.content ??
      "I don't have an answer right now.";

    const preSanitizeAnswer = answer;

    stageStart = Date.now();
    try {
      answer = await sanitizeModelOutput(openai, answer, ASK_PAT_OUTPUT_FALLBACK);
      logAskPatStage({
        requestId,
        stage: "moderation_out",
        duration_ms: Date.now() - stageStart,
        outcome: "success",
      });
    } catch (err) {
      logAskPatStage({
        requestId,
        stage: "moderation_out",
        duration_ms: Date.now() - stageStart,
        outcome: "failure",
        error_type: errorTypeFromUnknown(err),
      });
      throw err;
    }

    const replacedBySanitize =
      answer === ASK_PAT_OUTPUT_FALLBACK &&
      preSanitizeAnswer.trim().length > 0 &&
      preSanitizeAnswer !== ASK_PAT_OUTPUT_FALLBACK;

    let safetyStatus: "ok" | "output_safety_fallback" = "ok";

    stageStart = Date.now();
    try {
      const displayName = await getDisplayNameForUser(userId);
      answer = finalizeWithName(answer, displayName ?? undefined);

      if (!lexicalSafetyPass(answer)) {
        answer = ASK_PAT_OUTPUT_FALLBACK;
        safetyStatus = "output_safety_fallback";
      } else if (replacedBySanitize) {
        safetyStatus = "output_safety_fallback";
      }

      logAskPatStage({
        requestId,
        stage: "display_name",
        duration_ms: Date.now() - stageStart,
        outcome: "success",
      });
    } catch (err) {
      logAskPatStage({
        requestId,
        stage: "display_name",
        duration_ms: Date.now() - stageStart,
        outcome: "failure",
        error_type: errorTypeFromUnknown(err),
      });
      throw err;
    }

    const chunkIds = topChunks.map((c) => c.id);

    stageStart = Date.now();
    const persistOk = await persistAskPatAnswerWithRetries({
      questionRowId,
      answerText: answer,
      model: ASK_PAT_CHAT_MODEL,
      safetyStatus,
      answerMetadata: {
        chunk_ids: chunkIds,
        chunk_count: chunkIds.length,
      },
      requestId,
    });
    logAskPatStage({
      requestId,
      stage: "persist_answer",
      duration_ms: Date.now() - stageStart,
      outcome: persistOk.ok ? "success" : "failure",
      error_type: persistOk.ok ? undefined : "persistence_failed",
    });

    if (!persistOk.ok) {
      console.error(
        JSON.stringify({
          event: "ask_pat_error",
          version: "observability_v0",
          request_id: requestId,
          stage: "persist_answer",
          error_type: "persistence_failed",
          supabase_message: persistOk.lastMessage,
          supabase_code: persistOk.lastCode ?? null,
        })
      );
      logAskPatStage({
        requestId,
        stage: "final_response",
        duration_ms: 0,
        outcome: "success",
      });
      logAskPatTotal({
        requestId,
        duration_ms: Date.now() - requestStart,
        outcome: "200_answer_persist_failed",
      });
      return NextResponse.json({
        ok: true,
        answer,
        persisted: false,
      });
    }

    logAskPatStage({
      requestId,
      stage: "final_response",
      duration_ms: 0,
      outcome: "success",
    });
    logAskPatTotal({
      requestId,
      duration_ms: Date.now() - requestStart,
      outcome: "200_ok",
    });
    return NextResponse.json({ answer, ok: true });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "ask_pat_error",
        version: "observability_v0",
        request_id: requestId,
        stage: "unhandled",
        error_type: errorTypeFromUnknown(err),
      })
    );
    console.error("Ask Pat error:", err);

    const safeMessage =
      err instanceof Error ? err.message.slice(0, 240) : "unknown_error";

    const persistStart = Date.now();
    const persistErrResult = await persistAskPatAnswerWithRetries({
      questionRowId,
      answerText: ASK_PAT_GENERATION_ERROR_STUB,
      model: ASK_PAT_CHAT_MODEL,
      safetyStatus: "generation_error",
      answerMetadata: {
        generation_error: true,
        stage: "openai_pipeline",
        safe_message: safeMessage,
      },
      requestId,
    });
    logAskPatStage({
      requestId,
      stage: "persist_answer",
      duration_ms: Date.now() - persistStart,
      outcome: persistErrResult.ok ? "success" : "failure",
      error_type: persistErrResult.ok ? undefined : "persistence_failed",
    });

    if (!persistErrResult.ok) {
      console.error(
        JSON.stringify({
          event: "ask_pat_error",
          version: "observability_v0",
          request_id: requestId,
          stage: "persist_answer",
          error_type: "persistence_failed",
          supabase_message: persistErrResult.lastMessage,
          supabase_code: persistErrResult.lastCode ?? null,
          context: "generation_error_stub",
        })
      );
    }

    logAskPatStage({
      requestId,
      stage: "final_response",
      duration_ms: 0,
      outcome: "failure",
    });

    logAskPatTotal({
      requestId,
      duration_ms: Date.now() - requestStart,
      outcome: "500_unhandled",
    });
    return NextResponse.json(
      { error: "Something went wrong processing your question." },
      { status: 500 }
    );
  }
}
