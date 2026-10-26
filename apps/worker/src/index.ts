import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AiConfig } from "@edge-spec/core/ai";
import { PROMPT_VERSION, generateTest, probeRateLimit } from "@edge-spec/core/ai";
import {
  DEFAULT_AI,
  DEFAULT_PIPELINE,
  PROVIDERS,
  nextModel,
  parseRef,
  parseRepo,
  parseSandboxUrl,
  pipelineConfig,
  resolveAi,
} from "@edge-spec/core/catalog";
import { GitHub } from "@edge-spec/core/github";
import { readRepositoryChecks, runPipeline, withChecks } from "@edge-spec/core/pipeline";
import { detectChecks, SUPPORT_FILES } from "@edge-spec/core/ci";
import {
  pullFilesOf,
  pullMetaOf,
  pullSkippedOf,
  slugOf,
  validBranchName,
} from "@edge-spec/core/pr";
import { parseFixtureFile, type FixtureFile } from "@edge-spec/core/fixtures";
import { pullRequestBody } from "@edge-spec/core/provenance";
import { authorizedCommenter, parsePrCommand } from "@edge-spec/core/pr-command";
import { assertTestOnly } from "@edge-spec/core/policy";
import {
  classifyTree,
  describeRepository,
  extractExports,
  packageFacts,
  parseOpenApiSpec,
  riskOf,
} from "@edge-spec/core/scanner";
import { apiGaps, contractTestsFor } from "@edge-spec/core/openapi";
import {
  apiHealthMatrix,
  apiSourceCandidates,
  detectApiFramework,
  inferApiSpec,
} from "@edge-spec/core/api-surface";
import { coverageGaps } from "@edge-spec/core/coverage";
import {
  formatWithRunner,
  runInSandbox,
  runRepositoryChecks,
  staticCheck,
  validateTest,
} from "@edge-spec/core/validate";
import {
  checkSandboxHealth,
  parseSandboxConfig,
  sandboxRepo,
  type SandboxConfig,
} from "@edge-spec/core/sandbox";
import {
  HttpError,
  type Gap,
  type OpenApiSpec,
  type RateLimitInfo,
  type RetestOperation,
  type Validation,
} from "@edge-spec/core/types";
import type { Env } from "./env";
import {
  claimPrCommand,
  createRun,
  deleteMemory,
  deletePolicy,
  deleteRunHistory,
  deleteScheduledRepo,
  finishRun,
  getMemory,
  getPolicy,
  getRun,
  getWorkspace,
  listAudit,
  listBacklog,
  listRuns,
  listScheduledRepos,
  putMemory,
  putPolicy,
  putScheduledRepo,
  putWorkspace,
  recordAudit,
  runsDb,
  setBacklogState,
  setRunDecisions,
  syncBacklog,
} from "./db";
import type { BacklogState } from "@edge-spec/core/backlog";
import { impactForChanges } from "./impact";
import { ownerLookup } from "./ownership";
import { runScheduled } from "./scheduled";
import { parseRepoMemory } from "@edge-spec/core/memory";
import { routeModel } from "@edge-spec/core/routing";
import { evaluatePullPolicy, parsePullPolicy, policyBlocked } from "@edge-spec/core/policy";
import type { RunDecision, RunFile, RunSummary } from "@edge-spec/core/history";

export { TestGenerationWorkflow } from "./workflow";

/** Header carrying a bring-your-own GitHub token. Mirrors `src/web/lib/settings.ts`. */
const TOKEN_HEADER = "x-github-token";
/** Header carrying a bring-your-own provider key. */
const AI_KEY_HEADER = "x-ai-key";
/** Header carrying a private provider's base URL. */
const AI_BASE_HEADER = "x-ai-base-url";
/** Header asking for the deployment's own Workers AI binding. */
const DEPLOYMENT_AI_HEADER = "x-deployment-ai";
/** Header carrying a visitor's own test runner. */
const SANDBOX_URL_HEADER = "x-sandbox-url";
/** Header carrying the key for that runner. */
const SANDBOX_KEY_HEADER = "x-sandbox-key";
/** Header carrying the non-secret runner knobs as JSON. */
const SANDBOX_CONFIG_HEADER = "x-sandbox-config";

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** A bounded list of positive line numbers from a request body. */
function numbersOf(value: unknown, max = 500): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0,
    )
    .slice(0, max);
}

/** Validates the failed operations a client asks to retest. */
function retestOperationsOf(value: unknown): RetestOperation[] {
  if (!Array.isArray(value)) return [];
  const operations: RetestOperation[] = [];
  for (const entry of value.slice(0, 30)) {
    const item = asRecord(entry);
    const specPath = str(item.specPath);
    const method = str(item.method)?.toUpperCase();
    const path = str(item.path);
    if (!specPath || !method || !path || !/^[A-Z]+$/.test(method)) continue;
    operations.push({ specPath, method, path });
  }
  return operations;
}

/** In-memory fallback when D1 is not configured; per isolate, best effort. */
const recentCommands = new Map<string, number>();
function allowCommandInMemory(key: string, windowMs = 60_000): boolean {
  const now = Date.now();
  const last = recentCommands.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  recentCommands.set(key, now);
  if (recentCommands.size > 1_000) {
    for (const [entry, at] of recentCommands) {
      if (now - at >= windowMs) recentCommands.delete(entry);
    }
  }
  return true;
}

function stringMapOf(
  value: unknown,
  keyPattern: RegExp,
  maxValue = 2_000,
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  let count = 0;
  for (const [key, content] of Object.entries(asRecord(value))) {
    if (count >= 20 || !keyPattern.test(key) || key.length > 100) continue;
    if (typeof content !== "string" || content.length > maxValue) continue;
    result[key] = content;
    count += 1;
  }
  return count > 0 ? result : undefined;
}

/** Contract auth values from the request; they only reach sandbox env. */
function authFixtureOf(
  body: Record<string, unknown>,
): { headers?: Record<string, string>; query?: Record<string, string> } | undefined {
  const raw = asRecord(body.authFixture);
  const headers = stringMapOf(raw.headers, /^[A-Za-z0-9_.-]+$/);
  const query = stringMapOf(raw.query, /^[A-Za-z0-9_.-]+$/);
  return headers || query
    ? { ...(headers ? { headers } : {}), ...(query ? { query } : {}) }
    : undefined;
}

/** A failed attempt the client sends back to the self-correction loop. */
function previousOf(body: Record<string, unknown>): { code: string; output: string } | undefined {
  const previous = asRecord(body.previous);
  const code = typeof previous.code === "string" ? previous.code.slice(0, 24000) : "";
  const output = typeof previous.output === "string" ? previous.output.slice(0, 6000) : "";
  return code && output ? { code, output } : undefined;
}

