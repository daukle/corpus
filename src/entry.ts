import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { REFERENCE_BUILDS, type ReferenceBuild, type Shipped, type Side } from "./builds.ts";
import { compareFiles, comparisonKindOf, memberKey } from "./compare.ts";
import type { EcosystemName } from "./ecosystems.ts";
import { availableJdks, failedOnJdk } from "./jdk.ts";
import { migratedCounterparts, type MigrateReport } from "./migrated.ts";
import { capture, run, stopJvmsUnder, type Finished } from "./process.ts";
import { loadReference, saveReference, type Reference } from "./reference.ts";

export interface Entry {
  id: string;
  ecosystem: EcosystemName;
  url: string;
  commit: string;
}

export interface Settings {
  daukle: string;
  catalog: string;
  work: string;
  daukleCache: string;
  timeoutMs: number;
  /** Where each entry's reference is kept between runs. */
  references: string;
}

export type Outcome =
  | "same" | "proof-only" | "proof-failed" | "blocked" | "no-migrator" | "error"
  | "unreproducible" | "not-admitted";

export interface ShippedResult {
  key: string;
  unstable: number;
  /** The first few members that differed between the two original builds. */
  unstableSample: string[];
  counterpart: string | null;
  differing: string[];
}

export interface EntryResult {
  id: string;
  ecosystem: EcosystemName;
  url: string;
  commit: string;
  outcome: Outcome;
  reason?: string;
  seconds: Record<string, number>;
  shipped: ShippedResult[];
  blockers: MigrateReport["blockers"];
  proofFailure?: string;
  /** The JDK the original build ran on, when the harness chose one. */
  jdk?: string;  /** Whether the original build came from the store rather than from this run. */
  referenceReused?: boolean;
}

/**
 * Whether the project's own build succeeded twice, which alone decides admission: an entry whose
 * migration then errors is a finding about daukle, and dropping it would hide exactly that.
 */
export function isAdmitted(result: EntryResult): boolean {
  return result.outcome === "unreproducible" || result.shipped.length > 0;
}

/** Three checkouts at three different paths, so whatever a build writes from its own path differs between the controls. */
const SIDES = { controlA: "a", controlB: "control-b", migrated: "m" } as const;

function failed(entry: Entry, outcome: Outcome, reason: string, seconds: Record<string, number>): EntryResult {
  return { ...pick(entry), outcome, reason, seconds, shipped: [], blockers: [] };
}

function pick(entry: Entry): Pick<EntryResult, "id" | "ecosystem" | "url" | "commit"> {
  return { id: entry.id, ecosystem: entry.ecosystem, url: entry.url, commit: entry.commit };
}

function git(args: string[], cwd: string): void {
  const result = capture("git", ["-c", "core.autocrlf=false", ...args], cwd);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
}

/**
 * One clone from the network, then a local clone per side, each with the tags version plugins read.
 * @implNote blobless first; GitHub has answered a blobless checkout's blob fetch with HTTP 400 on a
 * large repository, so a failure falls back to a full clone.
 */
function checkout(entry: Entry, entryWork: string, sides: string[]): void {
  const source = join(entryWork, "source");
  try {
    git(["clone", "--filter=blob:none", "--no-checkout", entry.url, source], entryWork);
    git(["checkout", "--detach", entry.commit], source);
  } catch {
    rmSync(source, { recursive: true, force: true });
    git(["clone", "--no-checkout", entry.url, source], entryWork);
    git(["checkout", "--detach", entry.commit], source);
  }
  for (const name of sides) {
    const side = join(entryWork, name);
    git(["clone", "--no-checkout", source, name], entryWork);
    git(["checkout", "--detach", entry.commit], side);
    if (existsSync(join(side, ".gitmodules"))) fetchSubmodules(entry, side);
  }
}

/**
 * @implNote origin is pointed back at the project first: a side is cloned from the local source, so
 * a relative submodule url such as `../dep.git` would otherwise resolve next to that directory. An
 * ssh url is fetched over https, since the image holds no key.
 */
function fetchSubmodules(entry: Entry, side: string): void {
  git(["remote", "set-url", "origin", entry.url], side);
  git(["-c", "url.https://github.com/.insteadOf=git@github.com:",
    "submodule", "update", "--init", "--recursive", "--depth", "1"], side);
}

