import { writeFile } from "node:fs/promises";

import { ECOSYSTEMS, type Ecosystem, type EcosystemName } from "./ecosystems.ts";
import { getJson } from "./github.ts";

const SEARCHED_PER_LANGUAGE = 100;
const BANDS = ["small", "medium", "large"] as const;
const PER_BAND = 4;

type Band = (typeof BANDS)[number];

interface SearchResult {
  items: { full_name: string; stargazers_count: number; size: number; default_branch: string; html_url: string }[];
}

export interface Candidate {
  id: string;
  ecosystem: EcosystemName;
  url: string;
  stars: number;
  sizeKb: number;
  band: Band;
  /** The latest release's tag, or null when the pin is the default branch's head. */
  tag: string | null;
  commit: string;
}

async function searchLanguage(language: string): Promise<SearchResult["items"]> {
  const query = encodeURIComponent(`language:${language} fork:false archived:false`);
  const result = await getJson<SearchResult>(
    `/search/repositories?q=${query}&sort=stars&order=desc&per_page=${SEARCHED_PER_LANGUAGE}`,
  );
  return result?.items ?? [];
}

async function hasRootFile(fullName: string, branch: string, files: string[]): Promise<boolean> {
  for (const file of files) {
    const found = await getJson<unknown>(`/repos/${fullName}/contents/${file}?ref=${encodeURIComponent(branch)}`);
    if (found !== null) return true;
  }
  return false;
}

async function pinOf(fullName: string, branch: string): Promise<{ tag: string | null; commit: string }> {
  const release = await getJson<{ tag_name: string }>(`/repos/${fullName}/releases/latest`);
  const ref = release?.tag_name ?? branch;
  const commit = await getJson<{ sha: string }>(`/repos/${fullName}/commits/${encodeURIComponent(ref)}`);
  if (commit === null) throw new Error(`${fullName}: "${ref}" names no commit`);
  return { tag: release?.tag_name ?? null, commit: commit.sha };
}

/** Terciles of the pool by size, so the bands hold equal shares of what was found. */
function bandOf(sizeKb: number, sortedSizes: number[]): Band {
  const rank = sortedSizes.indexOf(sizeKb) / sortedSizes.length;
  if (rank < 1 / 3) return "small";
  if (rank < 2 / 3) return "medium";
  return "large";
}

async function poolOf(ecosystem: Ecosystem): Promise<SearchResult["items"]> {
  const seen = new Map<string, SearchResult["items"][number]>();
  for (const language of ecosystem.languages) {
    for (const item of await searchLanguage(language)) {
      if (seen.has(item.full_name)) continue;
      if (await hasRootFile(item.full_name, item.default_branch, ecosystem.rootFiles)) {
        seen.set(item.full_name, item);
      }
    }
  }
  return [...seen.values()];
}

async function candidatesOf(ecosystem: Ecosystem): Promise<Candidate[]> {
  const pool = await poolOf(ecosystem);
  const sortedSizes = pool.map((item) => item.size).sort((left, right) => left - right);
  const banded = pool
    .map((item) => ({ item, band: bandOf(item.size, sortedSizes) }))
    .sort((left, right) => right.item.stargazers_count - left.item.stargazers_count);
  const candidates: Candidate[] = [];
  for (const { item, band } of banded) {
    const pin = await pinOf(item.full_name, item.default_branch);
    candidates.push({
      id: `${ecosystem.name}/${item.full_name.replace("/", "-").toLowerCase()}`,
      ecosystem: ecosystem.name,
      url: item.html_url,
      stars: item.stargazers_count,
      sizeKb: item.size,
      band,
      ...pin,
    });
  }
  return candidates;
}

/** The first PER_BAND of each band, in star order: the corpus before admission replaces any. */
function firstOfEachBand(candidates: Candidate[]): Candidate[] {
  return BANDS.flatMap((band) => candidates.filter((candidate) => candidate.band === band).slice(0, PER_BAND));
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const ecosystems = only === undefined ? ECOSYSTEMS : ECOSYSTEMS.filter((ecosystem) => ecosystem.name === only);
  const all: Candidate[] = [];
  for (const ecosystem of ecosystems) {
    const candidates = await candidatesOf(ecosystem);
    console.log(`${ecosystem.name}: ${candidates.length} in the pool`);
    all.push(...candidates);
  }
  await writeFile("candidates.json", `${JSON.stringify(all, null, 2)}\n`);
  const chosen = ECOSYSTEMS.flatMap((ecosystem) => firstOfEachBand(all.filter((c) => c.ecosystem === ecosystem.name)));
  await writeFile("corpus.json", `${JSON.stringify(chosen, null, 2)}\n`);
  console.log(`corpus.json: ${chosen.length} entries`);
}

await main();
