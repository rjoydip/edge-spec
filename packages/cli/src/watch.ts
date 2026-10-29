/** Local watch mode: regenerate a test when a source file changes. */
import { watch as watchFs } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import type { EdgeSpecClient, GenerateResponse } from "@edge-spec/client";

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const IGNORED = /(^|\/)(node_modules|dist|build|coverage|\.git|\.wrangler|\.alchemy)\//;

/** A source file worth regenerating; tests and build output are not. */
export function isWatchSource(path: string): boolean {
  return SOURCE.test(path) && !TEST_FILE.test(path) && !IGNORED.test(path);
}

/** `src/a.ts` -> `src/a.test.ts`; `.tsx` keeps its extension. */
export function testPathFor(sourcePath: string): string {
  return sourcePath.replace(SOURCE, (extension) => `.test${extension.toLowerCase()}`);
}

/** A compact prefix/suffix diff: enough to decide, not a full LCS. */
export function diffLines(before: string, after: string, max = 120): string {
  const left = before ? before.split("\n") : [];
  const right = after.split("\n");
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let endLeft = left.length - 1;
  let endRight = right.length - 1;
  while (endLeft >= start && endRight >= start && left[endLeft] === right[endRight]) {
    endLeft -= 1;
    endRight -= 1;
  }
  const lines: string[] = [];
  for (let index = start; index <= endLeft && lines.length < max; index += 1) {
    lines.push(`- ${left[index] ?? ""}`);
  }
  for (let index = start; index <= endRight && lines.length < max; index += 1) {
    lines.push(`+ ${right[index] ?? ""}`);
  }
  if (lines.length === 0) return "No changes.";
  if (lines.length >= max) lines.push("… diff truncated");
  return lines.join("\n");
}

export interface WatchOptions {
  root: string;
  apiUrl: string;
  client: EdgeSpecClient;
  ai: { provider?: string; model?: string; accountId?: string };
  write: boolean;
  /** Stop immediately after starting (used by tests and one-shot checks). */
  once?: boolean;
}

/**
 * Watches source files and previews a generated test diff. Exactly one test is
 * generated per change; apply/reject is per file. Errors stay local to a file.
 */
export async function runWatch(options: WatchOptions): Promise<void> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(options.apiUrl)) {
    throw new Error(
      "watch needs a local EdgeSpec Worker (http://127.0.0.1:8787) because it sends inline source.",
    );
  }
  const root = resolve(options.root);
  const inFlight = new Set<string>();
  let queue = 0;
  let closed = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const reader = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stderr })
    : undefined;

  const ask = async (path: string): Promise<"apply" | "reject"> => {
    if (options.write) return "apply";
    if (!reader) return "reject";
    const answer = await reader.question(`Apply the generated test for ${path}? [a]pply/[r]eject `);
    return answer.trim().toLowerCase().startsWith("a") ? "apply" : "reject";
  };

  const generate = async (path: string): Promise<void> => {
    if (inFlight.has(path) || closed) return;
    inFlight.add(path);
    queue += 1;
    try {
      const source = await readFile(join(root, path), "utf8");
      const result: GenerateResponse = await options.client.generate({
        source,
        path,
        ...options.ai,
        strictTypes: true,
      });
      const testPath = result.generation.testPath || testPathFor(path);
      let existing = "";
      try {
        existing = await readFile(join(root, testPath), "utf8");
      } catch {
        // A missing test is the normal case.
      }
      process.stderr.write(`\n${path} → ${testPath}\n`);
      process.stderr.write(`${diffLines(existing, result.generation.code)}\n`);
      if (!result.validation.ok) {
        process.stderr.write(
          `Validation failed (${result.validation.verified ? "executed" : "static only"}); not applying.\n`,
        );
        return;
      }
      if ((await ask(path)) === "reject") {
        process.stderr.write("Rejected; the test file was not changed.\n");
        return;
      }
      await mkdir(dirname(join(root, testPath)), { recursive: true });
      await writeFile(join(root, testPath), result.generation.code, "utf8");
      process.stderr.write(`Wrote ${testPath}\n`);
    } catch (error) {
      process.stderr.write(`${path}: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      inFlight.delete(path);
      queue -= 1;
    }
  };

  const schedule = (path: string) => {
    const existing = timers.get(path);
    if (existing) clearTimeout(existing);
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        void generate(path);
      }, 300),
    );
  };

  const watcher = watchFs(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const path = String(filename).replace(/\\/g, "/");
    if (isWatchSource(path)) schedule(path);
  });

  process.stderr.write(`Watching ${root}. Ctrl+C to stop.\n`);
  if (options.once) {
    watcher.close();
    return;
  }

  await new Promise<void>((done) => {
    const stop = () => {
      closed = true;
      watcher.close();
      for (const timer of timers.values()) clearTimeout(timer);
      reader?.close();
      done();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  if (queue > 0) process.stderr.write(`Stopped with ${queue} generation(s) in flight.\n`);
}
