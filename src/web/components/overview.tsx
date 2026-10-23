/**
 * The overview: what the repository is made of, which model writes its tests,
 * how the results are checked, and which files are still untested. Everything
 * here is read from the tree, never invented.
 */
import { useState } from "react";
import {
  Box,
  Braces,
  Cpu,
  FileCode2,
  FolderTree,
  Gauge,
  Layers,
  Send,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import type { ApiArtifact, Gap, RepositoryOverview, Risk } from "../../core/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PathTree } from "@/components/path-tree";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { CHECK_TONES } from "@/lib/check-tones";
import { cn } from "@/lib/utils";
import type { Verification } from "@/components/pipeline";

const RISK = {
  high: { label: "H", color: "#fb7185", title: "High risk" },
  medium: { label: "M", color: "#fbbf24", title: "Medium risk" },
  low: { label: "L", color: "#a1a1aa", title: "Low risk" },
};

/** API descriptions and request collections each keep their own colour. */
const API_TONES: Record<
  ApiArtifact["kind"],
  { label: string; icon: typeof Braces; className: string }
> = {
  openapi: {
    label: "OpenAPI",
    icon: Braces,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
  postman: {
    label: "Postman",
    icon: Send,
    className: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  },
  bruno: {
    label: "Bruno",
    icon: FolderTree,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
};

interface OverviewProps {
  overview?: RepositoryOverview;
  gaps: Gap[];
  generatedPaths: string[];
  repo: string;
  providerId: string;
  providerName: string;
  modelName: string;
  baseUrl?: string;
  accountId?: string;
  verification: Verification;
  hasRunner: boolean;
  /** The last refusal from the provider, e.g. an exhausted allocation. */
  providerError?: string;
  onOpenGap: (gap: Gap) => void;
  onOpenSettings: () => void;
  /** Opens Settings at the provider section. */
  onChangeProvider: () => void;
}

/** A tool keeps its own colour, so the stack of badges is readable. */
const TOOL_TONES: Record<string, string> = {
  "Next.js": "border-sky-500/30 bg-sky-500/10 text-sky-300",
  Nuxt: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  SvelteKit: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  Astro: "border-purple-500/30 bg-purple-500/10 text-purple-300",
  Remix: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  Angular: "border-red-500/30 bg-red-500/10 text-red-300",
  Vite: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  webpack: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  Rollup: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  esbuild: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  TypeScript: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  Tailwind: "border-teal-500/30 bg-teal-500/10 text-teal-300",
  Bun: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Deno: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  "Cloudflare Workers": "border-orange-500/30 bg-orange-500/10 text-orange-300",
  Docker: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  "Docker Compose": "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
};

function ToolChip({ tool }: { tool: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap",
        TOOL_TONES[tool] ?? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
      )}
    >
      {tool}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <p className="text-[10px] tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs text-zinc-200">{value}</p>
    </div>
  );
}

export function Overview({
  overview,
  gaps,
  generatedPaths,
  repo,
  providerId,
  providerName,
  modelName,
  baseUrl,
  accountId,
  verification,
  hasRunner,
  providerError,
  onOpenGap,
  onOpenSettings,
  onChangeProvider,
}: OverviewProps) {
  const [riskFilter, setRiskFilter] = useState<Risk | undefined>(undefined);
  const [filesOpen, setFilesOpen] = useState(false);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const gap of gaps) counts[gap.risk] += 1;
  // A risk level filters the file tree in the modal.
  const visibleGaps = riskFilter ? gaps.filter((gap) => gap.risk === riskFilter) : gaps;

  const languages = overview?.languages ?? [];
  const languageTotal = languages.reduce((sum, language) => sum + language.count, 0);
  const checks = overview?.checks ?? [];
  const artifacts = overview?.apiArtifacts ?? [];

  const verificationLabel =
    verification === "verified"
      ? "bun test"
      : verification === "static"
        ? "static only"
        : verification === "failed"
          ? "failed"
          : hasRunner
            ? "runner ready"
            : "static only";

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <section className="glass-panel rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Box className="size-4 text-indigo-400" />
            Repository
          </h2>

          {!overview ? (
            <p className="mt-3 text-[11px] text-zinc-500">
              {repo
                ? "Scan the repository to read its languages and tooling."
                : "Enter owner/name in the header, then scan."}
            </p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Fact label="Package manager" value={overview.packageManager ?? "unknown"} />
                <Fact
                  label="Runtime"
                  value={
                    overview.runtime
                      ? `${overview.runtime}${overview.runtimeVersion ? ` ${overview.runtimeVersion}` : ""}`
                      : "unknown"
                  }
                />
                <Fact label="Package" value={overview.packageName ?? "unknown"} />
                <Fact label="Version" value={overview.packageVersion ?? "unknown"} />
                <Fact label="Files" value={String(overview.totalFiles)} />
                <Fact
                  label="Sources / tests"
                  value={`${overview.sourceFiles} / ${overview.testFiles}`}
                />
              </div>

              <div className="mt-3">
                <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
                  API specs & collections
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {artifacts.length === 0 ? (
                    <span className="text-[11px] text-zinc-500">
                      None found (OpenAPI, Postman, Bruno).
                    </span>
                  ) : (
                    (Object.keys(API_TONES) as ApiArtifact["kind"][]).map((kind) => {
                      const found = artifacts.filter((artifact) => artifact.kind === kind);
                      if (found.length === 0) return null;
                      const tone = API_TONES[kind];
                      const Icon = tone.icon;
                      return (
                        <span
                          key={kind}
                          title={found.map((artifact) => artifact.path).join("\n")}
                          className={cn(
                            "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px]",
                            tone.className,
                          )}
                        >
                          <Icon className="size-3" />
                          {tone.label} · {found.length}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {overview.frameworks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {overview.frameworks.map((tool) => (
                    <ToolChip key={tool} tool={tool} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Cpu className="size-4 text-indigo-400" />
            Model
          </h2>
          <div className="mt-3 flex items-center gap-2">
            <ProviderIcon provider={providerId} />
            <span className="text-xs text-zinc-200">{providerName}</span>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <Fact label="Model" value={modelName} />
            {baseUrl && <Fact label="Base URL" value={baseUrl} />}
            {accountId && <Fact label="Cloudflare account" value={accountId} />}
          </div>
          {providerError && (
            <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
              The last request was refused: {providerError}
            </p>
          )}
          <Button variant="ghost" size="xs" className="mt-2" onClick={onChangeProvider}>
            Change the provider
          </Button>
        </section>

        <section className="glass-panel rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Zap className="size-4 text-indigo-400" />
            Validation
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant={verification === "failed" ? "danger" : "accent"}>
              {verificationLabel}
            </Badge>
            <Badge variant={hasRunner ? "success" : "warning"}>
              {hasRunner ? "runner configured" : "static check only"}
            </Badge>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            {hasRunner
              ? "The suite is executed, so a pass is a real pass."
              : "Without a runner EdgeSpec can only check the test statically. Add one in Settings to execute the suite."}
          </p>
          <Button variant="ghost" size="xs" className="mt-2" onClick={onOpenSettings}>
            {hasRunner ? "Manage the runner" : "Add a runner"}
          </Button>
        </section>

        <section className="glass-panel rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <ShieldCheck className="size-4 text-indigo-400" />
            CI checks
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            A generated test has to satisfy these before a pull request is opened.
          </p>
          {checks.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {checks.map((check) => {
                const tone = CHECK_TONES[check.kind] ?? CHECK_TONES.test!;
                const Icon = tone.icon;
                return (
                  <li
                    key={check.command}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2 py-1.5 text-[11px]"
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md",
                        tone.iconClass,
                      )}
                    >
                      <Icon className="size-3" />
                    </span>
                    <span className={cn("font-mono", tone.textClass)}>{check.kind}</span>
                    <span className="truncate font-mono text-zinc-300">{check.command}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-[11px] text-zinc-500">
              {overview
                ? "No CI checks declared in the repository."
                : "Scan to see CI checks declared in the repository."}
            </p>
          )}
          {overview?.formatter && (
            <p className="mt-3 text-[11px] text-zinc-500">
              Formatted with <span className="font-mono text-zinc-300">{overview.formatter}</span>,
              so the committed file matches the repository style.
            </p>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Layers className="size-4 text-indigo-400" />
            Languages
          </h2>
          {languages.length === 0 ? (
            <p className="mt-3 text-[11px] text-zinc-500">No source languages found yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {languages.map((language) => (
                <li key={language.name}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-300">{language.name}</span>
                    <span className="font-mono text-zinc-500">
                      {language.count}
                      {languageTotal > 0 && (
                        <span className="ml-1 text-zinc-600">
                          {Math.round((language.count / languageTotal) * 100)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-indigo-500/80"
                      style={{
                        width: `${languageTotal > 0 ? (language.count / languageTotal) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-panel rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Gauge className="size-4 text-indigo-400" />
            Risk & untested files
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            A path heuristic, not a measurement. No coverage percentage is claimed.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["high", "medium", "low"] as const).map((risk) => (
              <div
                key={risk}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2"
              >
                <p className="text-[10px] tracking-wide text-zinc-500 uppercase">{risk}</p>
                <p className="mt-0.5 font-mono text-lg font-bold text-zinc-100">{counts[risk]}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-800 pt-3">
            <p className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
              <FileCode2 className="size-4 shrink-0 text-indigo-400" />
              <span className="truncate">
                {gaps.length === 0
                  ? repo
                    ? "No untested files"
                    : "No repository scanned"
                  : `${gaps.length} untested file${gaps.length === 1 ? "" : "s"}`}
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFilesOpen(true)}
              disabled={gaps.length === 0}
            >
              <Terminal className="size-3.5" />
              View files
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-600">
            {generatedPaths.length > 0
              ? `${generatedPaths.length} already have a generated test.`
              : "Pick a file to see it in Missing tests."}
          </p>
        </section>
      </div>

      <Dialog
        open={filesOpen}
        onClose={() => setFilesOpen(false)}
        title="Untested files"
        description="Source files with no matching test next to them."
        className="max-w-3xl"
        footer={
          <p className="mr-auto text-[11px] text-zinc-500">
            {generatedPaths.length > 0
              ? `${generatedPaths.length} of these files already have a generated test.`
              : "Pick a file to open it in Missing tests."}
          </p>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5 pb-3">
          <span className="text-[10px] text-zinc-600">filter</span>
          <button
            type="button"
            onClick={() => setRiskFilter(undefined)}
            aria-pressed={!riskFilter}
            className={cn(
              "rounded border px-2 py-0.5 font-mono text-[10px] transition",
              !riskFilter
                ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300",
            )}
          >
            all {gaps.length}
          </button>
          {(["high", "medium", "low"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setRiskFilter(riskFilter === risk ? undefined : risk)}
              aria-pressed={riskFilter === risk}
              title={RISK[risk].title}
              className={cn(
                "rounded border px-2 py-0.5 font-mono text-[10px] transition",
                riskFilter === risk
                  ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                  : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300",
              )}
            >
              {RISK[risk].label} {counts[risk]}
            </button>
          ))}
        </div>

        {visibleGaps.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ShieldAlert className="mx-auto size-8 text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-300">
              {riskFilter ? `No ${riskFilter} risk files here` : "Nothing untested here"}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800/70">
            <PathTree
              key={visibleGaps.map((gap) => gap.path).join("|")}
              paths={visibleGaps.map((gap) => gap.path)}
              onSelect={(path) => {
                const gap = visibleGaps.find((item) => item.path === path);
                if (!gap) return;
                setFilesOpen(false);
                onOpenGap(gap);
              }}
              decoration={(path) => {
                const gap = visibleGaps.find((item) => item.path === path);
                if (!gap) return null;
                const risk = RISK[gap.risk];
                return { text: risk.label, color: risk.color, title: risk.title };
              }}
              className="h-[55vh] min-h-64"
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
