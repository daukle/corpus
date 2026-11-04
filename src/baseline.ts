import type { EntryResult, Outcome } from "./entry.ts";

/** What one entry's last accepted run reached, for one pinned commit. */
export interface BaselineEntry {
  commit: string;
  outcome: Outcome;
  blockers: string[];
}

export type Baseline = Record<string, BaselineEntry>;

export interface Regression {
  id: string;
  was: Outcome;
  now: Outcome;
  gainedBlockers: string[];
}

/** Lower is better. `no-migrator` sits below `blocked`, because a migrator appearing turns one into the other. */
const OUTCOME_RANK: Record<Outcome, number> = {
  "same": 0,
  "proof-only": 1,
  "proof-failed": 2,
  "blocked": 3,
  "no-migrator": 4,
  "error": 5,
  "unreproducible": 6,
  "not-admitted": 7,
};

function blockerConstructs(result: EntryResult): string[] {
  return [...new Set(result.blockers.map((blocker) => blocker.construct))].sort();
}

function entryOf(result: EntryResult): BaselineEntry {
  return { commit: result.commit, outcome: result.outcome, blockers: blockerConstructs(result) };
}

/**
 * Each result against the baseline row for the same commit. A row for another commit is a pin
 * change, which resets that entry, so it is compared against nothing.
 */
export function regressionsAgainst(baseline: Baseline, results: EntryResult[]): Regression[] {
  const regressions: Regression[] = [];
  for (const result of results) {
    const before = baseline[result.id];
    if (before === undefined || before.commit !== result.commit) continue;
    const known = new Set(before.blockers);
    const gainedBlockers = blockerConstructs(result).filter((construct) => !known.has(construct));
    if (OUTCOME_RANK[result.outcome] > OUTCOME_RANK[before.outcome] || gainedBlockers.length > 0) {
      regressions.push({ id: result.id, was: before.outcome, now: result.outcome, gainedBlockers });
    }
  }
  return regressions;
}

/** The baseline with this run's results laid over it; entries this run did not reach keep their row. */
export function nextBaseline(baseline: Baseline, results: EntryResult[]): Baseline {
  const next: Baseline = { ...baseline };
  for (const result of results) next[result.id] = entryOf(result);
  return Object.fromEntries(Object.keys(next).sort().map((id) => [id, next[id]]));
}
