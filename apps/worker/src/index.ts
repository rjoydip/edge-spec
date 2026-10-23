import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AiConfig } from "@edge-spec/core/ai";
import { generateTest, probeRateLimit } from "@edge-spec/core/ai";
import {
  DEFAULT_AI,
  DEFAULT_PIPELINE,
  PROVIDERS,
  parseRef,
  parseRepo,
  parseSandboxUrl,
  pipelineConfig,
  resolveAi,
} from "@edge-spec/core/catalog";
import { GitHub } from "@edge-spec/core/github";
import { readRepositoryChecks, runPipeline, withChecks } from "@edge-spec/core/pipeline";
import { detectChecks, SUPPORT_FILES } from "@edge-spec/core/ci";
import { pullFilesOf, slugOf } from "@edge-spec/core/pr";
import {
  describeRepository,
  extractExports,
  findGaps,
  packageFacts,
  riskOf,
} from "@edge-spec/core/scanner";
import {
  formatWithRunner,
  runRepositoryChecks,
  staticCheck,
  validateTest,
  type SandboxConfig,
} from "@edge-spec/core/validate";
import { HttpError, type Gap, type RateLimitInfo, type Validation } from "@edge-spec/core/types";
import type { Env } from "./env";

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

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

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
  return {
    provider: choice.provider,
    model: choice.model,
    ...(choice.apiKey ? { apiKey: choice.apiKey } : {}),
    ...(choice.baseUrl ? { baseUrl: choice.baseUrl } : {}),
    ...(choice.accountId ? { accountId: choice.accountId } : {}),
    ...(useBinding && c.env.AI ? { ai: c.env.AI } : {}),
  };
}

/**
 * The runner that executes the suite. A visitor may point at their own runner
 * with a header; otherwise the deployment's binding is used.
 */
function sandboxFor(c: AppContext): SandboxConfig | undefined {
  const own = parseSandboxUrl(c.req.header(SANDBOX_URL_HEADER));
  if (own) {
    const key = c.req.header(SANDBOX_KEY_HEADER)?.trim();
    return { url: own, ...(key ? { apiKey: key } : {}) };
  }
  const url = c.env.SANDBOX_RUNNER_URL?.trim();
  if (!url) return undefined;
  return { url, ...(c.env.SANDBOX_API_KEY ? { apiKey: c.env.SANDBOX_API_KEY } : {}) };
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
    const gaps = findGaps(blobs, 25);

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
    try {
      Object.assign(overview, packageFacts(await github.file(repo, "package.json", ref)));
    } catch {
      // No package.json at the root.
    }

    // The commands the repository's CI runs, so the dashboard can show them
    // before anything is generated.
    const ruleFiles: Record<string, string> = {};
    const workflowPaths = blobs
      .filter((path) => path.startsWith(".github/workflows/") && path.endsWith(".yml"))
      .slice(0, 4);
    for (const path of [
      ...workflowPaths,
      ...blobs.filter((path) => SUPPORT_FILES.includes(path)),
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

    return c.json({
      repo,
      ref,
      scanned: blobs.length,
      gaps: [...enriched, ...gaps.slice(8)],
      overview,
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
    input: ReturnType<typeof pipelineConfig> & { repo: string; ref: string; retryGaps?: string[] };
  };
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const ref = parseRef(str(body.ref));
    const retryGaps = Array.isArray(body.retryGaps)
      ? body.retryGaps.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : undefined;
    prepared = {
      repo,
      ref,
      github: githubFor(c),
      aiConfig: aiConfigFor(c, body),
      input: { repo, ref, ...pipelineConfig(body), ...(retryGaps ? { retryGaps } : {}) },
    };
  } catch (err) {
    return fail(err);
  }

  const { github, aiConfig, input } = prepared;
  return streamSSE(c, async (stream) => {
    try {
      for await (const event of runPipeline(input, {
        github,
        aiConfig,
        ...(sandboxFor(c) ? { sandbox: sandboxFor(c) } : {}),
      })) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ type: "error", message }),
      });
    }
    await stream.writeSSE({ event: "done", data: "{}" });
  });
});