function sideOf(entryWork: string, name: string, settings: Settings): Side {
  return {
    dir: join(entryWork, name),
    outside: join(entryWork, `${name}-out`),
    log: join(entryWork, `${name}.log`),
    timeoutMs: settings.timeoutMs,
  };
}

function describeFailure(finished: Finished | string, log: string): string {
  if (typeof finished === "string") return finished;
  if (finished.timedOut) return `timed out after ${finished.seconds} s; see ${log}`;
  return `exited ${finished.code}; see ${log}`;
}

/** Members that differ between the two controls, by shipped key; null when the two cannot be paired. */
function unstableMembers(settings: Settings, a: Shipped[], b: Shipped[]): Map<string, Set<string>> | string {
  const unstable = new Map<string, Set<string>>();
  const bByKey = new Map(b.map((file) => [file.key, file.path]));
  for (const file of a) {
    const other = bByKey.get(file.key);
    if (other === undefined) return `the second control build did not ship ${file.key}`;
    const comparison = compareFiles(settings.daukle, file.path, other, comparisonKindOf(file.key));
    if (!comparison.readable) return `${file.key}: ${comparison.error}`;
    unstable.set(file.key, new Set(comparison.differences.map(memberKey)));
  }
  return unstable;
}

const UNSTABLE_SAMPLE = 10;

function sampleOf(members: Set<string>): string[] {
  return [...members].slice(0, UNSTABLE_SAMPLE);
}

function compareShipped(
  settings: Settings, reference: Shipped[], counterparts: Map<string, string>, unstable: Map<string, Set<string>>,
): ShippedResult[] {
  return reference.map((file) => {
    const counterpart = counterparts.get(file.key) ?? null;
    const ignored = unstable.get(file.key) ?? new Set<string>();
    const result: ShippedResult = {
      key: file.key, unstable: ignored.size, unstableSample: sampleOf(ignored), counterpart, differing: [],
    };
    if (counterpart === null) return result;
    const comparison = compareFiles(settings.daukle, file.path, counterpart, comparisonKindOf(file.key));
    result.differing = comparison.readable
      ? comparison.differences.map(memberKey).filter((member) => !ignored.has(member))
      : [comparison.error];
    return result;
  });
}

const REPORT_OUTCOMES: Record<MigrateReport["outcome"], Outcome> = {
  migrated: "same",
  blocked: "blocked",
  unproved: "proof-failed",
  undetected: "no-migrator",
  error: "error",
};

async function migrate(entry: Entry, entryWork: string, settings: Settings, seconds: Record<string, number>):
    Promise<{ report: MigrateReport } | { failure: string }> {
  const side = sideOf(entryWork, SIDES.migrated, settings);
  const reportPath = join(entryWork, "report.json");
  // --resolve, as a user migrates a project whose dependencies have to be pinned (D-229).
  const finished = await run(settings.daukle, ["migrate", "--resolve", "--catalog", settings.catalog,
    "--report", reportPath], {
    cwd: side.dir, log: side.log, timeoutMs: side.timeoutMs,
    env: { ...process.env, DAUKLE_CACHE_DIR: settings.daukleCache },
  });
  seconds.migrate = finished.seconds;
  stopJvmsUnder(settings.daukleCache);
  if (finished.timedOut) return { failure: `daukle migrate timed out after ${finished.seconds} s` };
  if (!existsSync(reportPath)) return { failure: `daukle migrate exited ${finished.code} and wrote no report` };
  const text = readFileSync(reportPath, "utf8");
  if (text === "") return { failure: `daukle migrate exited ${finished.code} and left its report empty` };
  return { report: JSON.parse(text) as MigrateReport };
}

function withJdk(side: Side, home: string): Side {
  return { ...side, env: { ...process.env, JAVA_HOME: home, PATH: `${home}/bin:${process.env.PATH ?? ""}` } };
}

async function timedBuild(builder: ReferenceBuild, side: Side, seconds: Record<string, number>, name: string) {
  const started = Date.now();
  const finished = await builder.build(side);
  seconds[name] = (seconds[name] ?? 0) + Math.round((Date.now() - started) / 1000);
  return finished;
}

/**
 * Builds control A on each JDK the image offers until one succeeds, moving on only when the failure
 * names the Java version, then control B on the JDK that worked. A string is why it was not admitted.
 */
