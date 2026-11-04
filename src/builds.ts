import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import type { EcosystemName } from "./ecosystems.ts";
import { packageManagerOf } from "./package-manager.ts";
import { run, type Finished, type RunOptions } from "./process.ts";

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
  /** JAVA_HOME and PATH for the JDK this side builds with, or nothing for the default. */
  env?: NodeJS.ProcessEnv;
}

function inSide(side: Side): RunOptions {
  return { cwd: side.dir, log: side.log, timeoutMs: side.timeoutMs, env: side.env };
}

export interface ReferenceBuild {
  build(side: Side): Promise<Finished | string>;
  shipped(side: Side): Shipped[];
  /** Whether the build runs on a JDK the harness chooses, and so may retry on another. */
  onJdk: boolean;
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

/** A library's jars, and what an Android module ships instead: an AAR, or an APK per variant. */
const GRADLE_SHIPPED = /(^|\/)build\/(libs\/[^/]+\.jar|outputs\/aar\/[^/]+\.aar|outputs\/apk\/.+\.apk)$/;

const gradle: ReferenceBuild = {
  async build(side) {
    const wrapper = IS_WINDOWS ? "gradlew.bat" : "gradlew";
    if (!existsSync(join(side.dir, wrapper))) return `the project carries no ${wrapper}`;
    const command = IS_WINDOWS ? join(side.dir, wrapper) : "./gradlew";
    return run(command, ["assemble", "--no-daemon", "--console=plain"], inSide(side));
  },
  shipped: (side) => shippedUnder(side.dir, GRADLE_SHIPPED),
  onJdk: true,
};

const maven: ReferenceBuild = {
  async build(side) {
    const wrapper = IS_WINDOWS ? "mvnw.cmd" : "mvnw";
    const command = existsSync(join(side.dir, wrapper)) ? join(side.dir, wrapper) : "mvn";
    return run(command, ["-B", "-DskipTests", "package"], inSide(side));
  },
  shipped: (side) => shippedUnder(side.dir, /(^|\/)target\/[^/]+\.jar$/),
  onJdk: true,
};

const npm: ReferenceBuild = {
  async build(side) {
    const manager = packageManagerOf(side.dir);
    const installed = await run(manager.name, manager.install, inSide(side));
    if (installed.code !== 0) return installed;
    mkdirSync(side.outside, { recursive: true });
    return run(manager.name, manager.pack(side.outside), inSide(side));
  },
  shipped: (side) =>
    shippedUnder(side.outside, /^[^/]+\.tgz$/).map((file) => ({ key: "package.tgz", path: file.path })),
  onJdk: false,
};

const cmake: ReferenceBuild = {
  async build(side) {
    const tree = join(side.outside, "build");
    const prefix = join(side.outside, "install");
    const configured = await run("cmake", ["-S", ".", "-B", tree, "-DCMAKE_BUILD_TYPE=Release"], inSide(side));
    if (configured.code !== 0) return configured;
    const built = await run("cmake", ["--build", tree, "--config", "Release"], inSide(side));
    if (built.code !== 0) return built;
    return run("cmake", ["--install", tree, "--config", "Release", "--prefix", prefix], inSide(side));
  },
  shipped: (side) => shippedUnder(join(side.outside, "install"), /./),
  onJdk: false,
};

export const REFERENCE_BUILDS: Record<EcosystemName, ReferenceBuild> = { gradle, maven, npm, cmake };
