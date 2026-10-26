/** LCOV parsing. Coverage is a fact from a runner, never a guess. */
import { testFilesFor } from "./scanner";
import type { CoverageDelta, Gap } from "./types";

export interface CoverageFile {
  path: string;
  lines: { covered: number; total: number };
  branches?: { covered: number; total: number };
  /** Lines with a zero hit count, in file order. */
  uncoveredLines: number[];
  /** Lines with at least one branch the suite never took. */
  uncoveredBranches?: number[];
}

export interface CoverageReport {
  lines: { covered: number; total: number };
  branches?: { covered: number; total: number };
  files: CoverageFile[];
}

const normalizePath = (path: string): string => path.trim().replace(/^\.\//, "");

/**
 * Parses the LCOV records a runner returns. An empty or malformed report is
 * `undefined`: the caller must say "not measured" rather than report 0 %.
 */
export function parseLcov(text: string): CoverageReport | undefined {
  const files: CoverageFile[] = [];
  let current:
    | {
        path: string;
        lines: Map<number, number>;
        branches: Map<string, boolean>;
      }
    | undefined;

  const finish = () => {
    if (!current || !current.path) return;
    const lineEntries = [...current.lines.entries()];
    const coveredLines = lineEntries.filter(([, hits]) => hits > 0).length;
    const branches = [...current.branches.values()];
    const coveredBranches = branches.filter(Boolean).length;
    const uncoveredBranches = [
      ...new Set(
        [...current.branches.entries()]
          .filter(([, taken]) => !taken)
          .map(([key]) => Number(key.split(":")[0])),
      ),
    ]
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
    files.push({
      path: normalizePath(current.path),
      lines: { covered: coveredLines, total: lineEntries.length },
      ...(branches.length > 0
        ? { branches: { covered: coveredBranches, total: branches.length } }
        : {}),
      uncoveredLines: lineEntries
        .filter(([, hits]) => hits === 0)
        .map(([line]) => line)
        .sort((a, b) => a - b),
      ...(uncoveredBranches.length > 0 ? { uncoveredBranches } : {}),
    });
    current = undefined;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [tag, ...rest] = line.split(":");
    const value = rest.join(":");
    if (tag === "SF") {
      finish();
      current = { path: value ?? "", lines: new Map(), branches: new Map() };
      continue;
    }
    if (!current) continue;
    if (tag === "DA") {
      const [lineNumber, hits] = (value ?? "").split(",");
      const number = Number(lineNumber);
      const count = Number(hits);
      if (Number.isInteger(number) && Number.isFinite(count)) current.lines.set(number, count);
    } else if (tag === "BRDA") {
      const [lineNumber, block, branch, taken] = (value ?? "").split(",");
      if (lineNumber === undefined || block === undefined || branch === undefined) continue;
      current.branches.set(`${lineNumber}:${block}:${branch}`, taken !== "-" && Number(taken) > 0);
    } else if (tag === "end_of_record") {
      finish();
    }
  }
  finish();

  if (files.length === 0) return undefined;
  const total = files.reduce((sum, file) => sum + file.lines.total, 0);
  const covered = files.reduce((sum, file) => sum + file.lines.covered, 0);
  const branchTotal = files.reduce((sum, file) => sum + (file.branches?.total ?? 0), 0);
  const branchCovered = files.reduce((sum, file) => sum + (file.branches?.covered ?? 0), 0);
  return {
    lines: { covered, total },
    ...(branchTotal > 0 ? { branches: { covered: branchCovered, total: branchTotal } } : {}),
    files,
  };
}

/** The report record for one repository path, absolute or relative. */
function fileCoverage(report: CoverageReport | undefined, path: string): CoverageFile | undefined {
  const target = normalizePath(path).replace(/^\/+/, "");
  return report?.files.find((file) => {
    const candidate = normalizePath(file.path).replace(/^\/+/, "");
    return candidate === target || candidate.endsWith(`/${target}`);
  });
}

/**
 * The per-file change between two executed reports. A delta exists only when
 * both reports measured the file; missing data is "not measured", never zero.
 */
export function coverageDelta(
  before: CoverageReport | undefined,
  after: CoverageReport | undefined,
  path: string,
): CoverageDelta {
  const first = fileCoverage(before, path);
  const second = fileCoverage(after, path);
  if (!first || !second) return { status: "not-measured" };

  const branches =
    first.branches && second.branches
      ? {
          before: first.branches.covered,
          after: second.branches.covered,
          delta: second.branches.covered - first.branches.covered,
          total: second.branches.total,
        }
      : undefined;

  return {
    status: "measured",
    path: normalizePath(path).replace(/^\/+/, ""),
    lines: {
      before: first.lines.covered,
      after: second.lines.covered,
      delta: second.lines.covered - first.lines.covered,
      total: second.lines.total,
    },
    ...(branches ? { branches } : {}),
  };
}

/** The gaps a prompt should target, read from a measured report. */
export interface CoverageTarget {
  path: string;
  uncoveredLines: number[];
  /** Lines with at least one branch the suite never took. */
  uncoveredBranches: number[];
}

/** The uncovered facts for one source file, or `undefined` when none exist. */
export function coverageTargetFor(
  report: CoverageReport | undefined,
  path: string,
): CoverageTarget | undefined {
  const file = fileCoverage(report, path);
  if (!file) return undefined;
  const uncoveredBranches = file.uncoveredBranches ?? [];
  if (file.uncoveredLines.length === 0 && uncoveredBranches.length === 0) return undefined;
  return {
    path: normalizePath(path).replace(/^\/+/, ""),
    uncoveredLines: file.uncoveredLines,
    uncoveredBranches,
  };
}

/** A bounded range list for a prompt or a reason. */
export function lineRanges(lines: readonly number[], max = 5): string {
  return rangesOf(lines, max);
}

/** `[12,13,14,31]` -> `"12-14, 31"`, capped so a reason stays readable. */
function rangesOf(lines: readonly number[], max = 20): string {
  const sorted = [...lines].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  const flush = () => {
    if (start === undefined) return;
    parts.push(previous === start ? `${start}` : `${start}-${previous}`);
    start = undefined;
  };
  for (const line of sorted) {
    if (start === undefined) start = line;
    else if (previous !== undefined && line !== previous + 1) {
      flush();
      start = line;
    }
    previous = line;
    if (parts.length >= max) break;
  }
  flush();
  const text = parts.slice(0, max).join(", ");
  return sorted.length > 0 && text ? text : "none";
}

/**
 * The coverage category: source files whose tests exist but whose lines or
 * branches fall short of the target. A file with no test stays `missing`.
 * Only facts from a real report are used.
 */
export function coverageGaps(
  paths: readonly string[],
  report: CoverageReport,
  target: number,
  testsBySource?: Map<string, string[]>,
): Gap[] {
  const present = new Set(paths);
  const gaps: Gap[] = [];
  const normalizedTarget = Math.min(100, Math.max(0, target));

  for (const file of report.files) {
    const path = normalizePath(file.path).replace(/^\/+/, "");
    if (!present.has(path)) continue;
    const tests = testsBySource?.get(path) ?? testFilesFor(path, present);
    if (tests.length === 0) continue;

    const lineRate = file.lines.total > 0 ? (file.lines.covered / file.lines.total) * 100 : 100;
    const branchRate =
      file.branches && file.branches.total > 0
        ? (file.branches.covered / file.branches.total) * 100
        : undefined;
    const below =
      lineRate < normalizedTarget ||
      (branchRate !== undefined && branchRate < normalizedTarget) ||
      file.uncoveredLines.length > 0;
    if (!below) continue;

    const facts = [
      file.uncoveredLines.length > 0
        ? `uncovered lines ${rangesOf(file.uncoveredLines)}`
        : undefined,
      `line rate ${Math.round(lineRate)}% vs target ${normalizedTarget}%`,
      branchRate !== undefined
        ? `branch rate ${Math.round(branchRate)}% vs target ${normalizedTarget}%`
        : undefined,
    ].filter(Boolean);

    gaps.push({
      path,
      testPath: tests[0] as string,
      risk: "medium",
      exports: [],
      reason: `${facts.join("; ")}. Extend ${tests.join(", ")}.`,
      kind: "coverage",
      evidence: {
        testFiles: tests,
        lineRate: Math.round(lineRate * 10) / 10,
        ...(branchRate !== undefined ? { branchRate: Math.round(branchRate * 10) / 10 } : {}),
        uncoveredLines: file.uncoveredLines.slice(0, 200),
        ...(file.uncoveredBranches?.length
          ? { uncoveredBranches: file.uncoveredBranches.slice(0, 200) }
          : {}),
      },
    });
  }

  return gaps.sort(
    (a, b) =>
      (a.evidence?.lineRate ?? 100) - (b.evidence?.lineRate ?? 100) || a.path.localeCompare(b.path),
  );
}
