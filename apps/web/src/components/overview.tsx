/**
 * The overview: what the repository is made of, which model writes its tests,
 * how the results are checked, and which files are still untested. Everything
 * here is read from the tree, never invented.
 */
import { lazy, Suspense, useState } from "react";
const RawSpecView = lazy(() => import("./raw-spec-view"));
import {
  Box,
  Package,
  Braces,
  Download,
  Cpu,
  FileCode2,
  Gauge,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Tag,
  Zap,
} from "lucide-react";
import type { Gap, OpenApiSpec, RepositoryOverview, Risk } from "@edge-spec/core/types";
import { Badge, Button, Dialog, ProviderIcon, cn } from "@edge-spec/ui";
import { PathTree } from "@/components/path-tree";
import { LanguageIcon } from "@/components/language-icon";
import { CHECK_TONES } from "@/lib/check-tones";
import type { LucideIcon } from "lucide-react";

const RISK = {
  high: { label: "H", color: "#fb7185", title: "High risk" },
  medium: { label: "M", color: "#fbbf24", title: "Medium risk" },
  low: { label: "L", color: "#a1a1aa", title: "Low risk" },
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
  hasRunner: boolean;
  /** The last refusal from the provider, e.g. an exhausted allocation. */
  providerError?: string;
  onOpenGap: (gap: Gap) => void;
  onOpenSettings: () => void;
  /** Opens Settings at the provider section. */
  onChangeProvider: () => void;
}

