/** Environment configuration shared by the CLI and the MCP server. */

export type Env = Record<string, string | undefined>;

/** The key each built-in provider expects, in order of preference. */
const PROVIDER_KEYS: Record<string, string[]> = {
  "workers-ai": ["CLOUDFLARE_API_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  private: ["EDGESPEC_AI_KEY"],
};

function first(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function bool(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export interface EnvDefaults {
  baseUrl: string;
  githubToken?: string;
  aiKey?: string;
  aiBaseUrl?: string;
  sandboxUrl?: string;
  sandboxKey?: string;
  deploymentAi: boolean;
  provider?: string;
  model?: string;
  accountId?: string;
}

/**
 * Reads the non-secret defaults and keys from the environment. Passing the
 * provider is important: the key name differs between OpenAI, Anthropic, etc.
 */
export function envDefaults(env: Env, provider?: string): EnvDefaults {
  const selectedProvider = provider?.trim() || env.EDGESPEC_AI_PROVIDER?.trim() || undefined;
  const providerKeys = selectedProvider ? (PROVIDER_KEYS[selectedProvider] ?? []) : [];
  const githubToken = first(env, ["GITHUB_TOKEN", "EDGESPEC_GITHUB_TOKEN"]);
  const aiKey = first(env, ["EDGESPEC_AI_KEY", ...providerKeys]);
  const aiBaseUrl = env.EDGESPEC_AI_BASE_URL?.trim();
  const sandboxUrl = env.EDGESPEC_SANDBOX_URL?.trim();
  const sandboxKey = env.EDGESPEC_SANDBOX_KEY?.trim();
  const model = env.EDGESPEC_AI_MODEL?.trim();
  const accountId = first(env, ["CLOUDFLARE_ACCOUNT_ID", "EDGESPEC_ACCOUNT_ID"]);
  return {
    baseUrl: (env.EDGESPEC_URL?.trim() || "http://127.0.0.1:8787").replace(/\/+$/, ""),
    ...(githubToken ? { githubToken } : {}),
    ...(aiKey ? { aiKey } : {}),
    ...(aiBaseUrl ? { aiBaseUrl } : {}),
    ...(sandboxUrl ? { sandboxUrl } : {}),
    ...(sandboxKey ? { sandboxKey } : {}),
    deploymentAi: bool(env.EDGESPEC_DEPLOYMENT_AI),
    ...(selectedProvider ? { provider: selectedProvider } : {}),
    ...(model ? { model } : {}),
    ...(accountId ? { accountId } : {}),
  };
}
