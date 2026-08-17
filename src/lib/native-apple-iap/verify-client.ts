export type AppleAccountTokenResult =
  | { ok: true; appAccountToken: string }
  | { ok: false; status: number };

export type AppleVerifyResult =
  | { kind: "verified" }
  | { kind: "conflict" }
  | { kind: "retryable" }
  | { kind: "rejected" };

export async function fetchAppleAccountToken(
  fetcher: typeof fetch = fetch
): Promise<AppleAccountTokenResult> {
  const res = await fetcher("/api/apple/account-token", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const body: unknown = await res.json().catch(() => null);
  const token =
    body &&
    typeof body === "object" &&
    "appAccountToken" in body &&
    typeof (body as { appAccountToken?: unknown }).appAccountToken === "string"
      ? (body as { appAccountToken: string }).appAccountToken.trim()
      : "";
  if (!token) return { ok: false, status: res.status };
  return { ok: true, appAccountToken: token };
}

export async function postAppleSignedTransaction(
  signedTransactionInfo: string,
  fetcher: typeof fetch = fetch
): Promise<AppleVerifyResult> {
  let res: Response;
  try {
    res = await fetcher("/api/apple/verify", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedTransactionInfo }),
    });
  } catch {
    return { kind: "retryable" };
  }

  if (res.status === 200) return { kind: "verified" };
  if (res.status === 409) return { kind: "conflict" };
  if (res.status >= 500) return { kind: "retryable" };
  return { kind: "rejected" };
}

/** Native may finish only after this returns true. */
export function shouldAckNativeTransactionFinish(
  result: AppleVerifyResult
): boolean {
  return result.kind === "verified";
}
