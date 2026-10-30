/** Test impact: fetch test files and their import closure, then walk dependents. */
import {
  buildGraph,
  impactedTests,
  importsOf,
  resolveImport,
  type ImpactedTest,
} from "@edge-spec/core/graph";
import type { GitHub } from "@edge-spec/core/github";
import { testFilesFor } from "@edge-spec/core/scanner";

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const MAX_FETCHES = 200;
const MAX_CACHED = 5;

interface CachedGraph {
  files: Record<string, string>;
  partial: boolean;
}

const cache = new Map<string, CachedGraph>();

/** Fetches at most `limit` files, bounded concurrency. */
async function fetchFiles(
  github: GitHub,
  repo: string,
  ref: string,
  paths: readonly string[],
  limit: number,
  present: ReadonlySet<string>,
): Promise<{ files: Record<string, string>; partial: boolean }> {
  const files: Record<string, string> = {};
  const seen = new Set<string>();
  const queue = [...paths];
  let partial = false;
  while (queue.length > 0) {
    if (seen.size >= limit) {
      partial = true;
      break;
    }
    const batch = queue.splice(0, 6).filter((path) => !seen.has(path));
    for (const path of batch) seen.add(path);
    const contents = await Promise.all(
      batch.map(async (path) => {
        try {
          return [path, await github.file(repo, path, ref)] as const;
        } catch {
          return [path, ""] as const;
        }
      }),
    );
    for (const [path, source] of contents) {
      if (!source) {
        partial = true;
        continue;
      }
      files[path] = source;
      for (const specifier of importsOf(source)) {
        const target = resolveImport(path, specifier, present);
        if (target && !seen.has(target)) queue.push(target);
      }
    }
  }
  return { files, partial };
}

/**
 * Builds the graph from test files and their import closure. This is cached
 * per repo@ref in the isolate; a restart only costs one rebuild.
 */
async function loadGraph(
  github: GitHub,
  repo: string,
  ref: string,
  testFiles: readonly string[],
  present: ReadonlySet<string>,
): Promise<CachedGraph> {
  const key = `${repo}@${ref}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const built = await fetchFiles(github, repo, ref, testFiles, MAX_FETCHES, present);
  if (!built.partial) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
    cache.set(key, built);
  }
  return built;
}

export interface ImpactResult {
  tests: ImpactedTest[];
  partial: boolean;
}

/** Direct and transitive test dependents of the changed paths. */
export async function impactForChanges(input: {
  github: GitHub;
  repo: string;
  ref: string;
  blobs: readonly string[];
  changed: readonly string[];
}): Promise<ImpactResult> {
  const present = new Set(input.blobs);
  const testFiles = input.blobs.filter((path) => TEST_FILE.test(path));
  const built = await loadGraph(input.github, input.repo, input.ref, testFiles, present);
  const graph = buildGraph(built.files);
  const testsBySource = new Map<string, string[]>();
  for (const path of input.changed) {
    const tests = testFilesFor(path, present);
    if (tests.length > 0) testsBySource.set(path, tests);
  }
  const selected = impactedTests(input.changed, graph, testsBySource);
  // A sibling test is impacted even when no fetched test imports the source.
  const tests = new Map(selected.map((item) => [item.test, item]));
  for (const [source, siblings] of testsBySource) {
    for (const test of siblings) {
      if (!tests.has(test)) tests.set(test, { test, via: [source, test] });
    }
  }
  return {
    tests: [...tests.values()].sort((left, right) => left.test.localeCompare(right.test)),
    partial: built.partial,
  };
}
