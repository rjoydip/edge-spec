/** Pure gap analysis: which source files have no matching test file. */
import { parse as parseYaml } from "yaml";
import type {
  ApiArtifact,
  Gap,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiSpec,
  RepositoryOverview,
  Risk,
} from "./types";

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const GENERATED =
  /(^|\/)(dist|build|out|coverage|node_modules|vendor|generated|__generated__|migrations)\//i;
const TEST_DIR = /(^|\/)(test|tests|__tests__|__mocks__|e2e|fixtures)\//i;
const DECLARATION = /\.d\.[cm]?ts$/i;
const CONFIG_FILE =
  /(^|\/)(vite|vitest|jest|playwright|tailwind|postcss|eslint|wrangler|bun|tsconfig|config|setup|webpack|rollup)[^/]*\.[cm]?[jt]s$/i;

/** `src/a/b.ts` -> `src/a/b.test.ts`; `.tsx` keeps its extension. */
export function expectedTestPath(path: string): string {
  return path.replace(SOURCE, (extension) => `.test${extension.toLowerCase()}`);
}

export function isSourceFile(path: string): boolean {
  if (!SOURCE.test(path)) return false;
  if (TEST_FILE.test(path) || DECLARATION.test(path)) return false;
  if (GENERATED.test(path) || TEST_DIR.test(path) || CONFIG_FILE.test(path)) return false;
  return true;
}

/** Best-effort exported symbol names. Regex, not a parser — enough to show in the UI. */
export function extractExports(source: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s*\{([^}]*)\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const group = match[1];
      if (!group) continue;
      for (const part of group.split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
  }
  return [...names].slice(0, 12);
}

const HIGH_RISK =
  /(auth|token|jwt|crypto|password|secret|billing|payment|invoice|webhook|permission|session|oauth)/i;
const LOW_RISK = /(util|helper|format|style|theme|const|type|component|ui)/i;

export function riskOf(path: string, exportCount = 0): Risk {
  if (HIGH_RISK.test(path)) return "high";
  if (LOW_RISK.test(path)) return "low";
  return exportCount > 20 ? "high" : "medium";
}

const TEST_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const TEST_DIRS = ["test", "tests", "__tests__", "spec"];
/** Extra suffixes ecosystems use instead of `.test`/`.spec`. */
const TEST_SUFFIXES = ["test", "spec", "e2e-spec", "-spec", "_spec"];

/** `src/a/b.ts` -> `{ dir: "src/a/", base: "b", ext: ".ts" }`. */
function splitPath(path: string): { dir: string; base: string; ext: string } {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  const file = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = file.lastIndexOf(".");
  return {
    dir,
    base: dot >= 0 ? file.slice(0, dot) : file,
    ext: dot >= 0 ? file.slice(dot) : ".ts",
  };
}

/** Every test file path a source file may use, common runtimes included. */
export function testCandidates(path: string): string[] {
  const { dir, base, ext } = splitPath(path);
  const exts = [ext, ...TEST_EXTENSIONS.filter((candidate) => candidate !== ext)];
  const names: string[] = [];
  for (const candidate of exts) {
    for (const suffix of TEST_SUFFIXES) names.push(`${base}.${suffix}${candidate}`);
  }

  const candidates = new Set<string>();
  for (const name of names) candidates.add(`${dir}${name}`);

  const segments = dir.split("/").filter(Boolean);
  const relativeWithoutExt = path.replace(/\.[^.]+$/, "");
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const ancestor = segments.slice(0, depth).join("/");
    const prefix = ancestor ? `${ancestor}/` : "";
    for (const testDir of TEST_DIRS) {
      for (const name of names) candidates.add(`${prefix}${testDir}/${name}`);
      // Mirrored path: tests/src/foo.test.ts
      for (const candidate of exts) {
        candidates.add(`${prefix}${testDir}/${relativeWithoutExt}.test${candidate}`);
        candidates.add(`${prefix}${testDir}/${relativeWithoutExt}.spec${candidate}`);
      }
    }
  }

  return [...candidates];
}

/** All existing test files for a source path, in tree order. */
export function testFilesFor(path: string, paths: Iterable<string>): string[] {
  const present = new Set(paths);
  return testCandidates(path).filter((candidate) => present.has(candidate));
}

/** The language a source extension belongs to, when EdgeSpec can name it. */
export function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANGUAGES[extension] ?? FILE_LANGUAGES[name];
}

