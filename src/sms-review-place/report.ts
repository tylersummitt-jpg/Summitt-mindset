import fs from "node:fs";
import path from "node:path";

import { scenarioFilterFromEnv } from "@/sms-review-place/run-review-runner";
import { looksLikeRawJsonSms } from "@/sms-review-place/sms-output";
import type {
  SmsReviewReportSummary,
  SmsReviewRunMode,
  SmsReviewRunRow,
} from "@/sms-review-place/types";

const REPO_ROOT = process.cwd();

export type SmsReviewWriteOptions = {
  mode?: SmsReviewRunMode;
};

export function reportsRootDir(mode: SmsReviewRunMode = "mock"): string {
  const sub =
    mode === "real_openai" ? "reports-real-openai" : "reports";
  return path.join(REPO_ROOT, "sms-review-place", sub);
}

export function formatMarkdownReport(rows: SmsReviewRunRow[], summary: SmsReviewReportSummary): string {
  const hardFails = rows.filter((r) => !r.pass);
  const noSends = rows.filter((r) => !r.final_should_send && !r.lane_skipped_reason);
  const jsonRows = rows.filter(
    (r) =>
      r.hard_flags.includes("json_final_body") ||
      (r.final_body_raw && looksLikeRawJsonSms(r.final_body_raw))
  );

  const lines: string[] = [];

  if (summary.run_mode === "real_openai") {
    lines.push(
      "# SMS Review Place — Real OpenAI Dry-Run",
      "",
      "**Mode:** real_openai",
      "**Fake users only** | **No Twilio** | **No DB writes**",
      "**Not production replay** | **Manual/local/internal only**",
      "",
      `Generated: ${summary.generated_at}`,
      "",
      "## Run summary",
      "",
      `- Scenarios run: ${summary.scenario_count}`,
      `- Steps run: ${summary.step_count}`,
      `- OpenAI live: ${summary.openai_live}`,
      `- Advisory review: ${summary.advisory_review}`,
      `- No-send (coaching path): ${summary.no_send_count}`,
      `- JSON final bodies: ${summary.json_final_body_count}`,
      `- Scenario filter: ${JSON.stringify(summary.scenario_filter)}`,
      ""
    );
  } else {
    lines.push(
      "# SMS Review Place — Sim-1 Report",
      "",
      `Generated: ${summary.generated_at}`,
      "",
      "## Run summary",
      "",
      `- Scenarios (enabled): ${summary.scenario_count}`,
      `- Steps run: ${summary.step_count}`,
      `- Pass: ${summary.pass_count}`,
      `- Fail: ${summary.fail_count}`,
      `- No-send (coaching path): ${summary.no_send_count}`,
      `- JSON final bodies: ${summary.json_final_body_count}`,
      ""
    );
  }

  if (summary.expect_clean_failures.length > 0) {
    lines.push("### expectClean failures", "");
    for (const id of summary.expect_clean_failures) {
      lines.push(`- ${id}`);
    }
    lines.push("");
  }

  if (summary.expect_hard_flag_misses.length > 0) {
    lines.push("### expectHardFlags misses (no expected flag)", "");
    for (const id of summary.expect_hard_flag_misses) {
      lines.push(`- ${id}`);
    }
    lines.push("");
  }

  lines.push("## Hard flag counts", "");
  const flagEntries = Object.entries(summary.hard_flag_counts);
  if (flagEntries.length === 0) {
    lines.push("_None._", "");
  } else {
    for (const [flag, count] of flagEntries.sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`- \`${flag}\`: ${count}`);
    }
    lines.push("");
  }

  lines.push("## JSON final body (diagnostic)", "");
  if (jsonRows.length === 0) {
    lines.push("_None._", "");
  } else {
    for (const r of jsonRows) {
      lines.push(`### ${r.scenario_id} (step ${r.step_index}, ${r.lane})`, "");
      lines.push(`- Flag: json_final_body`);
      lines.push(`- Final (display): ${r.final_body || "(empty)"}`);
      lines.push(`- Final (raw): \`${(r.final_body_raw ?? r.final_body).slice(0, 200)}\``);
      lines.push("");
    }
  }

  if (summary.run_mode === "mock") {
    lines.push("## Hard failures", "");
    if (hardFails.length === 0) {
      lines.push("_None._", "");
    } else {
      for (const r of hardFails) {
        lines.push(
          `### ${r.scenario_id} (step ${r.step_index}, ${r.lane}) — **FAIL**`,
          `- Hard flags: ${r.hard_flags.join(", ") || "(scenario expectation mismatch)"}`,
          `- Lane send: ${r.lane_should_send} | Final send: ${r.final_should_send}`,
          `- Lane reason: ${r.lane_no_send_reason ?? "—"}`,
          `- Final skip: ${r.final_skip_reason ?? "—"}`,
          `- Blocked (FVG): ${r.blocked_reasons.join(", ") || "—"}`,
          `- Lane body: ${r.lane_body || "(empty)"}`,
          `- North Star: ${r.north_star_body || "(empty)"}`,
          `- Final body: ${r.final_body || "(empty)"}`,
          r.final_body_raw ? `- Final raw (JSON leak): \`${r.final_body_raw.slice(0, 180)}\`` : "",
          `- Expected: ${r.expected_behavior}`,
          ""
        );
      }
    }
  }

  lines.push("## No-send table", "");
  if (noSends.length === 0) {
    lines.push("_None._", "");
  } else {
    lines.push("| Scenario | Lane | Lane reason | Final skip | Blocked |", "|---|---|---|---|---|");
    for (const r of noSends) {
      lines.push(
        `| ${r.scenario_id} | ${r.lane} | ${r.lane_no_send_reason ?? ""} | ${r.final_skip_reason ?? ""} | ${r.blocked_reasons.join("; ") || "—"} |`
      );
    }
    lines.push("");
  }

  lines.push("## Temporal wording audit", "");
  for (const r of rows) {
    if (r.hard_flags.includes("temporal_wording_violation")) {
      lines.push(`- **${r.scenario_id}**: ${r.final_body || r.lane_body}`);
    }
  }
  if (!rows.some((r) => r.hard_flags.includes("temporal_wording_violation"))) {
    lines.push("_No temporal violations flagged._", "");
  } else {
    lines.push("");
  }

  lines.push("## Proof / Victory audit", "");
  for (const r of rows) {
    if (
      r.hard_flags.includes("fake_proof_claim") ||
      r.hard_flags.includes("fake_victory_room_claim")
    ) {
      lines.push(`- **${r.scenario_id}**: ${r.final_body || r.lane_body}`);
      if (r.final_body_raw) lines.push(`  - raw: \`${r.final_body_raw.slice(0, 120)}\``);
    }
  }
  lines.push("");

  lines.push("## Repeated question audit", "");
  for (const r of rows) {
    if (r.hard_flags.includes("repeated_question")) {
      lines.push(`- **${r.scenario_id}**: ${r.final_body || r.lane_body}`);
    }
  }
  lines.push("");

  lines.push("## Praise / generic language audit", "");
  for (const r of rows) {
    if (r.hard_flags.includes("warm_praise_overuse") || r.hard_flags.includes("generic_momentum")) {
      lines.push(`- **${r.scenario_id}**: ${r.final_body || r.lane_body}`);
    }
  }
  lines.push("");

  if (rows.some((x) => x.lane === "classifier")) {
    lines.push("## Boundary classifier audit", "");
    for (const r of rows.filter((x) => x.lane === "classifier")) {
      lines.push(`### ${r.scenario_id} — pass=${r.pass}`, "");
      lines.push("```json");
      lines.push(JSON.stringify(r.classifier_results, null, 2));
      lines.push("```", "");
    }
  }

  lines.push("## Full output by scenario", "");
  for (const r of rows) {
    const status =
      summary.run_mode === "real_openai" ?
        `review ${r.pass ? "pass" : "note"}`
      : r.pass ? "PASS" : "FAIL";
    lines.push(`### ${r.scenario_id} — step ${r.step_index} (${r.lane}) — **${status}**`, "");
    lines.push(`- Run mode: ${r.run_mode}`);
    lines.push(`- Persona: ${r.persona_id}`);
    lines.push(`- Goal: ${r.current_goal}`);
    lines.push(`- Thread: ${r.thread_summary}`);
    lines.push(`- Memory: ${r.memory_summary}`);
    if (r.latest_user_reply) lines.push(`- User reply: ${r.latest_user_reply}`);
    if (r.lane_skipped_reason) lines.push(`- Lane skipped: ${r.lane_skipped_reason}`);
    lines.push(`- Packet: v${r.relationship_packet_version ?? "n/a"} truncated=${r.relationship_packet_truncated}`);
    lines.push(`- Lane send: ${r.lane_should_send} | Final send: ${r.final_should_send}`);
    lines.push(`- Lane no-send: ${r.lane_no_send_reason ?? "—"}`);
    lines.push(`- Final skip: ${r.final_skip_reason ?? "—"}`);
    lines.push(`- FVG blocked: ${r.blocked_reasons.join(", ") || "—"}`);
    lines.push(`- Lane body: ${r.lane_body || "(empty)"}`);
    lines.push(`- North Star: ${r.north_star_body || "(empty)"}`);
    lines.push(`- Final body: ${r.final_body || "(empty)"}`);
    if (r.final_body_raw) {
      lines.push(`- Final body (raw JSON diagnostic): \`${r.final_body_raw.slice(0, 200)}\``);
    }
    lines.push(`- Hard flags: ${r.hard_flags.join(", ") || "none"}`);
    if (summary.run_mode === "mock") {
      lines.push(`- Expect clean: ${r.expect_clean} | Expect hard: ${r.expect_hard_flags.join(", ") || "—"}`);
    }
    lines.push(`- Human notes: _${r.human_notes || "add during review"}_`, "");
  }

  lines.push("---", "");
  if (summary.run_mode === "real_openai") {
    lines.push(
      "_Real OpenAI dry-run: hard flags are advisory signals, not strict regression pass/fail._"
    );
  } else {
    lines.push(
      "_LLM judge fields not implemented in Sim-1. Soft review fields are placeholders for human review._"
    );
  }

  return lines.join("\n");
}

