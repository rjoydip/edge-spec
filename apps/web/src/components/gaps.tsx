import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileCode2,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import type { CoverageStatus, Gap, ScanTotals, ScanTruncation } from "@edge-spec/core/types";
import { Badge, Button, Switch, cn } from "@edge-spec/ui";

const RISK = {
  high: { variant: "danger" as const, label: "H" },
  medium: { variant: "warning" as const, label: "M" },
  low: { variant: "neutral" as const, label: "L" },
};

/** The gap categories the tab filters. */
export type GapFilter = "missing" | "coverage" | "api" | "unsupported";

const kindOf = (gap: Gap): GapFilter => gap.kind ?? "missing";

interface GapsProps {
  gaps: Gap[];
  generatedPaths: string[];
  /** The last validation result per source path. False means the test failed its checks. */
  validations?: Record<string, boolean>;
  generating: boolean;
  /** Parallel generation is on in Settings. */
  parallel: boolean;
  selected: string;
  checked: string[];
  /** Totals from the scan, so a filtered or truncated list stays honest. */
  totals?: ScanTotals;
  truncated?: ScanTruncation;
  coverageStatus?: CoverageStatus;
  coverageReason?: string;
  /** A runner is configured, so coverage and API tests can be measured. */
  hasRunner?: boolean;
  /** Focuses the file in the preview, in the code view or the metadata view. */
  onSelect: (gap: Gap, mode: "code" | "meta") => void;
  /** One path, or a list of paths, to add to or remove from the selection. */
  onToggleCheck: (paths: string | string[], checked: boolean) => void;
  /** Replaces the selection, e.g. for select all and clear. */
  onSetChecked: (paths: string[]) => void;
  /** The files whose last generation failed, with the reason. */
  errors?: Record<string, string>;
  onGenerate: (paths: string[]) => void;
  /** Paths whose generation is in flight right now: per-item spinner. */
  generatingPaths: string[];
  /** Overrides the settings parallel value for this session. */
  onParallelChange?: (value: boolean) => void;
  /** The pipeline is generating tests; the gap-level toggle stays hidden. */
  pipelineRunning?: boolean;
  /** Stops a running generation. */
  onStop: () => void;
  repo: string;
  /** Start the list in this repository folder; the scan is still whole-repo. */
  folder?: string;
  onClearFolder?: () => void;
}

