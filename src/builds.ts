import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import type { EcosystemName } from "./ecosystems.ts";
import { run, type Finished } from "./process.ts";

/** One file the original build ships, under a key both sides of a comparison agree on. */
export interface Shipped {
  key: string;
  path: string;
}

export interface Side {
  /** The project's checkout. */
  dir: string;
  /** A directory outside the checkout for whatever the build writes elsewhere, such as a packed tarball. */
  outside: string;
  log: string;
  timeoutMs: number;
}

export interface ReferenceBuild {
  build(side: Side): Promise<Finished | string>;
  shipped(side: Side): Shipped[];
}

const IS_WINDOWS = process.platform === "win32";
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".gradle"]);

function walk(root: string, accept: (relativePath: string) => boolean): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(path);
      } else if (accept(relative(root, path).replaceAll("\\", "/"))) {
        found.push(path);
      }
    }
  };
  visit(root);
  return found.sort();
}

function shippedUnder(root: string, pattern: RegExp): Shipped[] {
  if (!existsSync(root)) return [];
  return walk(root, (path) => pattern.test(path)).map((path) => ({
    key: relative(root, path).replaceAll("\\", "/"),
    path,
  }));
}

const gradle: ReferenceBuild = {
  async build(side) {
    const wrapper = IS_WINDOWS ? "gradlew.bat" : "gradlew";
    if (!existsSync(join(side.dir, wrapper))) return `the project carries no ${wrapper}`;
    const command = IS_WINDOWS ? join(side.dir, wrapper) : "./gradlew";
    return run(command, ["assemble", "--no-daemon", "--console=plain"], side);
  },
  shipped: (side) => shippedUnder(side.dir, /(^|\/)build\/libs\/[^/]+\.jar$/),
};

const maven: ReferenceBuild = {
  async build(side) {
    const wrapper = IS_WINDOWS ? "mvnw.cmd" : "mvnw";
    const command = existsSync(join(side.dir, wrapper)) ? join(side.dir, wrapper) : "mvn";
    return run(command, ["-B", "-DskipTests", "package"], side);
  },
  shipped: (side) => shippedUnder(side.dir, /(^|\/)target\/[^/]+\.jar$/),
};

const npm: ReferenceBuild = {
  async build(side) {
    const install = existsSync(join(side.dir, "package-lock.json")) ? "ci" : "install";
    const installed = await run("npm", [install], side);
    if (installed.code !== 0) return installed;
    mkdirSync(side.outside, { recursive: true });
    return run("npm", ["pack", "--pack-destination", side.outside], side);
  },
  shipped: (side) =>
    shippedUnder(side.outside, /^[^/]+\.tgz$/).map((file) => ({ key: "package.tgz", path: file.path })),
};

const cmake: ReferenceBuild = {
  async build(side) {
    const tree = join(side.outside, "build");
    const prefix = join(side.outside, "install");
    const configured = await run("cmake", ["-S", ".", "-B", tree, "-DCMAKE_BUILD_TYPE=Release"], side);
    if (configured.code !== 0) return configured;
    const built = await run("cmake", ["--build", tree, "--config", "Release"], side);
    if (built.code !== 0) return built;
    return run("cmake", ["--install", tree, "--config", "Release", "--prefix", prefix], side);
  },
  shipped: (side) => shippedUnder(join(side.outside, "install"), /./),
};

export const REFERENCE_BUILDS: Record<EcosystemName, ReferenceBuild> = { gradle, maven, npm, cmake };
