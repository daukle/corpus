import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { Settings } from "./entry.ts";

const DEFAULT_CATALOG = "https://raw.githubusercontent.com/daukle/manifest/main/plugins.json";
const DEFAULT_TIMEOUT_MINUTES = 60;

export interface Invocation {
  settings: Settings;
  /** Where every result, log and summary is written as soon as it exists. */
  results: string;
  corpus: string;
  only: string[] | undefined;
  /** An earlier admission.json whose rejections stand without being run again. */
  resume: string | undefined;
}

const USAGE = "usage: node src/<command>.ts --daukle <binary> --work <directory> [--results <directory>] "
  + "[--catalog <url>] [--corpus <file>] [--only <id>]... [--timeout-minutes <n>] "
  + "[--references <directory>] [--daukle-cache <directory>] [--resume <admission.json>]";

export function invocationFrom(argv: string[], defaultCorpus: string): Invocation {
  const { values } = parseArgs({
    args: argv,
    options: {
      daukle: { type: "string" },
      work: { type: "string" },
      results: { type: "string", default: "results" },
      catalog: { type: "string", default: DEFAULT_CATALOG },
      corpus: { type: "string", default: defaultCorpus },
      only: { type: "string", multiple: true },
      "timeout-minutes": { type: "string", default: String(DEFAULT_TIMEOUT_MINUTES) },
      references: { type: "string" },
      "daukle-cache": { type: "string" },
      resume: { type: "string" },
    },
  });
  if (values.daukle === undefined || values.work === undefined) throw new Error(USAGE);
  const work = resolve(values.work);
  return {
    settings: {
      daukle: resolve(values.daukle),
      catalog: values.catalog,
      work,
      daukleCache: resolve(values["daukle-cache"] ?? join(work, "daukle-cache")),
      references: resolve(values.references ?? join(work, "references")),
      timeoutMs: Number(values["timeout-minutes"]) * 60_000,
    },
    results: resolve(values.results),
    corpus: values.corpus,
    only: values.only,
    resume: values.resume,
  };
}
