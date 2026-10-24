#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EdgeSpecClient,
  clientConfigFromEnv,
  collectGenerations,
  envDefaults,
  finalResult,
  folderFirst,
  type Catalog,
  type Env,
  type EnvDefaults,
  type RunEvent,
  type ScanResult,
  type Validation,
} from "@edge-spec/client";
import { helpText, parseCliArgs, UsageError, type ParsedArgs } from "./args";

const VERSION = "0.1.0";

function stderr(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function makeClient(
  env: Env,
  options: { url?: string; provider?: string; sandboxUrl?: string },
): { client: EdgeSpecClient; defaults: EnvDefaults } {
  const defaults = envDefaults(env, options.provider);
  const config = clientConfigFromEnv(env, options.provider);
  return {
    client: new EdgeSpecClient({
      ...config,
      ...(options.url ? { baseUrl: options.url } : {}),
      ...(options.sandboxUrl ? { sandboxUrl: options.sandboxUrl } : {}),
    }),
    defaults,
  };
}

function aiOptions(
  options: { provider?: string; model?: string; accountId?: string },
  defaults: EnvDefaults,
): { provider?: string; model?: string; accountId?: string } {
  return {
    ...((options.provider ?? defaults.provider)
      ? { provider: options.provider ?? defaults.provider }
      : {}),
    ...((options.model ?? defaults.model) ? { model: options.model ?? defaults.model } : {}),
    ...((options.accountId ?? defaults.accountId)
      ? { accountId: options.accountId ?? defaults.accountId }
      : {}),
  };
}

function printValidation(validation: Validation): void {
  const status = validation.ok ? "passed" : "failed";
  const mode = validation.verified ? "executed" : "static check only";
  stderr(`Validation: ${status} (${mode}) in ${validation.durationMs} ms`);
  if (validation.output.trim()) stderr(validation.output.trim());
  for (const check of validation.checks ?? []) {
    stderr(`Check ${check.name}: ${check.ok ? "passed" : check.skipped ? "skipped" : "failed"}`);
  }
}

function printScan(result: ScanResult, options: { folder?: string; limit?: number }): void {
  const overview = result.overview;
  process.stdout.write(`${result.repo}@${result.ref}\n`);
  if (overview) {
    process.stdout.write(
      `${overview.totalFiles} files · ${overview.sourceFiles} sources · ${overview.testFiles} tests\n`,
    );
    if (overview.languages.length > 0) {
      process.stdout.write(
        `Languages: ${overview.languages
          .slice(0, 5)
          .map((language) => `${language.name} ${language.count}`)
          .join(", ")}\n`,
      );
    }
    if (overview.packageManager || overview.runtime) {
      process.stdout.write(
        `Runtime: ${[overview.packageManager, overview.runtime].filter(Boolean).join(" / ")}\n`,
      );
    }
    if (overview.checks?.length) {
      process.stdout.write(
        `Checks: ${overview.checks.map((check) => `${check.name} (${check.command})`).join(", ")}\n`,
      );
    }
  }
  let gaps = folderFirst(result.gaps, options.folder);
  if (options.limit !== undefined) gaps = gaps.slice(0, options.limit);
  if (gaps.length === 0) {
    process.stdout.write("No missing tests.\n");
    return;
  }
  process.stdout.write(`\nMissing tests (${gaps.length}):\n`);
  for (const gap of gaps) {
    const symbols = gap.exports.length > 0 ? `  [${gap.exports.join(", ")}]` : "";
    process.stdout.write(`${gap.risk.toUpperCase().padEnd(6)} ${gap.path}${symbols}\n`);
  }
}

function printCatalog(catalog: Catalog): void {
  process.stdout.write("EdgeSpec providers\n\n");
  for (const provider of catalog.providers) {
    process.stdout.write(`${provider.id}  ${provider.name}\n`);
    for (const model of provider.models) {
      process.stdout.write(`  ${model.id}  ${model.name}\n`);
    }
  }
  process.stdout.write(
    `\nDefaults: ${catalog.defaults.ai.provider} / ${catalog.defaults.ai.model}\n`,
  );
  process.stdout.write(`Sandbox: ${catalog.sandbox ? "configured" : "not configured"}\n`);
}

function printEvent(event: RunEvent): void {
  switch (event.type) {
    case "log":
      stderr(`[${event.level}] ${event.text}`);
      break;
    case "step":
      stderr(`[${event.step}] ${event.status}${event.note ? ` · ${event.note}` : ""}`);
      break;
    case "gaps":
      stderr(`[scan] ${event.gaps.length} missing test(s)`);
      break;
    case "generation":
      stderr(
        `[generate] ${event.generation.testPath} (${event.generation.code.split("\n").length} lines)`,
      );
      break;
    case "validation":
      stderr(
        `[validate] ${event.validation.ok ? "passed" : "failed"} · ${
          event.validation.verified ? "executed" : "static check only"
        }`,
      );
      break;
    case "quota":
      stderr(
        `[quota] ${event.rateLimit.provider}${event.rateLimit.remaining !== undefined ? ` · ${event.rateLimit.remaining} left` : ""}`,
      );
      break;
    case "result":
      stderr(
        `[result] ${event.ok ? "ok" : "failed"}${
          event.ready?.length ? ` · ${event.ready.length} ready` : ""
        }${event.reason ? ` · ${event.reason}` : ""}`,
      );
      break;
    case "error":
      stderr(`[error] ${event.message}`);
      break;
  }
}

async function execute(parsed: ParsedArgs, env: Env): Promise<void> {
  if (parsed.command === "help") {
    process.stdout.write(helpText);
    return;
  }
  if (parsed.command === "version") {
    process.stdout.write(`edge-spec ${VERSION}\n`);
    return;
  }

  const { client, defaults } = makeClient(env, {
    ...(parsed.url ? { url: parsed.url } : {}),
    ...(parsed.command === "run" || parsed.command === "generate"
      ? { provider: parsed.provider, sandboxUrl: parsed.sandboxUrl }
      : {}),
  });

  if (parsed.command === "catalog") {
    const catalog = await client.catalog();
    if (parsed.json) json(catalog);
    else printCatalog(catalog);
    return;
  }

  if (parsed.command === "scan") {
    const result = await client.scan({
      repo: parsed.repo,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
    });
    const gaps = folderFirst(result.gaps, parsed.folder);
    const limited = parsed.limit !== undefined ? gaps.slice(0, parsed.limit) : gaps;
    if (parsed.json) json({ ...result, gaps: limited });
    else
      printScan(result, {
        ...(parsed.folder ? { folder: parsed.folder } : {}),
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
      });
    return;
  }

  const ai = aiOptions(parsed, defaults);

  if (parsed.command === "generate") {
    const result = await client.generate({
      repo: parsed.repo,
      path: parsed.path,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...ai,
      ...(parsed.coverageTarget !== undefined ? { coverageTarget: parsed.coverageTarget } : {}),
      ...(parsed.maxRetries !== undefined ? { maxRetries: parsed.maxRetries } : {}),
      ...(parsed.maxAiRetries !== undefined ? { maxAiRetries: parsed.maxAiRetries } : {}),
      strictTypes: parsed.strictTypes,
    });

    let pullRequest: { url: string; files: number } | undefined;
    if (parsed.pr && result.validation.ok) {
      pullRequest = await client.openPullRequest({
        repo: parsed.repo,
        strictTypes: parsed.strictTypes,
        files: [
          {
            path: result.generation.testPath,
            code: result.generation.code,
            sourcePath: result.generation.sourcePath,
          },
        ],
      });
    } else if (parsed.pr && !parsed.json) {
      stderr("Skipped pull request: validation failed.");
    }

    if (parsed.json) {
      json({ ...result, ...(pullRequest ? { pullRequest } : {}) });
    } else {
      if (parsed.out) {
        await mkdir(dirname(parsed.out), { recursive: true });
        await writeFile(parsed.out, result.generation.code, "utf8");
        stderr(`Wrote ${parsed.out}`);
      } else {
        process.stdout.write(`${result.generation.code}\n`);
      }
      printValidation(result.validation);
      if (pullRequest) stderr(`Opened pull request: ${pullRequest.url}`);
    }
    if (!result.validation.ok) process.exitCode = 1;
    return;
  }

  const events: RunEvent[] = [];
  const result = await client.run(
    {
      repo: parsed.repo,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...ai,
      ...(parsed.coverageTarget !== undefined ? { coverageTarget: parsed.coverageTarget } : {}),
      ...(parsed.maxRetries !== undefined ? { maxRetries: parsed.maxRetries } : {}),
      ...(parsed.maxAiRetries !== undefined ? { maxAiRetries: parsed.maxAiRetries } : {}),
      ...(parsed.maxFiles !== undefined ? { maxFiles: parsed.maxFiles } : {}),
      strictTypes: parsed.strictTypes,
    },
    (event) => {
      events.push(event);
      if (!parsed.json) printEvent(event);
    },
  );

  const all = events.length > 0 ? events : result;
  const final = finalResult(all);
  if (!final) throw new Error("EdgeSpec finished without a result event.");
  const generated = collectGenerations(all);

  let pullRequest: { url: string; files: number } | undefined;
  if (parsed.pr && final.ok && final.ready?.length) {
    const files = final.ready.flatMap((path) => {
      const item = generated.get(path);
      return item
        ? [
            {
              path: item.generation.testPath,
              code: item.generation.code,
              sourcePath: item.generation.sourcePath,
            },
          ]
        : [];
    });
    if (files.length === 0)
      throw new Error("No generated code was available for the pull request.");
    pullRequest = await client.openPullRequest({
      repo: parsed.repo,
      strictTypes: parsed.strictTypes,
      files,
    });
  }

  if (parsed.json) {
    json({
      result: final,
      generations: [...generated.values()],
      ...(pullRequest ? { pullRequest } : {}),
    });
  } else {
    stderr(
      `\n${final.ok ? "Passed" : "Finished"}${final.ready?.length ? `: ${final.ready.length} test(s) ready` : ""}`,
    );
    if (final.reason) stderr(`Reason: ${final.reason}`);
    if (pullRequest) stderr(`Opened pull request: ${pullRequest.url}`);
  }
  if (!final.ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  try {
    const parsed = parseCliArgs(process.argv.slice(2));
    await execute(parsed, process.env);
  } catch (error) {
    if (error instanceof UsageError) {
      stderr(`error: ${error.message}\n\n${helpText}`);
      process.exitCode = 2;
      return;
    }
    stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