async function readJson(c: AppContext): Promise<Record<string, unknown>> {
  try {
    return asRecord(await c.req.json<unknown>());
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

function repoOf(body: Record<string, unknown>): string {
  const parsed = parseRepo(str(body.repo));
  if (!parsed) throw new HttpError(400, "Enter a repository as owner/name.");
  return `${parsed.owner}/${parsed.name}`;
}

function githubFor(c: AppContext): GitHub {
  return new GitHub(c.req.header(TOKEN_HEADER)?.trim() || undefined);
}

/** Source text is only accepted from the local dashboard's Vite proxy. */
function isLocalRequest(c: AppContext): boolean {
  const host = c.req.header("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}

function aiConfigFor(c: AppContext, body: Record<string, unknown>): AiConfig {
  const choice = resolveAi({
    provider: str(body.provider),
    model: str(body.model),
    apiKey: c.req.header(AI_KEY_HEADER),
    baseUrl: c.req.header(AI_BASE_HEADER),
    accountId: str(body.accountId),
  });
  // The deployment's own Workers AI binding is a local development convenience.
  // A deployed Worker only spends it when the request asks for it, so a
  // visitor always runs on their own provider.
  const useBinding = c.req.header(DEPLOYMENT_AI_HEADER) === "1";
  const fallback = nextModel(choice.provider, choice.model);
  return {
    provider: choice.provider,
    model: choice.model,
    ...(fallback ? { fallbackModel: fallback } : {}),
    ...(choice.apiKey ? { apiKey: choice.apiKey } : {}),
    ...(choice.baseUrl ? { baseUrl: choice.baseUrl } : {}),
    ...(choice.accountId ? { accountId: choice.accountId } : {}),
    ...(useBinding && c.env.AI ? { ai: c.env.AI } : {}),
  };
}

function sandboxConfigHeader(c: AppContext): SandboxConfig {
  const raw = c.req.header(SANDBOX_CONFIG_HEADER)?.trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "x-sandbox-config must be a JSON object.");
  }
  return parseSandboxConfig(parsed);
}

/**
 * The runner that executes the suite. A visitor may point at their own runner
 * with a header; otherwise the deployment's binding is used. Non-secret knobs
 * travel in one JSON header; URL and key stay separate.
 */
function sandboxFor(c: AppContext): SandboxConfig | undefined {
  const config = sandboxConfigHeader(c);
  const rawUrl = c.req.header(SANDBOX_URL_HEADER)?.trim();
  const own = parseSandboxUrl(rawUrl, { allowLocal: isLocalRequest(c) });
  if (rawUrl && !own) {
    throw new HttpError(400, "The sandbox URL must be https (or http on localhost).");
  }
  const key = c.req.header(SANDBOX_KEY_HEADER)?.trim();
  if (own) return { ...config, url: own, ...(key ? { apiKey: key } : {}) };
  const url = c.env.SANDBOX_RUNNER_URL?.trim();
  if (!url) return undefined;
  return {
    ...config,
    url,
    ...(c.env.SANDBOX_API_KEY ? { apiKey: c.env.SANDBOX_API_KEY } : {}),
  };
}

function fail(err: unknown): Response {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ error: message, status }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function validSignature(secret: string, raw: string, header: string): Promise<boolean> {
  if (!header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === `sha256=${hex}`;
}

app.get("/api/health", (c) =>
  c.json({ status: "ok", app: "EdgeSpec", timestamp: new Date().toISOString() }),
);

/**
 * How many calls the current provider has left. The provider's models
 * endpoint answers with the same rate limit headers as a chat request, so the
 * dashboard can show the state without spending a completion.
 */
app.get("/api/quota", async (c) => {
  try {
    const aiConfig = aiConfigFor(c, {
      provider: c.req.query("provider"),
      model: c.req.query("model"),
      accountId: c.req.query("accountId"),
    });
    const rateLimit = await probeRateLimit({ config: aiConfig });
    return rateLimit ? c.json({ rateLimit }) : c.json({});
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/catalog", (c) =>
  c.json({
    providers: PROVIDERS,
    defaults: { ai: DEFAULT_AI, pipeline: DEFAULT_PIPELINE },
    /** Tells the dashboard whether a sandbox runner exists before it promises one. */
    sandbox: Boolean(c.env.SANDBOX_RUNNER_URL),
  }),
);

/**
 * Probes a runner from the Worker. The browser cannot call an arbitrary origin,
 * and the key must not be exposed to it; the Worker can do both.
 */
app.post("/api/sandbox/health", async (c) => {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await readJson(c);
    } catch {
      // An empty body is fine: the headers or the deployment may carry the URL.
    }

    const headerConfig = sandboxConfigHeader(c);
    const bodyConfig = body.config === undefined ? undefined : parseSandboxConfig(body.config);
    const config = { ...headerConfig, ...bodyConfig };
    const requested = str(body.url);
    const allowLocal = isLocalRequest(c);

    let url: string | null;
    if (requested) {
      url = parseSandboxUrl(requested, { allowLocal });
      if (!url) {
        throw new HttpError(400, "A sandbox URL must be https (or http on localhost).");
      }
    } else {
      const headerUrl = c.req.header(SANDBOX_URL_HEADER)?.trim();
      const own = parseSandboxUrl(headerUrl, { allowLocal });
      if (headerUrl && !own) {
        throw new HttpError(400, "A sandbox URL must be https (or http on localhost).");
      }
      url = own ?? c.env.SANDBOX_RUNNER_URL?.trim() ?? null;
    }
    if (!url) return c.json({ ok: false, error: "No sandbox runner is configured." });

    const key = c.req.header(SANDBOX_KEY_HEADER)?.trim() || c.env.SANDBOX_API_KEY;
    return c.json(
      await checkSandboxHealth({
        sandbox: { ...config, url, ...(key ? { apiKey: key } : {}) },
      }),
    );
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/branches", async (c) => {
  try {
    const parsed = parseRepo(c.req.query("repo"));
    if (!parsed) throw new HttpError(400, "Enter a repository as owner/name.");
    const repo = `${parsed.owner}/${parsed.name}`;
    const github = githubFor(c);
    const [branches, defaultBranch] = await Promise.all([
      github.branches(repo),
      github.defaultBranch(repo),
    ]);
    branches.sort((a, b) =>
      a === defaultBranch ? -1 : b === defaultBranch ? 1 : a.localeCompare(b),
    );
    return c.json({ branches, defaultBranch });
  } catch (err) {
    return fail(err);
  }
});

app.post("/api/scan", async (c) => {
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const ref = parseRef(str(body.ref));
    const github = githubFor(c);
    const tree = await github.tree(repo, ref);
    const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    const classification = classifyTree(blobs);
    const gaps = classification.missing.slice(0, 25);

    // Fetch a few sources so the table can show exported symbols. Failures are
    // cosmetic and leave the gap as-is.
    const enriched = await Promise.all(
      gaps.slice(0, 8).map(async (gap): Promise<Gap> => {
        try {
          const source = await github.file(repo, gap.path, ref);
          const exports = extractExports(source);
          return { ...gap, exports, risk: riskOf(gap.path, exports.length) };
        } catch {
          return gap;
        }
      }),
    );

    // The tree tells the languages and the tooling; package.json adds the
    // version facts. A missing package.json is not an error.
    const overview = describeRepository(blobs);
    let packageJson: string | undefined;
    try {
      packageJson = await github.file(repo, "package.json", ref);
      Object.assign(overview, packageFacts(packageJson));
    } catch {
      // No package.json at the root.
    }

    // Parse any OpenAPI specs so the dashboard can render them.
    const openApiSpecs: OpenApiSpec[] = [];
    try {
      const OPENAPI_LIKE = /(^|\/)(openapi|swagger|api[-_.]?spec)[^/]*\.(json|ya?ml)$/i;
      for (const artifactPath of blobs.filter((path) => OPENAPI_LIKE.test(path)).slice(0, 4)) {
        try {
          const content = await github.file(repo, artifactPath, ref);
          const spec = parseOpenApiSpec(content, artifactPath);
          if (spec) openApiSpecs.push(spec);
        } catch {
          // A spec we cannot read is a spec we cannot render.
        }
      }
      if (openApiSpecs.length === 0) {
        // API-based repo without a published spec: infer one from route calls.
        // The dependency check avoids reading a dozen sources on every scan.
        const frameworkHint = detectApiFramework({
          ...(packageJson ? { packageJson } : {}),
          files: [],
        });
        const routeFileHint = blobs.some((path) => /(^|\/)(app\/api|pages\/api)\//i.test(path));
        if (frameworkHint || routeFileHint) {
          const files: Array<{ path: string; content: string }> = [];
          for (const path of apiSourceCandidates(blobs).slice(0, 16)) {
            try {
              files.push({ path, content: await github.file(repo, path, ref) });
            } catch {
              // One unreadable source must not stop the inference.
            }
          }
          const inferred = inferApiSpec({
            title: overview.packageName ?? repo,
            paths: blobs,
            files,
            ...(packageJson ? { packageJson } : {}),
          });
          if (inferred) {
            openApiSpecs.push(inferred.spec);
            overview.apiFramework = inferred.framework;
          }
        }
      }
      if (openApiSpecs.length > 0) {
        overview.openApiSpecs = openApiSpecs;
        overview.openApiSpec = openApiSpecs[0];
        overview.openApi = openApiSpecs[0];
        overview.openapi = openApiSpecs[0];
        overview.apiHealth = apiHealthMatrix(openApiSpecs);
      }
    } catch {
      // Best effort.
    }
    const contractGaps = apiGaps(openApiSpecs);
    const totals = {
      missing: classification.missing.length,
      coverage: 0,
      api: contractGaps.length,
      unsupported: classification.unsupported.length,
      skipped: classification.skipped,
    };

    // The commands the repository's CI runs, so the dashboard can show them
    // before anything is generated.
    const ruleFiles: Record<string, string> = {};
    if (packageJson) ruleFiles["package.json"] = packageJson;
    const workflowPaths = blobs
      .filter((path) => path.startsWith(".github/workflows/") && path.endsWith(".yml"))
      .slice(0, 4);
    for (const path of [
      ...workflowPaths,
      ...blobs.filter((path) => SUPPORT_FILES.includes(path) && path !== "package.json"),
    ]) {
      try {
        ruleFiles[path] = await github.file(repo, path, ref);
      } catch {
        // A file we cannot read is a rule we cannot apply.
      }
    }
    const workflows: Record<string, string> = {};
    for (const [path, content] of Object.entries(ruleFiles)) {
      if (path.startsWith(".github/workflows/")) workflows[path] = content;
    }
    const detected = detectChecks({
      paths: blobs,
      ...(ruleFiles["package.json"] ? { packageJson: ruleFiles["package.json"] } : {}),
      workflows,
      files: ruleFiles,
    });
    if (detected.checks.length > 0) {
      overview.checks = detected.checks.map((check) => ({
        name: check.name,
        kind: check.kind,
        command: check.command,
      }));
    }
    if (detected.formatter) overview.formatter = detected.formatter.name;
    overview.testRunner = detected.runner;

    // A full scan is the backlog's source of truth; a gap that disappeared closes.
    const history = runsDb(c.env);
    if (history) {
      const owner = await ownerLookup(github, repo, ref, blobs);
      await syncBacklog(
        history,
        repo,
        [...classification.missing, ...contractGaps].map((gap) => {
          const ownerName = owner(gap.evidence?.specPath ?? gap.path);
          return {
            path: gap.path,
            kind: gap.kind ?? "missing",
            ...(ownerName ? { owner: ownerName } : {}),
            risk: gap.risk,
            reason: gap.reason,
          };
        }),
        Date.now(),
        undefined,
        ["missing", "api"],
      ).catch(() => undefined);
    }

    return c.json({
      repo,
      ref,
      scanned: blobs.length,
      gaps: [...enriched, ...gaps.slice(8)],
      coverageGaps: [],
      apiGaps: contractGaps,
      unsupported: classification.unsupported,
      totals,
      truncated: {
        missing: classification.missing.length > 25,
        coverage: false,
        api: false,
      },
      coverageStatus: "not-run",
      overview,
    });
  } catch (err) {
    return fail(err);
  }
});

app.post("/api/impact", async (c) => {
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const ref = parseRef(str(body.ref));
    const changed = (Array.isArray(body.changedPaths) ? body.changedPaths : [])
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .map((path) => path.trim())
      .slice(0, 100);
    if (changed.length === 0) throw new HttpError(400, "Pass at least one changed path.");
    const github = githubFor(c);
    const tree = await github.tree(repo, ref);
    const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    return c.json(await impactForChanges({ github, repo, ref, blobs, changed }));
  } catch (err) {
    return fail(err);
  }
});

app.post("/api/record", async (c) => {
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const ref = parseRef(str(body.ref));
    const sandbox = sandboxFor(c);
    if (!sandbox?.url) throw new HttpError(400, "Recording needs a sandbox runner.");
    const github = githubFor(c);
    const tree = await github.tree(repo, ref);
    const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    const specPath =
      str(body.specPath) ??
      blobs.find((path) => /(^|\/)(openapi|swagger|api[-_.]?spec)[^/]*\.(json|ya?ml)$/i.test(path));
    if (!specPath) throw new HttpError(400, "No OpenAPI spec found; pass specPath.");
    const spec = parseOpenApiSpec(await github.file(repo, specPath, ref), specPath);
    if (!spec) throw new HttpError(400, `${specPath} is not a usable OpenAPI spec.`);
    const baseUrl =
      str(body.baseUrl) ??
      (sandbox.server?.readyUrl ? new URL(sandbox.server.readyUrl).origin : undefined);
    if (!baseUrl) throw new HttpError(400, "Pass baseUrl (the running app origin).");
    const authFixture = authFixtureOf(body);
    const contract = contractTestsFor(spec, undefined, {
      auth: Boolean(authFixture),
      negative: false,
    });
    const repoArg = sandboxRepo({
      repo,
      ref,
      sandbox,
      ...(sandbox.allowRepoToken ? { token: c.req.header(TOKEN_HEADER) ?? "" } : {}),
    });
    const env = {
      ...sandbox.env,
      BASE_URL: baseUrl,
      EDGESPEC_RECORD_FILE: "recorded-fixtures.json",
      ...(authFixture?.headers
        ? { EDGESPEC_AUTH_HEADERS: JSON.stringify(authFixture.headers) }
        : {}),
      ...(authFixture?.query ? { EDGESPEC_AUTH_QUERY: JSON.stringify(authFixture.query) } : {}),
    };
    const run = await runInSandbox({
      sandbox,
      ...(repoArg ? { repo: repoArg } : {}),
      env,
      files: { [specPath]: spec.content ?? "", [contract.path]: contract.code },
      command: `bun test ${contract.path}`,
    });
    if (run.unreachable || run.environmentError) {
      throw new HttpError(502, run.output || "The runner could not record fixtures.");
    }
    const text = run.artifacts["recorded-fixtures.json"] ?? run.files["recorded-fixtures.json"];
    const fixtures = text ? parseFixtureFile(text) : undefined;
    if (!fixtures) {
      throw new HttpError(502, run.output || "The runner returned no recorded fixtures.");
    }
    return c.json({ enabled: true, specPath, fixtures });
  } catch (err) {
    return fail(err);
  }
});

app.post("/api/coverage", async (c) => {
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const ref = parseRef(str(body.ref));
    const sandbox = sandboxFor(c);
    if (!sandbox?.url) {
      throw new HttpError(400, "Coverage needs a sandbox runner (x-sandbox-url).");
    }
    const github = githubFor(c);
    const tree = await github.tree(repo, ref);
    const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    const classification = classifyTree(blobs);
    const target = pipelineConfig(body).coverageTarget;

    const base = {
      repo,
      ref,
      scanned: blobs.length,
      totals: {
        missing: classification.missing.length,
        coverage: 0,
        api: 0,
        unsupported: classification.unsupported.length,
        skipped: classification.skipped,
      },
      truncated: { missing: false, coverage: false, api: false },
    };
    const unavailable = (reason: string) =>
      c.json({
        ...base,
        coverageGaps: [],
        coverageStatus: "unavailable",
        coverageReason: reason.slice(0, 600),
      });

    // The suite the repository itself runs; no invented command.
    let packageJson: string | undefined;
    try {
      packageJson = await github.file(repo, "package.json", ref);
    } catch {
      // A repository without package.json has no bun/npm test command.
    }
    const detected = detectChecks({
      paths: blobs,
      ...(packageJson ? { packageJson } : {}),
      workflows: {},
      files: packageJson ? { "package.json": packageJson } : {},
    });
    const test = detected.checks.find((check) => check.kind === "test");
    if (!test) return unavailable("No test command found in this repository.");

    const config: SandboxConfig = { ...sandbox, coverage: true };
    const repoArg = sandboxRepo({
      repo,
      ref,
      sandbox: config,
      ...(config.allowRepoToken ? { token: c.req.header(TOKEN_HEADER) ?? "" } : {}),
    });
    const run = await runInSandbox({
      sandbox: config,
      ...(repoArg ? { repo: repoArg } : {}),
      command: test.command,
      coverage: { format: "lcov" },
    });
    if (run.unreachable || run.environmentError) return unavailable(run.output);
    if (!run.coverage) {
      return unavailable(
        run.output || "The runner returned no coverage report (lcov.info missing).",
      );
    }

    const gaps = coverageGaps(blobs, run.coverage, target, classification.testsBySource);
    return c.json({
      ...base,
      coverageGaps: gaps.slice(0, 500),
      totals: { ...base.totals, coverage: gaps.length },
      truncated: { ...base.truncated, coverage: gaps.length > 500 },
      coverageStatus: "measured",
    });
  } catch (err) {
    return fail(err);
  }
});

app.post("/api/run", async (c) => {
  let prepared: {
    repo: string;
    ref: string;
    github: GitHub;
    aiConfig: AiConfig;
    sandbox?: SandboxConfig;
    repoToken?: string;
    authFixture?: { headers?: Record<string, string>; query?: Record<string, string> };
    fixtures?: FixtureFile;
    input: ReturnType<typeof pipelineConfig> & {
      repo: string;
      ref: string;
      mode?: "unit" | "api" | "both";
      retryGaps?: string[];
    };
  };
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const ref = parseRef(str(body.ref));
    const retryGaps = Array.isArray(body.retryGaps)
      ? body.retryGaps.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : undefined;
    const retestOperations = retestOperationsOf(body.retestOperations);
    const sandbox = sandboxFor(c);
    const authFixture = authFixtureOf(body);
    const fixtures =
      body.fixtures === undefined ? undefined : parseFixtureFile(JSON.stringify(body.fixtures));
    if (body.fixtures !== undefined && !fixtures) {
      throw new HttpError(400, "fixtures must contain at least one valid exchange.");
    }
    const repoToken = sandbox?.allowRepoToken
      ? c.req.header(TOKEN_HEADER)?.trim() || undefined
      : undefined;
    prepared = {
      repo,
      ref,
      github: githubFor(c),
      aiConfig: aiConfigFor(c, body),
      ...(sandbox ? { sandbox } : {}),
      ...(repoToken ? { repoToken } : {}),
      ...(authFixture ? { authFixture } : {}),
      ...(fixtures ? { fixtures } : {}),
      input: {
        repo,
        ref,
        ...pipelineConfig(body),
        ...(retestOperations.length > 0
          ? { mode: "api" as const, retestOperations }
          : body.mode === "api" || body.mode === "both" || body.mode === "unit"
            ? { mode: body.mode }
            : {}),
        ...(retryGaps && retestOperations.length === 0 ? { retryGaps } : {}),
      },
    };
  } catch (err) {
    return fail(err);
  }

  const { github, aiConfig, sandbox, repoToken, authFixture, fixtures, input } = prepared;
  const history = runsDb(c.env);
  const memory = history ? await getMemory(history, input.repo).catch(() => undefined) : undefined;
  const runId = crypto.randomUUID();
  const run: RunSummary = {
    id: runId,
    repo: input.repo,
    ref: input.ref,
    status: "running",
    provider: aiConfig.provider.id,
    model: aiConfig.model,
    startedAt: Date.now(),
    totals: { missing: 0, coverage: 0, api: 0, unsupported: 0, skipped: 0 },
  };
  let stored = false;
  if (history) {
    // History is a convenience; a D1 outage must not fail the run.
    try {
      await createRun(history, run);
      stored = true;
    } catch {
      stored = false;
    }
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "run",
      data: JSON.stringify({ type: "run", id: runId, persisted: stored }),
    });
    const files = new Map<string, RunFile>();
    let status: RunSummary["status"] = "failed";
    let scannedGaps: Gap[] | undefined;
    try {
      for await (const event of runPipeline(input, {
        github,
        aiConfig,
        ...(sandbox ? { sandbox } : {}),
        ...(repoToken ? { repoToken } : {}),
        ...(authFixture ? { authFixture } : {}),
        ...(fixtures ? { fixtures } : {}),
        ...(memory ? { memory } : {}),
      })) {
        if (event.type === "gaps") {
          scannedGaps = event.gaps;
          if (event.totals) run.totals = event.totals;
        }
        if (event.type === "generation") {
          files.set(event.generation.sourcePath, {
            sourcePath: event.generation.sourcePath,
            testPath: event.generation.testPath,
            decision: "pending",
            verified: false,
            checks: [],
          });
        }
        if (event.type === "validation" && event.sourcePath) {
          const current = files.get(event.sourcePath);
          files.set(event.sourcePath, {
            sourcePath: event.sourcePath,
            testPath: current?.testPath ?? event.sourcePath,
            decision: current?.decision ?? "pending",
            verified: event.validation.verified,
            checks: (event.validation.checks ?? []).map(({ output: _output, ...check }) => check),
            ...(event.validation.coverage ? { coverage: event.validation.coverage } : {}),
          });
        }
        if (event.type === "result") status = event.ok ? "ready" : "failed";
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ type: "error", message }),
      });
    } finally {
      if (history && stored) {
        const finished: RunSummary = { ...run, status, finishedAt: Date.now() };
        await finishRun(history, finished, [...files.values()]).catch(() => undefined);
      }
      if (history && scannedGaps) {
        await syncBacklog(
          history,
          input.repo,
          scannedGaps.map((gap) => ({
            path: gap.path,
            kind: gap.kind ?? "missing",
            risk: gap.risk,
            reason: gap.reason,
          })),
          Date.now(),
          runId,
          ["missing", "api", "unsupported"],
        ).catch(() => undefined);
      }
    }
    await stream.writeSSE({ event: "done", data: "{}" });
  });
});

