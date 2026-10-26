/**
 * The EdgeSpec agent workspace: Repository → Agent Activity → Gap Analysis →
 * Review Queue. Every number here comes from a scan or a run event.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileDiff,
  FileJson,
  FileSearch,
  Folder,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  History,
  Info,
  KeyRound,
  ListChecks,
  Loader2,
  Lock,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { folderFirst } from "@edge-spec/core/scanner";
import { providerById } from "@edge-spec/core/catalog";
import { parseRepoInput } from "@edge-spec/core/catalog";
import { pullRequestBody } from "@edge-spec/core/provenance";
import type {
  ApiTestResult,
  CoverageStatus,
  Gap,
  GapKind,
  OpenApiEndpoint,
  RateLimitInfo,
  RepositoryOverview,
  RetestOperation,
  ScanTotals,
  ScanTruncation,
  StepId,
} from "@edge-spec/core/types";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Input,
  ProviderIcon,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  TooltipProvider,
  cn,
} from "@edge-spec/ui";
import { fetchBranches, recordRunDecision, type PullMeta } from "@/api";
import { isLocalPathInput } from "@/lib/local-path";
import { setProject, type Project, type Settings as SettingsValue } from "@/lib/settings";
import { toggleMode, useAppearance } from "@/lib/theme";
import {
  CheckSummary,
  EndpointStatus,
  coverageDeltaLabel,
  coverageLabel,
  ICON_GRADIENT,
  provenanceFiles,
  skippedOperationsOf,
  IconGradientDefs,
  INITIAL_STEPS,
  MethodChip,
  TONES,
  type AgentTest,
  type LogEntry,
  type ReviewState,
  type ValidationFilter,
  type StepStatus,
  type Tone,
} from "./shared";
import {
  BacklogDialog,
  DiffDialog,
  EndpointDialog,
  FactsDialog,
  HistoryDialog,
  LogDialog,
  PrDialog,
  SourceDialog,
  SpecDialog,
  type PrDraft,
  type ReviewEntry,
} from "./dialogs";
import type { SettingsSection } from "./settings-sheet";

type Mode = "review" | "auto";

const MODES = [
  {
    id: "review",
    label: "Interactive Review",
    desc: "You approve each diff before the pull request.",
    outcome: "one decision per file",
    icon: ShieldCheck,
  },
  {
    id: "auto",
    label: "Fully Autonomous",
    desc: "Verified tests are accepted for you.",
    outcome: "one final PR review",
    icon: Zap,
  },
] as const;

const GAP_KINDS: Array<{ id: GapKind; label: string }> = [
  { id: "missing", label: "Missing tests" },
  { id: "coverage", label: "Coverage gaps" },
  { id: "api", label: "Contract gaps" },
  { id: "unsupported", label: "Unsupported" },
];

export interface AgentWorkspaceProps {
  project: Project;
  settings: SettingsValue;
  quota?: RateLimitInfo;
  providerError?: string;
  running: boolean;
  scanning: boolean;
  generating: boolean;
  generatingPaths: string[];
  steps: typeof INITIAL_STEPS;
  logs: LogEntry[];
  gapLogs: LogEntry[];
  gaps: Gap[];
  totals?: ScanTotals;
  truncated?: ScanTruncation;
  coverageStatus?: CoverageStatus;
  coverageReason?: string;
  overview?: RepositoryOverview;
  generated: AgentTest[];
  pullUrls: Record<string, string>;
  /** The history id of the current run, when the deployment stores history. */
  runId?: string;
  apiResults: ApiTestResult[];
  /** The last API result came from a retest, not a fresh run. */
  retest?: boolean;
  toast?: { title: string; description?: string; variant: "default" | "success" | "warning" };
  onRun: () => void;
  onScan: () => void;
  onRetest: (operations: RetestOperation[]) => void;
  onStop: () => void;
  onStopGenerating: () => void;
  onReset: () => void;
  onGenerate: (paths: string[]) => void;
  onOpenPull: (items: AgentTest[], meta: PullMeta) => Promise<string>;
  onOpenSettings: (section?: SettingsSection) => void;
  onDismissToast: () => void;
}

