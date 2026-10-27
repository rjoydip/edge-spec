/** Drift between two scans: new untested files and changed contract operations. */
export interface DriftSnapshot {
  /** Sorted source paths with no test. */
  missing: string[];
  /** Sorted `METHOD /path` names from every parsed OpenAPI spec. */
  operations: string[];
}

export interface Drift {
  newFiles: string[];
  closedFiles: string[];
  apiAdded: string[];
  apiRemoved: string[];
  changed: boolean;
}

const uniqueSorted = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();

export function snapshotOf(input: {
  missing: readonly string[];
  operations: readonly string[];
}): DriftSnapshot {
  return {
    missing: uniqueSorted(input.missing),
    operations: uniqueSorted(input.operations),
  };
}

const difference = (left: readonly string[], right: readonly string[]): string[] => {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
};

/** A first scan is a baseline, not drift: there is nothing to compare to. */
export function detectDrift(previous: DriftSnapshot | undefined, current: DriftSnapshot): Drift {
  if (!previous) {
    return { newFiles: [], closedFiles: [], apiAdded: [], apiRemoved: [], changed: false };
  }
  const newFiles = difference(current.missing, previous.missing);
  const closedFiles = difference(previous.missing, current.missing);
  const apiAdded = difference(current.operations, previous.operations);
  const apiRemoved = difference(previous.operations, current.operations);
  return {
    newFiles,
    closedFiles,
    apiAdded,
    apiRemoved,
    changed:
      newFiles.length > 0 || closedFiles.length > 0 || apiAdded.length > 0 || apiRemoved.length > 0,
  };
}

const MAX_LINES = 20;

function list(label: string, values: readonly string[]): string[] {
  if (values.length === 0) return [];
  return [
    `- ${label}: ${values.length}`,
    ...values.slice(0, MAX_LINES).map((value) => `  - \`${value}\``),
    ...(values.length > MAX_LINES ? [`  - …and ${values.length - MAX_LINES} more`] : []),
  ];
}

/** One actionable summary for a webhook or Slack incoming webhook. */
export function driftSummary(repo: string, drift: Drift): string {
  return [
    `## EdgeSpec drift · ${repo}`,
    "",
    ...(list("New untested files", drift.newFiles) ?? []),
    ...(list("Closed (now tested)", drift.closedFiles) ?? []),
    ...(list("New contract operations", drift.apiAdded) ?? []),
    ...(list("Removed contract operations", drift.apiRemoved) ?? []),
    "",
    "No pull request was opened. Review the new files, or run a scan from the dashboard.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
