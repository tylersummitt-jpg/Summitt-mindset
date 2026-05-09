import { Resend } from "resend";

export type NotifyQuotesBookFulfillmentArgs = {
  userEmail: string;
  displayName: string | null;
  clerkUserId: string;
  entitledFirstSeenAtIso: string;
  quotesBookDueAtIso: string;
};

/**
 * Internal ops-only: remind Tyler/Challenge to manually send the Pat Summitt quotes book.
 * Throws on missing config or Resend failure so the caller can record attempt/errors without marking sent.
 */
export async function notifyQuotesBookFulfillment(
  args: NotifyQuotesBookFulfillmentArgs
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.QUOTES_BOOK_FULFILLMENT_TO?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY missing");
  }
  if (!to) {
    throw new Error("QUOTES_BOOK_FULFILLMENT_TO missing");
  }

  const from =
    process.env.QUOTES_BOOK_FULFILLMENT_FROM?.trim() ||
    "challenge@summittmindset.com";

  const subject = `Send quotes book: ${args.userEmail}`;

  const text = [
    "Send this user the Pat Summitt quotes book.",
    "",
    "This is an internal fulfillment reminder only.",
    "The app marks the reminder as sent only after this email succeeds.",
    "",
    `User email: ${args.userEmail}`,
    args.displayName ? `Name: ${args.displayName}` : "Name: (not provided)",
    `Clerk user id: ${args.clerkUserId}`,
    `entitled_first_seen_at: ${args.entitledFirstSeenAtIso}`,
    `quotes_book_due_at: ${args.quotesBookDueAtIso}`,
  ].join("\n");

  const html = `
    <p><strong>Send this user the Pat Summitt quotes book.</strong></p>
    <p><em>Internal fulfillment reminder only.</em> The app records this reminder as sent only after this email succeeds.</p>
    <p>User email: ${escapeHtml(args.userEmail)}</p>
    <p>${args.displayName ? `Name: ${escapeHtml(args.displayName)}` : "Name: (not provided)"}</p>
    <p>Clerk user id: ${escapeHtml(args.clerkUserId)}</p>
    <p>entitled_first_seen_at: ${escapeHtml(args.entitledFirstSeenAtIso)}</p>
    <p>quotes_book_due_at: ${escapeHtml(args.quotesBookDueAtIso)}</p>
  `;

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to,
    subject,
    text,
    html,
  });

  if (result.error) {
    throw new Error(
      typeof result.error.message === "string"
        ? result.error.message
        : "Resend send failed"
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