/** Languages EdgeSpec cannot generate tests for yet. */
const UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  py: "Python",
  pyi: "Python",
  pyw: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  rake: "Ruby",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  cs: "C#",
  php: "PHP",
  scala: "Scala",
  sc: "Scala",
  ex: "Elixir",
  exs: "Elixir",
  dart: "Dart",
  lua: "Lua",
  jl: "Julia",
  r: "R",
  zig: "Zig",
  cr: "Crystal",
  hs: "Haskell",
  clj: "Clojure",
  cljs: "Clojure",
  fs: "F#",
  fsx: "F#",
};

/** Directories that hold other-language tests, not source. */
const OTHER_TEST_DIR = /(^|\/)(test|tests|__tests__|spec|specs|__mocks__|fixtures)\//i;
const OTHER_SOURCE_EXCLUDE =
  /(^|\/)(dist|build|out|coverage|node_modules|vendor|generated|migrations|target|bin|obj)\//i;

function unsupportedLanguage(path: string): string | undefined {
  if (OTHER_TEST_DIR.test(path) || OTHER_SOURCE_EXCLUDE.test(path)) return undefined;
  if (/\.(d\.ts|test|spec)\./i.test(path)) return undefined;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return UNSUPPORTED_EXTENSIONS[extension];
}

/** The risk order the UI uses: dangerous first, then alphabetical. */
const RISK_ORDER: Record<Risk, number> = { high: 0, medium: 1, low: 2 };

function sortGaps(gaps: Gap[]): Gap[] {
  return gaps.sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.path.localeCompare(b.path),
  );
}

/**
 * Classifies a whole tree once:
 * - `missing`: supported source with no test anywhere a convention looks.
 * - `unsupported`: a language EdgeSpec cannot generate for yet.
 * - `testsBySource`: the existing test files per supported source file.
 */
export function classifyTree(paths: readonly string[]): {
  missing: Gap[];
  unsupported: Gap[];
  testsBySource: Map<string, string[]>;
} {
  const present = new Set(paths);
  const missing: Gap[] = [];
  const unsupported: Gap[] = [];
  const testsBySource = new Map<string, string[]>();

  for (const path of present) {
    const language = unsupportedLanguage(path);
    if (language) {
      const { dir, base } = splitPath(path);
      unsupported.push({
        path,
        testPath: `${dir}${base}.test${path.slice(path.lastIndexOf("."))}`,
        risk: "low",
        exports: [],
        reason: `EdgeSpec cannot generate a ${language} test yet.`,
        kind: "unsupported",
        language,
      });
      continue;
    }
    if (!isSourceFile(path)) continue;

    const tests = testFilesFor(path, present);
    if (tests.length > 0) {
      testsBySource.set(path, tests);
      continue;
    }

    const testPath = expectedTestPath(path);
    const testName = testPath.slice(testPath.lastIndexOf("/") + 1);
    missing.push({
      path,
      testPath,
      risk: riskOf(path),
      exports: [],
      reason: `No ${testName} found next to this file or in an ancestor test directory.`,
      kind: "missing",
      language: languageOf(path),
    });
  }

  return {
    missing: sortGaps(missing),
    unsupported: unsupported.sort((a, b) => a.path.localeCompare(b.path)),
    testsBySource,
  };
}

/**
 * `paths` is every blob in the repository. A source file is a gap when none of
 * its conventional test file locations are present. Missing-only wrapper.
 */
export function findGaps(paths: readonly string[], limit = 500): Gap[] {
  return classifyTree(paths).missing.slice(0, limit);
}

/** Puts the files under `folder` first; the scan itself stays whole-repo. */
export function folderFirst(gaps: readonly Gap[], folder?: string): Gap[] {
  const prefix = folder?.replace(/^\/+|\/+$/g, "");
  if (!prefix) return [...gaps];
  const start = `${prefix}/`;
  const inside = gaps.filter((gap) => gap.path.startsWith(start));
  if (inside.length === 0) return [...gaps];
  return [...inside, ...gaps.filter((gap) => !gap.path.startsWith(start))];
}

export function summarize(paths: readonly string[]): {
  scanned: number;
  sources: number;
} {
  const sources = paths.filter(isSourceFile).length;
  return { scanned: paths.length, sources };
}

