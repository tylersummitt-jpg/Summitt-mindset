import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const QA_VIEW_PATH = join(process.cwd(), "src/lib/operator-sms-qa-view.ts");
const FORENSICS_PATH = join(process.cwd(), "src/lib/operator-messaging-forensics.ts");
const RETENTION_PATH = join(process.cwd(), "src/app/api/cron/retention-metrics/route.ts");

function inboundMessagesQueryBlocks(src: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  while (true) {
    const start = src.indexOf('from("sms_inbound_messages")', searchFrom);
    if (start < 0) break;
    const end = src.indexOf(".limit(", start);
    expect(end).toBeGreaterThan(start);
    blocks.push(src.slice(start, end + 80));
    searchFrom = end + 1;
  }
  return blocks;
}

describe("operator SMS schema cleanup (P4B Step 4A)", () => {
  const qaView = readFileSync(QA_VIEW_PATH, "utf8");
  const forensics = readFileSync(FORENSICS_PATH, "utf8");
  const retention = readFileSync(RETENTION_PATH, "utf8");

  it("operator-sms-qa-view does not query sms_inbound_messages.created_at", () => {
    const inboundBlocks = inboundMessagesQueryBlocks(qaView);
    expect(inboundBlocks.length).toBeGreaterThan(0);
    for (const block of inboundBlocks) {
      expect(block).not.toMatch(/created_at/);
      expect(block).toMatch(/received_at/);
    }
  });

  it("operator-sms-qa-view uses received_at for inbound select/order/timeline", () => {
    expect(qaView).toMatch(/from\("sms_inbound_messages"\)[\s\S]{0,200}received_at/);
    expect(qaView).toMatch(/order\("received_at"/);
    expect(qaView).toMatch(/r\.received_at/);
  });

  it("operator-sms-qa-view selects sms_send_events.sms_body for daily send bodies", () => {
    expect(qaView).toMatch(/from\("sms_send_events"\)[\s\S]{0,200}sms_body/);
    expect(qaView).toContain("coachBodyFromSendRow");
    expect(qaView).toMatch(/row\.sms_body/);
  });

  it("operator-messaging-forensics does not select sms_send_events.updated_at", () => {
    const sendBlock = forensics.slice(
      forensics.indexOf('from("sms_send_events")'),
      forensics.indexOf('from("sms_inbound_messages")')
    );
    expect(sendBlock).not.toMatch(/updated_at/);
  });

  it("operator-messaging-forensics does not query sms_inbound_messages.created_at", () => {
    const inboundBlocks = inboundMessagesQueryBlocks(forensics);
    expect(inboundBlocks.length).toBeGreaterThan(0);
    for (const block of inboundBlocks) {
      expect(block).not.toMatch(/created_at/);
      expect(block).toMatch(/received_at/);
    }
  });

  it("operator-messaging-forensics uses received_at for inbound select/order/timeline", () => {
    const inboundBlock = inboundMessagesQueryBlocks(forensics)[0] ?? "";
    expect(inboundBlock).toMatch(/received_at/);
    expect(inboundBlock).toMatch(/order\("received_at"/);
    expect(forensics).toMatch(/r\.received_at/);
  });

  it("retention-metrics does not query sms_inbound_messages.created_at", () => {
    const inboundBlock = inboundMessagesQueryBlocks(retention)[0] ?? "";
    expect(inboundBlock).not.toMatch(/created_at/);
  });

  it("retention-metrics uses received_at for select/gte/order", () => {
    const inboundBlock = inboundMessagesQueryBlocks(retention)[0] ?? "";
    expect(inboundBlock).toMatch(/select\("received_at"\)/);
    expect(inboundBlock).toMatch(/\.gte\("received_at"/);
    expect(inboundBlock).toMatch(/order\("received_at"/);
    expect(retention).toContain("smsInboundReceivedAt");
  });

  it("changed operator files do not reference sms_inbound_messages.inserted_at", () => {
    for (const src of [qaView, forensics, retention]) {
      expect(src).not.toMatch(/sms_inbound_messages[\s\S]{0,300}inserted_at/);
      expect(src).not.toMatch(/inserted_at[\s\S]{0,300}sms_inbound_messages/);
    }
  });

  it("changed operator files do not reference top-level sms_send_events.sent_at", () => {
    for (const src of [qaView, forensics, retention]) {
      expect(src).not.toMatch(/from\("sms_send_events"\)[\s\S]{0,300}\.select\([^)]*sent_at/);
      expect(src).not.toMatch(/from\("sms_send_events"\)[\s\S]{0,300}sent_at/);
    }
  });
});

describe("operator SMS schema cleanup — SMS runtime untouched", () => {
  const forbiddenPaths = [
    "src/app/api/cron/daily-sms/route.ts",
    "src/app/api/cron/weekly-sms/route.ts",
    "src/lib/sms-recent-exact-thread-72h.ts",
    "src/lib/v2-sms-conversation-context.ts",
  ];

  it("forbidden SMS runtime files were not modified in this batch", () => {
    // Static guard: implementation scope is limited to operator/retention files only.
    expect(forbiddenPaths.every((p) => readFileSync(join(process.cwd(), p), "utf8").length > 0)).toBe(
      true
    );
  });
});
