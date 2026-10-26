/**
 * The test-only path policy. EdgeSpec may add tests and test support, never
 * application source. One module is shared by generation, the pull request
 * route and the durable workflow, so every path is judged the same way.
 */
import { skippedPathReason } from "./scanner";
import { HttpError } from "./types";

/** A file named like a test artifact. */
const TEST_FILE = /\.(test|spec|e2e-spec|_spec|-spec)\.[cm]?[jt]sx?$/i;
/** A directory that exists for tests, so any file inside it is test support. */
const TEST_DIR = /(^|\/)(test|tests|__tests__|__mocks__|spec|specs|e2e)\//i;

/** A policy refusal, so a caller can tell it from a parse or provider error. */
export class PolicyError extends HttpError {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(400, `Refusing "${path}": ${reason}.`);
    this.name = "PolicyError";
  }
}

/** Why a path is not a test artifact, or `undefined` when it is allowed. */
export function testPathProblem(path: string): string | undefined {
  const value = path.trim();
  if (!value) return "the path is empty";
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    return "the path must be relative to the repository";
  }
  if (value.includes("\\")) return "the path must use forward slashes";
  const segments = value.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || !segment)) {
    return "the path must not contain empty or traversal segments";
  }
  if (skippedPathReason(value)) {
    return "generated, vendored and lockfile paths are not allowed";
  }
  if (!TEST_FILE.test(value) && !TEST_DIR.test(value)) {
    return "only test files (*.test.*, *.spec.*, tests/**) may be written";
  }
  return undefined;
}

export function isTestPath(path: string): boolean {
  return testPathProblem(path) === undefined;
}

/** Generated code says so at the top of the file; do not write tests for it. */
const GENERATED_MARKER = /^[ \t]*(?:\/\/|#|\/\*|\*|<!--)[ \t]*(?:@generated\b|DO NOT EDIT\b)/im;

/** Why a source file is marked generated, or `undefined`. */
export function generatedMarkerReason(source: string): string | undefined {
  return GENERATED_MARKER.test(source.slice(0, 2000)) ? "it is marked generated" : undefined;
}

/** Throws a named 400 unless `path` is a test artifact. */
export function assertTestOnly(path: string): void {
  const problem = testPathProblem(path);
  if (problem) throw new PolicyError(path, problem);
}
