import "server-only";

import OpenAI from "openai";
import {
  PAT_BRAND_SAFETY_RULES,
  assertTextSafeForBrand,
  sanitizeModelOutput,
} from "@/lib/ai-safety";
import {
  buildDeterministicIdentityOptions,
  buildIdentityGenerationPromptBlock,
  type IdentityGenerationContext,
} from "@/lib/onboarding-identity-templates";
import {
  buildRecommendedGoalsForArea,
  getGoalAreaLabel,
  type GoalAreaId,
} from "@/lib/onboarding-goal-templates";
import {
  formatGoalPersonalizationForPrompt,
  resolveGoalRelationshipTerms,
  type GoalPersonalizationInput,
} from "@/lib/onboarding-goal-personalization";
import { sanitizeGoalOptions } from "@/lib/onboarding-goal-quality";

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

export async function generateIdentityOptions(
  ctx: IdentityGenerationContext
): Promise<string[]> {
  const fallback = buildDeterministicIdentityOptions(ctx);
  const openai = getOpenAIClient();
  if (!openai) return fallback;

  const ingredientBlock = buildIdentityGenerationPromptBlock(ctx);

  const prompt = [
    "Generate 5 short identity anchor lines for onboarding.",
    "Each must start with one of: I am…, I am becoming…, I am building…, I am choosing to be…, I am working to become…",
    ingredientBlock,
    `Preferred name: ${ctx.preferredName}`,
    ctx.userWrittenWords
      ? `User draft identity words (refine, do not quote verbatim if weak): ${ctx.userWrittenWords}`
      : "",
    PAT_BRAND_SAFETY_RULES,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const safe = await assertTextSafeForBrand(openai, prompt);
    if (!safe.ok) return fallback;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: "Return exactly 5 lines, one per line, no numbering.",
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\d+[\).\s]+/, "").trim())
      .filter((l) => l.length >= 12 && /^i am/i.test(l));

    const sanitized: string[] = [];
    for (const line of lines) {
      const out = await sanitizeModelOutput(openai, line, "");
      if (out && out.length >= 12) sanitized.push(out);
    }

    if (sanitized.length >= 3) return sanitized.slice(0, 5);
    return fallback;
  } catch (err) {
    console.error("[onboarding-generation] identity OpenAI failed", err);
    return fallback;
  }
}

export async function generateGoalOptions(
  areaId: GoalAreaId,
  context: GoalPersonalizationInput = {}
): Promise<{ title: string; behaviorStatement: string }[]> {
  const identityAnchor = context.identityAnchor ?? "";
  const fallback = buildRecommendedGoalsForArea(areaId, context).map((goal) => ({
    title: goal.title,
    behaviorStatement: goal.behaviorStatement,
  }));

  const openai = getOpenAIClient();
  if (!openai) return fallback;

  const areaLabel = getGoalAreaLabel(areaId);
  const relationshipTerms = formatGoalPersonalizationForPrompt(
    resolveGoalRelationshipTerms(context)
  );
  const prompt = [
    "Generate 5 daily accountability goals as JSON: {\"goals\":[{\"title\":\"...\",\"behaviorStatement\":\"...\"}]}",
    "Each behaviorStatement MUST start with \"I will\".",
    "Each goal must be checkable yes/no today or on a normal workday.",
    "Use concrete actions with a time, duration, count, or specific moment.",
    "Prefer daily or near-daily practice. Avoid weekly-only goals.",
    "Do NOT paste or paraphrase the full identity statement.",
    "Do NOT use filler like \"matches who I am becoming\".",
    "No My Why, purpose, life_desires, or vague self-improvement language.",
    "No sentence fragments. Use proper capitalization.",
    "Use the resolved relationship terms below when relevant.",
    "Avoid generic 'spouse or partner' when a specific partner term is provided.",
    "Do not include private names.",
    `Focus area: ${areaLabel}`,
    relationshipTerms,
    identityAnchor
      ? `Identity context for relevance only (do not quote verbatim): ${identityAnchor.slice(0, 160)}`
      : "",
    PAT_BRAND_SAFETY_RULES,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const safe = await assertTextSafeForBrand(openai, prompt);
    if (!safe.ok) return fallback;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: '{"goals":[]}' },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { goals?: { title?: string; behaviorStatement?: string }[] };
    const goals = Array.isArray(parsed.goals) ? parsed.goals : [];

    const out: { title: string; behaviorStatement: string }[] = [];
    for (const g of goals) {
      const title = typeof g.title === "string" ? g.title.trim() : "";
      const behavior =
        typeof g.behaviorStatement === "string" ? g.behaviorStatement.trim() : "";
      if (!title || !behavior) continue;
      const safeTitle = await sanitizeModelOutput(openai, title, "");
      const safeBehavior = await sanitizeModelOutput(openai, behavior, "");
      if (safeTitle && safeBehavior) {
        out.push({ title: safeTitle, behaviorStatement: safeBehavior });
      }
    }

    const sanitized = sanitizeGoalOptions(out, identityAnchor, 5);
    if (sanitized.length >= 3) {
      return sanitized;
    }
    return fallback;
  } catch (err) {
    console.error("[onboarding-generation] goal OpenAI failed", err);
    return fallback;
  }
}
