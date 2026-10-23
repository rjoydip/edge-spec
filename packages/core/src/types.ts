/** Shared shapes. Nothing here knows about HTTP, GitHub or a specific model. */

/** An error that carries the status code the API should answer with. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type Risk = "high" | "medium" | "low";

/** A source file that has no matching test file. */
export interface Gap {
  path: string;
  testPath: string;
  risk: Risk;
  /** Exported symbols, best effort. Empty until the source is fetched. */
  exports: string[];
  reason: string;
}

export interface ScanResult {
  repo: string;
  ref: string;
  scanned: number;
  gaps: Gap[];
  /** What the repository looks like: languages, tooling, runtime. */
  overview?: RepositoryOverview;
}

/** An OpenAPI description or a Postman/Bruno request collection. */
export interface ApiArtifact {
  kind: "openapi" | "postman" | "bruno";
  path: string;
}

/** Facts read from the repository tree, not invented. */
export interface RepositoryOverview {
  /** Languages by file count, biggest first. */
  languages: Array<{ name: string; count: number }>;
  /** bun, npm, pnpm, yarn or deno, from the lockfile. */
  packageManager?: string;
  /** node, deno, bun… from the runtime files. */
  runtime?: string;
  /** The version the repository asks for, when it states one. */
  runtimeVersion?: string;
  packageName?: string;
  packageVersion?: string;
  /** Frameworks and build tools the configuration files reveal. */
  frameworks: string[];
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  /** The commands the repository's CI runs. */
  checks?: Array<{ name: string; kind: CheckKind; command: string }>;
  /** The formatter the repository uses. */
  formatter?: string;
  /** OpenAPI specs and Postman/Bruno collections found in the tree. */
  apiArtifacts?: ApiArtifact[];
}

export interface Generation {
  sourcePath: string;
  testPath: string;
  code: string;
  provider: string;
  model: string;
  corrected: boolean;
  /** The original file, so the review can show it beside the generated test. */
  source?: string;
}

export interface Validation {
  ok: boolean;
  /** True only when a real test runner executed the suite. */
  verified: boolean;
  output: string;
  durationMs: number;
  /** The repository checks that ran against the test. */
  checks?: CheckResult[];
}

/** What a provider says about the calls it has left. */
export interface RateLimitInfo {
  provider: string;
  /** The limit, when the provider states one. */
  limit?: number;
  /** The calls left, when the provider states it. */
  remaining?: number;
  /** When the window resets, in seconds. */
  resetSeconds?: number;
}

/** The kind of check a repository runs. */
export type CheckKind = "format" | "lint" | "typecheck" | "build" | "test";

/** The result of one repository check. */
export interface CheckResult {
  name: string;
  kind: CheckKind;
  /** The command that ran. */
  command: string;
  ok: boolean;
  /** True when the check could not run in the runner, e.g. a missing tool. */
  skipped?: boolean;
  output: string;
  durationMs: number;
}

/** A generated test and its last validation result. */
export interface GeneratedTest {
  generation: Generation;
  validation: Validation;
}

/** What the dashboard sends to generate a test. Keys travel in headers. */
export interface AiChoice {
  provider: string;
  model: string;
}

export interface RunInput {
  repo: string;
  ref: string;
  maxRetries: number;
  maxAiRetries: number;
  strictTypes: boolean;
  coverageTarget: number;
  /** How many gap files one run generates tests for. */
  maxFiles: number;
}

export type StepId = "scan" | "generate" | "validate" | "correct" | "pull-request";

export type RunEvent =
  | { type: "log"; level: "info" | "ai" | "warn" | "success" | "error"; text: string }
  | { type: "step"; step: StepId; status: "start" | "done" | "failed"; note?: string }
  | { type: "gaps"; gaps: Gap[]; overview?: RepositoryOverview }
  | { type: "quota"; rateLimit: RateLimitInfo }
  | { type: "generation"; generation: Generation }
  | { type: "validation"; validation: Validation }
  | {
      type: "result";
      ok: boolean;
      pullRequestUrl?: string;
      reason?: string;
      generation?: Generation;
      /** Source paths whose tests are ready for a pull request. */
      ready?: string[];
    }
  | { type: "error"; message: string };
