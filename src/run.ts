import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { runEntry, type Entry, type EntryResult, type Settings } from "./entry.ts";

const DEFAULT_CATALOG = "https://raw.githubusercontent.com/daukle/manifest/main/plugins.json";
const DEFAULT_TIMEOUT_MINUTES = 60;

function settingsFrom(values: Record<string, string | boolean | string[] | undefined>): Settings {
  if (typeof values.daukle !== "string" || typeof values.work !== "string") {
    throw new Error("usage: node src/run.ts --daukle <binary> --work <directory> [--catalog <url>] "
      + "[--only <id>]... [--corpus <file>] [--timeout-minutes <n>]");
  }
  const work = resolve(values.work);
  return {
    daukle: resolve(values.daukle),
    catalog: typeof values.catalog === "string" ? values.catalog : DEFAULT_CATALOG,
    work,
    daukleCache: join(work, "daukle-cache"),
    timeoutMs: Number(values["timeout-minutes"] ?? DEFAULT_TIMEOUT_MINUTES) * 60_000,
  };
}

/**
 * Blockers ranked by how many entries they stop: what migration work to do next. Grouped by the
 * surface row a blocker names, since a construct is per instance (`scripts."lint"`, one nested
 * package.json) and would never add up across projects; a blocker with no row groups by construct.
 */
function backlogOf(results: EntryResult[]): { row: string; entries: string[]; examples: string[] }[] {
  const byRow = new Map<string, { entries: Set<string>; examples: Set<string> }>();
  for (const result of results) {
    for (const blocker of result.blockers) {
      const row = blocker.surface ?? `no surface row: ${blocker.construct}`;
      const group = byRow.get(row) ?? { entries: new Set<string>(), examples: new Set<string>() };
      group.entries.add(result.id);
      group.examples.add(blocker.construct);
      byRow.set(row, group);
    }
  }
  return [...byRow.entries()]
    .map(([row, group]) => ({ row, entries: [...group.entries], examples: [...group.examples].slice(0, 5) }))
    .sort((left, right) => right.entries.length - left.entries.length || left.row.localeCompare(right.row));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      daukle: { type: "string" },
      work: { type: "string" },
      catalog: { type: "string" },
      only: { type: "string", multiple: true },
      corpus: { type: "string", default: "corpus.json" },
      "timeout-minutes": { type: "string" },
    },
  });
  const settings = settingsFrom(values);
  const corpus = JSON.parse(readFileSync(values.corpus as string, "utf8")) as Entry[];
  const only = values.only as string[] | undefined;
  const entries = only === undefined ? corpus : corpus.filter((entry) => only.includes(entry.id));
  if (only !== undefined && entries.length !== only.length) {
    throw new Error(`no corpus entry is called ${only.filter((id) => !corpus.some((e) => e.id === id)).join(", ")}`);
  }
  mkdirSync("results", { recursive: true });
  const results: EntryResult[] = [];
  for (const entry of entries) {
    console.log(`${entry.id}: running`);
    const result = await runEntry(entry, settings);
    results.push(result);
    writeFileSync(join("results", `${entry.id.replaceAll("/", "_")}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${entry.id}: ${result.outcome}${result.reason !== undefined ? ` (${result.reason})` : ""}`);
  }
  writeFileSync(join("results", "summary.json"), `${JSON.stringify({
    outcomes: results.map((result) => ({ id: result.id, outcome: result.outcome })),
    backlog: backlogOf(results),
  }, null, 2)}\n`);
}

await main();
