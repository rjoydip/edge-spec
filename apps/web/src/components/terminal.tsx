import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronUp, Search, Terminal, X } from "lucide-react";
import { Input, cn } from "@edge-spec/ui";
import type { StepId } from "@edge-spec/core/types";

export type LogLevel = "info" | "ai" | "warn" | "success" | "error";

export interface LogEntry {
  id: number;
  level: LogLevel;
  time: string;
  text: string;
  /** The pipeline stage that produced the entry; gap logs leave it unset. */
  step?: StepId;
}

const FILTERS = ["ALL", "INFO", "AI", "WARN", "SUCCESS", "ERROR"] as const;
const PAGE = 100;

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "border-sky-500/20 bg-sky-500/10 text-sky-400",
  ai: "border-indigo-500/20 bg-indigo-500/10 text-indigo-300",
  warn: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  error: "border-rose-500/20 bg-rose-500/10 text-rose-400",
};

const TEXT_STYLE: Record<LogLevel, string> = {
  info: "text-zinc-300",
  ai: "text-indigo-200",
  warn: "text-amber-200",
  success: "text-emerald-300",
  error: "text-rose-300",
};

interface TerminalProps {
  logs: LogEntry[];
  running: boolean;
  /** The name of the log, e.g. "Run log" or "Missing tests log". */
  title?: string;
  /** What the empty panel says. */
  empty?: string;
  /** Filter state for the header, e.g. the pipeline stage being shown. */
  context?: ReactNode;
}

export function TerminalPanel({
  logs,
  running,
  title = "Run log",
  empty = "No events yet. Set a repository and press Run.",
  context,
}: TerminalProps) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef(0);
  const loadingOlder = useRef(false);
  /** Follow new events only while the reader is already at the bottom. */
  const atBottom = useRef(true);

  const term = query.trim().toLowerCase();
  const filtered = logs.filter(
    (entry) =>
      (filter === "ALL" || entry.level.toUpperCase() === filter) &&
      (!term || entry.text.toLowerCase().includes(term)),
  );
  const hiddenCount = Math.max(0, filtered.length - visibleCount);
  const shown = hiddenCount > 0 ? filtered.slice(hiddenCount) : filtered;

  useEffect(() => {
    if (!atBottom.current) return;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [logs]);

  // A new filter or search starts at the newest events.
  useEffect(() => setVisibleCount(PAGE), [filter, query]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    atBottom.current = true;
  }, [filter, query]);

  // Keep the viewport steady when older rows are prepended.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    loadingOlder.current = false;
    if (!element || previousHeight.current === 0) return;
    element.scrollTop += element.scrollHeight - previousHeight.current;
    previousHeight.current = 0;
  }, [visibleCount]);

  const loadOlder = () => {
    const element = scrollRef.current;
    if (!element || loadingOlder.current || hiddenCount === 0) return;
    loadingOlder.current = true;
    previousHeight.current = element.scrollHeight;
    setVisibleCount((current) => current + PAGE);
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    if (element.scrollTop <= 24) loadOlder();
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  };

  return (
    <div className="glass-panel overflow-hidden rounded-2xl font-mono text-xs">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-indigo-400" />
            <span className="font-semibold text-zinc-200">{title}</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {filtered.length === logs.length ? logs.length : `${filtered.length}/${logs.length}`}{" "}
              events
            </span>
            {running && (
              <span className="flex items-center gap-1.5 text-[10px] text-indigo-300">
                <span className="size-1.5 animate-pulse rounded-full bg-indigo-400" />
                Live
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-zinc-600" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search logs…"
                aria-label={`Search ${title.toLowerCase()}`}
                spellCheck={false}
                className="h-7 w-36 pr-7 pl-7 text-[10px] sm:w-44"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear log search"
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            {FILTERS.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFilter(type)}
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-semibold transition",
                  filter === type
                    ? "border border-indigo-500/30 bg-indigo-500/15 text-indigo-300"
                    : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        {context && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
            {context}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="no-scrollbar h-72 space-y-1.5 overflow-y-auto bg-zinc-950/70 p-4"
      >
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={loadOlder}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-800 py-1.5 text-[10px] text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
          >
            <ChevronUp className="size-3" />
            {hiddenCount} earlier event{hiddenCount === 1 ? "" : "s"} · scroll up to load
          </button>
        )}
        {shown.length === 0 ? (
          <p className="text-zinc-600">
            {logs.length === 0 ? empty : "No events match the filter or search."}
          </p>
        ) : (
          shown.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 rounded p-0.5 leading-relaxed">
              <span className="shrink-0 text-zinc-600 select-none">{entry.time}</span>
              <span
                className={cn(
                  "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold",
                  LEVEL_STYLE[entry.level],
                )}
              >
                {entry.level.toUpperCase()}
              </span>
              <span className={cn("flex-1 break-words", TEXT_STYLE[entry.level])}>
                {entry.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