function Fact({
  label,
  value,
  icon: Icon,
  iconClassName = "text-indigo-400",
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  iconClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
      <p className="text-[10px] tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-xs text-zinc-200">
        {Icon && <Icon className={cn("size-3.5 shrink-0", iconClassName)} />}
        {value}
      </p>
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
  hasRunner,
  providerError,
  onOpenGap,
  onOpenSettings,
  onChangeProvider,
}: OverviewProps) {
  const [riskFilter, setRiskFilter] = useState<Risk | undefined>(undefined);
  const [filesOpen, setFilesOpen] = useState(false);
  const [openApiRaw, setOpenApiRaw] = useState(false);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const gap of gaps) counts[gap.risk] += 1;
  // A risk level filters the file tree in the modal.
  const visibleGaps = riskFilter ? gaps.filter((gap) => gap.risk === riskFilter) : gaps;

  const languages = overview?.languages ?? [];
  const languageTotal = languages.reduce((sum, language) => sum + language.count, 0);
  const checks = overview?.checks ?? [];
  const openApiSpecs = (overview?.openApiSpecs ??
    [overview?.openApiSpec, overview?.openApi, overview?.openapi].filter(Boolean)) as OpenApiSpec[];

  const downloadSpec = (spec: OpenApiSpec) => {
    const blob = new Blob([spec.content ?? ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = spec.path.split("/").pop() ?? "openapi";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <section className="glass-panel rounded-2xl p-3">
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
                <Fact
                  label="Package manager"
                  value={overview.packageManager ?? "unknown"}
                  icon={Package}
                />
                <Fact
                  label="Runtime"
                  icon={Package}
                  iconClassName="text-emerald-400"
                  value={
                    overview.runtime
                      ? `${overview.runtime}${overview.runtimeVersion ? ` ${overview.runtimeVersion}` : ""}`
                      : "unknown"
                  }
                />
                <Fact
                  label="Package"
                  value={overview.packageName ?? "unknown"}
                  icon={Box}
                  iconClassName="text-violet-400"
                />
                <Fact
                  label="Version"
                  value={overview.packageVersion ?? "0.0.0"}
                  icon={Tag}
                  iconClassName="text-amber-400"
                />
                <Fact
                  label="Files"
                  value={String(overview.totalFiles ?? 0)}
                  icon={FileCode2}
                  iconClassName="text-rose-400"
                />
                <Fact
                  label="Sources / tests"
                  icon={FileCode2}
                  iconClassName="text-cyan-400"
                  value={`${overview.sourceFiles ?? 0} / ${overview.testFiles ?? 0}`}
                />
              </div>
            </>
          )}
        </section>

        <section className="glass-panel flex min-h-full flex-col rounded-2xl p-4">
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

        <section className="glass-panel flex min-h-full flex-col rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Zap className="size-4 text-indigo-400" />
            Validation
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant={hasRunner ? "success" : "warning"}>
              {hasRunner ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
              {hasRunner ? "sandbox configured" : "static only"}
            </Badge>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            {hasRunner
              ? "The suite is executed, so a pass is a real pass."
              : "Without a sandbox EdgeSpec can only check the test statically. Add one in Settings to execute the suite."}
          </p>
          <Button variant="ghost" size="xs" className="mt-2" onClick={onOpenSettings}>
            {hasRunner ? "Manage the sandbox" : "Add a sandbox"}
          </Button>
        </section>

        <section className="glass-panel flex min-h-full flex-col rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <ShieldCheck className="size-4 text-indigo-400" />
            CI checks
          </h2>
          <p className="mt-3 text-[11px] text-zinc-500">
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

        <section className="glass-panel rounded-2xl p-3">
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
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <LanguageIcon language={language.name} className="size-3.5 shrink-0" />
                      {language.name}
                    </span>
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

        <section className="glass-panel rounded-2xl p-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
            <Gauge className="size-4 text-indigo-400" />
            Risk & untested files
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            A path heuristic, not a measurement. No coverage percentage is claimed.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["high", "medium", "low"] as const).map((risk) => {
              const RiskIcon =
                risk === "high" ? ShieldAlert : risk === "medium" ? ShieldAlert : ShieldCheck;
              const label =
                risk === "high" ? "HIGH (H)" : risk === "medium" ? "MEDIUM (M)" : "LOW (L)";
              const tone =
                risk === "high"
                  ? "text-rose-400"
                  : risk === "medium"
                    ? "text-amber-400"
                    : "text-zinc-400";
              return (
                <div
                  key={risk}
                  className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-center"
                >
                  <p
                    className={cn(
                      "flex items-center justify-center gap-1 text-[10px] tracking-wide uppercase",
                      tone,
                    )}
                  >
                    <RiskIcon className="size-3" />
                    {label}
                  </p>
                  <p className="mt-0.5 font-mono text-lg font-bold text-zinc-100">{counts[risk]}</p>
                </div>
              );
            })}
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

        {openApiSpecs.length > 0 && (
          <section className="glass-panel rounded-2xl p-3 md:col-span-2 xl:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
                <Braces className="size-4 text-indigo-400" />
                OpenAPI spec
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setOpenApiRaw(false)}
                  aria-pressed={!openApiRaw}
                  title="Rendered view"
                  className={cn(
                    "rounded border p-1 transition",
                    !openApiRaw
                      ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  <Braces className="size-3.5 text-sky-300" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenApiRaw(true)}
                  aria-pressed={openApiRaw}
                  title="Raw view"
                  className={cn(
                    "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300",
                    openApiRaw && "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
                  )}
                >
                  <FileCode2 className="size-3.5 text-amber-300" />
                </button>
                <button
                  type="button"
                  onClick={() => downloadSpec(openApiSpecs[0]!)}
                  title="Download raw spec"
                  className="inline-flex items-center justify-center rounded border border-emerald-500/40 bg-emerald-500/10 p-1 text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  <Download className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-4">
              {openApiSpecs.map((spec, index) => (
                <div
                  key={`${spec.path}-${index}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs text-zinc-200">{spec.title ?? spec.path}</p>
                    {spec.version && (
                      <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                        {spec.version}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-zinc-500">{spec.path}</span>
                  </div>
                  {spec.description && (
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                      {spec.description}
                    </p>
                  )}
                  {openApiRaw ? (
                    <div className="mt-3 h-64 overflow-hidden rounded-lg border border-zinc-800">
                      <Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center font-mono text-[11px] text-zinc-500">
                            loading…
                          </div>
                        }
                      >
                        <RawSpecView
                          path={spec.path}
                          code={spec.content ?? ""}
                          className="h-full"
                        />
                      </Suspense>
                    </div>
                  ) : spec.endpoints.length > 0 ? (
                    <ul className="mt-3 divide-y divide-zinc-800/70">
                      {spec.endpoints.map((endpoint, endpointIndex) => (
                        <li
                          key={`${endpoint.method}-${endpoint.path}-${endpointIndex}`}
                          className="flex flex-wrap items-center gap-2 py-2 text-[11px]"
                        >
                          <span
                            className={cn(
                              "w-14 shrink-0 rounded border px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold",
                              endpoint.method === "GET"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                : endpoint.method === "POST"
                                  ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                                  : endpoint.method === "PUT"
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                    : endpoint.method === "DELETE"
                                      ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                                      : endpoint.method === "PATCH"
                                        ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                                        : "border-zinc-700 bg-zinc-900 text-zinc-200",
                            )}
                          >
                            {endpoint.method}
                          </span>
                          <span className="font-mono text-zinc-300">{endpoint.path}</span>
                          {(endpoint.summary || endpoint.description) && (
                            <span className="text-zinc-500">
                              — {endpoint.summary ?? endpoint.description}
                            </span>
                          )}
                          {endpoint.operationId && (
                            <span className="ml-auto font-mono text-[10px] text-zinc-600">
                              {endpoint.operationId}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[11px] text-zinc-500">No operations declared.</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
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
