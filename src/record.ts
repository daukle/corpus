import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { entryWorkOf, type EntryResult, type Settings } from "./entry.ts";

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Writes the result and keeps the entry's logs and report, then deletes its checkouts: a full run
 * walks dozens of projects, and their build trees would fill the disk long before it ends.
 */
export function recordEntry(result: EntryResult, settings: Settings, results: string): void {
  const name = result.id.replaceAll("/", "_");
  mkdirSync(results, { recursive: true });
  writeJson(join(results, `${name}.json`), result);
  const entryWork = entryWorkOf(result.id, settings);
  if (!existsSync(entryWork)) return;
  const logs = join(results, "logs", name);
  mkdirSync(logs, { recursive: true });
  for (const file of readdirSync(entryWork)) {
    if (file.endsWith(".log") || file === "report.json") copyFileSync(join(entryWork, file), join(logs, file));
  }
  rmSync(entryWork, { recursive: true, force: true });
}
