import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { backlogOf, type BacklogRow } from "./backlog.ts";
import { nextBaseline, regressionsAgainst, type Baseline, type Regression } from "./baseline.ts";
import type { EntryResult } from "./entry.ts";
import { writeJson } from "./record.ts";

const USAGE = "usage: node src/report.ts --results <directory> --baseline <file> --summary <file> "
  + "--next-baseline <file>";
const BACKLOG_ROWS_SHOWN = 30;
/** The exit code for a run that got worse, apart from 1, which is a report that could not be written. */
const REGRESSED = 3;

function isEntryResult(value: unknown): value is EntryResult {
  return typeof value === "object" && value !== null && "id" in value && "outcome" in value && "blockers" in value;
}

/** Every entry result in the directory, each `<id>.json` an entry job wrote. */
function resultsIn(directory: string): EntryResult[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as unknown)
    .filter(isEntryResult)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function totalSeconds(result: EntryResult): number {
  return Object.values(result.seconds).reduce((sum, seconds) => sum + seconds, 0);
}

function outcomeTable(results: EntryResult[]): string[] {
  const rows = results.map((result) =>
    `| ${result.id} | ${result.outcome} | ${result.blockers.length} | ${result.jdk ?? ""} | ${totalSeconds(result)} |`);
  return ["| entry | outcome | blockers | jdk | seconds |", "| --- | --- | --- | --- | --- |", ...rows];
}

function regressionLines(regressions: Regression[]): string[] {
  if (regressions.length === 0) return ["No entry got worse than its baseline."];
  return regressions.map((regression) => {
    const gained = regression.gainedBlockers.length > 0 ? `, new blockers: ${regression.gainedBlockers.join(", ")}` : "";
    return `- **${regression.id}**: ${regression.was} to ${regression.now}${gained}`;
  });
}

function backlogLines(backlog: BacklogRow[]): string[] {
  const rows = backlog.slice(0, BACKLOG_ROWS_SHOWN).map((row) =>
    `| ${row.entries.length} | ${row.row} | ${row.examples.join(", ")} |`);
  return ["| entries | surface row | examples |", "| --- | --- | --- |", ...rows];
}

function summaryOf(results: EntryResult[], regressions: Regression[], backlog: BacklogRow[]): string {
  return [
    `## Migration corpus: ${results.length} entries`, "",
    ...outcomeTable(results), "",
    "## Regressions", "", ...regressionLines(regressions), "",
    "## Backlog, by entries blocked", "", ...backlogLines(backlog), "",
  ].join("\n");
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      results: { type: "string" },
      baseline: { type: "string" },
      summary: { type: "string" },
      "next-baseline": { type: "string" },
    },
  });
  if (!values.results || !values.baseline || !values.summary || !values["next-baseline"]) throw new Error(USAGE);
  const results = resultsIn(values.results);
  const baseline: Baseline = existsSync(values.baseline) ? JSON.parse(readFileSync(values.baseline, "utf8")) : {};
  const regressions = regressionsAgainst(baseline, results);
  writeFileSync(values.summary, summaryOf(results, regressions, backlogOf(results)));
  writeJson(values["next-baseline"], nextBaseline(baseline, results));
  if (regressions.length > 0) process.exitCode = REGRESSED;
}

main();
