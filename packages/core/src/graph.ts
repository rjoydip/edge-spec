/**
 * A lightweight import graph for JS/TS. Regex, not a parser: enough to select
 * test dependents, honest about being partial. It never invents an edge.
 */

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const RELATIVE = /^\.{1,2}\//;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:[^'"]*?\s+from\s+)["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** Every module specifier in a source file, in first-seen order. */
export function importsOf(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]?.trim();
      if (specifier) found.add(specifier);
    }
  }
  return [...found];
}

function joinPath(fromPath: string, specifier: string): string {
  const base = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
  const parts = `${base}${specifier}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

/** Resolves a relative specifier to an existing repository file. */
export function resolveImport(
  fromPath: string,
  specifier: string,
  present: ReadonlySet<string>,
): string | undefined {
  if (!RELATIVE.test(specifier)) return undefined;
  const target = joinPath(fromPath, specifier);
  if (present.has(target)) return target;
  // A TS ESM import often names `.js` while the repo holds `.ts`.
  if (/\.[cm]?js$/i.test(target)) {
    const stem = target.replace(/\.[cm]?js$/i, "");
    for (const extension of SOURCE_EXTENSIONS) {
      if (present.has(`${stem}${extension}`)) return `${stem}${extension}`;
    }
  }
  for (const extension of SOURCE_EXTENSIONS) {
    if (present.has(`${target}${extension}`)) return `${target}${extension}`;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    if (present.has(`${target}/index${extension}`)) return `${target}/index${extension}`;
  }
  return undefined;
}

export interface ModuleGraph {
  /** Resolved imports per file. */
  imports: Map<string, string[]>;
  /** Files that import each file. */
  dependents: Map<string, string[]>;
}

/** Builds the graph only from files whose source is available. */
export function buildGraph(files: Readonly<Record<string, string>>): ModuleGraph {
  const present = new Set(Object.keys(files));
  const imports = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const [path, source] of Object.entries(files)) {
    const resolved = importsOf(source)
      .map((specifier) => resolveImport(path, specifier, present))
      .filter((target): target is string => Boolean(target));
    imports.set(path, resolved);
    for (const target of resolved) {
      const list = dependents.get(target) ?? [];
      if (!list.includes(path)) list.push(path);
      dependents.set(target, list);
    }
  }
  return { imports, dependents };
}

export interface ImpactedTest {
  test: string;
  /** The dependency chain from the changed file to the test. */
  via: string[];
}

/**
 * Direct and transitive test dependents of the changed files. A sibling test
 * for a changed source is included too, because it is impacted by definition.
 */
export function impactedTests(
  changed: readonly string[],
  graph: ModuleGraph,
  testsBySource: ReadonlyMap<string, string[]> = new Map(),
  maxDepth = 8,
): ImpactedTest[] {
  const selected = new Map<string, string[]>();
  const visited = new Set<string>();
  const queue = changed.map((path) => ({ path, via: [path], depth: 0 }));

  const add = (test: string, via: string[]) => {
    const previous = selected.get(test);
    if (!previous || via.length < previous.length) selected.set(test, via);
  };

  for (const path of changed) {
    if (TEST_FILE.test(path)) add(path, [path]);
    for (const test of testsBySource.get(path) ?? []) add(test, [path, test]);
  }

  while (queue.length > 0 && selected.size < 500) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth || visited.has(current.path)) continue;
    visited.add(current.path);
    if (TEST_FILE.test(current.path)) {
      add(current.path, current.via);
      continue;
    }
    for (const dependent of graph.dependents.get(current.path) ?? []) {
      const via = [...current.via, dependent];
      if (TEST_FILE.test(dependent)) add(dependent, via);
      else queue.push({ path: dependent, via, depth: current.depth + 1 });
    }
  }

  return [...selected.entries()]
    .map(([test, via]) => ({ test, via }))
    .sort((left, right) => left.test.localeCompare(right.test));
}
