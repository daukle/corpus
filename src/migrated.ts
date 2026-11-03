import { basename, join } from "node:path";

import type { Shipped } from "./builds.ts";
import type { EcosystemName } from "./ecosystems.ts";

/** The parts of daukle migrate's --report the harness reads. */
export interface MigrateReport {
  outcome: "migrated" | "blocked" | "unproved" | "undetected" | "error";
  error?: string;
  detected: { plugin: string; dir: string }[];
  blockers: { source: string; construct: string; where: string; why: string; surface: string | null }[];
  proof: { failure?: string; compared: { instance: string; old: string; new: string; as: string; same?: boolean }[] };
}

/**
 * What the migrated project built that answers each shipped file of the original, by the file's
 * name. A name two shipped files share cannot be told apart, so neither is matched.
 * @implNote only daukle/gradle builds a shipped artifact today: its proof task makes every jar and
 * the report names where. daukle/node has no task that packs a tarball, so npm matches nothing.
 */
export function migratedCounterparts(
  ecosystem: EcosystemName, report: MigrateReport, migratedDir: string, reference: Shipped[],
): Map<string, string> {
  const counterparts = new Map<string, string>();
  if (ecosystem !== "gradle") return counterparts;
  const byName = new Map<string, string[]>();
  for (const comparison of report.proof.compared) {
    const name = basename(comparison.new);
    byName.set(name, [...(byName.get(name) ?? []), join(migratedDir, comparison.new)]);
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