/** Extension to language. The languages a repository is likely written in. */
const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  pyi: "Python",
  pyw: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  rake: "Ruby",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  cs: "C#",
  cshtml: "C#",
  razor: "C#",
  vb: "Visual Basic",
  fs: "F#",
  fsi: "F#",
  fsx: "F#",
  php: "PHP",
  scala: "Scala",
  sc: "Scala",
  groovy: "Groovy",
  gvy: "Groovy",
  gradle: "Groovy",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hrl: "Erlang",
  hs: "Haskell",
  clj: "Clojure",
  cljs: "Clojure",
  cljc: "Clojure",
  edn: "Clojure",
  ml: "OCaml",
  mli: "OCaml",
  re: "ReasonML",
  rei: "ReasonML",
  elm: "Elm",
  purs: "PureScript",
  rkt: "Racket",
  scm: "Scheme",
  ss: "Scheme",
  lisp: "Common Lisp",
  lsp: "Common Lisp",
  cl: "Common Lisp",
  el: "Emacs Lisp",
  dart: "Dart",
  lua: "Lua",
  jl: "Julia",
  r: "R",
  rmd: "R",
  nim: "Nim",
  zig: "Zig",
  cr: "Crystal",
  d: "D",
  vala: "Vala",
  hx: "Haxe",
  gd: "GDScript",
  sol: "Solidity",
  move: "Move",
  cairo: "Cairo",
  lean: "Lean",
  agda: "Agda",
  idr: "Idris",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  hxx: "C++",
  m: "Objective-C",
  mm: "Objective-C++",
  cu: "CUDA",
  cuh: "CUDA",
  ino: "Arduino",
  pde: "Processing",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  hbs: "Handlebars",
  ejs: "EJS",
  pug: "Pug",
  njk: "Nunjucks",
  liquid: "Liquid",
  twig: "Twig",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  ksh: "Shell",
  csh: "Shell",
  ps1: "PowerShell",
  psm1: "PowerShell",
  psd1: "PowerShell",
  bat: "Batch",
  cmd: "Batch",
  awk: "AWK",
  tcl: "Tcl",
  pl: "Perl",
  pm: "Perl",
  pro: "Prolog",
  prolog: "Prolog",
  asm: "Assembly",
  s: "Assembly",
  f: "Fortran",
  for: "Fortran",
  f90: "Fortran",
  f95: "Fortran",
  f03: "Fortran",
  f08: "Fortran",
  pas: "Pascal",
  pp: "Pascal",
  dpr: "Pascal",
  adb: "Ada",
  ads: "Ada",
  cob: "COBOL",
  cbl: "COBOL",
  v: "Verilog",
  vh: "Verilog",
  sv: "SystemVerilog",
  svh: "SystemVerilog",
  vhd: "VHDL",
  vhdl: "VHDL",
  glsl: "GLSL",
  vert: "GLSL",
  frag: "GLSL",
  hlsl: "HLSL",
  wgsl: "WGSL",
  metal: "Metal",
  sql: "SQL",
  graphql: "GraphQL",
  gql: "GraphQL",
  tf: "Terraform",
  tfvars: "Terraform",
  proto: "Protocol Buffers",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "SCSS",
  less: "Less",
};

/** Files that name their language instead of using an extension. */
const FILE_LANGUAGES: Record<string, string> = {
  Dockerfile: "Dockerfile",
  Makefile: "Makefile",
  "CMakeLists.txt": "CMake",
  Gemfile: "Ruby",
  Rakefile: "Ruby",
  Justfile: "Just",
  "build.gradle": "Groovy",
  "settings.gradle": "Groovy",
};

/** Lockfile to package manager. The first match wins. */
const LOCKFILES: Array<[string, string]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["deno.lock", "deno"],
];

/** Configuration file to the tool it reveals. */
const FRAMEWORKS: Array<[RegExp, string]> = [
  [/^next\.config\./, "Next.js"],
  [/^nuxt\.config\./, "Nuxt"],
  [/^svelte\.config\./, "SvelteKit"],
  [/^astro\.config\./, "Astro"],
  [/^remix\.config\./, "Remix"],
  [/^angular\.json$/, "Angular"],
  [/^vite\.config\./, "Vite"],
  [/^webpack\.config\./, "webpack"],
  [/^rollup\.config\./, "Rollup"],
  [/^esbuild\./, "esbuild"],
  [/^tsconfig\./, "TypeScript"],
  [/^tailwind\.config\./, "Tailwind"],
  [/^bunfig\.toml$/, "Bun"],
  [/^deno\.json/, "Deno"],
  [/^wrangler\./, "Cloudflare Workers"],
  [/^Dockerfile$/, "Docker"],
  [/^docker-compose\.ya?ml$/, "Docker Compose"],
];

const TEST_PATH = /(\.test\.|\.spec\.|__tests__\/|\/tests?\/|\/e2e\/)/i;

/** API descriptions and request collections, so the overview can name them. */
const OPENAPI = /(^|\/)(openapi|swagger|api[-_.]?spec)[^/]*\.(json|ya?ml)$/i;
const POSTMAN = /(^|\/)postman\/|(^|\/)[^/]*postman[^/]*\.json$/i;
const BRUNO = /(^|\/)bruno\/|(^|\/)bruno\.json$|\.bru$/i;

