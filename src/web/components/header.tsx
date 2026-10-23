import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  FolderGit2,
  GitBranch,
  KeyRound,
  Moon,
  RefreshCw,
  Settings,
  Sun,
} from "lucide-react";
import { fetchBranches } from "@/api";
import { providerById, parseRepoInput } from "../../core/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProviderIcon } from "@/components/ui/provider-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  setProject,
  type Project as ProjectValue,
  type Settings as SettingsValue,
  type Secrets,
} from "@/lib/settings";
import type { RateLimitInfo } from "../../core/types";
import { isLocalHost } from "@/lib/env";
import { toggleMode, useAppearance } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface HeaderProps {
  project: ProjectValue;
  settings: SettingsValue;
  secrets: Secrets;
  running: boolean;
  scanning: boolean;
  onScan: () => void;
  /** The logo clears the repository, the scan and the generated tests. */
  onReset: () => void;
  /** What the provider says about the calls it has left. */
  quota?: RateLimitInfo;
  /** The last refusal from the provider. */
  providerError?: string;
  onOpenSettings: () => void;
  /** Opens Settings at the provider section. */
  onOpenProvider: () => void;
}

/** A small number that fits on a badge: 12, 1.2k, 10k. */
function compactNumber(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/** The header input shows the repository and, when set, the start folder. */
function projectInput(project: ProjectValue): string {
  return project.folder ? `${project.repo}/${project.folder}` : project.repo;
}

/** Header: brand, repository, provider state, theme, settings. Uniform `h-9` row. */
export function Header({
  project,
  settings,
  secrets,
  running,
  scanning,
  onScan,
  onReset,
  quota,
  providerError,
  onOpenSettings,
  onOpenProvider,
}: HeaderProps) {
  const { mode } = useAppearance();
  const provider = providerById(settings.provider);
  const [repo, setRepo] = useState(projectInput(project));
  const [branches, setBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string>();
  const refValue = useRef(project.ref);

  // Keep the draft in step when the saved project changes.
  useEffect(() => setRepo(projectInput(project)), [project.repo, project.folder]);
  useEffect(() => {
    refValue.current = project.ref;
  }, [project.ref]);

  // A repository is enough to fetch its branches; the chosen branch stays a dropdown.
  useEffect(() => {
    if (!project.repo) {
      setBranches([]);
      setBranchError(undefined);
      setBranchLoading(false);
      return;
    }
    let cancelled = false;
    setBranches([]);
    setBranchLoading(true);
    setBranchError(undefined);
    fetchBranches(project.repo)
      .then((result) => {
        if (cancelled) return;
        setBranches(result.branches);
        if (!refValue.current || !result.branches.includes(refValue.current)) {
          setProject({ ref: result.defaultBranch });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setBranchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setBranchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.repo]);

  const invalid = repo.trim().length > 0 && !parseRepoInput(repo);
  // The branch belongs to the saved repository. While the input is being
  // edited, it is neither trustworthy nor useful, so it collapses away.
  const editing = repo.trim() !== projectInput(project);
  const branchOpen = Boolean(project.repo) && !editing;
  // On a deployed Worker the deployment's own Workers AI binding is not used,
  // so a key is needed there.
  const needsKey =
    !secrets.aiKey.trim() &&
    Boolean(provider?.needsKey || (provider?.id === "workers-ai" && !isLocalHost()));
  const needsUrl = settings.provider === "private" && !settings.baseUrl.trim();
  // The provider says it has no calls left.
  const exhausted = quota?.remaining === 0;
  const branchOptions =
    project.ref && !branches.includes(project.ref) ? [project.ref, ...branches] : branches;

  const commit = () => {
    const next = repo.trim();
    if (!next) {
      setProject({ repo: "", ref: "", folder: "" });
      return;
    }
    const parsed = parseRepoInput(next);
    if (!parsed) return;
    const name = `${parsed.owner}/${parsed.name}`;
    const folder = parsed.folder ?? "";
    const sameRepo = name === project.repo;
    if (sameRepo && folder === project.folder) {
      if (parsed.ref && parsed.ref !== project.ref) setProject({ ref: parsed.ref });
      setRepo(folder ? `${name}/${folder}` : name);
      return;
    }
    setProject({
      repo: name,
      ref: parsed.ref ?? (sameRepo ? project.ref : ""),
      folder,
    });
  };

  return (
    <header className="app-reveal glass-panel sticky top-0 z-30 rounded-2xl px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            title="Reset everything"
            aria-label="Reset everything"
            className="relative rounded-xl transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:outline-none"
          >
            <img
              src="/favicon.svg"
              alt=""
              width={36}
              height={36}
              className="brand-mark size-9 shadow-lg shadow-indigo-950/30"
            />
            {running && (
              <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
            )}
          </button>
          <div className="leading-tight">
            <h1 className="text-base font-bold tracking-tight text-white">EdgeSpec</h1>
          </div>
        </div>

        <div className="order-3 flex min-w-0 flex-1 basis-full items-center gap-2 lg:order-none lg:basis-auto">
          <div className="relative min-w-0 flex-1 lg:max-w-md">
            {project.folder ? (
              <FolderGit2 className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
            ) : (
              <GitBranch className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
            )}
            <Input
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="owner/repository[/folder]"
              aria-label="GitHub repository or folder path"
              title={
                project.folder
                  ? `Whole repository, starting in ${project.folder}`
                  : "GitHub repository"
              }
              aria-invalid={invalid}
              spellCheck={false}
              className={cn(
                "pl-8 font-mono",
                invalid && "border-rose-500/60 focus:border-rose-500/60",
              )}
            />
          </div>
          <div
            aria-hidden={branchOpen ? undefined : true}
            className={cn(
              "min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 ease-out",
              branchOpen
                ? cn("max-w-44 opacity-100", !project.folder && "sm:max-w-56")
                : "pointer-events-none -mr-2 max-w-0 opacity-0",
            )}
          >
            {project.repo &&
              (project.folder ? (
                <Badge
                  variant={branchError ? "warning" : "neutral"}
                  title={
                    branchError ??
                    "Branch used for the whole repository. Enter owner/repo to choose another."
                  }
                  className="h-9 max-w-44 shrink-0 gap-1.5 px-2.5"
                >
                  {branchError ? (
                    <AlertCircle className="size-3.5 shrink-0" />
                  ) : (
                    <GitBranch className="size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 truncate">
                    {branchLoading ? "loading…" : project.ref || "default"}
                  </span>
                </Badge>
              ) : (
                <Select
                  value={project.ref || undefined}
                  onValueChange={(value) => setProject({ ref: value })}
                  disabled={branchLoading}
                >
                  <SelectTrigger
                    aria-label="Branch"
                    title={branchError ?? "Branch"}
                    tabIndex={branchOpen ? undefined : -1}
                    className="w-44 shrink-0 font-mono sm:w-56"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {branchError ? (
                        <AlertCircle className="size-3.5 shrink-0 text-amber-400" />
                      ) : (
                        <GitBranch className="size-3.5 shrink-0 text-zinc-500" />
                      )}
                      <SelectValue placeholder={branchLoading ? "loading…" : "branch"} />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {branchOptions.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        No branches found
                      </SelectItem>
                    ) : (
                      branchOptions.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              ))}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="default"
              size="icon"
              onClick={onScan}
              disabled={running || scanning || !project.repo}
              title={scanning ? "Scanning…" : "Scan"}
              aria-label="Scan"
            >
              <RefreshCw className={scanning ? "animate-spin" : undefined} />
            </Button>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenProvider}
            title={`${provider?.name ?? "AI provider"}${
              needsKey
                ? " — a key is required here"
                : needsUrl
                  ? " — a base URL is required"
                  : providerError
                    ? ` — ${providerError}`
                    : quota?.remaining !== undefined
                      ? ` — ${quota.remaining} of ${quota.limit ?? "?"} calls left`
                      : ""
            }`}
            aria-label={
              needsKey
                ? "AI provider, API key needed"
                : providerError
                  ? "AI provider, the last request was refused"
                  : "AI provider, open the provider settings"
            }
            className="hidden shrink-0 rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none sm:block"
          >
            <Badge
              variant={needsKey || needsUrl || providerError || exhausted ? "warning" : "accent"}
              className="relative size-9 shrink-0 items-center justify-center p-0"
            >
              <ProviderIcon provider={settings.provider} />
              {(needsKey || needsUrl || providerError) && (
                <KeyRound
                  className="absolute -top-1 -right-1 size-3.5 rounded-full bg-zinc-950 text-amber-400"
                  aria-label={needsKey ? "API key needed" : "Base URL needed"}
                />
              )}
              {exhausted && (
                <AlertCircle
                  className="absolute -top-1 -right-1 size-3.5 rounded-full bg-zinc-950 text-rose-400"
                  aria-label="No calls left"
                />
              )}
              {quota?.remaining !== undefined && !exhausted && (
                <span className="absolute -bottom-1 -right-1 rounded-full bg-zinc-900 px-1 font-mono text-[9px] leading-4 text-emerald-300 ring-1 ring-zinc-700">
                  {compactNumber(quota.remaining)}
                </span>
              )}
            </Badge>
          </button>

          <Button
            variant="outline"
            size="icon"
            onClick={toggleMode}
            title={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}
            aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}
          >
            {mode === "dark" ? (
              <Sun className="text-amber-300" />
            ) : (
              <Moon className="text-indigo-300" />
            )}
          </Button>

          <Button onClick={onOpenSettings} className="px-3" aria-label="Open settings">
            <Settings />
          </Button>
        </div>
      </div>
    </header>
  );
}
