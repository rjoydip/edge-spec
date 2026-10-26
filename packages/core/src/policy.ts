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

/** A per-repository gate for pull requests. Never contains a secret. */
export interface PullPolicy {
  /** Blocks every pull request while set. */
  killSwitch?: boolean;
  /** The pull request must be a draft (human approval before ready). */
  draftOnly?: boolean;
  /** 0 or absent means no file-count gate. */
  maxFiles?: number;
  /** Extra allowlist; empty means the test-only policy is the only path gate. */
  allowedPaths?: string[];
  /** Measured covered-line delta the run must reach; 0 or absent disables it. */
  minCoverageDelta?: number;
  /** Applied after the pull request opens. */
  labels?: string[];
  reviewers?: string[];
}

export interface PolicyViolation {
  gate: string;
  message: string;
}

const stringsOf = (value: unknown, max = 20): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, max)
        .map((item) => item.slice(0, 120))
    : [];

function boundedInt(value: unknown, min: number, max: number): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** Accepts only known fields and clamps them; unknown input is ignored. */
export function parsePullPolicy(value: unknown): PullPolicy {
  const input =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  // Zero means "no gate" in the dashboard, so it must not clamp to one.
  const maxFilesRaw = Number(input.maxFiles);
  const coverageRaw = Number(input.minCoverageDelta);
  const maxFiles =
    Number.isFinite(maxFilesRaw) && maxFilesRaw > 0 ? boundedInt(maxFilesRaw, 1, 100) : undefined;
  const minCoverageDelta =
    Number.isFinite(coverageRaw) && coverageRaw > 0
      ? boundedInt(coverageRaw, 1, 1_000_000)
      : undefined;
  const allowedPaths = stringsOf(input.allowedPaths, 30);
  const labels = stringsOf(input.labels);
  const reviewers = stringsOf(input.reviewers);
  return {
    ...(input.killSwitch === true ? { killSwitch: true } : {}),
    ...(input.draftOnly === true ? { draftOnly: true } : {}),
    ...(maxFiles !== undefined ? { maxFiles } : {}),
    ...(allowedPaths.length > 0 ? { allowedPaths } : {}),
    ...(minCoverageDelta !== undefined ? { minCoverageDelta } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(reviewers.length > 0 ? { reviewers } : {}),
  };
}

function globOf(pattern: string): RegExp {
  const normalized = pattern.trim().replace(/^\.\//, "");
  let escaped = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] as string;
    if (char === "*" && normalized[index + 1] === "*") {
      // `**/` also matches zero directories, as glob users expect.
      if (normalized[index + 2] === "/") {
        escaped += "(?:.*/)?";
        index += 2;
      } else {
        escaped += ".*";
        index += 1;
      }
    } else if (char === "*") {
      escaped += "[^/]*";
    } else {
      escaped += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
    }
  }
  return new RegExp(`^${escaped}$`);
}

function pathAllowed(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globOf(pattern).test(path));
}

/** Files a policy needs from a pull request: the path and its measured delta. */
export interface PolicyFile {
  path: string;
  coverage?: { status: string; lines?: { delta?: number } };
}

/** Every reason the policy blocks this pull request; empty means allowed. */
export function evaluatePullPolicy(
  policy: PullPolicy,
  input: { files: readonly PolicyFile[]; draft?: boolean },
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  if (policy.killSwitch) {
    violations.push({
      gate: "kill-switch",
      message: "The repository kill switch blocks pull requests.",
    });
  }
  if (policy.draftOnly && input.draft !== true) {
    violations.push({
      gate: "draft-only",
      message: "This repository requires a draft pull request for human approval.",
    });
  }
  if (policy.maxFiles !== undefined && input.files.length > policy.maxFiles) {
    violations.push({
      gate: "max-files",
      message: `${input.files.length} files exceed the ${policy.maxFiles}-file limit.`,
    });
  }
  if (policy.allowedPaths?.length) {
    const outside = input.files
      .map((file) => file.path)
      .filter((path) => !pathAllowed(path, policy.allowedPaths ?? []));
    if (outside.length > 0) {
      violations.push({
        gate: "allowed-paths",
        message: `${outside.slice(0, 3).join(", ")}${outside.length > 3 ? ` and ${outside.length - 3} more` : ""} are outside the allowed paths.`,
      });
    }
  }
  if (policy.minCoverageDelta !== undefined) {
    const unmeasured = input.files.filter((file) => file.coverage?.status !== "measured");
    if (unmeasured.length > 0) {
      violations.push({
        gate: "coverage-delta",
        message: `Coverage delta is not measured for ${unmeasured
          .slice(0, 3)
          .map((file) => file.path)
          .join(", ")}; this policy requires at least ${policy.minCoverageDelta} covered line(s).`,
      });
    } else {
      const delta = input.files.reduce(
        (sum, file) => sum + (Number(file.coverage?.lines?.delta) || 0),
        0,
      );
      if (delta < policy.minCoverageDelta) {
        violations.push({
          gate: "coverage-delta",
          message: `Coverage +${delta} lines is below the required ${policy.minCoverageDelta}.`,
        });
      }
    }
  }
  return violations;
}

export function policyBlocked(violations: readonly PolicyViolation[]): string | undefined {
  if (violations.length === 0) return undefined;
  return `Policy blocked this pull request: ${violations
    .map((violation) => `${violation.gate} — ${violation.message}`)
    .join(" ")}`;
}
