import { capture } from "./process.ts";

export interface Difference {
  member?: string;
  kind: string;
}

export type Comparison =
  | { readable: true; differences: Difference[]; truncated: boolean }
  | { readable: false; error: string };

/** One comparator for the whole corpus: daukle's own, the one migrate's proof uses. */
/** What `daukle compare --as` takes: a migrate proof names one of these for each file it compares. */
export type ComparisonKind = "bytes" | "archive" | "archive-json";

export function compareFiles(daukle: string, old: string, current: string, as: ComparisonKind): Comparison {
  const result = capture(daukle, ["compare", old, current, "--as", as, "--json"], process.cwd());
  if (result.code !== 0 && result.code !== 3) {
    return { readable: false, error: (result.stderr || result.stdout).trim() };
  }
  const parsed = JSON.parse(result.stdout) as { differences: Difference[]; truncated: boolean };
  return { readable: true, differences: parsed.differences, truncated: parsed.truncated };
}

export function memberKey(difference: Difference): string {
  return difference.member ?? "(the whole file)";
}

/** jars, zips and tarballs compare by member; anything else by bytes. */
export function comparisonKindOf(path: string): ComparisonKind {
  return /\.(jar|zip|tgz|tar\.gz|war|aar|apk)$/i.test(path) ? "archive" : "bytes";
}
