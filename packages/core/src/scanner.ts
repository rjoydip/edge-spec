/** Pure gap analysis: which source files have no matching test file. */
import type { ApiArtifact, Gap, RepositoryOverview, Risk } from "./types";

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

/**
 * `paths` is every blob in the repository. A source file is a gap when its
 * expected sibling test path is absent.
 */
export function findGaps(paths: readonly string[], limit = 50): Gap[] {
  const present = new Set(paths);
  const gaps: Gap[] = [];

  for (const path of present) {
    if (!isSourceFile(path)) continue;
    const testPath = expectedTestPath(path);
    if (present.has(testPath)) continue;

    const risk = riskOf(path);
    const testName = testPath.slice(testPath.lastIndexOf("/") + 1);
    gaps.push({
      path,
      testPath,
      risk,
      exports: [],
      reason: `No ${testName} next to this file.`,
    });
  }

  const order: Record<Risk, number> = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => order[a.risk] - order[b.risk] || a.path.localeCompare(b.path));
  return gaps.slice(0, limit);
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
