import { PROGRAMS_COPY, REFLECTION_ANSWER_MAX } from "./programs-copy";

export function normalizeReflectionAnswer(
  value: string
): { ok: true; text: string } | { ok: false; message: string } {
  const text = value.trim();
  if (!text) {
    return { ok: false, message: PROGRAMS_COPY.reflectionRequired };
  }
  if (text.length > REFLECTION_ANSWER_MAX) {
    return { ok: false, message: PROGRAMS_COPY.reflectionTooLong };
  }
  return { ok: true, text };
}
