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

/** Optional copy the reviewer can edit before the pull request is opened. */
export interface PullMeta {
  title?: string;
  body?: string;
  branch?: string;
  commitMessage?: string;
  draft?: boolean;
}

/** Reads the optional pull request fields; absent values are omitted. */
export function pullMetaOf(body: Record<string, unknown>): PullMeta {
  const title = text(body.title).slice(0, 200);
  const prBody = text(body.body).slice(0, 20_000);
  const branch = text(body.branch).slice(0, 120);
  const commitMessage = text(body.commitMessage).slice(0, 200);
  return {
    ...(title ? { title } : {}),
    ...(prBody ? { body: prBody } : {}),
    ...(branch ? { branch } : {}),
    ...(commitMessage ? { commitMessage } : {}),
    ...(body.draft === true ? { draft: true } : {}),
  };
}

/** A user-edited branch must be a safe, non-protected git ref. */
export function validBranchName(value: string): boolean {
  if (!value || value.length > 120) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.endsWith(".") || value.endsWith(".lock")) return false;
  if (value.includes("..") || value.includes("//") || value.includes("@{") || value === "@") {
    return false;
  }
  if (value.startsWith("refs/")) return false;
  return !["main", "master", "HEAD"].includes(value);
}

/** A branch name fragment: the file name, safe for git. */
export function slugOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  return base.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || "tests";
}
