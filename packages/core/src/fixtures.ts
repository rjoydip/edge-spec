/** Recorded HTTP exchanges for deterministic contract replay. No secrets in code. */

export interface FixtureExchange {
  method: string;
  /** Path plus query, exactly as requested. */
  path: string;
  status: number;
  headers?: Record<string, string>;
  /** Response text; absent for empty bodies. */
  body?: string;
}

export interface FixtureFile {
  version: 1;
  recordedAt: string;
  exchanges: FixtureExchange[];
}

export function fixtureKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Validates a recorded file; anything malformed is rejected, never half-used. */
export function parseFixtureFile(text: string): FixtureFile | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  const raw = Array.isArray(record.exchanges) ? record.exchanges : [];
  const exchanges: FixtureExchange[] = [];
  for (const entry of raw.slice(0, 500)) {
    const item = asRecord(entry);
    const method = typeof item.method === "string" ? item.method.trim().toUpperCase() : "";
    const path = typeof item.path === "string" ? item.path.trim() : "";
    const status = Number(item.status);
    if (!method || !path || !Number.isInteger(status)) continue;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(item.headers))) {
      if (typeof value === "string" && key.length < 100 && value.length < 2_000) {
        headers[key] = value;
      }
    }
    const body = typeof item.body === "string" ? item.body.slice(0, 200_000) : undefined;
    exchanges.push({
      method,
      path,
      status,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  }
  if (exchanges.length === 0) return undefined;
  return {
    version: 1,
    recordedAt:
      typeof record.recordedAt === "string" ? record.recordedAt : new Date().toISOString(),
    exchanges,
  };
}

export function fixtureFor(
  file: FixtureFile,
  method: string,
  path: string,
): FixtureExchange | undefined {
  return file.exchanges.find(
    (exchange) => fixtureKey(exchange.method, exchange.path) === fixtureKey(method, path),
  );
}
