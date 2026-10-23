import {
  Cpu,
  GitPullRequest,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  Zap,
} from "lucide-react";
import { useState } from "react";
import type { StepId } from "@edge-spec/core/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel, type LogEntry } from "@/components/terminal";
import { cn } from "@/lib/utils";

export type StepStatus = "idle" | "running" | "done" | "failed";
export type Steps = Record<StepId, { status: StepStatus; note?: string }>;

export const INITIAL_STEPS: Steps = {
  scan: { status: "idle" },
  generate: { status: "idle" },
  validate: { status: "idle" },
  correct: { status: "idle" },
  "pull-request": { status: "idle" },
};

export type Verification = "none" | "verified" | "static" | "failed";

const NODES: Array<{
  id: StepId;
  step: string;
  title: string;
  desc: string;
  icon: typeof Search;
  tone: string;
}> = [
  {
    id: "scan",
    step: "01",
    title: "Scan",
    desc: "Find source files with no sibling test",
    icon: Search,
    tone: "border-sky-500/25 bg-sky-500/10 text-sky-400",
  },
  {
    id: "generate",
    step: "02",
    title: "Generate",
    desc: "Write bun:test specs with your model",
    icon: Cpu,
    tone: "border-indigo-500/25 bg-indigo-500/10 text-indigo-400",
  },
  {
    id: "validate",
    step: "03",
    title: "Validate",
    desc: "Run the suite, or static-check it",
    icon: Zap,
    tone: "border-amber-500/25 bg-amber-500/10 text-amber-400",
  },
  {
    id: "correct",
    step: "04",
    title: "Self-correct",
    desc: "Feed failures back, bounded by retries",
    icon: RotateCcw,
    tone: "border-violet-500/25 bg-violet-500/10 text-violet-400",
  },
  {
    id: "pull-request",
    step: "05",
    title: "Pull request",
    desc: "Review the preview, then open the PR by hand",
    icon: GitPullRequest,
    tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  },
];

const STATUS_TONES: Record<StepStatus, string> = {
  idle: "border-zinc-700/60 bg-zinc-800/40 text-zinc-400",
  running: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-400",
};

interface PipelineProps {
  steps: Steps;
  logs: LogEntry[];
  running: boolean;
  onRun: () => void;
  onStop: () => void;
}

export function Pipeline({ steps, logs, running, onRun, onStop }: PipelineProps) {
  const [selected, setSelected] = useState<StepId | undefined>(undefined);
  const selectedNode = selected ? NODES.find((node) => node.id === selected) : undefined;
  const visibleLogs = selected ? logs.filter((entry) => entry.step === selected) : logs;

  return (
    <div className="space-y-5">
      <div className="glass-panel relative overflow-hidden rounded-2xl p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
              <RefreshCw className="size-4 text-indigo-400" />
              Pipeline
              {running && (
                <Badge variant="accent" className="gap-1.5 py-1">
                  <span className="size-1.5 animate-pulse rounded-full bg-indigo-400" />
                  Running
                </Badge>
              )}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Each phase streams live; nothing is persisted on the server.
            </p>
          </div>
          <Button
            size="sm"
            variant={running ? "danger" : "default"}
            onClick={running ? onStop : onRun}
            className="w-8 px-0"
            title={running ? "Stop the run" : "Run pipeline"}
            aria-label={running ? "Stop the run" : "Run pipeline"}
          >
            {running ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <Play className="size-3.5 fill-current" />
            )}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {NODES.map((node, index) => {
            const state = steps[node.id];
            const runningNow = state.status === "running";
            const done = state.status === "done";
            const failed = state.status === "failed";
            const Icon = node.icon;

            return (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setSelected((current) => (current === node.id ? undefined : node.id))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected((current) => (current === node.id ? undefined : node.id));
                  }
                }}
                aria-pressed={selected === node.id}
                title={
                  selected === node.id ? `Show every log again` : `Show only the ${node.title} log`
                }
                style={{ animationDelay: `${index * 55}ms` }}
                className={cn(
                  "pipeline-node flex w-full cursor-pointer flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5",
                  runningNow
                    ? "pipeline-node-active scale-[1.02] border-indigo-500/60 bg-indigo-500/10 shadow-lg shadow-indigo-950/20"
                    : done
                      ? "border-emerald-500/30 bg-zinc-900/70 hover:border-emerald-500/50"
                      : failed
                        ? "border-rose-500/40 bg-rose-500/5 hover:border-rose-500/60"
                        : "border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700",
                  selected === node.id && "ring-2 ring-indigo-500/60",
                )}
              >
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-lg border font-mono text-xs font-bold transition-colors",
                        node.tone,
                      )}
                    >
                      {node.step}
                    </span>
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-lg border transition-colors",
                        node.tone,
                      )}
                    >
                      <Icon className={cn("size-3.5", runningNow && "animate-pulse")} />
                    </span>
                  </div>
                  <p className="text-xs font-bold text-zinc-100">{node.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{node.desc}</p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-800/60 pt-2 text-[10px]">
                  <span className="text-zinc-500">status</span>
                  <span
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 font-mono font-semibold",
                      STATUS_TONES[state.status],
                      runningNow && "status-live",
                    )}
                  >
                    <span className="size-1 shrink-0 rounded-full bg-current" />
                    <span className="truncate">
                      {state.note ??
                        (runningNow
                          ? "processing"
                          : done
                            ? "completed"
                            : failed
                              ? "failed"
                              : "idle")}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <ShieldAlert className="size-3.5" />
        The repository, the model and the runner come from the header and the Overview tab.
        <RefreshCw className="ml-auto size-3.5" />
        Settings apply to the next run.
      </div>

      <TerminalPanel
        logs={visibleLogs}
        running={running}
        title={selectedNode ? `${selectedNode.title} log` : "Run log"}
        empty={
          selectedNode
            ? `No events for ${selectedNode.title} yet.`
            : "No events yet. Set a repository and press Run."
        }
        context={
          selectedNode ? (
            <>
              <span>Showing</span>
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                {selectedNode.title}
              </span>
              <span className="text-zinc-600">· {visibleLogs.length} event(s)</span>
              <button
                type="button"
                onClick={() => setSelected(undefined)}
                className="ml-auto text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              >
                Show all logs
              </button>
            </>
          ) : (
            "All stages · click a stage to filter its log"
          )
        }
      />
    </div>
  );
}
