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

/** Why a source file is a gap. Absent on old callers means "missing". */
export type GapKind = "missing" | "coverage" | "api" | "unsupported";

export interface GapEvidence {
  /** Existing tests that made this a coverage gap, not a missing-test gap. */
  testFiles?: string[];
  lineRate?: number;
  branchRate?: number;
  uncoveredLines?: number[];
  /** Lines with an untaken branch, from the same measured report. */
  uncoveredBranches?: number[];
  /** For kind === "api". */
  specPath?: string;
  operation?: { method: string; path: string; operationId?: string };
}

/** A source file that needs a test, or one EdgeSpec cannot generate for yet. */
export interface Gap {
  path: string;
  testPath: string;
  risk: Risk;
  /** Exported symbols, best effort. Empty until the source is fetched. */
  exports: string[];
  reason: string;
  kind?: GapKind;
  language?: string;
  evidence?: GapEvidence;
}

export interface ScanTotals {
  missing: number;
  coverage: number;
  api: number;
  unsupported: number;
  /** Sources excluded by the path policy, shown rather than silently dropped. */
  skipped: number;
}

export interface ScanTruncation {
  missing: boolean;
  coverage: boolean;
  api: boolean;
}

export type CoverageStatus = "not-run" | "unavailable" | "measured";

export interface ScanResult {
  repo: string;
  ref: string;
  scanned: number;
  /** Missing tests only, kept for old clients. */
  gaps: Gap[];
  coverageGaps?: Gap[];
  apiGaps?: Gap[];
  unsupported?: Gap[];
  totals?: ScanTotals;
  truncated?: ScanTruncation;
  coverageStatus?: CoverageStatus;
  coverageReason?: string;
  /** What the repository looks like: languages, tooling, runtime. */
  overview?: RepositoryOverview;
}

/** An OpenAPI description or a Postman/Bruno request collection. */
export interface ApiArtifact {
  kind: "openapi" | "postman" | "bruno";
  path: string;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie" | string;
  required?: boolean;
  schema?: Record<string, unknown>;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
}

export interface OpenApiRequestBody {
  contentType: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  example?: unknown;
}

/** One operation in an OpenAPI document. */
export interface OpenApiEndpoint {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  /** Documented status codes, as strings ("200", "default"). */
  responses?: string[];
  /** Security scheme names only; never the secret itself. */
  security?: string[];
}

/** A parsed OpenAPI document, ready to render. */
export interface OpenApiSpec {
  path: string;
  title?: string;
  version?: string;
  description?: string;
  endpoints: OpenApiEndpoint[];
  /** Servers the document declares. */
  servers?: string[];
  /** Raw source of the spec, for the raw view and download. */
  content?: string;
}

/** The kind of failure a contract test reported. */
export type ApiDiagnosis =
  "assertion" | "timeout" | "boot" | "missing-fixture" | "network" | "unknown";

/** One contract test result, parsed from JUnit. */
export interface ApiTestResult {
  specPath: string;
  method: string;
  path: string;
  status: "passed" | "failed" | "skipped" | "not-run";
  httpStatus?: number;
  durationMs?: number;
  error?: string;
  /** Only set for a failed case; derived from the failure text. */
  diagnosis?: ApiDiagnosis;
  expected?: string;
  actual?: string;
}

/** One operation a retest should execute, and the spec it belongs to. */
export interface RetestOperation {
  specPath: string;
  method: string;
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
  /** Parsed OpenAPI documents found in the tree. */
  openApiSpecs?: OpenApiSpec[];
  /** The first parsed OpenAPI document, for convenience. */
  openApiSpec?: OpenApiSpec;
  openApi?: OpenApiSpec;
  openapi?: OpenApiSpec;
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

/** A per-file coverage change, from two executed LCOV reports. */
export type CoverageDelta =
  | { status: "not-measured" }
  | {
      status: "measured";
      path: string;
      lines: { before: number; after: number; delta: number; total: number };
      branches?: { before: number; after: number; delta: number; total: number };
    };

export interface Validation {
  ok: boolean;
  /** True only when a real test runner executed the suite. */
  verified: boolean;
  output: string;
  durationMs: number;
  /** The repository checks that ran against the test. */
  checks?: CheckResult[];
  /** Present only when the run asked the runner for coverage. */
  coverage?: CoverageDelta;
  /** True when repeated runs disagreed; a flaky suite is never verified. */
  flaky?: boolean;
  /** How many times the suite ran, including the first. */
  runs?: number;
  /** Set when the sandbox could not prepare or run the suite at all. */
  environmentError?: "setup" | "server" | "unreachable" | "timeout";
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
  /** Set when the sandbox environment failed before the check could run. */
  environmentError?: "setup" | "server" | "unreachable" | "timeout";
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
  /** Emitted first by the SSE route so the dashboard can record decisions. */
  | { type: "run"; id: string; persisted: boolean }
  | {
      type: "step";
      step: StepId;
      status: "start" | "done" | "failed";
      note?: string;
      /** The file this event belongs to, when the run is concurrent. */
      sourcePath?: string;
    }
  | {
      type: "gaps";
      gaps: Gap[];
      overview?: RepositoryOverview;
      totals?: ScanTotals;
      coverageStatus?: CoverageStatus;
      coverageReason?: string;
    }
  | { type: "quota"; rateLimit: RateLimitInfo }
  | { type: "generation"; generation: Generation }
  | { type: "validation"; validation: Validation; sourcePath?: string }
  | {
      type: "api";
      results: ApiTestResult[];
      /** This was a retest, not a fresh run. */ retest?: boolean;
    }
  | {
      type: "result";
      ok: boolean;
      pullRequestUrl?: string;
      reason?: string;
      generation?: Generation;
      /** Source paths whose tests are ready for a pull request. */
      ready?: string[];
      /** This was a retest of failed endpoints, not a fresh run. */
      retest?: boolean;
    }
  | { type: "error"; message: string };
