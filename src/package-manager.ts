import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PackageManager {
  name: "npm" | "pnpm" | "yarn";
  install: string[];
  /** The command that packs the root package into a tarball under destination. */
  pack(destination: string): string[];
}

const NPM_CI: PackageManager = {
  name: "npm",
  install: ["ci"],
  pack: (destination) => ["pack", "--pack-destination", destination],
};

const NPM_INSTALL: PackageManager = { ...NPM_CI, install: ["install"] };

const PNPM: PackageManager = {
  name: "pnpm",
  install: ["install", "--frozen-lockfile"],
  pack: (destination) => ["pack", "--pack-destination", destination],
};

const YARN_BERRY: PackageManager = {
  name: "yarn",
  install: ["install", "--immutable"],
  pack: (destination) => ["pack", "--out", join(destination, "package.tgz")],
};

const YARN_CLASSIC: PackageManager = {
  name: "yarn",
  install: ["install", "--frozen-lockfile"],
  pack: (destination) => ["pack", "--filename", join(destination, "package.tgz")],
};

function declaredManager(dir: string): string | undefined {
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { packageManager?: unknown };
  return typeof manifest.packageManager === "string" ? manifest.packageManager : undefined;
}

function yarnOf(declared: string | undefined, dir: string): PackageManager {
  const major = declared?.match(/^yarn@(\d+)/)?.[1];
  if (major !== undefined) return Number(major) >= 2 ? YARN_BERRY : YARN_CLASSIC;
  return existsSync(join(dir, ".yarnrc.yml")) ? YARN_BERRY : YARN_CLASSIC;
}

/**
 * The project's own package manager: its `packageManager` field first, as corepack reads it, then
 * the lockfile it commits. Building a pnpm workspace with npm fails on `workspace:` before anything
 * of the project is tried, which is a fact about the harness, not the project.
 */
export function packageManagerOf(dir: string): PackageManager {
  const declared = declaredManager(dir);
  if (declared?.startsWith("pnpm@") || (declared === undefined && existsSync(join(dir, "pnpm-lock.yaml")))) {
    return PNPM;
  }
  if (declared?.startsWith("yarn@") || (declared === undefined && existsSync(join(dir, "yarn.lock")))) {
    return yarnOf(declared, dir);
  }
  return existsSync(join(dir, "package-lock.json")) ? NPM_CI : NPM_INSTALL;
}