export function buildSummary(
  rows: SmsReviewRunRow[],
  options: SmsReviewWriteOptions = {}
): SmsReviewReportSummary {
  const mode = options.mode ?? rows[0]?.run_mode ?? "mock";
  const hard_flag_counts: SmsReviewReportSummary["hard_flag_counts"] = {};
  for (const r of rows) {
    for (const f of r.hard_flags) {
      hard_flag_counts[f] = (hard_flag_counts[f] ?? 0) + 1;
    }
  }

  const scenarioIds = new Set(rows.map((r) => r.scenario_id));
  const expect_clean_failures: string[] = [];
  const expect_hard_flag_misses: string[] = [];

  if (mode === "mock") {
    for (const r of rows) {
      if (r.expect_clean && !r.pass) {
        expect_clean_failures.push(`${r.scenario_id}:${r.step_index}:${r.lane}`);
      }
      if (r.expect_hard_flags.length > 0 && !r.pass) {
        expect_hard_flag_misses.push(`${r.scenario_id}:${r.step_index}:${r.lane}`);
      }
    }
  }

  const filter = scenarioFilterFromEnv();

  return {
    generated_at: new Date().toISOString(),
    run_mode: mode,
    scenario_count: scenarioIds.size,
    step_count: rows.length,
    pass_count: rows.filter((r) => r.pass).length,
    fail_count: rows.filter((r) => !r.pass).length,
    hard_flag_counts,
    no_send_count: rows.filter((r) => !r.final_should_send && !r.lane_skipped_reason).length,
    json_final_body_count: rows.filter((r) => r.hard_flags.includes("json_final_body")).length,
    expect_clean_failures,
    expect_hard_flag_misses,
    fixtures_only: true,
    no_twilio: true,
    no_db_writes: true,
    not_production_replay: true,
    openai_live: mode === "real_openai",
    manual_local_internal_only: mode === "real_openai",
    scenario_filter: {
      scenario: filter.scenario,
      persona: filter.persona,
      limit: filter.limit,
      all: filter.all,
    },
    advisory_review: mode === "real_openai",
  };
}

export function writeSmsReviewReport(
  rows: SmsReviewRunRow[],
  options: SmsReviewWriteOptions = {}
): string {
  const mode = options.mode ?? rows[0]?.run_mode ?? "mock";
  const summary = buildSummary(rows, { mode });
  const timestamp = summary.generated_at.replace(/[:.]/g, "-");
  const dir = path.join(reportsRootDir(mode), timestamp);
  fs.mkdirSync(dir, { recursive: true });

  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "run.jsonl"), jsonl, "utf8");
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "report.md"), formatMarkdownReport(rows, summary), "utf8");

  return dir;
}