app.post("/api/generate", async (c) => {
  try {
    const body = await readJson(c);
    const inlineSource = typeof body.source === "string" ? body.source : undefined;
    if (inlineSource !== undefined && !isLocalRequest(c)) {
      throw new HttpError(403, "Local source input is only available on a local Worker.");
    }
    const repo = inlineSource === undefined ? repoOf(body) : undefined;
    const ref = repo ? parseRef(str(body.ref)) : "local";
    const path = str(body.path);
    if (!path) throw new HttpError(400, "path is required.");
    const config = pipelineConfig(body);
    const aiConfig = aiConfigFor(c, body);
    const sandbox = sandboxFor(c);
    const memoryDb = runsDb(c.env);
    const memory =
      repo && memoryDb ? await getMemory(memoryDb, repo).catch(() => undefined) : undefined;
    const repoToken = sandbox?.allowRepoToken
      ? c.req.header(TOKEN_HEADER)?.trim() || undefined
      : undefined;
    const repoArg = repo
      ? sandboxRepo({
          repo,
          ref,
          ...(sandbox ? { sandbox } : {}),
          ...(repoToken ? { token: repoToken } : {}),
        })
      : undefined;

    const github = githubFor(c);
    let source = inlineSource;
    if (source === undefined) {
      if (!repo) throw new HttpError(400, "Enter a repository as owner/name.");
      source = await github.file(repo, path, ref);
    }
    const testPath = path.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, (ext) => `.test${ext}`);
    // Inline local source never leaves the machine; a repo file may become a PR.
    if (repo) assertTestOnly(testPath);

    // A coverage gap carries the measured lines the next test should target.
    const uncoveredLines = numbersOf(body.uncoveredLines);
    const uncoveredBranches = numbersOf(body.uncoveredBranches);
    const coverageHint =
      uncoveredLines.length > 0 || uncoveredBranches.length > 0
        ? { path, uncoveredLines, uncoveredBranches }
        : undefined;

    // The repository's own rules, so a corrected test is measured against the
    // same checks as a pipeline run. Without a runner they cannot execute.
    let checks: Awaited<ReturnType<typeof readRepositoryChecks>> | undefined;
    if (sandbox && repo) {
      const tree = await github.tree(repo, ref);
      const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      checks = await readRepositoryChecks(github, repo, ref, blobs);
    }

    const fastCheck = /"fast-check"\s*:/.test(checks?.support["package.json"] ?? "");
    const properties = config.propertyTests && fastCheck ? { runs: 50, seed: 42 } : undefined;
    const runner = checks?.runner ?? "bun";
    const packageManager = checks?.packageManager ?? "bun";

    let rateLimit: RateLimitInfo | undefined;
    const notices: string[] = [];
    let generationModel = aiConfig.model;
    const write = (previous?: { code: string; output: string }) => {
      const model = config.autoRouteModels
        ? (routeModel(aiConfig.provider, {
            sourceLength: source.length,
            retry: Boolean(previous),
          }) ?? aiConfig.model)
        : aiConfig.model;
      const fallback = nextModel(aiConfig.provider, model);
      generationModel = model;
      return generateTest({
        filePath: path,
        source,
        config: { ...aiConfig, model, ...(fallback ? { fallbackModel: fallback } : {}) },
        runner,
        ...(memory ? { memory } : {}),
        coverageTarget: config.coverageTarget,
        ...(coverageHint ? { coverageHint } : {}),
        ...(properties ? { propertyTests: properties } : {}),
        ...(previous ? { previous } : {}),
        onNotice: (text) => notices.push(text),
        ...(checks && checks.style.length ? { style: checks.style } : {}),
        ...(checks && checks.checks.length
          ? { checks: checks.checks.map((check) => ({ name: check.name, command: check.command })) }
          : {}),
        onRateLimit: (info) => {
          rateLimit = info;
        },
      });
    };

    const formatCode = async (candidate: string): Promise<string> => {
      if (!checks?.formatter || !sandbox) return candidate;
      const formatted = await formatWithRunner({
        sandbox,
        ...(repoArg ? { repo: repoArg } : {}),
        files: { ...checks.support, [path]: source, [testPath]: candidate },
        command: checks.formatter.command,
        path: testPath,
      });
      const next = formatted.code;
      return next && next.trim() ? next : candidate;
    };

    const check = async (candidate: string): Promise<Validation> => {
      let validation = await validateTest({
        sourcePath: path,
        source,
        testPath,
        test: candidate,
        strictTypes: config.strictTypes,
        flakyRuns: config.flakyRuns,
        runner,
        packageManager,
        mutationCommand: config.mutationCommand,
        requireProperties: Boolean(properties),
        ...(sandbox ? { sandbox } : {}),
        ...(repoArg ? { repo: repoArg } : {}),
      });
      const results = await runRepositoryChecks({
        ...(sandbox ? { sandbox } : {}),
        ...(repoArg ? { repo: repoArg } : {}),
        files: { ...checks?.support, [path]: source, [testPath]: candidate },
        checks: checks?.checks ?? [],
      });
      return withChecks(validation, results);
    };

    const previous = previousOf(body);
    let code = await formatCode(await write(previous));
    let validation = await check(code);
    let attempts = 0;
    let corrected = Boolean(previous);

    // Feed every failure back, then re-run the whole check set: a fix for one
    // error must not leave another one behind.
    while (!validation.ok && attempts < config.maxRetries) {
      attempts += 1;
      code = await formatCode(await write({ code, output: validation.output }));
      validation = await check(code);
      corrected = true;
    }

    return c.json({
      generation: {
        sourcePath: path,
        testPath,
        code,
        provider: aiConfig.provider.id,
        model: generationModel,
        corrected,
        promptVersion: PROMPT_VERSION,
        source,
      },
      validation,
      attempts,
      ...(rateLimit ? { rateLimit } : {}),
      ...(notices.length > 0 ? { notices } : {}),
    });
  } catch (err) {
    return fail(err);
  }
});

