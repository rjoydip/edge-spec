/**
 * Infer an API surface when a repository is API-based but has no OpenAPI
 * document. Routes are read from framework calls and Next.js route files; the
 * result is explicitly marked inferred, never presented as a published spec.
 *
 * ponytail: regex route extraction, not an AST. Mounted router prefixes and
 * generated routes are not resolved; the inferred flag and the health matrix
 * keep that honest. Upgrade to a parser only if inference becomes primary.
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
  { dependency: /^itty-router$/i, module: "itty-router", name: "itty-router" },
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

/**
 * Route calls such as `app.get("/x", …)` or `router.post("/x", …)`. The
 * receiver must look like a server object, so a frontend `.get("key")` does not
 * become an endpoint.
 */
const ROUTE_CALL =
  /\b(?:app|router|server|api|route|routes|fastify|elysia|hono|worker)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(['"`])(\/[^'"`]*)\2/gi;

/** Hono's `app.on("GET", "/x", …)`. */
const ON_CALL =
  /\b(?:app|router|server)\s*\.\s*on\s*\(\s*(['"])(get|post|put|patch|delete|options|head)\1\s*,\s*(['"`])(\/[^'"`]*)\3/gi;

/** Elysia chains: `new Elysia().get("/x", …)` or `).post("/x", …)`. */
const CHAIN_CALL =
  /(?:\bnew\s+[A-Za-z_$][\w$]*\s*\([^)]*\)|\))\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*(['"`])(\/[^'"`]*)\2/gi;

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

/** Routes named in the supplied sources, deduplicated by method + path. */
export function extractRoutes(files: readonly SourceFile[]): InferredRoute[] {
  const routes: InferredRoute[] = [];
  const seen = new Set<string>();
  const add = (method: string, rawPath: string, file: SourceFile, index: number) => {
    const upper = method.toUpperCase();
    if (!METHOD_SET.has(method.toLowerCase()) || !rawPath.startsWith("/")) return;
    const path = openApiPath(rawPath);
    const key = `${upper} ${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ method: upper, path, source: file.path, line: lineOf(file.content, index) });
  };

  for (const file of files) {
    for (const route of nextRoutes(file)) {
      const key = `${route.method.toUpperCase()} ${route.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({ ...route, method: route.method.toUpperCase(), source: file.path });
      }
    }
    for (const match of file.content.matchAll(ROUTE_CALL)) {
      add(match[1] ?? "", match[3] ?? "", file, match.index ?? 0);
    }
    for (const match of file.content.matchAll(ON_CALL)) {
      add(match[2] ?? "", match[4] ?? "", file, match.index ?? 0);
    }
    for (const match of file.content.matchAll(CHAIN_CALL)) {
      add(match[1] ?? "", match[3] ?? "", file, match.index ?? 0);
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
        "200": { description: "Inferred success; verify the handler response." },
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
      status: names.has(`${endpoint.method.toUpperCase()} ${endpoint.path}`)
        ? "covered"
        : "missing-test",
      auth: endpoint.security ?? [],
      requestBody: endpoint.requestBody !== undefined,
      parameters: endpoint.parameters?.length ?? 0,
    })),
  );
}
