import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backlogOf } from "./backlog.ts";
import { runEntry, type Entry, type EntryResult } from "./entry.ts";
import { recordEntry, writeJson } from "./record.ts";
import { invocationFrom } from "./settings.ts";

/** Runs the pinned corpus, or the entries --only names, and ranks what blocked them. */
async function main(): Promise<void> {
  const { settings, results, corpus, only } = invocationFrom(process.argv.slice(2), "corpus.json");
  const entries = JSON.parse(readFileSync(corpus, "utf8")) as Entry[];
  const chosen = only === undefined ? entries : entries.filter((entry) => only.includes(entry.id));
  const missing = (only ?? []).filter((id) => !entries.some((entry) => entry.id === id));
  if (missing.length > 0) throw new Error(`no corpus entry is called ${missing.join(", ")}`);

  const finished: EntryResult[] = [];
  for (const entry of chosen) {
    console.log(`${entry.id}: running`);
    const result = await runEntry(entry, settings);
    finished.push(result);
    recordEntry(result, settings, results);
    console.log(`${entry.id}: ${result.outcome}${result.reason !== undefined ? ` (${result.reason})` : ""}`);
    writeJson(join(results, "summary.json"), {
      outcomes: finished.map((done) => ({ id: done.id, outcome: done.outcome })),
      backlog: backlogOf(finished),
    });
  }
}

await main();