app.post("/api/pull-request", async (c) => {
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const files = pullFilesOf(body);
    if (files.length === 0) {
      throw new HttpError(400, "Add at least one test file.");
    }
    const strict = pipelineConfig(body).strictTypes;
    for (const file of files) {
      const problems = staticCheck(file.code, strict);
      if (problems.length > 0) {
        throw new HttpError(400, problems.map((p) => p.problem).join(" "));
      }
    }

    // Gates run before any branch or commit exists.
    const meta = pullMetaOf(body);
    const policy = parsePullPolicy(body.policy);
    const blocked = policyBlocked(
      evaluatePullPolicy(policy, { files, ...(meta.draft ? { draft: true } : {}) }),
    );
    const auditDb = runsDb(c.env);
    if (blocked) {
      if (auditDb) {
        await recordAudit(auditDb, {
          repo,
          actor: "dashboard",
          action: "pr_blocked",
          detail: { reason: blocked },
        }).catch(() => undefined);
      }
      throw new HttpError(403, blocked);
    }

    const github = githubFor(c);
    const base = await github.defaultBranch(repo);
    const sha = await github.headSha(repo, base);
    if (meta.branch && !validBranchName(meta.branch)) {
      throw new HttpError(400, "Enter a safe branch name other than the default branch.");
    }
    const single = files.length === 1;
    const fallbackBranch = single
      ? `edgespec/test-${slugOf(files[0]?.sourcePath ?? files[0]?.path ?? "tests")}-${Date.now()}`
      : `edgespec/tests-${Date.now()}`;
    const branch = meta.branch ?? fallbackBranch;
    const commitMessage =
      meta.commitMessage ??
      `test: add generated tests for ${single ? files[0]?.sourcePath : `${files.length} files`}`;

    await github.createBranch(repo, branch, sha);
    // Every test lands on the same branch, so a batch is one pull request.
    for (const file of files) {
      await github.putFile(repo, file.path, file.code, commitMessage, branch);
    }

    const provenanceFiles = files.map((file) => ({
      sourcePath: file.sourcePath,
      testPath: file.path,
      ...(file.provider ? { provider: file.provider } : {}),
      ...(file.model ? { model: file.model } : {}),
      ...(file.promptVersion ? { promptVersion: file.promptVersion } : {}),
      ...(file.corrected ? { corrected: true } : {}),
      ...(file.flaky ? { flaky: true } : {}),
      ...(file.verified !== undefined ? { verified: file.verified } : {}),
      ...(file.checks ? { checks: file.checks } : {}),
      ...(file.coverage ? { coverage: file.coverage } : {}),
      ...(file.mutation ? { mutation: file.mutation } : {}),
    }));
    const url = await github.openPull(repo, {
      title:
        meta.title ??
        (single
          ? `test: add unit tests for ${files[0]?.sourcePath}`
          : `test: add unit tests for ${files.length} files`),
      head: branch,
      base,
      body:
        meta.body ??
        pullRequestBody({
          provider: files[0]?.provider,
          model: files[0]?.model,
          files: provenanceFiles,
          skipped: pullSkippedOf(body),
          testOnly: true,
        }),
      ...(meta.draft ? { draft: true } : {}),
    });

    // Labels and reviewers are policy actions, not gates: never fail the PR for them.
    const pullNumber = Number(/\/pull\/(\d+)\/?$/.exec(url)?.[1]);
    if (pullNumber > 0) {
      if (policy.labels?.length) {
        await github.addLabels(repo, pullNumber, policy.labels).catch(() => undefined);
      }
      if (policy.reviewers?.length) {
        await github.requestReviewers(repo, pullNumber, policy.reviewers).catch(() => undefined);
      }
    }

    if (auditDb) {
      await recordAudit(auditDb, {
        repo,
        actor: "dashboard",
        action: "pr_opened",
        detail: { url, files: files.length },
      }).catch(() => undefined);
    }

    // The pull request is the acceptance decision, when the client knows the run.
    const history = runsDb(c.env);
    const runId = str(body.runId);
    if (history && runId && /^[A-Za-z0-9-]{8,64}$/.test(runId)) {
      await setRunDecisions(
        history,
        runId,
        files.map((file) => ({ sourcePath: file.sourcePath, decision: "accepted" as const })),
      ).catch(() => undefined);
    }
    return c.json({ url, files: files.length });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/pulls", async (c) => {
  try {
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    const pulls = await githubFor(c).pulls(`${repo.owner}/${repo.name}`);
    return c.json({ pulls });
  } catch (err) {
    return fail(err);
  }
});

