/**
 * Prompt construction and provider dispatch. The key belongs to the caller and
 * is only ever placed in the upstream request headers.
 */
import type { Provider } from "./catalog";
import { lineRanges, type CoverageTarget } from "./coverage";
import { HttpError, type RateLimitInfo } from "./types";

/** Minimal shape of the Workers AI binding; avoids pulling Worker types into DOM. */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface AiConfig {
  provider: Provider;
  model: string;
  /** Another model of the same provider, tried once on quota/5xx. */
  fallbackModel?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Cloudflare account for Workers AI BYOK. */
  accountId?: string;
  ai?: AiBinding;
}

/** Tokens a provider says it used. Only reported numbers are counted. */
export interface TokenUsage {
  input: number;
  output: number;
}

export interface GenerateInput {
  filePath: string;
  source: string;
  config: AiConfig;
  /** Previous attempt plus the runner output, for the self-correction loop. */
  previous?: { code: string; output: string };
  /** Advisory: the prompt asks the model to aim for this branch coverage. */
  coverageTarget?: number;
  /** Uncovered lines and branches from the last executed report, when measured. */
  coverageHint?: CoverageTarget;
  /** The style rules the repository formats with. */
  style?: string[];
  /** The commands CI runs, so the test satisfies them. */
  checks?: { name: string; command: string }[];
  /** Called when the provider states how many calls are left. */
  onRateLimit?: (info: RateLimitInfo) => void;
  /** Called with the usage the provider reported for the answer it returned. */
  onUsage?: (usage: TokenUsage) => void;
  /** A fallback, a caveat: something the reader should see in the log. */
  onNotice?: (text: string) => void;
  fetchImpl?: typeof fetch;
}

const SYSTEM =
  "You write focused, deterministic TypeScript unit tests. You never invent APIs that are not in the provided source.";

export function buildPrompt(input: GenerateInput): string {
  const correction = input.previous
    ? `\nThe previous attempt failed. Fix every failure listed below, not only the first.\n\nPrevious test:\n\`\`\`ts\n${input.previous.code}\n\`\`\`\n\nFailure output:\n\`\`\`\n${input.previous.output.slice(0, 6000)}\n\`\`\`\n`
    : "";

  const style = input.style?.length
    ? `\nFormatting and style rules of this repository:\n${input.style.map((rule) => `- ${rule}`).join("\n")}\n`
    : "";

  const checks = input.checks?.length
    ? `\nThe CI of this repository runs these commands, so the test must satisfy them:\n${input.checks
        .map((check) => `- \`${check.command}\``)
        .join("\n")}\n`
    : "";

  const hint = input.coverageHint;
  const hintLines = hint ? lineRanges(hint.uncoveredLines) : "";
  const hintBranches = hint?.uncoveredBranches.slice(0, 5).join(", ") ?? "";
  const targeting =
    hintLines || hintBranches
      ? `\nA real coverage report for this file found gaps. Target them directly:\n${hintLines ? `- Uncovered lines: ${hintLines}. Add assertions for the behavior on these lines.\n` : ""}${hintBranches ? `- Uncovered branches on lines: ${hintBranches}. Exercise both outcomes.\n` : ""}`
      : "";

  return `Write a complete unit test file for the source below.

File: ${input.filePath}
Runner: Bun (\`bun:test\`) with TypeScript.

Rules:
- Use \`import { describe, it, expect, mock, beforeEach } from "bun:test";\`
- Import the subject from \`./${importName(input.filePath)}\` (same directory as the test).
- Mock network, timers and randomness. No real HTTP, no sleeps.
- Cover exported functions and the edge cases a reviewer would ask for: empty input, invalid input, thrown errors, boundaries.
- Aim for at least ${input.coverageTarget ?? 90}% branch coverage of the exported surface.
- Keep it one file and make it pass against the source exactly as written.
- Write the code in the style of the repository, so a formatter does not change it.
- Do not add a coverage comment or prose outside the code block.
${style}${checks}${targeting}
Source:
\`\`\`ts
${input.source.slice(0, 24000)}
\`\`\`
${correction}
Return only one fenced TypeScript code block.`;
}

function importName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, "");
}

/** Pulls the first fenced block out of a model reply; falls back to the reply. */
export function extractCode(reply: string): string {
  const fenced = reply.match(/```(?:typescript|ts|tsx|javascript|js)?\s*\n([\s\S]*?)```/i);
  const code = (fenced?.[1] ?? reply).trim();
  return code
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

export function isPlausibleTest(code: string): boolean {
  if (code.length < 40) return false;
  if (!/\b(describe|it|test)\s*\(/.test(code)) return false;
  if (!/\bexpect\s*\(/.test(code)) return false;
  return true;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** Reads the token usage each protocol reports, if it reports any. */
function usageOf(value: unknown): TokenUsage | undefined {
  const record = asRecord(value);
  const usage = asRecord(record.usage ?? record.usageMetadata);
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount);
  const output = Number(
    usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount,
  );
  if (!Number.isFinite(input) && !Number.isFinite(output)) return undefined;
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textFrom(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => textFrom(asRecord(part).text ?? part)).join("");
  }
  return "";
}

/** How long a provider may take before the request is given up on. */
export const AI_TIMEOUT_MS = 180_000;

/** True when the request was aborted because it ran out of time. */
export function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /abort(ed)? due to timeout|timed? ?out/i.test(message)
  );
}

