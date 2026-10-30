/**
 * The service ports. Every capability the app uses is declared here as a
 * vendor-free interface; adapters in `@edge-spec/adapters`, `@edge-spec/db`
 * and `@edge-spec/sandbox` implement them, and the platform entry (Worker,
 * Bun server, Vercel function, Lambda) wires one into `Env`.
 *
 * A port belongs here only when more than one target can back it, or when a
 * deployment may legitimately leave it off. That is why `SqlDatabase`,
 * `CacheStore`, `ObjectStore`, `JobQueue` and the email sender are ports,
 * while GitHub and AI clients (data-carrying, not platform-provided) are not.
 */

/** Just the parts of a job status the dashboard needs. */
export interface JobStatus {
  status: string;
  error?: { message?: string } | null;
  output?: unknown;
  steps?: { name: string; status: string }[];
}

export interface JobInstance {
  id: string;
  status(): Promise<JobStatus>;
}

export interface JobQueue {
  create(options?: { params?: unknown; id?: string }): Promise<JobInstance>;
  get(id: string): Promise<JobInstance>;
}

/** The subset of SQL this app uses. Backed by D1, Postgres or SQLite. */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch<T = unknown>(statements: SqlStatement[]): Promise<T[]>;
}

/** The subset of object storage used for drift and run artifacts. */
export interface ObjectStore {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
}

/** Optional read-through cache. Never the source of truth. */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type CacheDriver = "kv" | "redis" | "memory";

/** Transactional email. Resend is the only adapter today (plain HTTP). */
export interface EmailSender {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ sent: true } | { sent: false; reason: string }>;
}

/** Structured logs and errors. Providers: consola, OTLP, Sentry, Axiom. */
export type ObserverLevel = "debug" | "info" | "warn" | "error";

export interface Observer {
  log(level: ObserverLevel, message: string, fields?: Record<string, unknown>): void;
  /** A named event; resolves once the provider accepted (or skipped) it. */
  event(name: string, fields?: Record<string, unknown>): Promise<void>;
  error(error: unknown, fields?: Record<string, unknown>): Promise<void>;
}
