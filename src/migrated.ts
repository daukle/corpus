import { basename, join } from "node:path";

import type { Shipped } from "./builds.ts";
import type { ComparisonKind } from "./compare.ts";

/** The parts of daukle migrate's --report the harness reads. */
export interface MigrateReport {
  outcome: "migrated" | "blocked" | "unproved" | "undetected" | "error";
  error?: string;
  detected: { plugin: string; dir: string }[];
  blockers: { source: string; construct: string; where: string; why: string; surface: string | null }[];
  proof: { failure?: string; compared: { instance: string; old: string; new: string; as: ComparisonKind; same?: boolean }[] };
}

/** The migrated file answering a shipped one, and the comparison its proof used on it. */
export interface Counterpart {
  path: string;
  as: ComparisonKind;
}

/**
 * What the migrated project built that answers each shipped file of the original, by the file's
 * name, among the files the report says its proof compared. A name two shipped files share cannot
 * be told apart, so neither is matched.
 * @implNote it reads the report alone and names no plugin, so a plugin that starts shipping an
 * artifact is compared without a change here, and as its proof compared it: a plugin that renders a
 * manifest into an archive proves it with "archive-json", which a guess from the extension misses.
 */
export function migratedCounterparts(
  report: MigrateReport, migratedDir: string, reference: Shipped[],
): Map<string, Counterpart> {
  const counterparts = new Map<string, Counterpart>();
  const byName = new Map<string, Counterpart[]>();
  for (const comparison of report.proof.compared) {
    const name = basename(comparison.new);
    byName.set(name, [...(byName.get(name) ?? []), { path: join(migratedDir, comparison.new), as: comparison.as }]);
  }
  const referenceNames = reference.map((file) => basename(file.key));
  for (const file of reference) {
    const name = basename(file.key);
    const candidates = byName.get(name) ?? [];
    const shared = referenceNames.filter((other) => other === name).length > 1;
    if (candidates.length === 1 && !shared) counterparts.set(file.key, candidates[0]);
  }
  return counterparts;
}
