/**
 * Infer an API surface when a repository is API-based but has no OpenAPI
 * document. Routes are read from framework calls and Next.js route files; the
 * result is explicitly marked inferred, never presented as a published spec.
 *
 * ponytail: regex route extraction, not an AST. Mounted router prefixes are
 * composed across files; generated routes and runtime composition are not. The
 * inferred flag keeps that honest. Upgrade to a parser only if inference
 * becomes primary.
 */
import { isSourceFile, parseOpenApiSpec } from "@edge-spec/core/scanner";
import type { ApiHealthRow, OpenApiEndpoint, OpenApiSpec } from "./types";

export interface SourceFile {
  path: string;
  content: string;
}

const METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;
const METHOD_SET = new Set<string>(METHODS);

/** Dependencies and imports that mean the repository exposes HTTP routes. */
const FRAMEWORKS: Array<{ dependency: RegExp; module: string; name: string }> = [
  { dependency: /^hono$/i, module: "hono", name: "Hono" },
  { dependency: /^express$/i, module: "express", name: "Express" },
  { dependency: /^elysia$/i, module: "elysia", name: "Elysia" },
  { dependency: /^fastify$/i, module: "fastify", name: "Fastify" },
  { dependency: /^koa$|^@koa\/router$/i, module: "koa", name: "Koa" },
  { dependency: /^@nestjs\/core$/i, module: "@nestjs/core", name: "NestJS" },
  { dependency: /^next$/i, module: "next", name: "Next.js" },
  {
    dependency: /^itty-router$/i,
    module: "itty-router",
    name: "itty-router",
  },
];

/** Files most likely to declare routes; everything else is still scanned. */
const ROUTE_HINT = /(route|router|server|api|handler|controller|endpoint|index|app)\b/i;

const NEXT_ROUTE = /(^|\/)(app\/api\/.+\/route|pages\/api\/.+)\.[cm]?[jt]sx?$/i;

/** Keep the inference read bounded on a large repository. */
export function apiSourceCandidates(paths: readonly string[], limit = 40): string[] {
  return paths
    .filter((path) => isSourceFile(path) || NEXT_ROUTE.test(path))
    .sort((a, b) => {
      const hint = Number(ROUTE_HINT.test(b)) - Number(ROUTE_HINT.test(a));
      return hint || a.localeCompare(b);
    })
    .slice(0, limit);
}

function packageNames(packageJson: string | undefined): string[] {
  if (!packageJson) return [];
  try {
    const parsed = JSON.parse(packageJson) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ];
  } catch {
    return [];
  }
}

/** The framework name the dependencies or imports reveal, biggest signal first. */
export function detectApiFramework(input: {
  packageJson?: string;
  files: readonly SourceFile[];
}): string | undefined {
  const dependencies = packageNames(input.packageJson);
  for (const framework of FRAMEWORKS) {
    if (dependencies.some((dependency) => framework.dependency.test(dependency))) {
      return framework.name;
    }
  }
  const sources = input.files.map((file) => file.content).join("\n");
  for (const framework of FRAMEWORKS) {
    if (
      sources.includes(`from "${framework.module}"`) ||
      sources.includes(`from '${framework.module}'`) ||
      sources.includes(`require("${framework.module}")`) ||
      sources.includes(`require('${framework.module}')`)
    ) {
      return framework.name;
    }
  }
  return undefined;
}

