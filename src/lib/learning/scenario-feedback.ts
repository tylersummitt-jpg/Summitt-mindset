/**
 * Graded scenario choice copy.
 * Correct with no teaching line is "Correct!".
 * Incorrect names the correct choice and never repeats "Your answer".
 * An authored explanation, when present, follows that status line.
 */
export function presentScenarioChoiceResponse(response: string): string {
  if (!/your answer:/i.test(response)) return response;

  const yourAnswer = response.match(/\s*your answer:\s*([\s\S]*)$/i);
  if (!yourAnswer || yourAnswer.index == null) return response;

  const before = response.slice(0, yourAnswer.index).trim();
  let after = yourAnswer[1] ?? "";
  const explanationLead = after.search(
    /\s(?:Not quite\b|That's right\b|Yes, that's correct\b|Of these\b)/i
  );
  let explanation = "";
  if (explanationLead >= 0) {
    explanation = after.slice(explanationLead).trim();
    after = after.slice(0, explanationLead);
  }
  explanation = explanation
    .replace(/^(?:Not quite!?\s*|That's right!\s*|Yes, that's correct!\s*)/i, "")
    .trim();

  const status = /^(correct)\b/i.test(before)
    ? "correct"
    : /^(incorrect)\b/i.test(before)
      ? "incorrect"
      : null;
  const correctAnswer = before.match(/correct answer:\s*([\s\S]+)$/i)?.[1]?.trim().replace(/\.$/, "");

  if (status === "correct") {
    return explanation ? `Correct!\n\n${explanation}` : "Correct!";
  }
  if (status === "incorrect" && correctAnswer) {
    const line = `Incorrect. Correct answer: ${correctAnswer}.`;
    return explanation ? `${line}\n\n${explanation}` : line;
  }
  return response;
}