/** The rate limit headers a provider sends, if it sends any. */
function rateLimitOf(response: Response, provider: string): RateLimitInfo | undefined {
  const read = (...names: string[]): number | undefined => {
    for (const name of names) {
      const value = response.headers.get(name);
      if (value === null) continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };
  const limit = read("x-ratelimit-limit-requests", "anthropic-ratelimit-requests-limit");
  const remaining = read(
    "x-ratelimit-remaining-requests",
    "anthropic-ratelimit-requests-remaining",
  );
  const reset = read("x-ratelimit-reset-requests", "anthropic-ratelimit-requests-reset");
  if (limit === undefined && remaining === undefined) return undefined;
  return {
    provider,
    ...(limit !== undefined ? { limit } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(reset !== undefined ? { resetSeconds: reset } : {}),
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: unknown },
  provider: string,
  model: string,
): Promise<{ data: unknown; rateLimit?: RateLimitInfo }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...init.headers },
      body: JSON.stringify(init.body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (error) {
    // A provider that answers slowly is not the same as one that is gone.
    if (isTimeout(error)) {
      throw new HttpError(
        504,
        `The provider did not answer within ${Math.round(AI_TIMEOUT_MS / 1000)} seconds. It may be busy, or the model may be slow: try a faster model, or generate one file at a time.`,
      );
    }
    throw new HttpError(
      502,
      `AI provider unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    // A retired model answers with a 404. Say so in words the reader can act
    // on, instead of pasting the provider's JSON.
    if (response.status === 404) {
      throw new HttpError(
        400,
        `The model "${model}" is not available at ${provider} any more. Choose another model in Settings.`,
      );
    }
    // Provider bodies can echo request headers; keep the message short and never
    // include the key ourselves.
    // Keep the distinction the fallback rule needs: a client error is final,
    // quota and server errors are worth one model fallback.
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
    throw new HttpError(status, `AI provider returned ${response.status}: ${text.slice(0, 300)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, "AI provider returned a non-JSON response.");
  }
  const rateLimit = rateLimitOf(response, provider);
  return { data, ...(rateLimit ? { rateLimit } : {}) };
}

/**
 * Asks the provider how many calls are left, without spending a completion.
 * Every provider has a cheap models endpoint that carries the same rate limit
 * headers as a chat request.
 */
export async function probeRateLimit(input: {
  config: AiConfig;
  fetchImpl?: typeof fetch;
}): Promise<RateLimitInfo | undefined> {
  const { provider, apiKey, baseUrl, accountId } = input.config;
  const fetchImpl = input.fetchImpl ?? fetch;
  let url: string;
  const headers: Record<string, string> = {};

  if (provider.protocol === "openai" || provider.protocol === "workers-ai") {
    const root =
      provider.protocol === "workers-ai" && apiKey && accountId
        ? `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`
        : (baseUrl ?? provider.baseUrl);
    url = `${root}/models`;
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  } else if (provider.protocol === "anthropic") {
    url = `${baseUrl ?? provider.baseUrl}/v1/models`;
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider.protocol === "google") {
    url = `${baseUrl ?? provider.baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey ?? "")}`;
  } else {
    return undefined;
  }

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    await response.text();
    if (!response.ok) return undefined;
    return rateLimitOf(response, provider.id);
  } catch {
    // A provider that cannot be asked is a provider we know nothing about.
    return undefined;
  }
}

async function callWorkersAi(input: GenerateInput): Promise<string> {
  const { ai, model, apiKey, accountId } = input.config;
  // A Cloudflare account ID + API token switches Workers AI to the
  // OpenAI-compatible REST endpoint, so a deployment does not need the binding.
  if (apiKey && accountId) {
    return callOpenAi({
      ...input,
      config: {
        ...input.config,
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`,
      },
    });
  }
  if (!ai) {
    throw new HttpError(
      501,
      "Workers AI is not bound on this deployment. Add a Cloudflare account ID and API token in Settings, or choose another provider.",
    );
  }
  const result = await ai.run(model, {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildPrompt(input) },
    ],
    max_tokens: 4096,
    temperature: 0.2,
  });
  const record = asRecord(result);
  if (typeof record.error === "string") {
    throw new HttpError(502, `Workers AI: ${record.error.slice(0, 300)}`);
  }
  const usage = usageOf(result);
  if (usage) input.onUsage?.(usage);
  const reply = textFrom(record.response ?? record.result ?? result);
  if (!reply) throw new HttpError(502, "Workers AI returned an empty reply.");
  return reply;
}

async function callOpenAi(input: GenerateInput): Promise<string> {
  const { provider, model, apiKey, baseUrl } = input.config;
  const fetchImpl = input.fetchImpl ?? fetch;
  const { data, rateLimit } = await postJson(
    fetchImpl,
    `${baseUrl ?? provider.baseUrl}/chat/completions`,
    {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      body: {
        model,
        temperature: 0.2,
        max_tokens: 4096,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPrompt(input) },
        ],
      },
    },
    provider.id,
    model,
  );
  if (rateLimit) input.onRateLimit?.(rateLimit);
  const usage = usageOf(data);
  if (usage) input.onUsage?.(usage);
  const choices = Array.isArray(asRecord(data).choices)
    ? (asRecord(data).choices as unknown[])
    : [];
  const message = asRecord(asRecord(choices[0]).message);
  const reply = textFrom(message.content);
  if (!reply) throw new HttpError(502, "The AI provider returned an empty reply.");
  return reply;
}

async function callAnthropic(input: GenerateInput): Promise<string> {
  const { provider, model, apiKey, baseUrl } = input.config;
  const fetchImpl = input.fetchImpl ?? fetch;
  const { data, rateLimit } = await postJson(
    fetchImpl,
    `${baseUrl ?? provider.baseUrl}/v1/messages`,
    {
      headers: {
        "x-api-key": apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        max_tokens: 4096,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(input) }],
      },
    },
    provider.id,
    model,
  );
  if (rateLimit) input.onRateLimit?.(rateLimit);
  const usage = usageOf(data);
  if (usage) input.onUsage?.(usage);
  const content = asRecord(data).content;
  const reply = Array.isArray(content) ? textFrom(content) : "";
  if (!reply) throw new HttpError(502, "Anthropic returned an empty reply.");
  return reply;
}

async function callGoogle(input: GenerateInput): Promise<string> {
  const { provider, model, apiKey, baseUrl } = input.config;
  const fetchImpl = input.fetchImpl ?? fetch;
  const { data, rateLimit } = await postJson(
    fetchImpl,
    `${baseUrl ?? provider.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey ?? "")}`,
    {
      headers: {},
      body: {
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
        // Gemini thinks before it answers, and the thinking counts against
        // the output budget. A small budget leaves no room for the file.
        generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
      },
    },
    provider.id,
    model,
  );
  if (rateLimit) input.onRateLimit?.(rateLimit);
  const usage = usageOf(data);
  if (usage) input.onUsage?.(usage);
  const candidates = asRecord(data).candidates;
  const first = Array.isArray(candidates) ? asRecord(candidates[0]) : {};
  const parts = asRecord(asRecord(first.content).parts);
  // A thinking model returns its reasoning as a part of its own. The answer is
  // the rest.
  const answered = Array.isArray(parts)
    ? parts.filter((part) => asRecord(part).thought !== true)
    : [];
  const reply = textFrom(answered.length > 0 ? answered : parts);
  // A reply that stopped on the token limit never held the whole file.
  if (str(first.finishReason) === "MAX_TOKENS") {
    throw new HttpError(
      502,
      "The model ran out of output tokens before the test was finished. Try another model, or a smaller file.",
    );
  }
  if (!reply) throw new HttpError(502, "Gemini returned an empty reply.");
  return reply;
}

/** The prompt size as an order-of-magnitude token range. Never a billed number. */
export function estimatePromptTokens(input: GenerateInput): { low: number; high: number } {
  const tokens = Math.ceil(buildPrompt(input).length / 4);
  return { low: Math.round(tokens * 0.75), high: Math.round(tokens * 1.25) };
}

async function generateOnce(input: GenerateInput): Promise<string> {
  let reply: string;
  switch (input.config.provider.protocol) {
    case "workers-ai":
      reply = await callWorkersAi(input);
      break;
    case "anthropic":
      reply = await callAnthropic(input);
      break;
    case "google":
      reply = await callGoogle(input);
      break;
    default:
      reply = await callOpenAi(input);
  }
  const code = extractCode(reply);
  if (!isPlausibleTest(code)) {
    throw new HttpError(
      502,
      "The model did not return a test file. The reply may have been cut short: try another model, or a smaller file.",
    );
  }
  return code;
}

/**
 * One generation attempt. When the chosen model is rate-limited or the
 * provider fails, try the next model of the same provider once and say so.
 */
export async function generateTest(input: GenerateInput): Promise<string> {
  try {
    return await generateOnce(input);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 0;
    const fallback = input.config.fallbackModel?.trim();
    if (!fallback || fallback === input.config.model || (status !== 429 && status < 500)) {
      throw error;
    }
    input.onNotice?.(
      `${input.config.model} did not answer (${status}); falling back to ${fallback}.`,
    );
    return generateOnce({
      ...input,
      config: { ...input.config, model: fallback, fallbackModel: undefined },
    });
  }
}