async function buildControls(builder: ReferenceBuild, a: Side, b: Side, seconds: Record<string, number>):
    Promise<{ jdk?: string } | string> {
  const jdks = builder.onJdk ? availableJdks() : [];
  const tries = jdks.length > 0 ? jdks : [undefined];
  let chosen: { version: string; home: string } | undefined;
  for (const [index, jdk] of tries.entries()) {
    if (index > 0) git(["clean", "-fdxq"], a.dir);
    const side = jdk === undefined ? a : withJdk(a, jdk.home);
    const finished = await timedBuild(builder, side, seconds, "controlA");
    if (typeof finished !== "string" && finished.code === 0) {
      chosen = jdk;
      break;
    }
    const last = index === tries.length - 1;
    if (typeof finished === "string" || finished.timedOut || last || !failedOnJdk(a.log)) {
      return `the original build ${describeFailure(finished, a.log)}`;
    }
  }
  const finished = await timedBuild(builder, chosen === undefined ? b : withJdk(b, chosen.home), seconds, "controlB");
  if (typeof finished === "string" || finished.code !== 0) return `the original build ${describeFailure(finished, b.log)}`;
  return chosen === undefined ? {} : { jdk: chosen.version };
}

export function entryWorkOf(id: string, settings: Settings): string {
  return join(settings.work, id.replaceAll("/", "_"));
}

/**
 * The stored reference for this commit, or a fresh one from two builds of the project's own tool,
 * stored before it is returned. A string is why the entry was not admitted.
 */
async function referenceOf(entry: Entry, entryWork: string, settings: Settings, seconds: Record<string, number>):
    Promise<Reference | { outcome: Outcome; reason: string }> {
  const builder = REFERENCE_BUILDS[entry.ecosystem];
  const a = sideOf(entryWork, SIDES.controlA, settings);
  const b = sideOf(entryWork, SIDES.controlB, settings);
  const controls = await buildControls(builder, a, b, seconds);
  if (typeof controls === "string") return { outcome: "not-admitted", reason: controls };
  const shipped = builder.shipped(a);
  if (shipped.length === 0) {
    return { outcome: "not-admitted", reason: "the original build shipped nothing the corpus recognises" };
  }
  const unstable = unstableMembers(settings, shipped, builder.shipped(b));
  if (typeof unstable === "string") return { outcome: "unreproducible", reason: unstable };
  return saveReference(settings.references, entry.id, entry.commit, { jdk: controls.jdk, shipped, unstable }, seconds);
}

export async function runEntry(entry: Entry, settings: Settings): Promise<EntryResult> {
  const entryWork = entryWorkOf(entry.id, settings);
  rmSync(entryWork, { recursive: true, force: true });
  mkdirSync(entryWork, { recursive: true });
  const seconds: Record<string, number> = {};
  const stored = loadReference(settings.references, entry.id, entry.commit);
  try {
    checkout(entry, entryWork, stored === null ? Object.values(SIDES) : [SIDES.migrated]);
  } catch (error) {
    return failed(entry, "error", (error as Error).message, seconds);
  }
  const built = stored ?? await referenceOf(entry, entryWork, settings, seconds);
  if ("outcome" in built) return failed(entry, built.outcome, built.reason, seconds);
  const { shipped: reference, unstable } = built;

  const unmatched: ShippedResult[] = reference.map((file) => ({
    key: file.key, unstable: unstable.get(file.key)?.size ?? 0,
    unstableSample: sampleOf(unstable.get(file.key) ?? new Set<string>()), counterpart: null, differing: [],
  }));
  const migrated = await migrate(entry, entryWork, settings, seconds);
  if ("failure" in migrated) return { ...failed(entry, "error", migrated.failure, seconds), shipped: unmatched };
  const { report } = migrated;
  const result: EntryResult = {
    ...pick(entry), outcome: REPORT_OUTCOMES[report.outcome], seconds, blockers: report.blockers,
    referenceReused: stored !== null, shipped: unmatched,
  };
  if (built.jdk !== undefined) result.jdk = built.jdk;
  if (report.error !== undefined) result.reason = report.error;
  if (report.proof.failure !== undefined) result.proofFailure = report.proof.failure;
  if (report.outcome !== "migrated") return result;

  const counterparts = migratedCounterparts(entry.ecosystem, report, join(entryWork, SIDES.migrated), reference);
  result.shipped = compareShipped(settings, reference, counterparts, unstable);
  const covered = result.shipped.every((file) => file.counterpart !== null && file.differing.length === 0);
  if (!covered) result.outcome = "proof-only";
  return result;
}
