import type { EntryResult } from "./entry.ts";

export interface BacklogRow {
  row: string;
  entries: string[];
  examples: string[];
}

/**
 * Blockers ranked by how many entries they stop: what migration work to do next. Grouped by the
 * surface row a blocker names, since a construct is per instance (`scripts."lint"`, one nested
 * package.json) and would never add up across projects; a blocker with no row groups by construct.
 */
export function backlogOf(results: EntryResult[]): BacklogRow[] {
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