export function AgentWorkspace({
  project,
  settings,
  quota,
  providerError,
  running,
  scanning,
  generating,
  generatingPaths,
  steps,
  logs,
  gapLogs,
  gaps,
  totals,
  truncated,
  coverageStatus,
  coverageReason,
  overview,
  generated,
  pullUrls,
  runId,
  apiResults,
  retest,
  toast,
  onRun,
  onScan,
  onRetest,
  onStop,
  onStopGenerating,
  onReset,
  onGenerate,
  onOpenPull,
  onOpenSettings,
  onDismissToast,
}: AgentWorkspaceProps) {
  const appearance = useAppearance();
  const provider = providerById(settings.provider);
  const isLocalDev = import.meta.env.DEV;
  const projectInput =
    project.localPath || (project.folder ? `${project.repo}/${project.folder}` : project.repo);

  const [repoInput, setRepoInput] = useState(projectInput);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchError, setBranchError] = useState<string | undefined>(undefined);
  const [branchLoading, setBranchLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("review");
  const [gapKind, setGapKind] = useState<GapKind>("missing");
  const [gapQuery, setGapQuery] = useState("");
  const [apiQuery, setApiQuery] = useState("");
  const [apiMethods, setApiMethods] = useState<string[]>([]);
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewState, setReviewState] = useState<"all" | ReviewState>("all");
  const [reviewValidation, setReviewValidation] = useState<ValidationFilter>("all");
  const [selection, setSelection] = useState<string[]>([]);
  const [specPath, setSpecPath] = useState("");
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [diffPath, setDiffPath] = useState<string | undefined>(undefined);
  const [sourcePath, setSourcePath] = useState<string | undefined>(undefined);
  const [logOpen, setLogOpen] = useState(false);
  const [logStep, setLogStep] = useState<StepId | "all">("all");
  const [endpointKey, setEndpointKey] = useState<
    { specPath: string; method: string; path: string } | undefined
  >(undefined);
  const [specFocus, setSpecFocus] = useState<
    { specPath: string; method: string; path: string } | undefined
  >(undefined);
  const [specOpen, setSpecOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [prDraft, setPrDraft] = useState<PrDraft>({
    title: "",
    branch: "",
    commit: "",
    description: "",
    draft: true,
  });
  const [prBusy, setPrBusy] = useState(false);
  const [prError, setPrError] = useState<string | undefined>(undefined);
  const [openedUrl, setOpenedUrl] = useState<string | undefined>(undefined);
  const autoHandled = useRef(false);

  const parsedInput = parseRepoInput(repoInput);
  const inputLocal = isLocalPathInput(repoInput);
  const invalid = repoInput.trim().length > 0 && !(inputLocal ? isLocalDev : parsedInput);
  const localDraft = inputLocal && isLocalDev;
  const repoLabel = localDraft
    ? "local path"
    : parsedInput
      ? `${parsedInput.owner}/${parsedInput.name}`
      : repoInput.trim()
        ? "invalid"
        : "no repo";

  useEffect(() => setRepoInput(projectInput), [projectInput]);

  useEffect(() => {
    if (localDraft) setMode("review");
  }, [localDraft]);

  // Branches come from GitHub; a local folder has none.
  useEffect(() => {
    if (!project.repo) {
      setBranches([]);
      return;
    }
    let cancelled = false;
    setBranchLoading(true);
    setBranchError(undefined);
    fetchBranches(project.repo)
      .then((result) => {
        if (cancelled) return;
        setBranches(result.branches);
        if (!project.ref && result.defaultBranch) setProject({ ref: result.defaultBranch });
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
    // A branch change must not refetch the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.repo]);

  // Give every generated file a decision slot; drop files from a previous tree.
  useEffect(() => {
    setReviews((current) => {
      const paths = new Set(generated.map((item) => item.generation.sourcePath));
      let next = current;
      for (const path of paths) {
        if (!(path in next)) {
          if (next === current) next = { ...current };
          next[path] = "pending";
        }
      }
      for (const path of Object.keys(next)) {
        if (!paths.has(path)) {
          if (next === current) next = { ...current };
          delete next[path];
        }
      }
      return next;
    });
  }, [generated]);

  // Autonomous: accept verified tests, then show the pull request screen.
  useEffect(() => {
    if (running) autoHandled.current = false;
  }, [running]);
  useEffect(() => {
    if (running || mode !== "auto" || autoHandled.current) return;
    const verified = generated.filter((item) => item.validation.ok);
    if (verified.length === 0) return;
    autoHandled.current = true;
    setReviews((current) => {
      const next = { ...current };
      for (const item of generated) {
        next[item.generation.sourcePath] = item.validation.ok ? "accepted" : "rejected";
      }
      return next;
    });
    if (runId) {
      for (const item of generated) {
        void recordRunDecision(
          runId,
          item.generation.sourcePath,
          item.validation.ok ? "accepted" : "rejected",
        ).catch(() => undefined);
      }
    }
    openPullDialog(verified);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode, generated, runId]);

  const counts: ScanTotals = totals ?? {
    missing: gaps.filter((gap) => (gap.kind ?? "missing") === "missing").length,
    coverage: gaps.filter((gap) => gap.kind === "coverage").length,
    api: gaps.filter((gap) => gap.kind === "api").length,
    unsupported: gaps.filter((gap) => gap.kind === "unsupported").length,
    skipped: 0,
  };
  const orderedGaps = folderFirst(gaps, project.folder);
  const query = (value: string) => value.trim().toLowerCase();
  const filteredGaps = orderedGaps.filter(
    (gap) =>
      (gap.kind ?? "missing") === gapKind &&
      (!gapQuery.trim() || gap.path.toLowerCase().includes(query(gapQuery))),
  );
  const generationCapable = (gap: Gap) => gap.kind !== "api" && gap.kind !== "unsupported";
  const selectableGaps = filteredGaps.filter(generationCapable);
  const groups = filteredGaps.reduce<Record<string, Gap[]>>((all, gap) => {
    const dir = gap.path.split("/").slice(0, -1).join("/");
    (all[dir] ??= []).push(gap);
    return all;
  }, {});
  const allSelected =
    selectableGaps.length > 0 && selectableGaps.every((gap) => selection.includes(gap.path));

  const specs = overview?.openApiSpecs?.length
    ? overview.openApiSpecs
    : (() => {
        const one = overview?.openApiSpec ?? overview?.openApi ?? overview?.openapi;
        return one ? [one] : [];
      })();
  const currentSpec = specs.find((spec) => spec.path === specPath) ?? specs[0];
  const apiPassed = apiResults.filter((result) => result.status === "passed").length;
  const apiSkipped = apiResults.filter((result) => result.status === "skipped").length;
  const apiFailed = apiResults.filter((result) => result.status === "failed").length;
  const contractTests = generated.filter((item) =>
    specs.some((spec) => spec.path === item.generation.sourcePath),
  );
  const specEndpoints = currentSpec?.endpoints ?? [];
  const specMethods = [...new Set(specEndpoints.map((item) => item.method.toUpperCase()))].sort();
  const visibleEndpoints = specEndpoints.filter(
    (item) =>
      (apiMethods.length === 0 || apiMethods.includes(item.method.toUpperCase())) &&
      (!apiQuery.trim() || `${item.method} ${item.path}`.toLowerCase().includes(query(apiQuery))),
  );
  const endpointResult = (spec: string, endpoint: OpenApiEndpoint) =>
    apiResults.find(
      (result) =>
        result.specPath === spec &&
        result.method.toUpperCase() === endpoint.method.toUpperCase() &&
        result.path === endpoint.path,
    );
  const endpointHealth = (spec: string, endpoint: OpenApiEndpoint) =>
    overview?.apiHealth?.find(
      (row) =>
        row.specPath === spec &&
        row.method.toUpperCase() === endpoint.method.toUpperCase() &&
        row.path === endpoint.path,
    );

  const entries: ReviewEntry[] = generated.map((item) => ({
    item,
    state: reviews[item.generation.sourcePath] ?? "pending",
  }));
  const acceptedCount = entries.filter((entry) => entry.state === "accepted").length;
  const rejectedCount = entries.filter((entry) => entry.state === "rejected").length;
  const pendingCount = entries.filter((entry) => entry.state === "pending").length;
  const matchesValidation = (entry: ReviewEntry) => {
    const { validation } = entry.item;
    if (reviewValidation === "passed") return validation.ok && Boolean(validation.verified);
    if (reviewValidation === "failed") return !validation.ok;
    if (reviewValidation === "static") return validation.ok && !validation.verified;
    return true;
  };
  const visibleEntries = entries.filter(
    (entry) =>
      (reviewState === "all" || entry.state === reviewState) &&
      matchesValidation(entry) &&
      (!reviewQuery.trim() ||
        `${entry.item.generation.testPath} ${entry.item.generation.sourcePath}`
          .toLowerCase()
          .includes(query(reviewQuery))),
  );
  const diffEntry = entries.find((entry) => entry.item.generation.sourcePath === diffPath);
  const sourceEntry = entries.find((entry) => entry.item.generation.sourcePath === sourcePath);
  const endpoint =
    endpointKey && currentSpec
      ? currentSpec.endpoints.find(
          (item) =>
            item.method.toUpperCase() === endpointKey.method.toUpperCase() &&
            item.path === endpointKey.path,
        )
      : undefined;

  const allLogs = [...logs, ...gapLogs].sort((a, b) => a.time.localeCompare(b.time));
  const scanStatus = steps.scan.status;

  const checksTotal = generated.reduce(
    (count, item) => count + (item.validation.checks?.length ?? 0),
    0,
  );
  const validated = generated.filter((item) => item.validation.ok || item.validation.output).length;
  const hasSpec = specs.length > 0;

  const stages: Array<{
    id: string;
    label: string;
    sub: string;
    icon: typeof FolderGit2;
    tone: Tone;
    state: StepStatus;
    pct: number;
    step?: StepId;
    disabled?: boolean;
  }> = [
    {
      id: "clone",
      label: "Cloned Repo",
      sub: overview
        ? `${overview.totalFiles.toLocaleString()} files · ${overview.sourceFiles} source`
        : scanning
          ? "Cloning…"
          : "Waiting for a repository",
      icon: FolderGit2,
      tone: "clone",
      state: scanStatus,
      pct: scanStatus === "running" ? 55 : scanStatus === "done" ? 100 : 0,
      step: "scan",
    },
    {
      id: "analyze",
      label: "Analyzed Gaps",
      sub: gaps.length
        ? `${gaps.length} gaps · ${counts.missing} missing`
        : scanning
          ? "Reading the tree"
          : "Not scanned",
      icon: Search,
      tone: "analyze",
      state:
        scanStatus === "done"
          ? "done"
          : scanStatus === "running"
            ? "running"
            : scanStatus === "failed"
              ? "failed"
              : "idle",
      pct: scanStatus === "done" ? 100 : scanStatus === "running" ? 60 : 0,
    },
    {
      id: "test",
      label: "Testing OpenSpec",
      sub: !hasSpec
        ? "Not applicable · no OpenAPI spec"
        : project.localPath
          ? "Needs a GitHub run"
          : apiResults.length
            ? `${apiPassed}/${apiResults.length} endpoints · ${apiFailed} failed`
            : steps.validate.status === "running"
              ? "Executing contract tests"
              : "Waiting for a run",
      icon: Zap,
      tone: "test",
      state: !hasSpec
        ? "idle"
        : steps.validate.status === "running"
          ? "running"
          : apiResults.length
            ? "done"
            : "idle",
      pct: !hasSpec
        ? 0
        : apiResults.length
          ? (apiPassed / apiResults.length) * 100
          : steps.validate.status === "running"
            ? 40
            : 0,
      ...(hasSpec ? { step: "validate" as StepId } : {}),
      disabled: !hasSpec,
    },
    {
      id: "static",
      label: "Static checks",
      sub: checksTotal
        ? `${checksTotal} check${checksTotal === 1 ? "" : "s"}`
        : settings.sandboxUrl.trim()
          ? "Repo checks · runner"
          : "Static check only",
      icon: ShieldCheck,
      tone: "review",
      state:
        steps.validate.status === "running"
          ? "running"
          : checksTotal > 0 || steps.validate.status === "done"
            ? "done"
            : "idle",
      pct: generated.length
        ? (validated / generated.length) * 100
        : steps.validate.status === "running"
          ? 40
          : 0,
    },
    {
      id: "fix",
      label: "Fixing & Generating",
      sub: `${generated.length} test${generated.length === 1 ? "" : "s"} · max ${settings.maxFiles}`,
      icon: Wrench,
      tone: "fix",
      state:
        steps.generate.status === "running" || steps.correct.status === "running"
          ? "running"
          : steps.generate.status === "failed"
            ? "failed"
            : generated.length
              ? "done"
              : "idle",
      pct: Math.min(100, (generated.length / Math.max(1, settings.maxFiles)) * 100),
      step: "generate",
    },
  ];

  const projectMatches = Boolean(project.repo || project.localPath);
  const busy = running || scanning || generating;
  const startLabel = busy ? "Stop" : project.localPath ? "Scan" : "Start Scan";

  const commitProject = () => {
    const raw = repoInput.trim();
    if (!raw) return;
    if (isLocalPathInput(raw)) {
      if (!isLocalDev) return;
      if (project.localPath !== raw) setProject({ localPath: raw, repo: "", ref: "", folder: "" });
      return;
    }
    const parsed = parseRepoInput(raw);
    if (!parsed) return;
    setProject({
      repo: `${parsed.owner}/${parsed.name}`,
      ref: parsed.ref ?? project.ref,
      folder: parsed.folder ?? "",
      localPath: "",
    });
  };

  const start = () => {
    if (!repoInput.trim() || invalid) return;
    commitProject();
    window.setTimeout(() => {
      if (localDraft) onScan();
      else onRun();
    }, 0);
  };

  const stopOrReset = () => {
    if (running || scanning) onStop();
    else if (generating) onStopGenerating();
    else onReset();
  };

  const openLog = (step?: StepId) => {
    setLogStep(step ?? "all");
    setLogOpen(true);
  };

  const openSpec = (focus?: { specPath: string; method: string; path: string }) => {
    setSpecFocus(focus);
    setSpecOpen(true);
  };

  const openEndpoint = (spec: string, item: OpenApiEndpoint) => {
    setEndpointKey({ specPath: spec, method: item.method, path: item.path });
  };

  const buildDescription = (items: AgentTest[]) =>
    pullRequestBody({
      provider: provider?.name ?? settings.provider,
      model: settings.model,
      files: provenanceFiles(items),
      skipped: skippedOperationsOf(apiResults),
      testOnly: true,
    });

  function openPullDialog(items: AgentTest[]) {
    if (items.length === 0) return;
    const now = Date.now();
    setPrDraft({
      title: `test: cover ${items.length} untested path${items.length === 1 ? "" : "s"}`,
      branch: `edgespec/tests-${now}`,
      commit: `test: add ${items.length} generated test file${items.length === 1 ? "" : "s"}`,
      description: buildDescription(items),
      draft: true,
    });
    setPrError(undefined);
    setPrOpen(true);
  }

  const openReview = () => {
    const items = entries.filter((entry) => entry.state === "accepted").map((entry) => entry.item);
    openPullDialog(items);
  };

  const dispatch = async () => {
    if (prBusy) return;
    const items = entries.filter((entry) => entry.state === "accepted").map((entry) => entry.item);
    if (items.length === 0) return;
    setPrBusy(true);
    setPrError(undefined);
    try {
      const url = await onOpenPull(items, {
        title: prDraft.title.trim() || undefined,
        body: prDraft.description.trim() || undefined,
        branch: prDraft.branch.trim() || undefined,
        commitMessage: prDraft.commit.trim() || undefined,
        draft: prDraft.draft,
      });
      setOpenedUrl(url);
      setPrOpen(false);
    } catch (error) {
      setPrError(error instanceof Error ? error.message : String(error));
    } finally {
      setPrBusy(false);
    }
  };

  const setReview = (path: string, state: ReviewState) => {
    setReviews((current) => ({ ...current, [path]: state }));
    if (runId) void recordRunDecision(runId, path, state).catch(() => undefined);
  };

  const restoreRejected = () => {
    setReviews((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (next[key] !== "rejected") continue;
        next[key] = "pending";
        if (runId) void recordRunDecision(runId, key, "pending").catch(() => undefined);
      }
      return next;
    });
  };

  const acceptedUrl =
    openedUrl ??
    entries
      .filter((entry) => entry.state === "accepted")
      .map((entry) => pullUrls[entry.item.generation.sourcePath])
      .find(Boolean);

  const statusText = running
    ? "Run in flight · stages stream their own events"
    : scanning
      ? "Scanning the repository"
      : generating
        ? `Generating ${generatingPaths.length || ""} test(s)`.trim()
        : openedUrl
          ? "Pull request opened"
          : generated.length
            ? `${acceptedCount} accepted · ${rejectedCount} rejected · ${pendingCount} pending`
            : projectMatches
              ? `${project.repo || project.localPath} · ready`
              : "Point EdgeSpec at a repository";

  return (
    <TooltipProvider delayDuration={180}>
      <IconGradientDefs />
      <div className="no-scrollbar relative min-h-dvh overflow-x-hidden">
        <div className="app-backdrop" aria-hidden="true">
          <div className="app-aurora app-aurora-a" />
          <div className="app-aurora app-aurora-b" />
          <div className="app-aurora app-aurora-c" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl space-y-3 px-3 pt-3 pb-28 sm:px-6">
          <header className="app-reveal glass-panel sticky top-0 z-30 rounded-2xl px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2.5">
              <Hint label="Reset this workspace">
                <button
                  type="button"
                  onClick={onReset}
                  aria-label="Reset this workspace"
                  className="relative shrink-0 rounded-xl transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:outline-none"
                >
                  <img
                    src="/favicon.svg"
                    alt=""
                    width={32}
                    height={32}
                    className="brand-mark size-8"
                  />
                  {busy && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
                  )}
                </button>
              </Hint>
              <div className="min-w-0 leading-tight">
                <h1 className="truncate text-sm font-bold tracking-tight text-zinc-50">EdgeSpec</h1>
                <p className="hidden text-[10px] text-zinc-500 sm:block">
                  Agentic test coverage — scan, test, fix, ship.
                </p>
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <Hint label={`${provider?.name ?? settings.provider} · open provider settings`}>
                  <button
                    type="button"
                    onClick={() => onOpenSettings("provider")}
                    className="rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none"
                    aria-label="Open AI provider settings"
                  >
                    <Badge variant="accent" className="h-9 items-center gap-1 px-2.5">
                      <ProviderIcon provider={settings.provider} />
                      {quota?.remaining !== undefined ? compactNumber(quota.remaining) : "AI"}
                    </Badge>
                  </button>
                </Hint>
                <Hint label={`${settings.sandboxProvider} · open sandbox settings`}>
                  <button
                    type="button"
                    onClick={() => onOpenSettings("sandbox")}
                    className="hidden rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none sm:block"
                    aria-label="Open sandbox settings"
                  >
                    <Badge variant="neutral" className="size-9 items-center justify-center p-0">
                      <Boxes className="size-4 text-violet-400" />
                    </Badge>
                  </button>
                </Hint>
                {project.repo && !project.localPath && (
                  <Hint label="Test-debt backlog">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setBacklogOpen(true)}
                      aria-label="Test-debt backlog"
                    >
                      <ListChecks className="text-emerald-300" />
                    </Button>
                  </Hint>
                )}
                {project.repo && !project.localPath && (
                  <Hint label="Run history">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setHistoryOpen(true)}
                      aria-label="Run history"
                    >
                      <History className="text-sky-300" />
                    </Button>
                  </Hint>
                )}
                <Hint label="Settings">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => onOpenSettings()}
                    aria-label="Open settings"
                  >
                    <Settings className="text-indigo-300" />
                  </Button>
                </Hint>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="User profile"
                      className="rounded-full transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:outline-none"
                    >
                      <Avatar>
                        <AvatarFallback>ES</AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel>
                      {project.repo || project.localPath || "no project"}
                      {project.ref ? ` · ${project.ref}` : ""}
                    </DropdownMenuLabel>
                    <DropdownMenuItem onSelect={toggleMode}>
                      {appearance.mode === "dark" ? <Sun /> : <Moon />}
                      {appearance.mode === "dark" ? "Light" : "Dark"} mode
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onOpenSettings("provider")}>
                      <KeyRound />
                      Provider & keys
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onReset}>
                      <RefreshCw />
                      Reset workspace
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {providerError && (
            <Alert variant="warning">
              <AlertCircle />
              <div>
                <AlertTitle>The provider refused the request</AlertTitle>
                <AlertDescription>{providerError}</AlertDescription>
              </div>
            </Alert>
          )}

          {/* Step 1 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "60ms" }}>
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="01"
                title="Repository"
                icon={FolderGit2}
                tone="clone"
                iconClass="text-zinc-400"
                hint="pick a repo, a branch and how much control you keep"
                aside={
                  <Badge
                    variant={invalid ? "danger" : localDraft ? "accent" : "neutral"}
                    className="max-w-52 truncate font-mono"
                  >
                    {repoLabel}
                  </Badge>
                }
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <GitBranch className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={repoInput}
                    onChange={(event) => setRepoInput(event.target.value)}
                    onBlur={commitProject}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                        window.setTimeout(start, 0);
                      }
                    }}
                    aria-label="Repository URL or local path"
                    spellCheck={false}
                    disabled={busy}
                    aria-invalid={invalid}
                    placeholder={isLocalDev ? "owner/repo or ./local/path" : "owner/repo"}
                    className={cn(
                      "pl-8 font-mono",
                      invalid && "border-rose-500/60 focus:border-rose-500/60",
                    )}
                  />
                </div>
                {localDraft ? (
                  <Badge
                    variant="accent"
                    className="h-9 w-full items-center justify-center gap-1.5 px-3 sm:w-44"
                  >
                    <GitBranch className="size-3.5" />
                    local folder
                  </Badge>
                ) : (
                  <Select
                    value={project.ref || undefined}
                    onValueChange={(ref) => setProject({ ref })}
                    disabled={busy || branchLoading || branches.length === 0}
                  >
                    <SelectTrigger
                      aria-label="Branch"
                      title={branchError}
                      className="w-full font-mono sm:w-44"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <GitBranch className="size-3.5 shrink-0 text-zinc-500" />
                        <SelectValue placeholder={branchLoading ? "loading…" : "branch"} />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {branches.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          No branches found
                        </SelectItem>
                      ) : (
                        branches.map((branch) => (
                          <SelectItem key={branch} value={branch}>
                            {branch}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  onClick={busy ? stopOrReset : start}
                  disabled={!busy && (!repoInput.trim() || invalid)}
                  className={cn(
                    "sm:w-36",
                    busy && "from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500",
                  )}
                >
                  {busy ? (
                    <>
                      <Square className="size-3.5 fill-current" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5 fill-current" />
                      {startLabel}
                    </>
                  )}
                </Button>
              </div>

              {invalid ? (
                <p className="text-[10px] text-rose-300">
                  {isLocalDev
                    ? "Enter owner/repo, a GitHub URL, or a local folder path."
                    : "Enter owner/repo or a GitHub URL."}
                </p>
              ) : localDraft ? (
                <p className="text-[10px] text-zinc-500">
                  Local folder · the scan reads the filesystem. Pull requests need a GitHub
                  repository.
                </p>
              ) : null}

              <div className="space-y-2 pt-0.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                    Review mode
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    how much the agent decides for you
                  </span>
                </div>
                <RadioGroup
                  value={mode}
                  onValueChange={(value) => setMode(value as Mode)}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {MODES.map((option) => {
                    const Icon = option.icon;
                    const active = mode === option.id;
                    const needsGitHub = option.id === "auto" && localDraft;
                    const tile =
                      option.id === "review"
                        ? active
                          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-800 bg-zinc-950/50 text-emerald-400/60"
                        : active
                          ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
                          : "border-zinc-800 bg-zinc-950/50 text-amber-400/60";
                    return (
                      <div
                        key={option.id}
                        onClick={() => {
                          if (!needsGitHub) setMode(option.id);
                        }}
                        className={cn(
                          "relative flex items-start gap-2.5 rounded-xl border p-2.5 transition",
                          needsGitHub
                            ? "cursor-not-allowed border-zinc-800 bg-zinc-900/20 opacity-55"
                            : active
                              ? "cursor-pointer border-indigo-500/50 bg-indigo-500/[0.08] shadow-lg shadow-indigo-950/20"
                              : "cursor-pointer border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/60",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                            needsGitHub ? "border-zinc-800 bg-zinc-950/50 text-zinc-600" : tile,
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-zinc-100">
                              {option.label}
                            </span>
                            {active && (
                              <Badge variant="accent" className="px-1.5 py-0 text-[9px]">
                                selected
                              </Badge>
                            )}
                            {needsGitHub && (
                              <Badge variant="warning" className="gap-0.5 px-1.5 py-0 text-[9px]">
                                <Lock className="size-2.5" />
                                needs GitHub
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                            {needsGitHub
                              ? "Local folders cannot open a pull request."
                              : option.desc}
                          </p>
                          <p
                            className={cn(
                              "mt-1 font-mono text-[9px]",
                              active ? "text-indigo-300" : "text-zinc-600",
                            )}
                          >
                            {needsGitHub ? "switch to a GitHub repository" : option.outcome}
                          </p>
                        </div>
                        <RadioGroupItem
                          value={option.id}
                          disabled={needsGitHub}
                          className="mt-1.5"
                        />
                      </div>
                    );
                  })}
                </RadioGroup>
                <div className="flex items-start gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] px-2.5 py-1.5 text-[10px] leading-relaxed text-zinc-400">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                  {mode === "review"
                    ? "You decide file by file. Nothing reaches the pull request until you accept it."
                    : "The agent accepts verified tests; you still review the pull request once before it opens."}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 2 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "120ms" }}>
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="02"
                title="Agent Activity"
                icon={Activity}
                tone="analyze"
                hint="stages stream their own events · click one to inspect"
                aside={
                  <>
                    {busy && (
                      <Badge variant="accent" className="gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        live
                      </Badge>
                    )}
                    <Button variant="ghost" size="xs" onClick={() => setFactsOpen(true)}>
                      <FileJson className="size-3" stroke={ICON_GRADIENT} />
                      Facts
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => openLog()}>
                      <Terminal className="size-3 text-amber-400" />
                      Event log
                    </Button>
                  </>
                }
              />
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                {stages.map((stage, index) => (
                  <Fragment key={stage.id}>
                    {index > 0 && (
                      <ChevronRight className="hidden size-3.5 shrink-0 text-zinc-600 lg:block" />
                    )}
                    <StageNode
                      {...stage}
                      position={index + 1}
                      onOpen={stage.step ? () => openLog(stage.step as StepId) : undefined}
                      disabled={stage.disabled || scanStatus === "idle"}
                    />
                  </Fragment>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                <span>
                  {gaps.length} gaps · {counts.missing} missing · {counts.coverage} coverage ·{" "}
                  {counts.api} contract
                </span>
                {apiResults.length > 0 && (
                  <span className="ml-auto font-mono">
                    {apiPassed}/{apiResults.length} endpoints · {apiFailed} failed · {apiSkipped}{" "}
                    skipped
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Step 3 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "180ms" }}>
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="03"
                title="Gap Analysis"
                icon={ShieldCheck}
                tone="test"
                hint="missing tests and coverage gaps are counted apart"
                aside={
                  <>
                    <Badge variant="warning">{counts.missing} missing</Badge>
                    <Badge variant="accent">{counts.coverage} coverage</Badge>
                    <Badge variant={counts.api ? "warning" : "neutral"}>
                      {counts.api} contract
                    </Badge>
                    {counts.unsupported > 0 && (
                      <Badge variant="neutral">{counts.unsupported} unsupported</Badge>
                    )}
                    {counts.skipped > 0 && (
                      <Badge variant="neutral">{counts.skipped} skipped</Badge>
                    )}
                  </>
                }
              />

              <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
                    <span className="text-[10px] font-semibold text-zinc-400">
                      Gap tree <span className="text-zinc-600">({filteredGaps.length})</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="neutral">{selection.length} selected</Badge>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setSelection(
                            allSelected
                              ? selection.filter(
                                  (path) => !filteredGaps.some((gap) => gap.path === path),
                                )
                              : [
                                  ...new Set([
                                    ...selection,
                                    ...filteredGaps.map((gap) => gap.path),
                                  ]),
                                ],
                          )
                        }
                      >
                        {allSelected ? "Clear" : "All"}
                      </Button>
                      <Button
                        size="xs"
                        onClick={() => onGenerate(selection)}
                        disabled={selection.length === 0 || generating || !projectMatches}
                      >
                        {generating ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                        Generate {selection.length}
                      </Button>
                    </div>
                  </div>

                  <Tabs
                    value={gapKind}
                    onValueChange={(value) => setGapKind(value as GapKind)}
                    className="space-y-0"
                  >
                    <TabsList className="w-full justify-start gap-1 overflow-x-auto border-b border-zinc-800/60 px-2 py-1.5">
                      {GAP_KINDS.filter(
                        (kind) => kind.id !== "unsupported" || counts.unsupported > 0,
                      ).map((kind) => (
                        <TabsTrigger key={kind.id} value={kind.id} className="h-7 px-2 text-[10px]">
                          {kind.label} · {counts[kind.id]}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>

                  <div className="border-b border-zinc-800/60 px-2 py-1.5">
                    <SearchField
                      value={gapQuery}
                      onChange={setGapQuery}
                      placeholder="Search gap paths…"
                      label="Search gaps"
                    />
                  </div>

                  <ScrollArea className="h-[386px]">
                    <div className="p-1.5">
                      {filteredGaps.length === 0 ? (
                        <p className="px-2 py-6 text-center text-[11px] text-zinc-500">
                          {projectMatches
                            ? gapQuery.trim()
                              ? "No gaps match this search."
                              : "No gaps in this category."
                            : "Scan a repository to list gaps."}
                        </p>
                      ) : (
                        Object.entries(groups).map(([dir, files], groupIndex) => (
                          <Collapsible key={dir} defaultOpen={groupIndex < 3}>
                            <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-zinc-500 transition hover:text-zinc-300">
                              <ChevronRight className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                              <Folder className="size-3.5 shrink-0 text-amber-400/80" />
                              <span className="truncate font-mono">{dir}</span>
                              <span className="ml-auto shrink-0 font-mono text-zinc-600">
                                {files.length}
                              </span>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              {files.map((gap) => {
                                const capable = generationCapable(gap);
                                const checked = selection.includes(gap.path);
                                const toggle = () => {
                                  if (!capable) return;
                                  setSelection((current) =>
                                    checked
                                      ? current.filter((path) => path !== gap.path)
                                      : [...new Set([...current, gap.path])],
                                  );
                                };
                                return (
                                  <Hint key={gap.path} label={gap.path}>
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={toggle}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          toggle();
                                        }
                                      }}
                                      className="flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-6 text-left transition hover:bg-zinc-800/40"
                                    >
                                      <Checkbox
                                        checked={checked}
                                        disabled={!capable}
                                        onClick={(event) => event.stopPropagation()}
                                        onCheckedChange={toggle}
                                        aria-label={
                                          capable
                                            ? `Select ${gap.path}`
                                            : "Contract tests come from the run"
                                        }
                                      />
                                      <FileCode2
                                        className={cn(
                                          "size-3.5 shrink-0",
                                          gap.kind === "api"
                                            ? "text-amber-400"
                                            : gap.kind === "coverage"
                                              ? "text-sky-400"
                                              : gap.kind === "unsupported"
                                                ? "text-zinc-600"
                                                : "text-zinc-500",
                                        )}
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate font-mono text-[11px] text-zinc-300">
                                          {gap.path.split("/").pop()}
                                        </span>
                                        <span className="block truncate text-[10px] text-zinc-600">
                                          {gap.reason}
                                        </span>
                                      </span>
                                      {generated.some(
                                        (item) => item.generation.sourcePath === gap.path,
                                      ) && (
                                        <Hint label="Test generated">
                                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
                                        </Hint>
                                      )}
                                      <Badge
                                        variant={
                                          gap.risk === "high"
                                            ? "danger"
                                            : gap.risk === "medium"
                                              ? "warning"
                                              : "neutral"
                                        }
                                      >
                                        {gap.risk === "high"
                                          ? "H"
                                          : gap.risk === "medium"
                                            ? "M"
                                            : "L"}
                                      </Badge>
                                    </div>
                                  </Hint>
                                );
                              })}
                            </CollapsibleContent>
                          </Collapsible>
                        ))
                      )}
                      {(gapKind === "api" || gapKind === "unsupported") && (
                        <p className="mt-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5 text-[9px] leading-relaxed text-zinc-500">
                          {gapKind === "api"
                            ? "Contract tests are generated by a run, not by the unit-test generator. Use the endpoint matrix to inspect them."
                            : "EdgeSpec cannot generate tests for this language yet; the gap stays visible."}
                        </p>
                      )}
                      {gapKind === "coverage" && (
                        <p className="mt-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5 text-[9px] leading-relaxed text-zinc-500">
                          Coverage · {coverageLabel(coverageStatus)}
                          {coverageReason ? ` · ${coverageReason}` : ""}. A percentage is shown only
                          when a runner measured it.
                        </p>
                      )}
                      {truncated?.[gapKind as keyof ScanTruncation] && (
                        <p className="mt-2 text-[9px] text-amber-400/80">
                          The list is truncated; scan again or widen the language filter.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400">
                      <Zap className="size-3.5 text-amber-400" />
                      OpenAPI health matrix
                      {specs.length > 1 ? (
                        <Select
                          value={currentSpec?.path}
                          onValueChange={(value) => setSpecPath(value)}
                        >
                          <SelectTrigger
                            className="h-6 w-40 font-mono text-[9px]"
                            aria-label="Spec"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {specs.map((spec) => (
                              <SelectItem key={spec.path} value={spec.path}>
                                {spec.path}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="neutral" className="font-mono">
                          {currentSpec?.path ?? "No spec"}
                        </Badge>
                      )}
                      {currentSpec?.inferred && (
                        <Badge
                          variant="warning"
                          className="px-1.5 py-0 text-[9px]"
                          title="Inferred from source because no OpenAPI document was found"
                        >
                          inferred
                        </Badge>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      {apiResults.length ? (
                        <>
                          <CheckCircle2 className="size-3 text-emerald-400" />
                          {apiPassed} passed
                        </>
                      ) : steps.validate.status === "running" ? (
                        <>
                          <Loader2 className="size-3 animate-spin text-amber-400" />
                          Live
                        </>
                      ) : (
                        "Not run"
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => openSpec()}
                        disabled={!currentSpec}
                      >
                        <FileJson className="size-3" />
                        Spec
                      </Button>
                    </div>
                  </div>
                  {currentSpec && (
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800/60 px-2 py-1.5">
                      <SearchField
                        value={apiQuery}
                        onChange={setApiQuery}
                        placeholder="Search endpoints…"
                        label="Search endpoints"
                        className="min-w-0 flex-1"
                      />
                      {specMethods.map((method) => {
                        const active = apiMethods.includes(method);
                        return (
                          <button
                            key={method}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setApiMethods((current) =>
                                current.includes(method)
                                  ? current.filter((item) => item !== method)
                                  : [...current, method],
                              )
                            }
                            className={cn(
                              "rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold transition",
                              active
                                ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                                : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                            )}
                          >
                            {method}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <ScrollArea className="h-[430px]">
                    {currentSpec ? (
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-3">Endpoint</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden pr-3 text-right sm:table-cell">
                              Time
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleEndpoints.map((item, index) => {
                            const result = endpointResult(currentSpec.path, item);
                            return (
                              <TableRow
                                key={`${item.method}-${item.path}`}
                                className={cn(
                                  "matrix-row cursor-pointer",
                                  result?.status === "failed" && "bg-rose-500/[0.04]",
                                )}
                                style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                                onClick={() => openEndpoint(currentSpec.path, item)}
                              >
                                <TableCell className="pl-3">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <MethodChip method={item.method} />
                                    <span className="truncate font-mono text-[11px] text-zinc-300">
                                      {item.path}
                                    </span>
                                    <ChevronRight className="size-3 shrink-0 text-zinc-700" />
                                  </span>
                                </TableCell>
                                <TableCell>
                                  {steps.validate.status === "running" && !result ? (
                                    <Skeleton className="h-4 w-20" />
                                  ) : (
                                    <EndpointStatus
                                      result={result}
                                      health={endpointHealth(currentSpec.path, item)}
                                    />
                                  )}
                                </TableCell>
                                <TableCell className="hidden pr-3 text-right font-mono text-[10px] text-zinc-500 sm:table-cell">
                                  {result?.durationMs !== undefined
                                    ? `${result.durationMs}ms`
                                    : "—"}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {visibleEndpoints.length === 0 && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell
                                colSpan={3}
                                className="py-8 text-center text-[11px] text-zinc-500"
                              >
                                No endpoints match this search or method filter.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="px-3 py-10 text-center text-[11px] text-zinc-500">
                        {projectMatches
                          ? "No OpenAPI document was found in this scan."
                          : "Scan a repository with an OpenAPI document."}
                      </p>
                    )}
                  </ScrollArea>
                  <div className="flex items-center gap-1.5 border-t border-zinc-800/60 px-3 py-1.5 text-[10px] text-zinc-500">
                    <Server className="size-3 text-sky-400" />
                    {apiResults.length
                      ? retest
                        ? "contract retest executed"
                        : "contract suite executed"
                      : settings.sandboxUrl.trim()
                        ? "Runner configured · contract suite not run yet"
                        : "No runner · static checks only"}
                    {apiFailed > 0 && (
                      <Button
                        variant="outline"
                        size="xs"
                        className="ml-auto"
                        disabled={running}
                        onClick={() =>
                          onRetest(
                            apiResults
                              .filter((result) => result.status === "failed")
                              .map((result) => ({
                                specPath: result.specPath,
                                method: result.method,
                                path: result.path,
                              })),
                          )
                        }
                      >
                        <RefreshCw className="size-3" />
                        Retest {apiFailed} failed
                      </Button>
                    )}
                    <span className={cn("font-mono", apiFailed === 0 && "ml-auto")}>
                      {apiPassed}/{apiResults.length || 0} · {apiFailed} failed · {apiSkipped}{" "}
                      skipped
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 4 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "240ms" }}>
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="04"
                title="Review Queue"
                icon={FileDiff}
                tone="review"
                iconClass="text-stage-analyze"
                hint="accept or reject each file; preview the diff or the source"
                aside={
                  <>
                    <Badge variant="success">{acceptedCount} accepted</Badge>
                    <Badge variant={rejectedCount ? "warning" : "neutral"}>
                      {rejectedCount} rejected
                    </Badge>
                    <Badge variant={pendingCount ? "warning" : "neutral"}>
                      {pendingCount} pending
                    </Badge>
                  </>
                }
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setReviews((current) => {
                      const next = { ...current };
                      for (const entry of entries) {
                        if (entry.item.validation.ok)
                          next[entry.item.generation.sourcePath] = "accepted";
                      }
                      return next;
                    })
                  }
                  disabled={!generated.some((item) => item.validation.ok)}
                >
                  <Check className="size-3.5 text-emerald-400" />
                  Accept all passed
                </Button>
                {specs.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => openSpec()}>
                    <FileJson className="size-3.5" />
                    Spec & contract
                  </Button>
                )}
                <SearchField
                  value={reviewQuery}
                  onChange={setReviewQuery}
                  placeholder="Search tests…"
                  label="Search review queue"
                  className="w-44"
                />
                <Select
                  value={reviewState}
                  onValueChange={(value) => setReviewState(value as "all" | ReviewState)}
                >
                  <SelectTrigger className="h-8 w-32 text-[11px]" aria-label="Filter by status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending review</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={reviewValidation}
                  onValueChange={(value) => setReviewValidation(value as ValidationFilter)}
                >
                  <SelectTrigger className="h-8 w-36 text-[11px]" aria-label="Filter by validation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All validation</SelectItem>
                    <SelectItem value="passed">Validation passed</SelectItem>
                    <SelectItem value="failed">Validation failed</SelectItem>
                    <SelectItem value="static">Static check only</SelectItem>
                  </SelectContent>
                </Select>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
                  <Sparkles className="size-3 text-violet-400" />
                  {provider?.name ?? settings.provider} · {settings.model}
                </span>
              </div>

              {entries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-8 text-center text-[11px] text-zinc-500">
                  {running
                    ? "Tests appear here as the agent writes them."
                    : "Start a run, or generate tests from Gap Analysis."}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {visibleEntries.length === 0 && (
                    <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 py-6 text-center text-[11px] text-zinc-500">
                      No tests match this search or status filter.
                    </p>
                  )}
                  {visibleEntries.map((entry) => {
                    const item = entry.item;
                    const path = item.generation.sourcePath;
                    const accepted = entry.state === "accepted";
                    const rejected = entry.state === "rejected";
                    return (
                      <div
                        key={path}
                        className={cn(
                          "flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-2 transition",
                          generatingPaths.includes(path) && "row-flash",
                        )}
                      >
                        <FileCode2
                          className={cn(
                            "size-3.5 shrink-0",
                            accepted
                              ? "text-emerald-400"
                              : rejected
                                ? "text-rose-400"
                                : "text-zinc-500",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] text-zinc-200">
                            {item.generation.testPath}
                          </span>
                          <span className="block truncate text-[10px] text-zinc-500">
                            {path} · {item.generation.model}
                            {item.generation.corrected ? " · corrected" : ""}
                          </span>
                        </span>
                        <span className="hidden sm:block">
                          <CheckSummary validation={item.validation} />
                        </span>
                        {item.validation.flaky && (
                          <Badge variant="warning">flaky · quarantined</Badge>
                        )}
                        {item.validation.mutation?.status === "measured" && (
                          <Badge variant="neutral">
                            mutation {item.validation.mutation.score}%
                          </Badge>
                        )}
                        {item.validation.coverage && (
                          <Badge variant="neutral">
                            {coverageDeltaLabel(item.validation.coverage)}
                          </Badge>
                        )}
                        <Hint label="Preview diff">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setDiffPath(path)}
                            aria-label="Preview diff"
                          >
                            <FileDiff className="size-3.5 text-zinc-400" />
                          </Button>
                        </Hint>
                        <Hint label="Generate test">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => onGenerate([path])}
                            disabled={generating || !projectMatches}
                            aria-label="Generate test"
                          >
                            <RefreshCw
                              className={cn(
                                "size-3.5 text-sky-400",
                                generatingPaths.includes(path) && "animate-spin",
                              )}
                            />
                          </Button>
                        </Hint>
                        <Hint label="Metadata and source">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setSourcePath(path)}
                            aria-label="Metadata and source"
                          >
                            <FileSearch className="size-3.5" stroke={ICON_GRADIENT} />
                          </Button>
                        </Hint>
                        <Hint
                          label={
                            item.validation.ok
                              ? accepted
                                ? "Withdraw acceptance"
                                : "Accept this test"
                              : "A failing test cannot be accepted"
                          }
                        >
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setReview(path, accepted ? "pending" : "accepted")}
                            disabled={!item.validation.ok}
                            aria-label={accepted ? "Withdraw acceptance" : "Accept this test"}
                          >
                            <Check className="size-3.5 text-emerald-400" />
                          </Button>
                        </Hint>
                        <Hint label={rejected ? "Restore this test" : "Reject this test"}>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setReview(path, rejected ? "pending" : "rejected")}
                            aria-label={rejected ? "Restore this test" : "Reject this test"}
                          >
                            <X className="size-3.5 text-rose-400" />
                          </Button>
                        </Hint>
                      </div>
                    );
                  })}
                </div>
              )}

              {rejectedCount > 0 && (
                <div className="overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/[0.035]">
                  <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/15 px-3 py-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                      <TriangleAlert className="size-3.5 text-amber-300/80" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-amber-200/90">
                        Rejected · kept out of the pull request
                      </p>
                      <p className="text-[10px] text-amber-300/50">
                        {rejectedCount} file(s) stay in this session. Restore any before creating
                        the pull request.
                      </p>
                    </div>
                    <Badge variant="warning">{rejectedCount}</Badge>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-amber-200/80 hover:bg-amber-500/[0.08]"
                      onClick={restoreRejected}
                    >
                      <RotateCcw className="size-3.5" />
                      Restore all
                    </Button>
                  </div>
                  <div className="space-y-1 p-2">
                    {entries
                      .filter((entry) => entry.state === "rejected")
                      .map((entry) => (
                        <div
                          key={entry.item.generation.sourcePath}
                          className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/40 px-2.5 py-1.5"
                        >
                          <FileCode2 className="size-3.5 shrink-0 text-rose-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[10px] text-zinc-200">
                              {entry.item.generation.testPath}
                            </span>
                            <span className="block truncate text-[10px] text-zinc-500">
                              {entry.item.generation.sourcePath}
                            </span>
                          </span>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-emerald-300 hover:bg-emerald-500/10"
                            onClick={() => setReview(entry.item.generation.sourcePath, "pending")}
                          >
                            <RotateCcw className="size-3.5" />
                            Restore
                          </Button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {acceptedUrl && (
                <Alert variant="success">
                  <GitPullRequest />
                  <div>
                    <AlertTitle>Pull request opened</AlertTitle>
                    <AlertDescription>
                      <a
                        href={acceptedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-300 underline-offset-2 hover:underline"
                      >
                        {acceptedUrl}
                        <ExternalLink className="size-3" />
                      </a>
                    </AlertDescription>
                  </div>
                </Alert>
              )}

              {running && (
                <Alert variant="info">
                  <Loader2 className="animate-spin" />
                  <div>
                    <AlertTitle>The agent is still writing and testing</AlertTitle>
                    <AlertDescription>
                      Review actions become available as each file gets a validation result.
                    </AlertDescription>
                  </div>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6">
          <div className="glass-panel relative mx-auto flex max-w-7xl flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-400">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  busy
                    ? "animate-pulse bg-amber-400"
                    : acceptedUrl || generated.length
                      ? "bg-emerald-400"
                      : "bg-zinc-600",
                )}
              />
              <span className="truncate">{statusText}</span>
              {generated.length > 0 && !acceptedUrl && (
                <Badge variant="success" className="ml-1 hidden sm:inline-flex">
                  {acceptedCount}/{generated.length} included
                </Badge>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {busy ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Stop this run?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The stream closes and the generated tests stay in this session. No pull
                        request is opened.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep running</AlertDialogCancel>
                      <AlertDialogAction variant="danger" onClick={stopOrReset}>
                        Stop run
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onReset}
                  disabled={!projectMatches && !generated.length}
                >
                  <X className="size-3.5" />
                  Cancel
                </Button>
              )}
              {acceptedUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(acceptedUrl, "_blank")}
                >
                  <GitPullRequest className="size-3.5" />
                  Pull request opened
                  <ExternalLink className="size-3" />
                </Button>
              ) : (
                <Button
                  onClick={openReview}
                  disabled={running || generating || acceptedCount === 0 || pendingCount > 0}
                  title={
                    project.localPath
                      ? "Pull requests need a GitHub repository"
                      : acceptedCount === 0
                        ? "Accept at least one verified test"
                        : pendingCount > 0
                          ? "Decide on the pending files first"
                          : "Review the pull request"
                  }
                >
                  <GitPullRequest />
                  Review pull request
                  <ArrowUpRight className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {toast && (
          <div className="fixed right-4 bottom-24 z-50 max-w-sm">
            <div
              className={cn(
                "toast-in glass-panel rounded-xl border px-3.5 py-2.5 text-xs shadow-xl",
                toast.variant === "success" && "border-emerald-500/30",
                toast.variant === "warning" && "border-amber-500/30",
                toast.variant === "default" && "border-zinc-700",
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-zinc-100">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                      {toast.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onDismissToast}
                  aria-label="Dismiss"
                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        <LogDialog
          open={logOpen}
          onClose={() => setLogOpen(false)}
          logs={allLogs}
          step={logStep}
          onStep={setLogStep}
        />
        <SourceDialog
          open={Boolean(sourceEntry)}
          entry={sourceEntry}
          onClose={() => setSourcePath(undefined)}
          onState={(state) => {
            if (sourceEntry) setReview(sourceEntry.item.generation.sourcePath, state);
          }}
          onGenerate={() => {
            if (sourceEntry) onGenerate([sourceEntry.item.generation.sourcePath]);
          }}
          regenerating={Boolean(
            sourceEntry && generatingPaths.includes(sourceEntry.item.generation.sourcePath),
          )}
          onViewDiff={() => {
            if (!sourceEntry) return;
            const path = sourceEntry.item.generation.sourcePath;
            setSourcePath(undefined);
            setDiffPath(path);
          }}
        />
        <DiffDialog
          open={Boolean(diffEntry)}
          entry={diffEntry}
          onClose={() => setDiffPath(undefined)}
        />
        <EndpointDialog
          open={Boolean(endpoint)}
          onClose={() => setEndpointKey(undefined)}
          spec={currentSpec}
          endpoint={endpoint}
          result={endpoint && currentSpec ? endpointResult(currentSpec.path, endpoint) : undefined}
          contractTest={
            currentSpec
              ? contractTests.find((item) => item.generation.sourcePath === currentSpec.path)
              : undefined
          }
          onOpenSpec={() => {
            if (endpointKey) openSpec(endpointKey);
          }}
          onOpenContract={() => {
            if (!currentSpec) return;
            const contract = contractTests.find(
              (item) => item.generation.sourcePath === currentSpec.path,
            );
            if (!contract) return;
            setEndpointKey(undefined);
            setSourcePath(contract.generation.sourcePath);
          }}
        />
        <SpecDialog
          open={specOpen}
          onClose={() => setSpecOpen(false)}
          specs={specs}
          focus={specFocus}
          contractTests={contractTests}
          onOpenContract={(sourcePath) => {
            setSpecOpen(false);
            setSourcePath(sourcePath);
          }}
        />
        <FactsDialog
          open={factsOpen}
          onClose={() => setFactsOpen(false)}
          overview={overview}
          specs={specs}
          coverageStatus={coverageStatus}
          coverageReason={coverageReason}
        />
        <HistoryDialog
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          repo={project.repo}
        />
        <BacklogDialog
          open={backlogOpen}
          onClose={() => setBacklogOpen(false)}
          repo={project.repo}
        />
        <PrDialog
          open={prOpen}
          onClose={() => setPrOpen(false)}
          entries={entries}
          skipped={apiResults.filter((result) => result.status === "skipped")}
          settings={settings}
          project={project}
          value={prDraft}
          onChange={setPrDraft}
          onDispatch={dispatch}
          busy={prBusy}
          error={prError}
        />
      </div>
    </TooltipProvider>
  );
}

function compactNumber(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-zinc-500" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-7 pl-7 text-[10px]"
      />
    </div>
  );
}

function StageNode({
  label,
  sub,
  icon: Icon,
  tone,
  state,
  pct,
  position,
  onOpen,
  disabled,
}: {
  position: number;
  label: string;
  sub: string;
  icon: typeof FolderGit2;
  tone: Tone;
  state: StepStatus;
  pct: number;
  onOpen?: () => void;
  disabled?: boolean;
}) {
  const palette = TONES[tone];
  const running = state === "running";
  const done = state === "done";
  const interactive = Boolean(onOpen) && !disabled;
  const card = (
    <button
      type="button"
      onClick={onOpen}
      disabled={!interactive}
      style={
        {
          "--stage-progress": `${Math.max(0, Math.min(100, pct))}%`,
          "--stage-tone": `var(--stage-${tone})`,
        } as React.CSSProperties
      }
      className={cn(
        "pipeline-node group relative min-w-0 flex-1 rounded-xl border border-transparent px-2.5 py-2.5 text-left transition-all",
        interactive ? "hover:-translate-y-0.5" : "cursor-default",
        disabled && "opacity-60",
        done
          ? "bg-zinc-900/70"
          : running
            ? cn("bg-zinc-900/40 shadow-lg", palette.glow)
            : "bg-zinc-900/40",
      )}
    >
      <span className="stage-ring" aria-hidden="true" />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "relative flex size-7 shrink-0 items-center justify-center rounded-lg border bg-zinc-950/40",
            done
              ? "border-emerald-500/40 text-emerald-400"
              : running
                ? cn(palette.border, palette.text, "stage-ping")
                : "border-zinc-800 text-zinc-500",
          )}
        >
          {done ? (
            <Check className="size-3.5" strokeWidth={3} />
          ) : running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-zinc-200">{label}</p>
          <p className="truncate font-mono text-[10px] text-zinc-500">{sub}</p>
        </div>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
          {String(position).padStart(2, "0")}
          {interactive && (
            <ChevronRight className="ml-0.5 inline size-3 text-zinc-700 transition group-hover:text-zinc-400" />
          )}
        </span>
      </div>
    </button>
  );
  return interactive ? <Hint label={`Open ${label} events`}>{card}</Hint> : card;
}

function StepHead({
  n,
  title,
  hint,
  icon: Icon,
  tone,
  iconClass,
  aside,
}: {
  n: string;
  title: string;
  hint: string;
  icon: typeof FolderGit2;
  tone: Tone;
  iconClass?: string;
  aside?: ReactNode;
}) {
  const palette = TONES[tone];
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-bold",
          palette.border,
          palette.soft,
          palette.text,
        )}
      >
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
          <Icon className={cn("size-3.5", iconClass ?? palette.text)} />
          {title}
        </h2>
        <p className="text-[10px] text-zinc-500">{hint}</p>
      </div>
      {aside && <div className="ml-auto flex flex-wrap items-center gap-1.5">{aside}</div>}
    </div>
  );
}
