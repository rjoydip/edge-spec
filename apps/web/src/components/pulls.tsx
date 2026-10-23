import { useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import type { PullSummary } from "@edge-spec/core/github";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type PullFilter = "all" | "open" | "closed";

interface PullsProps {
  pulls: PullSummary[];
  loading: boolean;
  error?: string;
  repo: string;
  onRefresh: () => void;
}

const date = (iso: string): string => {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? iso : value.toLocaleDateString();
};

export function Pulls({ pulls, loading, error, repo, onRefresh }: PullsProps) {
  const [filter, setFilter] = useState<PullFilter>("all");
  const filtered = pulls.filter((pull) => filter === "all" || pull.state === filter);
  const open = pulls.filter((pull) => pull.state === "open").length;
  const closed = pulls.filter((pull) => pull.state === "closed").length;

  return (
    <div className="glass-panel rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <p className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
          <GitPullRequest className="size-4 shrink-0 text-indigo-400" />
          <span className="truncate">
            {repo ? (
              <span
                className="flex items-center gap-2"
                title="Among the 20 most recent pull requests"
              >
                <span className="font-mono text-emerald-400">{open} open</span>
                <span className="text-zinc-700">·</span>
                <span className="font-mono text-indigo-400">{closed} closed</span>
              </span>
            ) : (
              "No repository set · add owner/name in the header"
            )}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as PullFilter)}
            disabled={!repo}
          >
            <SelectTrigger className="w-32" aria-label="Filter pull requests by state">
              <span className="flex min-w-0 items-center gap-1.5">
                <ListFilter className="size-3.5 shrink-0 text-zinc-500" />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={onRefresh} disabled={loading || !repo}>
            <RefreshCw className={cn(loading && "animate-spin")} />
            {loading ? "Loading" : "Refresh"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="px-5 py-12 text-center text-xs text-rose-400">{error}</p>
      ) : pulls.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <GitPullRequest className="mx-auto size-8 text-zinc-700" />
          <p className="mt-3 text-sm font-medium text-zinc-300">
            {loading ? "Loading pull requests…" : "No pull requests yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            EdgeSpec opens one after a generated test passes validation.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <ListFilter className="mx-auto size-8 text-zinc-700" />
          <p className="mt-3 text-sm font-medium text-zinc-300">No {filter} pull requests</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            Try another state in the filter.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {filtered.map((pull) => (
            <li
              key={pull.number}
              className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <GitPullRequest
                    className={cn(
                      "size-4 shrink-0",
                      pull.state === "open" ? "text-emerald-400" : "text-indigo-400",
                    )}
                  />
                  <span className="truncate text-xs font-semibold text-zinc-200">{pull.title}</span>
                  <span className="font-mono text-[11px] text-zinc-500">#{pull.number}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-[11px] text-zinc-500">
                  {pull.branch && (
                    <span className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-zinc-400">
                      <GitBranch className="size-3 text-indigo-400" />
                      {pull.branch}
                    </span>
                  )}
                  <Badge variant={pull.state === "open" ? "success" : "neutral"}>
                    {pull.state}
                  </Badge>
                  <span>{pull.author}</span>
                  <span>·</span>
                  <span>{date(pull.createdAt)}</span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(pull.url, "_blank", "noopener")}
                className="self-start md:self-auto"
              >
                <ExternalLink />
                View on GitHub
                <CheckCircle2 className="text-emerald-400" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