app.post("/webhook", async (c) => {
  try {
    const raw = await c.req.text();
    const secret = c.env.GITHUB_WEBHOOK_SECRET;
    if (secret && !(await validSignature(secret, raw, c.req.header("x-hub-signature-256") ?? ""))) {
      throw new HttpError(401, "Invalid webhook signature.");
    }

    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(raw));
    } catch {
      throw new HttpError(400, "Invalid JSON payload.");
    }

    const repository = asRecord(payload.repository);
    const repo = str(repository.full_name);
    if (!repo) throw new HttpError(400, "Webhook payload has no repository.");
    const ref = str(payload.ref)?.replace(/^refs\/heads\//, "") ?? "main";
    // An App webhook names its installation; a PAT deployment sends none.
    const installationId = Number(asRecord(payload.installation).id);
    const useApp = Number.isInteger(installationId) && installationId > 0;

    const binding = c.env.TEST_GENERATION_WORKFLOW;
    if (!binding) throw new HttpError(501, "Workflows are not bound on this deployment.");
    const installation = useApp ? { installationId } : {};

    if (c.req.header("x-github-event") === "issue_comment") {
      if (str(payload.action) !== "created") {
        return c.json({ ignored: str(payload.action) ?? "action" }, 202);
      }
      const issue = asRecord(payload.issue);
      if (!issue.pull_request) return c.json({ ignored: "not a pull request" }, 202);
      const comment = asRecord(payload.comment);
      const command = parsePrCommand(str(comment.body) ?? "");
      if (!command) return c.json({ ignored: "not a command" }, 202);
      const user = asRecord(comment.user);
      const login = str(user.login) ?? "";
      if (
        !login ||
        !authorizedCommenter({
          association: str(comment.author_association),
          userType: str(user.type),
        })
      ) {
        return c.json({ ignored: "unauthorized" }, 202);
      }
      const number = Number(issue.number);
      if (!Number.isInteger(number) || number <= 0) {
        return c.json({ ignored: "no pull request" }, 202);
      }
      const db = runsDb(c.env);
      const allowed = db
        ? await claimPrCommand(db, repo, number, login, command.name)
        : allowCommandInMemory(`${repo}#${number}:${login}:${command.name}`);
      if (!allowed) return c.json({ ignored: "rate limited" }, 202);
      const instance = await binding.create({
        params: {
          repo,
          ref: "main",
          pullRequest: number,
          event: "pr_command",
          command: {
            ...command,
            commentId: Number(comment.id) || 0,
            login,
          },
          ...installation,
        },
      });
      return c.json({ workflowId: instance.id }, 202);
    }

    if (c.req.header("x-github-event") === "pull_request") {
      const action = str(payload.action);
      if (!["opened", "synchronize", "reopened"].includes(action ?? "")) {
        return c.json({ ignored: action ?? "unknown action" }, 202);
      }
      const pullRequest = asRecord(payload.pull_request);
      const number = Number(pullRequest.number);
      const headSha = str(asRecord(pullRequest.head).sha);
      if (!Number.isInteger(number) || number <= 0 || !headSha) {
        throw new HttpError(400, "Pull request payload has no number or head commit.");
      }
      const instance = await binding.create({
        params: {
          repo,
          ref: headSha,
          headSha,
          pullRequest: number,
          event: "pull_request",
          ...installation,
        },
      });
      return c.json({ workflowId: instance.id }, 202);
    }

    const instance = await binding.create({
      params: { repo, ref, event: "push", ...installation },
    });
    return c.json({ workflowId: instance.id }, 202);
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/backlog", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false, items: [] });
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    return c.json({
      enabled: true,
      items: await listBacklog(db, `${repo.owner}/${repo.name}`),
    });
  } catch (err) {
    return fail(err);
  }
});