/** `:id` -> `{id}`, and strip a trailing slash so paths deduplicate. */
export function openApiPath(path: string): string {
  const normalized = path.replace(/:([A-Za-z_$][\w$]*)/g, "{$1}").replace(/\/+$/, "");
  return normalized || "/";
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

/** Receivers that usually hold a router even when the declaration is indirect. */
const KNOWN_ROUTERS = new Set([
  "app",
  "router",
  "server",
  "api",
  "route",
  "routes",
  "fastify",
  "elysia",
  "hono",
  "worker",
]);

/**
 * Route calls such as `app.get("/x", …)` or `usersRouter.post("/x", …)`. The
 * receiver is filtered to a declared/imported router, so a frontend
 * `.get("key")` does not become an endpoint.
 */
const ROUTE_CALL =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(['"`])(\/[^'"`]*)\3/gi;

/** Hono's `app.on("GET", "/x", …)`. */
const ON_CALL =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*on\s*\(\s*(['"])(get|post|put|patch|delete|options|head)\2\s*,\s*(['"`])(\/[^'"`]*)\4/gi;

/** Elysia chains: `new Elysia().get("/x", …)` or `).post("/x", …)`. */
const CHAIN_CALL =
  /(?:\bnew\s+[A-Za-z_$][\w$]*\s*\([^)]*\)|\))\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(['"`])(\/[^'"`]*)\2/gi;

/** `app.route("/api", router)`, `.mount()` and Express's `.use()`. */
const MOUNT_CALL =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:route|mount|use)\s*\(\s*(['"`])(\/[^'"`]*)\2\s*,\s*([A-Za-z_$][\w$]*)/gi;

/** `const router = express.Router()` and the equivalent constructors. */
const ROUTER_DECL =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:new\s+)?(?:Hono|Elysia|Fastify|Koa|KoaRouter|Router|hono)\s*\(|express\s*(?:\.\s*Router)?\s*\()/gi;

const IMPORT_DEFAULT = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;
const IMPORT_NAMESPACE = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;
const IMPORT_NAMED = /\bimport\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2/g;

interface ParsedFile {
  path: string;
  content: string;
  declared: Set<string>;
  imports: Map<string, string>;
}

interface Mount {
  parent: string;
  prefix: string;
  child: string;
  file: string;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const dirOf = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
};

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEXES = ["ts", "tsx", "js", "jsx", "mjs", "cjs"].map((ext) => `index.${ext}`);

/** Resolve a relative import to a file in the scanned set, or undefined. */
function resolveModule(from: string, specifier: string, paths: Set<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalizePath(`${dirOf(from)}/${specifier}`);
  const candidates = [base, ...EXTENSIONS.map((ext) => `${base}${ext}`)];
  // TypeScript source imported with Node's `.js` extension.
  if (base.endsWith(".js")) {
    candidates.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  }
  candidates.push(...INDEXES.map((index) => `${base}/${index}`));
  return candidates.find((candidate) => paths.has(candidate));
}

function parseFile(file: SourceFile): ParsedFile {
  const declared = new Set<string>();
  for (const match of file.content.matchAll(ROUTER_DECL)) {
    if (match[1]) declared.add(match[1]);
  }
  const imports = new Map<string, string>();
  for (const match of file.content.matchAll(IMPORT_DEFAULT)) {
    if (match[1] && match[3]) imports.set(match[1], match[3]);
  }
  for (const match of file.content.matchAll(IMPORT_NAMESPACE)) {
    if (match[1] && match[3]) imports.set(match[1], match[3]);
  }
  for (const match of file.content.matchAll(IMPORT_NAMED)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && match[3]) imports.set(name, match[3]);
    }
  }
  return { path: file.path, content: file.content, declared, imports };
}

/** Prefix two route paths without doubling the separator. */
function joinPath(prefix: string, path: string): string {
  const left = prefix.replace(/\/+$/, "");
  return `${left}${path.startsWith("/") ? path : `/${path}`}` || "/";
}

interface ResolvedMount {
  mount: Mount;
  target: string;
  /** Set when the child router lives in the same file. */
  receiver?: string;
}

/**
 * Resolve a mount to a file: a same-file router, a relative import, or the only
 * file that declares the child name. Ambiguous or external mounts stay
 * unresolved so a wrong prefix is never invented.
 */
function resolveMount(
  mount: Mount,
  parsed: Map<string, ParsedFile>,
  paths: Set<string>,
): ResolvedMount | undefined {
  const owner = parsed.get(mount.file);
  if (owner?.declared.has(mount.child)) {
    return { mount, target: mount.file, receiver: mount.child };
  }
  const imported = owner?.imports.get(mount.child);
  if (imported) {
    const target = resolveModule(mount.file, imported, paths);
    if (target) return { mount, target };
  }
  const declaredBy = [...parsed.values()].filter((file) => file.declared.has(mount.child));
  if (declaredBy.length === 1) return { mount, target: declaredBy[0]!.path };
  return undefined;
}

/** Next.js app/pages routes declare methods as exported functions. */
function nextRoutes(file: SourceFile): Array<{ method: string; path: string; line: number }> {
  const match = NEXT_ROUTE.exec(file.path);
  if (!match) return [];
  const path = file.path
    .replace(/^app\/api\//, "/")
    .replace(/^pages\/api\//, "/")
    .replace(/\/route\.[cm]?[jt]sx?$/, "")
    .replace(/\.[cm]?[jt]sx?$/, "")
    .replace(/\/index$/, "")
    .replace(/\[([^\]]+)\]/g, "{$1}");
  const routes: Array<{ method: string; path: string; line: number }> = [];
  for (const method of METHODS) {
    const pattern = new RegExp(
      `\\bexport\\s+(?:async\\s+)?(?:function|const)\\s+${method.toUpperCase()}\\b`,
      "i",
    );
    const found = pattern.exec(file.content);
    if (found)
      routes.push({
        method,
        path: path === "" ? "/" : path,
        line: lineOf(file.content, found.index),
      });
  }
  return routes;
}

export interface InferredRoute {
  method: string;
  path: string;
  source: string;
  line: number;
}

/**
 * Routes named in the supplied sources, deduplicated by method + path.
 *
 * Mounted routers are composed: a route declared on `router` inherits the
 * prefix from `app.route("/api", router)`, including nested mounts and routers
 * imported from another scanned file. Unresolved mounts are ignored rather than
 * guessed.
 */
export function extractRoutes(files: readonly SourceFile[]): InferredRoute[] {
  const parsed = new Map(files.map((file) => [file.path, parseFile(file)]));
  const paths = new Set(parsed.keys());
  const mounts: ResolvedMount[] = [];
  for (const file of files) {
    for (const match of file.content.matchAll(MOUNT_CALL)) {
      const resolved = resolveMount(
        {
          parent: match[1] ?? "",
          prefix: match[3] ?? "",
          child: match[4] ?? "",
          file: file.path,
        },
        parsed,
        paths,
      );
      if (resolved) mounts.push(resolved);
    }
  }
  const wholeMounts = mounts.filter((mount) => mount.receiver === undefined);
  const prefixCache = new Map<string, string[]>();
  const wholePrefixes = (file: string, seen: Set<string> = new Set()): string[] => {
    const cached = prefixCache.get(file);
    if (cached) return cached;
    if (seen.has(file)) return [""];
    const incoming = wholeMounts.filter((mount) => mount.target === file);
    if (incoming.length === 0) {
      prefixCache.set(file, [""]);
      return [""];
    }
    const next = new Set<string>();
    for (const mount of incoming) {
      for (const parent of wholePrefixes(mount.mount.file, new Set([...seen, file]))) {
        next.add(joinPath(parent, mount.mount.prefix));
      }
    }
    const list = next.size > 0 ? [...next] : [""];
    prefixCache.set(file, list);
    return list;
  };

  const routes: InferredRoute[] = [];
  const seen = new Set<string>();
  const add = (
    method: string,
    rawPath: string,
    file: SourceFile,
    index: number,
    prefixes: string[],
  ) => {
    const upper = method.toUpperCase();
    if (!METHOD_SET.has(method.toLowerCase()) || !rawPath.startsWith("/")) return;
    for (const prefix of prefixes) {
      const path = openApiPath(joinPath(prefix, rawPath));
      const key = `${upper} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({
        method: upper,
        path,
        source: file.path,
        line: lineOf(file.content, index),
      });
    }
  };

  for (const file of files) {
    const info = parsed.get(file.path)!;
    const base = wholePrefixes(file.path);
    const isRouter = (receiver: string) =>
      info.declared.has(receiver) || info.imports.has(receiver) || KNOWN_ROUTERS.has(receiver);
    const prefixesFor = (receiver: string): string[] => {
      const local = mounts.filter(
        (mount) => mount.target === file.path && mount.receiver === receiver,
      );
      if (local.length === 0) return base;
      // A mounted sub-router lives at the mount prefix, not at the file root.
      const out = new Set<string>();
      for (const mount of local) {
        for (const parent of wholePrefixes(mount.mount.file)) {
          out.add(joinPath(parent, mount.mount.prefix));
        }
      }
      return [...out];
    };

    for (const route of nextRoutes(file)) {
      const key = `${route.method.toUpperCase()} ${route.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({
          ...route,
          method: route.method.toUpperCase(),
          source: file.path,
        });
      }
    }
    for (const match of file.content.matchAll(ROUTE_CALL)) {
      const receiver = match[1] ?? "";
      if (isRouter(receiver)) {
        add(match[2] ?? "", match[4] ?? "", file, match.index ?? 0, prefixesFor(receiver));
      }
    }
    for (const match of file.content.matchAll(ON_CALL)) {
      const receiver = match[1] ?? "";
      if (isRouter(receiver)) {
        add(match[3] ?? "", match[5] ?? "", file, match.index ?? 0, prefixesFor(receiver));
      }
    }
    for (const match of file.content.matchAll(CHAIN_CALL)) {
      add(match[1] ?? "", match[3] ?? "", file, match.index ?? 0, base);
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function parametersOf(path: string): OpenApiEndpoint["parameters"] {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].flatMap((match) => match[1] ?? []);
  return names.length > 0
    ? names.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      }))
    : undefined;
}

/**
 * A minimal OpenAPI 3.1 document for routes inferred from source. It is valid
 * enough for the existing contract-test writer and the endpoint matrix, and it
 * says loudly that it was inferred.
 */
export function inferredOpenApi(input: {
  title: string;
  routes: readonly InferredRoute[];
}): OpenApiSpec | undefined {
  if (input.routes.length === 0) return undefined;
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of input.routes) {
    const path = openApiPath(route.path);
    const entry = (paths[path] ??= {});
    entry[route.method.toLowerCase()] = {
      summary: `Inferred ${route.method} ${path}`,
      operationId: `${route.method.toLowerCase()}_${path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      "x-edgespec-source": `${route.source}:${route.line}`,
      ...(parametersOf(path) ? { parameters: parametersOf(path) } : {}),
      responses: {
        "200": {
          description: "Inferred success; verify the handler response.",
        },
      },
    };
  }

  const document = {
    openapi: "3.1.0",
    info: {
      title: input.title,
      version: "0.0.0-inferred",
      description:
        "Inferred from source by EdgeSpec because no OpenAPI document was found. Review before using it as a contract.",
    },
    "x-edgespec-inferred": true,
    paths,
  };
  const content = JSON.stringify(document, null, 2);
  const spec = parseOpenApiSpec(content, "openapi.inferred.json");
  return spec ? { ...spec, inferred: true } : undefined;
}

/** Detect and infer in one step; undefined when the repository is not API-based. */
export function inferApiSpec(input: {
  title: string;
  paths: readonly string[];
  files: readonly SourceFile[];
  packageJson?: string;
}): { framework: string; spec: OpenApiSpec } | undefined {
  const framework = detectApiFramework({
    ...(input.packageJson ? { packageJson: input.packageJson } : {}),
    files: input.files,
  });
  const routes = extractRoutes(input.files);
  if (!framework && routes.length === 0) return undefined;
  const spec = inferredOpenApi({ title: input.title, routes });
  if (!spec) return undefined;
  return { framework: framework ?? "HTTP routes", spec };
}

/**
 * Endpoint x status for the OpenAPI health matrix. A contract test is matched by
 * its name; a scan without test contents reports "missing-test" honestly.
 */
export function apiHealthMatrix(
  specs: readonly OpenApiSpec[],
  testNames: Iterable<string> = [],
): ApiHealthRow[] {
  const names = new Set([...testNames].map((name) => name.trim().replace(/\s+/g, " ")));
  return specs.flatMap((spec) =>
    spec.endpoints.map((endpoint) => ({
      method: endpoint.method.toUpperCase(),
      path: endpoint.path,
      specPath: spec.path,
      ...(spec.inferred ? { inferred: true } : {}),
      probe: "static" as const,
      status: names.has(`${endpoint.method.toUpperCase()} ${endpoint.path}`)
        ? "covered"
        : "missing-test",
      auth: endpoint.security ?? [],
      requestBody: endpoint.requestBody !== undefined,
      parameters: endpoint.parameters?.length ?? 0,
    })),
  );
}
