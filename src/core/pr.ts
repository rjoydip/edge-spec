/** The pull request payload: which test files a branch should carry. */

/** One test file in the pull request. */
export interface PullFile {
  /** Path of the test file in the repository. */
  path: string;
  code: string;
  /** The source file the test covers. */
  sourcePath: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Accepts either a batch (`files`) or one test (`sourcePath`, `testPath`,
 * `code`). A batch becomes a single pull request, so every test lands on the
 * same branch and in the same commit.
 */
export function pullFilesOf(body: Record<string, unknown>): PullFile[] {
  const raw = Array.isArray(body.files) ? body.files : [];
  const files: PullFile[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const path = text(item.path);
    const code = text(item.code);
    if (!path || !code) continue;
    const sourcePath = text(item.sourcePath);
    files.push({ path, code, sourcePath: sourcePath || path });
  }
  if (files.length > 0) return files;

  const sourcePath = text(body.sourcePath);
  const testPath = text(body.testPath);
  const code = text(body.code);
  if (sourcePath && testPath && code) return [{ path: testPath, code, sourcePath }];
  return [];
}

/** A branch name fragment: the file name, safe for git. */
export function slugOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  return base.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || "tests";
}