app.patch("/api/backlog", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "The backlog needs the RUNS_DB binding.");
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    const body = await readJson(c);
    const path = str(body.path);
    const state = str(body.state);
    if (!path || !state || !["open", "accepted", "rejected", "ignored", "closed"].includes(state)) {
      throw new HttpError(400, "Pass a path and a valid state.");
    }
    const owner = str(body.owner)?.slice(0, 120);
    await setBacklogState(db, `${repo.owner}/${repo.name}`, path, state as BacklogState, owner);
    await recordAudit(db, {
      repo: `${repo.owner}/${repo.name}`,
      actor: "dashboard",
      action: "backlog_updated",
      detail: { path, state },
    }).catch(() => undefined);
    return c.json({ updated: true });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/schedules", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false, schedules: [] });
    return c.json({ enabled: true, schedules: await listScheduledRepos(db) });
  } catch (err) {
    return fail(err);
  }
});

app.put("/api/schedules", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Scheduled scans need the RUNS_DB binding.");
    const body = await readJson(c);
    const parsed = parseRepo(str(body.repo));
    if (!parsed) throw new HttpError(400, "Enter a repository as owner/name.");
    const days = Number(body.intervalDays);
    const installationId = Number(body.installationId);
    const intervalDays = Number.isFinite(days) ? Math.min(30, Math.max(1, Math.round(days))) : 7;
    await putScheduledRepo(db, {
      repo: `${parsed.owner}/${parsed.name}`,
      intervalDays,
      enabled: body.enabled !== false,
      ...(Number.isInteger(installationId) && installationId > 0 ? { installationId } : {}),
    });
    await recordAudit(db, {
      repo: `${parsed.owner}/${parsed.name}`,
      actor: "dashboard",
      action: "schedule_updated",
      detail: { intervalDays, enabled: body.enabled !== false },
    }).catch(() => undefined);
    return c.json({ enabled: true, schedules: await listScheduledRepos(db) });
  } catch (err) {
    return fail(err);
  }
});

