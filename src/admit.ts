import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backlogOf } from "./backlog.ts";
import { runEntry, type EntryResult, type Outcome } from "./entry.ts";
import { recordEntry, writeJson } from "./record.ts";
import type { Candidate } from "./select.ts";
import { invocationFrom } from "./settings.ts";

const PER_BAND = 4;
/** A band that admits nothing in this many tries says so rather than walking the whole pool. */
const MAX_TRIES_PER_BAND = 10;
const BANDS = ["small", "medium", "large"] as const;
const NOT_ADMITTED: Outcome[] = ["not-admitted", "error"];

interface Admission {
  admitted: Candidate[];
  rejected: { id: string; band: string; outcome: Outcome; reason: string }[];
  shortBands: { ecosystem: string; band: string; admitted: number; tried: number }[];
}

/**
 * Walks each ecosystem's bands in star order and keeps the first PER_BAND whose own build succeeds
 * twice: an `unreproducible` entry is admitted, since its builds succeeded. Every rejection is kept
 * with its reason, so "too big to build" stays visible. --only names ecosystems here.
 */
async function main(): Promise<void> {
  const { settings, results, corpus, only } = invocationFrom(process.argv.slice(2), "candidates.json");
  const candidates = JSON.parse(readFileSync(corpus, "utf8")) as Candidate[];
  const ecosystems = [...new Set(candidates.map((candidate) => candidate.ecosystem))]
    .filter((ecosystem) => only === undefined || only.includes(ecosystem));
  const admission: Admission = { admitted: [], rejected: [], shortBands: [] };
  const finished: EntryResult[] = [];

  for (const ecosystem of ecosystems) {
    for (const band of BANDS) {
      const pool = candidates.filter((candidate) => candidate.ecosystem === ecosystem && candidate.band === band);
      let admitted = 0;
      let tried = 0;
      for (const candidate of pool) {
        if (admitted === PER_BAND || tried === MAX_TRIES_PER_BAND) break;
        tried++;
        console.log(`${candidate.id} (${band}): running`);
        const result = await runEntry(candidate, settings);
        recordEntry(result, settings, results);
        console.log(`${candidate.id}: ${result.outcome}${result.reason !== undefined ? ` (${result.reason})` : ""}`);
        if (NOT_ADMITTED.includes(result.outcome)) {
          admission.rejected.push({ id: candidate.id, band, outcome: result.outcome, reason: result.reason ?? "" });
        } else {
          admitted++;
          admission.admitted.push(candidate);
          finished.push(result);
        }
        writeJson(join(results, "admission.json"), admission);
        writeJson(join(results, "corpus.json"), admission.admitted);
        writeJson(join(results, "summary.json"), {
          outcomes: finished.map((done) => ({ id: done.id, outcome: done.outcome })),
          backlog: backlogOf(finished),
        });
      }
      if (admitted < PER_BAND) admission.shortBands.push({ ecosystem, band, admitted, tried });
      writeJson(join(results, "admission.json"), admission);
    }
  }
}

await main();