export function apiArtifactOf(path: string): ApiArtifact | undefined {
  if (OPENAPI.test(path)) return { kind: "openapi", path };
  if (POSTMAN.test(path)) return { kind: "postman", path };
  if (BRUNO.test(path)) return { kind: "bruno", path };
  return undefined;
}

/** Reads the repository tree and reports what it is made of. */
export function describeRepository(paths: readonly string[]): RepositoryOverview {
  const languages = new Map<string, number>();
  let sourceFiles = 0;
  let testFiles = 0;
  let packageManager: string | undefined;
  let runtime: string | undefined;
  const frameworks: string[] = [];
  const apiArtifacts: ApiArtifact[] = [];

  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const language = LANGUAGES[extension] ?? FILE_LANGUAGES[name];
    if (language) languages.set(language, (languages.get(language) ?? 0) + 1);

    if (isSourceFile(path)) sourceFiles += 1;
    if (TEST_PATH.test(path)) testFiles += 1;

    const artifact = apiArtifactOf(path);
    if (artifact) apiArtifacts.push(artifact);

    if (!packageManager) {
      const lock = LOCKFILES.find(([file]) => name === file);
      if (lock) packageManager = lock[1];
    }

    if (!runtime) {
      if (name === ".nvmrc" || name === ".node-version") runtime = "node";
      else if (name === "deno.json" || name === "deno.jsonc") runtime = "deno";
      else if (name === ".tool-versions") runtime = "asdf";
      else if (name === "bunfig.toml") runtime = "bun";
    }

    for (const [pattern, tool] of FRAMEWORKS) {
      if (pattern.test(name) && !frameworks.includes(tool)) frameworks.push(tool);
    }
  }

  return {
    languages: [...languages.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    ...(packageManager ? { packageManager } : {}),
    ...(runtime ? { runtime } : {}),
    ...(apiArtifacts.length > 0 ? { apiArtifacts: apiArtifacts.slice(0, 12) } : {}),
    frameworks: frameworks.sort(),
    totalFiles: paths.length,
    sourceFiles,
    testFiles,
  };
}

/** The facts only package.json can tell. Missing fields stay missing. */
export function packageFacts(
  content: string,
): Pick<
  RepositoryOverview,
  "packageName" | "packageVersion" | "runtime" | "runtimeVersion" | "packageManager"
> {
  const facts: Pick<
    RepositoryOverview,
    "packageName" | "packageVersion" | "runtime" | "runtimeVersion" | "packageManager"
  > = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return facts;
  }
  if (typeof parsed !== "object" || parsed === null) return facts;
  const pkg = parsed as {
    name?: unknown;
    version?: unknown;
    packageManager?: unknown;
    engines?: { node?: unknown; bun?: unknown; deno?: unknown };
  };

  if (typeof pkg.name === "string" && pkg.name.trim()) facts.packageName = pkg.name.trim();
  if (typeof pkg.version === "string" && pkg.version.trim()) {
    facts.packageVersion = pkg.version.trim();
  }
  if (typeof pkg.packageManager === "string" && pkg.packageManager.trim()) {
    facts.packageManager = pkg.packageManager.trim().split("@")[0];
  }
  const engines = pkg.engines;
  if (engines && typeof engines === "object") {
    const node = engines.node;
    if (typeof node === "string" && node.trim()) {
      facts.runtime = facts.runtime ?? "node";
      facts.runtimeVersion = node.trim().replace(/^[\^~>=<\s]+/, "");
    }
  }
  return facts;
}

const OPENAPI_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** A local `#/components/...` reference resolver. Remote refs are not fetched. */
function resolveRef(doc: Record<string, unknown>, ref: string, depth = 0): unknown {
  if (depth > 20 || !ref.startsWith("#/")) return undefined;
  let current: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"))];
  }
  return current;
}

/** Follows local `$ref`s, with a depth cap so a cycle cannot hang the Worker. */
function deref(doc: Record<string, unknown>, value: unknown, depth = 0): unknown {
  const record = asRecord(value);
  if (!record || depth > 20) return value;
  const ref = typeof record.$ref === "string" ? record.$ref : undefined;
  if (!ref) return value;
  return deref(doc, resolveRef(doc, ref, depth), depth + 1);
}