app.delete("/api/schedules", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Scheduled scans need the RUNS_DB binding.");
    const parsed = parseRepo(c.req.query("repo"));
    if (!parsed) throw new HttpError(400, "Pass ?repo=owner/name.");
    await deleteScheduledRepo(db, `${parsed.owner}/${parsed.name}`);
    await recordAudit(db, {
      repo: `${parsed.owner}/${parsed.name}`,
      actor: "dashboard",
      action: "schedule_deleted",
    }).catch(() => undefined);
    return c.json({ deleted: true });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/workspace", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false });
    return c.json({ enabled: true, workspace: await getWorkspace(db) });
  } catch (err) {
    return fail(err);
  }
});

app.put("/api/workspace", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Workspace settings need the RUNS_DB binding.");
    const body = await readJson(c);
    const workspace = await putWorkspace(db, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(body.retentionDays !== undefined ? { retentionDays: Number(body.retentionDays) } : {}),
    });
    await recordAudit(db, {
      actor: "dashboard",
      action: "workspace_updated",
      detail: { retentionDays: workspace.retentionDays, name: workspace.name },
    }).catch(() => undefined);
    return c.json({ enabled: true, workspace });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/audit", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false, events: [] });
    const parsed = parseRepo(c.req.query("repo"));
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({
      enabled: true,
      events: await listAudit(db, {
        ...(parsed ? { repo: `${parsed.owner}/${parsed.name}` } : {}),
        limit,
      }),
    });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/memory", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false, memory: {} });
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    return c.json({
      enabled: true,
      memory: await getMemory(db, `${repo.owner}/${repo.name}`),
    });
  } catch (err) {
    return fail(err);
  }
});

