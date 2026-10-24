/**
 * Local-only project access for the dashboard. Vite sees the developer's disk;
 * the Worker cannot. This plugin is served by the dev server and is absent from
 * every build. A deployed dashboard never exposes it.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { detectChecks, SUPPORT_FILES } from "@edge-spec/core/ci";
import {
  describeRepository,
  extractExports,
  findGaps,
  packageFacts,
  parseOpenApiSpec,
  riskOf,
} from "@edge-spec/core/scanner";
import type { Gap, ScanResult } from "@edge-spec/core/types";

const MAX_FILES = 20_000;
const SKIP = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".vite",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

/** Expands `~`, resolves the path and confirms it is a folder. */
export function resolveLocalRoot(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error("A local folder path is required.");
  if (raw === "~") raw = homedir();
  else if (raw.startsWith("~/") || raw.startsWith("~\\")) raw = join(homedir(), raw.slice(2));

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const candidates = [resolve(process.cwd(), raw), resolve(repoRoot, raw)];
  let root: string | undefined;
  let requested = resolve(process.cwd(), raw);
  for (const candidate of candidates) {
    try {
      const real = realpathSync(candidate);
      if (statSync(real).isDirectory() || statSync(real).isFile()) {
        root = real;
        requested = candidate;
        break;
      }
    } catch {
      // Try the next base directory.
    }
  }
  if (!root) {
    // Fall back to the original resolution so the error names the path.
    requested = resolve(process.cwd(), raw);
    try {
      root = realpathSync(requested);
    } catch {
      throw new Error(`Local folder not found: ${requested}`);
    }
  }
  if (statSync(root).isFile()) return dirname(root);
  if (!statSync(root).isDirectory()) throw new Error(`Not a folder: ${root}`);
  return root;
}

/** Every file under `root`, relative to it, with forward slashes. */
function walk(root: string, current = ""): string[] {
  const dir = current ? join(root, current) : root;
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) files.push(...walk(root, path));
    } else if (entry.isFile()) {
      files.push(path);
    }
    if (files.length > MAX_FILES) {
      throw new Error(`Too many files under ${root} (limit ${MAX_FILES}).`);
    }
  }
  return files;
}

/** Reads one file under the project; paths that escape the root are refused. */
export function readLocalFile(root: string, path: string): string {
  if (!path) throw new Error("A relative file path is required.");

  let full: string;
  try {
    full = realpathSync(resolve(root, path));
  } catch {
    throw new Error(`File not found: ${path}`);
  }
  const inside = relative(root, full);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error("The file is outside the local project.");
  }
  if (!statSync(full).isFile()) throw new Error(`Not a file: ${path}`);
  return readFileSync(full, "utf8");
}

function readIfPresent(root: string, path: string): string | undefined {
  try {
    return readLocalFile(root, path);
  } catch {
    return undefined;
  }
}

/** The same scan shape as `/api/scan`, backed by the local tree. */
export function scanLocalProject(root: string): ScanResult {
  const blobs = walk(root);
  const gaps = findGaps(blobs, 25);

  const enriched: Gap[] = gaps.slice(0, 8).map((gap) => {
    try {
      const source = readLocalFile(root, gap.path);
      const exports = extractExports(source);
      return { ...gap, exports, risk: riskOf(gap.path, exports.length) };
    } catch {
      return gap;
    }
  });

  const overview = describeRepository(blobs);
  const packageJson = readIfPresent(root, "package.json");
  if (packageJson) Object.assign(overview, packageFacts(packageJson));

  const openApiSpecs = [];
  const openApiPaths = blobs.filter((path) =>
    /(^|\/)(openapi|swagger|api[-_.]?spec)[^/]*\.(json|ya?ml)$/i.test(path),
  );
  for (const artifactPath of openApiPaths.slice(0, 4)) {
    const content = readIfPresent(root, artifactPath);
    if (content === undefined) continue;
    const spec = parseOpenApiSpec(content, artifactPath);
    if (spec) openApiSpecs.push(spec);
  }
  if (openApiSpecs.length > 0) {
    overview.openApiSpecs = openApiSpecs;
    overview.openApiSpec = openApiSpecs[0];
    overview.openApi = openApiSpecs[0];
    overview.openapi = openApiSpecs[0];
  }

  const files: Record<string, string> = {};
  for (const path of SUPPORT_FILES) {
    const content = readIfPresent(root, path);
    if (content !== undefined) files[path] = content;
  }

  const workflows: Record<string, string> = {};
  const workflowPaths = blobs
    .filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
    .slice(0, 4);
  for (const path of workflowPaths) {
    const content = readIfPresent(root, path);
    if (content !== undefined) {
      files[path] = content;
      workflows[path] = content;
    }
  }

  const detected = detectChecks({
    paths: blobs,
    ...(packageJson ? { packageJson } : {}),
    workflows,
    files,
  });
  if (detected.checks.length > 0) {
    overview.checks = detected.checks.map(({ name, kind, command }) => ({ name, kind, command }));
  }
  if (detected.formatter) overview.formatter = detected.formatter.name;

  return {
    repo: root,
    ref: "local",
    scanned: blobs.length,
    gaps: [...enriched, ...gaps.slice(8)],
    overview,
  };
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** Vite dev middleware for `/local-api/scan` and `/local-api/file`. */
export function localApi(): Plugin {
  return {
    name: "edgespec-local-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/local-api/")) return next();

        try {
          if (req.method !== "GET") {
            reply(res, 405, { error: "Method not allowed." });
            return;
          }
          if (url.pathname === "/local-api/scan") {
            const root = resolveLocalRoot(url.searchParams.get("path") ?? "");
            reply(res, 200, scanLocalProject(root));
            return;
          }
          if (url.pathname === "/local-api/file") {
            const root = resolveLocalRoot(url.searchParams.get("root") ?? "");
            const path = url.searchParams.get("path") ?? "";
            reply(res, 200, { source: readLocalFile(root, path) });
            return;
          }
          reply(res, 404, { error: "Not found." });
        } catch (error) {
          reply(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