function parseParameter(
  doc: Record<string, unknown>,
  value: unknown,
): OpenApiParameter | undefined {
  const parameter = asRecord(deref(doc, value));
  if (!parameter || typeof parameter.name !== "string" || typeof parameter.in !== "string") {
    return undefined;
  }
  const schema = asRecord(deref(doc, parameter.schema));
  const enumValues = schema && Array.isArray(schema.enum) ? schema.enum : undefined;
  return {
    name: parameter.name,
    in: parameter.in,
    ...(parameter.required === true ? { required: true } : {}),
    ...(schema ? { schema } : {}),
    ...(parameter.example !== undefined ? { example: parameter.example } : {}),
    ...(schema && schema.default !== undefined ? { default: schema.default } : {}),
    ...(enumValues ? { enum: enumValues } : {}),
  };
}

function parseRequestBody(
  doc: Record<string, unknown>,
  value: unknown,
): OpenApiRequestBody | undefined {
  const body = asRecord(deref(doc, value));
  const content = body && asRecord(body.content);
  if (!content) return undefined;
  const [contentType, media] = Object.entries(content)[0] ?? [];
  if (!contentType) return undefined;
  const mediaRecord = asRecord(media);
  const schema = asRecord(deref(doc, mediaRecord?.schema));
  return {
    contentType,
    ...(body?.required === true ? { required: true } : {}),
    ...(schema ? { schema } : {}),
    ...(mediaRecord?.example !== undefined ? { example: mediaRecord.example } : {}),
  };
}

function securityNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  for (const requirement of value) {
    for (const name of Object.keys(asRecord(requirement) ?? {})) names.add(name);
  }
  return [...names];
}

/** Parses an OpenAPI JSON or YAML document into a renderable summary. */
export function parseOpenApiSpec(content: string, path = ""): OpenApiSpec | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    try {
      parsed = parseYaml(content);
    } catch {
      return undefined;
    }
  }
  const doc = asRecord(parsed);
  if (!doc) return undefined;
  const isOpenApi = typeof doc.openapi === "string" || typeof doc.swagger === "string";
  if (!isOpenApi) return undefined;

  const endpoints: OpenApiSpec["endpoints"] = [];
  const paths = asRecord(doc.paths);
  if (paths) {
    for (const [route, operations] of Object.entries(paths)) {
      const item = asRecord(deref(doc, operations));
      if (!item) continue;
      const shared = Array.isArray(item.parameters)
        ? item.parameters.flatMap((parameter) => {
            const parsed = parseParameter(doc, parameter);
            return parsed ? [parsed] : [];
          })
        : [];
      for (const method of OPENAPI_METHODS) {
        const op = asRecord(deref(doc, item[method]));
        if (!op) continue;
        const own = Array.isArray(op.parameters)
          ? op.parameters.flatMap((parameter) => {
              const parsed = parseParameter(doc, parameter);
              return parsed ? [parsed] : [];
            })
          : [];
        const byKey = new Map<string, OpenApiParameter>();
        for (const parameter of [...shared, ...own]) {
          byKey.set(`${parameter.in}:${parameter.name}`, parameter);
        }
        const requestBody =
          op.requestBody === undefined ? undefined : parseRequestBody(doc, op.requestBody);
        const responses = asRecord(deref(doc, op.responses));
        const security = securityNames(op.security);
        endpoints.push({
          method: method.toUpperCase(),
          path: route,
          ...(typeof op.summary === "string" ? { summary: op.summary } : {}),
          ...(typeof op.description === "string" ? { description: op.description } : {}),
          ...(typeof op.operationId === "string" ? { operationId: op.operationId } : {}),
          ...(byKey.size > 0 ? { parameters: [...byKey.values()] } : {}),
          ...(requestBody ? { requestBody } : {}),
          ...(responses ? { responses: Object.keys(responses) } : {}),
          ...(security.length > 0 ? { security } : {}),
        });
      }
    }
  }

  const info = asRecord(doc.info);
  const servers = Array.isArray(doc.servers)
    ? doc.servers.flatMap((server) => {
        const record = asRecord(server);
        return record && typeof record.url === "string" ? [record.url] : [];
      })
    : [];
  return {
    path,
    ...(typeof info?.title === "string" ? { title: info.title } : {}),
    ...(typeof info?.version === "string" ? { version: info.version } : {}),
    ...(typeof info?.description === "string" ? { description: info.description } : {}),
    endpoints,
    ...(servers.length > 0 ? { servers } : {}),
    content,
  };
}

export const parseOpenApi = parseOpenApiSpec;
export const parseOpenAPI = parseOpenApiSpec;
export const parseOpenApiDocument = parseOpenApiSpec;
export const openApiFacts = parseOpenApiSpec;
export const describeOpenApi = parseOpenApiSpec;