app.post("/api/generate", async (c) => {
  try {
    const body = await readJson(c);
    const repo = repoOf(body);
    const ref = parseRef(str(body.ref));
    const path = str(body.path);
    if (!path) throw new HttpError(400, "path is required.");
    const config = pipelineConfig(body);
    const aiConfig = aiConfigFor(c, body);
    const sandbox = sandboxFor(c);

    const github = githubFor(c);
    const source = await github.file(repo, path, ref);
    const testPath = path.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, (ext) => `.test${ext}`);

    // The repository's own rules, so a corrected test is measured against the
    // same checks as a pipeline run. Without a runner they cannot execute.
    let checks: Awaited<ReturnType<typeof readRepositoryChecks>> | undefined;
    if (sandbox) {
      const tree = await github.tree(repo, ref);
      const blobs = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      checks = await readRepositoryChecks(github, repo, ref, blobs);
    }

    let rateLimit: RateLimitInfo | undefined;
    const write = (previous?: { code: string; output: string }) =>
      generateTest({
        filePath: path,
        source,
        config: aiConfig,
        coverageTarget: config.coverageTarget,
        ...(previous ? { previous } : {}),
        ...(checks && checks.style.length ? { style: checks.style } : {}),
        ...(checks && checks.checks.length
          ? { checks: checks.checks.map((check) => ({ name: check.name, command: check.command })) }
          : {}),
        onRateLimit: (info) => {
          rateLimit = info;
        },
      });

    const formatCode = async (candidate: string): Promise<string> => {
      if (!checks?.formatter || !sandbox) return candidate;
      const formatted = await formatWithRunner({
        sandbox,
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
        ...(sandbox ? { sandbox } : {}),
      });
      const results = await runRepositoryChecks({
        ...(sandbox ? { sandbox } : {}),
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
        model: aiConfig.model,
        corrected,
        source,
      },
      validation,
      attempts,
      ...(rateLimit ? { rateLimit } : {}),
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

    const github = githubFor(c);
    const base = await github.defaultBranch(repo);
    const sha = await github.headSha(repo, base);
    const single = files.length === 1;
    const branch = single
      ? `edgespec/test-${slugOf(files[0]?.sourcePath ?? files[0]?.path ?? "tests")}-${Date.now()}`
      : `edgespec/tests-${Date.now()}`;

    await github.createBranch(repo, branch, sha);
    // Every test lands on the same branch, so a batch is one pull request.
    for (const file of files) {
      await github.putFile(
        repo,
        file.path,
        file.code,
        `test: add generated tests for ${file.sourcePath}`,
        branch,
      );
    }

    const listing = files
      .map((file) => `- \`${file.path}\` (for \`${file.sourcePath}\`)`)
      .join("\n");
    const url = await github.openPull(repo, {
      title: single
        ? `test: add unit tests for ${files[0]?.sourcePath}`
        : `test: add unit tests for ${files.length} files`,
      head: branch,
      base,
      body: [
        "### EdgeSpec",
        "",
        single
          ? `Generated unit tests for \`${files[0]?.sourcePath}\`.`
          : `Generated unit tests for ${files.length} files.`,
        "",
        listing,
        "",
        "Review before merging — generated tests are a draft, not a proof.",
      ].join("\n"),
    });
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

    const binding = c.env.TEST_GENERATION_WORKFLOW;
    if (!binding) throw new HttpError(501, "Workflows are not bound on this deployment.");
    const instance = await binding.create({ params: { repo, ref } });
    return c.json({ workflowId: instance.id }, 202);
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

// Unknown API paths must return JSON, not the SPA's index.html.
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Anything else is a static asset (assets-first routing in wrangler.toml).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
