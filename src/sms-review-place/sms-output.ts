/**
 * SMS Review Place — human-visible SMS helpers (not used by production routes).
 */

export function looksLikeRawJsonSms(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return t.startsWith("{");
  }
}

export function tryExtractSmsBodyFromJsonLike(text: string): string | null {
  const t = text.trim();
  if (!looksLikeRawJsonSms(t)) return null;
  try {
    const parsed: unknown = JSON.parse(t);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const body = (parsed as { body?: unknown }).body;
      if (typeof body === "string" && body.trim()) return body.trim();
    }
  } catch {
    return null;
  }
  return null;
}

export type ResolvedFinalSms = {
  /** Body shown in reports and used for human-readable checks. */
  final_body: string;
  /** Raw FVG output when it looked like JSON (for diagnosis). */
  final_body_raw: string | null;
  final_should_send: boolean;
};

export function resolveFinalSmsOutput(args: {
  fvgShouldSend: boolean;
  fvgBody: string;
}): ResolvedFinalSms {
  if (!args.fvgShouldSend) {
    return { final_body: "", final_body_raw: null, final_should_send: false };
  }

  const raw = (args.fvgBody ?? "").trim();
  if (!looksLikeRawJsonSms(raw)) {
    return { final_body: raw, final_body_raw: null, final_should_send: true };
  }

  const extracted = tryExtractSmsBodyFromJsonLike(raw);
  if (extracted && !looksLikeRawJsonSms(extracted)) {
    return {
      final_body: extracted,
      final_body_raw: raw,
      final_should_send: true,
    };
  }

  return { final_body: raw, final_body_raw: raw, final_should_send: true };
}
