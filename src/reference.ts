import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { Shipped } from "./builds.ts";

/** What the project's own build shipped for one pinned commit, kept so later runs never rebuild it. */
export interface Reference {
  jdk?: string;
  shipped: Shipped[];
  unstable: Map<string, Set<string>>;
}

interface StoredReference {
  jdk?: string;
  shipped: { key: string; file: string }[];
  unstable: Record<string, string[]>;
  seconds: Record<string, number>;
}

/**
 * The tools the reference was built with. Bumped in the image whenever a tool in it changes, since a
 * new JDK or package manager can change what the original build ships.
 */
function environment(): string {
  return process.env.CORPUS_REFERENCE_ENV ?? "host";
}

function directoryOf(store: string, id: string, commit: string): string {
  return join(store, environment(), id.replaceAll("/", "_"), commit);
}

export function loadReference(store: string, id: string, commit: string): Reference | null {
  const directory = directoryOf(store, id, commit);
  const manifest = join(directory, "reference.json");
  if (!existsSync(manifest)) return null;
  const stored = JSON.parse(readFileSync(manifest, "utf8")) as StoredReference;
  return {
    jdk: stored.jdk,
    shipped: stored.shipped.map((file) => ({ key: file.key, path: join(directory, "files", file.file) })),
    unstable: new Map(Object.entries(stored.unstable).map(([key, members]) => [key, new Set(members)])),
  };
}

/**
 * Copies what control A shipped into the store and returns the stored copy, which the migrated side
 * is compared against. Written to a temporary directory and renamed, so an interrupted run never
 * leaves a reference that looks complete.
 */
export function saveReference(
  store: string, id: string, commit: string, reference: Reference, seconds: Record<string, number>,
): Reference {
  const directory = directoryOf(store, id, commit);
  const partial = `${directory}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(join(partial, "files"), { recursive: true });
  const shipped = reference.shipped.map((file, index) => {
    const name = `${index}-${basename(file.key)}`;
    copyFileSync(file.path, join(partial, "files", name));
    return { key: file.key, file: name };
  });
  const stored: StoredReference = {
    jdk: reference.jdk,
    shipped,
    unstable: Object.fromEntries([...reference.unstable].map(([key, members]) => [key, [...members]])),
    seconds,
  };
  writeFileSync(join(partial, "reference.json"), `${JSON.stringify(stored, null, 2)}\n`);
  rmSync(directory, { recursive: true, force: true });
  renameSync(partial, directory);
  return loadReference(store, id, commit) as Reference;
}