export function Gaps({
  gaps,
  generatedPaths,
  validations = {},
  generating,
  generatingPaths,
  parallel,
  onParallelChange,
  pipelineRunning,
  selected,
  checked,
  totals,
  truncated,
  coverageStatus,
  coverageReason,
  hasRunner = false,
  onSelect,
  onToggleCheck,
  onSetChecked,
  onGenerate,
  onStop,
  errors = {},
  repo,
  folder,
  onClearFolder,
}: GapsProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [filter, setFilter] = useState<GapFilter>("missing");
  const counts: ScanTotals = totals ?? {
    missing: gaps.filter((gap) => kindOf(gap) === "missing").length,
    coverage: gaps.filter((gap) => kindOf(gap) === "coverage").length,
    api: gaps.filter((gap) => kindOf(gap) === "api").length,
    unsupported: gaps.filter((gap) => kindOf(gap) === "unsupported").length,
  };
  const visible = gaps.filter((gap) => kindOf(gap) === filter);
  const pending = visible.filter((gap) => !generatedPaths.includes(gap.path));
  const allChecked = pending.length > 0 && pending.every((gap) => checked.includes(gap.path));
  const someChecked = checked.length > 0 && !allChecked;
  const passedCount = generatedPaths.filter((path) => validations[path] === true).length;
  const validationFailedCount = generatedPaths.filter((path) => validations[path] === false).length;
  const generationFailedCount = Object.keys(errors).filter(
    (path) => !generatedPaths.includes(path),
  ).length;
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  // While a generation runs, parallel mode still accepts new files.
  const canGenerate = !generating || parallel;
  const truncatedHere = truncated?.[filter as keyof ScanTruncation] === true;
  const total = counts[filter];

  const FILTERS: Array<[GapFilter, string, string | undefined]> = [
    ["missing", "Missing", undefined],
    ["coverage", "Coverage", hasRunner ? undefined : "Needs a sandbox runner to measure coverage."],
    ["api", "API", hasRunner ? undefined : "Needs a sandbox runner to execute contract tests."],
    ["unsupported", "Unsupported", undefined],
  ];

  // A file picked elsewhere (the Overview, the tree) is scrolled into view, so
  // the list always shows which one is focused.
  useEffect(() => {
    if (!selected) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-gap-path="${CSS.escape(selected)}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [selected, gaps.length]);

  return (
    <div className="glass-panel flex h-[min(70vh,40rem)] flex-col overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <p className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
          <ShieldAlert className="size-4 shrink-0 text-indigo-400" />
          <span className="truncate">
            {counts.missing + counts.coverage + counts.api + counts.unsupported > 0
              ? `${counts.missing} missing · ${counts.coverage} coverage · ${counts.api} API · ${counts.unsupported} unsupported`
              : "No cached scan"}
          </span>
        </p>
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-[10px]">
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-indigo-300">
            {generatedPaths.length} generated
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">
            {passedCount} passed
          </span>
          {validationFailedCount > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-amber-300">
              {validationFailedCount} validation failed
            </span>
          )}
          {generationFailedCount > 0 && (
            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-rose-300">
              {generationFailedCount} failed
            </span>
          )}
        </div>
      </div>

      {folder && (
        <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-sky-500/5 px-4 py-1.5 text-[10px] text-sky-300">
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="truncate" title={folder}>
            Whole repository · starting in <span className="font-mono text-sky-200">{folder}</span>
          </span>
          {onClearFolder && (
            <button
              type="button"
              onClick={onClearFolder}
              title="Clear the start folder"
              aria-label="Clear the start folder"
              className="ml-auto shrink-0 rounded p-0.5 text-sky-400/70 transition hover:bg-sky-500/10 hover:text-sky-200"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}

      {gaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950/40 px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-400 select-none">
            <input
              type="checkbox"
              className="size-3.5"
              checked={allChecked}
              ref={(node) => {
                if (node) node.indeterminate = someChecked;
              }}
              onChange={(event) =>
                onSetChecked(event.target.checked ? pending.map((gap) => gap.path) : [])
              }
              aria-label="Select every pending file"
            />
            Select all
          </label>

          <span className="h-4 w-px bg-zinc-800" />

          {checked.length > 0 ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 font-mono text-[10px] text-indigo-300">
                <span className="size-1.5 rounded-full bg-indigo-400" />
                {checked.length} selected
              </span>
              <Button
                size="xs"
                onClick={() => onGenerate(checked)}
                disabled={!canGenerate}
                className="shadow-md shadow-indigo-950/30"
              >
                <Sparkles className="size-3.5" />
                Generate {checked.length} test{checked.length === 1 ? "" : "s"}
              </Button>
              <button
                type="button"
                onClick={() => onSetChecked([])}
                className="text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              >
                Clear
              </button>
            </>
          ) : (
            <span className="truncate text-[11px] text-zinc-500">
              Select files to generate tests.
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            {generating && (
              <Button size="xs" variant="danger" onClick={onStop}>
                <Square className="size-3.5 fill-current" />
              </Button>
            )}
            {checked.length > 1 && !pipelineRunning && (
              <label className="flex cursor-pointer items-center gap-2">
                <Switch
                  size="sm"
                  checked={parallel}
                  onCheckedChange={(value) => onParallelChange?.(value)}
                  aria-label="Parallel generation"
                />
                <span className="text-[10px] text-zinc-500">
                  {parallel ? "Parallel" : "Sequential"}
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {(counts.missing + counts.coverage + counts.api + counts.unsupported > 0 ||
        gaps.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 bg-zinc-950/60 px-4 py-2">
          {FILTERS.map(([id, label, disabledReason]) => {
            const disabled = Boolean(disabledReason);
            const active = filter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[10px] transition",
                  active
                    ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-200"
                    : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                  disabled &&
                    "cursor-not-allowed opacity-40 hover:border-zinc-800 hover:text-zinc-500",
                )}
              >
                {label} ({counts[id]})
              </button>
            );
          })}
          {coverageStatus === "not-run" && (
            <span className="ml-auto text-[10px] text-zinc-600">coverage not measured</span>
          )}
          {coverageStatus === "unavailable" && (
            <span className="ml-auto truncate text-[10px] text-amber-400/80" title={coverageReason}>
              coverage unavailable{coverageReason ? ` · ${coverageReason}` : ""}
            </span>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-16 text-center">
          <FileCode2 className="mx-auto size-8 text-zinc-700" />
          <p className="mt-3 text-sm font-medium text-zinc-300">
            {repo
              ? gaps.length === 0
                ? "No missing tests yet"
                : `No ${filter} gaps`
              : "No repository set"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            {repo
              ? gaps.length === 0
                ? "Scan the repository to list source files that have no test next to them."
                : filter === "coverage" && coverageStatus === "not-run"
                  ? "Run a scan with a sandbox runner to measure coverage."
                  : filter === "api"
                    ? "Add an OpenAPI spec, or run the pipeline in API mode, to list contract gaps."
                    : "Nothing in this category. Pick another filter."
              : "Enter owner/name or a folder path in the header, then scan."}
          </p>
        </div>
      ) : (
        <ul
          ref={listRef}
          className="no-scrollbar min-h-0 flex-1 divide-y divide-zinc-800 overflow-auto"
        >
          {truncatedHere && (
            <li className="bg-amber-500/5 px-4 py-1.5 text-[10px] text-amber-400">
              Showing {visible.length} of {total} {filter} gaps.
            </li>
          )}
          {visible.map((gap) => {
            const risk = RISK[gap.risk];
            const kind = kindOf(gap);
            const unsupported = kind === "unsupported";
            const done = generatedPaths.includes(gap.path);
            const failed = validations[gap.path] === false;
            const failure = done ? undefined : errors[gap.path];
            const isChecked = checked.includes(gap.path);
            const itemBusy = generatingPaths.includes(gap.path);
            return (
              <li
                key={gap.path}
                role="button"
                tabIndex={0}
                data-gap-path={gap.path}
                onClick={() => onSelect(gap, done ? "code" : "meta")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(gap, done ? "code" : "meta");
                  }
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-zinc-800/40",
                  // The focused file wears an accent bar, so it is obvious
                  // which one the preview is showing.
                  selected === gap.path &&
                    "bg-indigo-500/10 shadow-[inset_2px_0_0_0_var(--accent-500)]",
                  itemBusy && "animate-pulse",
                )}
              >
                {!unsupported && (
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0"
                    checked={isChecked}
                    onChange={(event) => onToggleCheck(gap.path, event.target.checked)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${gap.path}`}
                  />
                )}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Badge variant={risk.variant}>{risk.label}</Badge>
                  <span className="truncate font-mono text-[11px] text-zinc-300">{gap.path}</span>
                  {kind !== "missing" && (
                    <span className="shrink-0 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] tracking-wide text-zinc-400 uppercase">
                      {gap.language ?? kind}
                    </span>
                  )}
                </div>

                {itemBusy && !done && (
                  <span className="shrink-0 text-indigo-400">
                    <Loader2 className="size-4 animate-spin" aria-label="Generating" />
                  </span>
                )}
                {done && !failed && (
                  <span title="The test passed validation" className="shrink-0 text-emerald-400">
                    <CheckCircle2 className="size-4" aria-label="Test passed validation" />
                  </span>
                )}
                {done && failed && (
                  <span
                    title="The test failed validation. Open its preview to see why."
                    className="shrink-0 text-amber-400"
                  >
                    <TriangleAlert className="size-4" aria-label="Validation failed" />
                  </span>
                )}
                {failure && (
                  <span
                    className="relative shrink-0"
                    onMouseEnter={() => setHoveredPath(gap.path)}
                    onMouseLeave={() => setHoveredPath(null)}
                  >
                    <AlertCircle
                      className="size-4 cursor-help text-rose-400"
                      aria-label={`Generation failed: ${failure.slice(0, 120)}`}
                    />
                    {hoveredPath === gap.path && (
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[10px] leading-snug text-zinc-300 shadow-xl"
                      >
                        {failure.length > 140 ? `${failure.slice(0, 140)}…` : failure}
                      </span>
                    )}
                  </span>
                )}

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(gap, "meta");
                  }}
                  title="What is missing in this file"
                  aria-label={`Show what is missing in ${gap.path}`}
                  className="shrink-0 rounded-lg border border-zinc-800 p-1 text-zinc-500 transition hover:border-indigo-500/50 hover:text-indigo-300"
                >
                  <Info className="size-3.5" />
                </button>

                {unsupported ? null : done ? (
                  <>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(gap, "code");
                      }}
                      title="Preview the generated test"
                      aria-label={`Preview the test for ${gap.path}`}
                      className="shrink-0 rounded-lg border border-sky-500/30 bg-sky-500/10 p-1 text-sky-300 transition hover:border-sky-400/50 hover:text-sky-200"
                    >
                      <Eye className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onGenerate([gap.path]);
                      }}
                      title={
                        canGenerate
                          ? "Regenerate the test for this file"
                          : "Wait for the running generation, or turn on parallel mode"
                      }
                      aria-label={`Regenerate the test for ${gap.path}`}
                      disabled={itemBusy || !canGenerate}
                      className="shrink-0 rounded-lg border border-violet-500/30 bg-violet-500/10 p-1 text-violet-300 transition hover:border-violet-400/50 hover:text-violet-200 disabled:opacity-40"
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onGenerate([gap.path]);
                    }}
                    title={
                      canGenerate
                        ? "Generate a test for this file"
                        : "Wait for the running generation, or turn on parallel mode"
                    }
                    aria-label={`Generate a test for ${gap.path}`}
                    disabled={itemBusy || !canGenerate}
                    className="shrink-0 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-1 text-indigo-300 transition hover:border-indigo-400/50 hover:text-indigo-200 disabled:opacity-40"
                  >
                    <Sparkles className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