app.put("/api/memory", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Repository memory needs the RUNS_DB binding.");
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    const body = await readJson(c);
    const memory = await putMemory(
      db,
      `${repo.owner}/${repo.name}`,
      parseRepoMemory(body.memory ?? body),
    );
    await recordAudit(db, {
      repo: `${repo.owner}/${repo.name}`,
      actor: "dashboard",
      action: "memory_updated",
      detail: { fields: Object.keys(memory) },
    }).catch(() => undefined);
    return c.json({ enabled: true, memory });
  } catch (err) {
    return fail(err);
  }
});

app.delete("/api/memory", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Repository memory needs the RUNS_DB binding.");
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    await deleteMemory(db, `${repo.owner}/${repo.name}`);
    return c.json({ deleted: true });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/policies", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false, policy: {} });
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    const policy = await getPolicy(db, `${repo.owner}/${repo.name}`);
    return c.json({ enabled: true, policy });
  } catch (err) {
    return fail(err);
  }
});

app.put("/api/policies", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Policy storage is not enabled on this deployment.");
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    const body = await readJson(c);
    const policy = await putPolicy(
      db,
      `${repo.owner}/${repo.name}`,
      parsePullPolicy(body.policy ?? body),
    );
    await recordAudit(db, {
      repo: `${repo.owner}/${repo.name}`,
      actor: "dashboard",
      action: "policy_updated",
      detail: { gates: Object.keys(policy) },
    }).catch(() => undefined);
    return c.json({ enabled: true, policy });
  } catch (err) {
    return fail(err);
  }
});

app.delete("/api/policies", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Policy storage is not enabled on this deployment.");
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    await deletePolicy(db, `${repo.owner}/${repo.name}`);
    return c.json({ deleted: true });
  } catch (err) {
    return fail(err);
  }
});

/** History ids are UUID-shaped; the guard keeps SQL parameters and URLs honest. */
const HISTORY_ID = /^[A-Za-z0-9-]{8,64}$/;

app.get("/api/runs", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false, runs: [] });
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    const limit = Number(c.req.query("limit") ?? 20);
    const runs = await listRuns(db, `${repo.owner}/${repo.name}`, limit);
    return c.json({ enabled: true, runs });
  } catch (err) {
    return fail(err);
  }
});

app.delete("/api/runs", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Run history is not enabled on this deployment.");
    const repo = parseRepo(c.req.query("repo"));
    if (!repo) throw new HttpError(400, "Pass ?repo=owner/name.");
    const deleted = await deleteRunHistory(db, `${repo.owner}/${repo.name}`);
    return c.json({ deleted });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/runs/:id/files", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) return c.json({ enabled: false });
    const id = c.req.param("id");
    if (!HISTORY_ID.test(id)) throw new HttpError(400, "Invalid run id.");
    const detail = await getRun(db, id);
    if (!detail) throw new HttpError(404, "Run not found.");
    return c.json({ enabled: true, ...detail });
  } catch (err) {
    return fail(err);
  }
});

app.post("/api/runs/:id/decisions", async (c) => {
  try {
    const db = runsDb(c.env);
    if (!db) throw new HttpError(501, "Run history is not enabled on this deployment.");
    const id = c.req.param("id");
    if (!HISTORY_ID.test(id)) throw new HttpError(400, "Invalid run id.");
    const body = await readJson(c);
    const decisions: Array<{ sourcePath: string; decision: RunDecision }> = [];
    for (const entry of Array.isArray(body.decisions) ? body.decisions : []) {
      const item = asRecord(entry);
      const sourcePath = str(item.sourcePath);
      const decision = str(item.decision);
      if (
        !sourcePath ||
        (decision !== "accepted" && decision !== "rejected" && decision !== "pending")
      ) {
        continue;
      }
      decisions.push({ sourcePath, decision });
    }
    if (decisions.length === 0) throw new HttpError(400, "Pass at least one decision.");
    await setRunDecisions(db, id, decisions.slice(0, 200));
    return c.json({ updated: Math.min(decisions.length, 200) });
  } catch (err) {
    return fail(err);
  }
});

app.get("/api/runs/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpError(400, "Invalid workflow id.");
    const binding = c.env.TEST_GENERATION_WORKFLOW;
    if (!binding) throw new HttpError(501, "Workflows are not bound on this deployment.");
    const instance = await binding.get(id);
    return c.json(await instance.status());
  } catch (err) {
    return fail(err);
  }
});

// Local filesystem access is a development convenience, only on localhost.
app.get("/local-api/scan", (c) => {
  if (!isLocalRequest(c))
    return c.json({ error: "Local access is only available on localhost." }, 403);
  return c.json({ error: "Local folder access requires the Vite dev server (bun run dev)." }, 400);
});

app.get("/local-api/file", (c) => {
  if (!isLocalRequest(c))
    return c.json({ error: "Local access is only available on localhost." }, 403);
  return c.json({ error: "Local file access requires the Vite dev server (bun run dev)." }, 400);
});

// Unknown API paths must return JSON, not the SPA's index.html.
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Anything else is a static asset (assets-first routing in wrangler.toml).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: runScheduled,
};
