/**
 * Design draft for the four-step agent workspace (see REDESIGN.md).
 *
 * Fixtures only: no Worker, no GitHub, no keys. Mounted at `?draft` so the
 * shipped dashboard is untouched while the layout is reviewed.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Clock,
  ExternalLink,
  FileCode2,
  FileDiff,
  FileJson,
  FileSearch,
  Folder,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  KeyRound,
  Loader2,
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
  Progress,
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
import { providerById } from "@edge-spec/core/catalog";
import { toggleMode, useAppearance } from "@/lib/theme";
import {
  CHECKS,
  ENDPOINTS,
  GAPS,
  GENERATED,
  PHASE_RANK,
  type DraftGap,
  type DraftPhase,
  type StageId,
} from "./data";
import {
  DEFAULT_PR_DRAFT,
  DiffDialog,
  EndpointDialog,
  FactsDialog,
  LogDialog,
  PrDialog,
  PullsDialog,
  SourceDialog,
  SpecDialog,
  type PrDraft,
  type ReviewEntry,
  type ReviewState,
} from "./dialogs";
import {
  DEFAULT_DRAFT_SETTINGS,
  SettingsSheet,
  type DraftSettings,
  type SettingsSection,
} from "./settings-sheet";
import {
  CheckSummary,
  EndpointStatus,
  MethodChip,
  RISK,
  TONES,
  type EndpointRow,
  type Tone,
} from "./shared";

type StageState = "idle" | "running" | "done";

const MODES = [
  {
    id: "review",
    label: "Interactive Review",
    desc: "Pause at every diff; dispatch by hand.",
    icon: ShieldCheck,
  },
  {
    id: "auto",
    label: "Fully Autonomous",
    desc: "Auto-accept, then show the PR package.",
    icon: Zap,
  },
] as const;

const SEED_REVIEWS: Record<string, ReviewState> = {
  "src/auth/session.ts": "accepted",
  "src/edge/middleware.ts": "rejected",
  "src/api/sync.ts": "pending",
  "openapi.yaml": "accepted",
};

const GAP_KINDS = [
  { id: "missing", label: "Missing tests" },
  { id: "coverage", label: "Coverage gaps" },
  { id: "api", label: "Contract gaps" },
] as const;

function statusOf(reviews: Record<string, ReviewState>, state: ReviewState): number {
  return GENERATED.filter((file) => reviews[file.source] === state).length;
}

export function AgentWorkspaceDraft() {
  const appearance = useAppearance();
  const [phase, setPhase] = useState<DraftPhase>("idle");
  const [tested, setTested] = useState(0);
  const [written, setWritten] = useState(0);
  const [fixed, setFixed] = useState(false);
  const [mode, setMode] = useState<"review" | "auto">("review");
  const [repo, setRepo] = useState("https://github.com/acme/edge-api.git");
  const [branch, setBranch] = useState("main");
  const [settings, setSettings] = useState<DraftSettings>(DEFAULT_DRAFT_SETTINGS);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>(SEED_REVIEWS);
  const [selection, setSelection] = useState<string[]>(
    GAPS.filter((gap) => gap.kind === "missing")
      .slice(0, 8)
      .map((gap) => gap.path),
  );
  const [gapKind, setGapKind] = useState<(typeof GAP_KINDS)[number]["id"]>("missing");
  const [queued, setQueued] = useState<"idle" | "running" | "done">("idle");
  const [queuedCount, setQueuedCount] = useState(0);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  const [prDraft, setPrDraft] = useState<PrDraft>(DEFAULT_PR_DRAFT);
  const [logOpen, setLogOpen] = useState(false);
  const [logStage, setLogStage] = useState<StageId | "all">("all");
  const [diffPath, setDiffPath] = useState<string | undefined>(undefined);
  const [sourcePath, setSourcePath] = useState<string | undefined>(undefined);
  const [specFocus, setSpecFocus] = useState<EndpointRow | undefined>(undefined);
  const [endpointKey, setEndpointKey] = useState<string | undefined>(undefined);
  const [specOpen, setSpecOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [pullsOpen, setPullsOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);

  const rank = PHASE_RANK[phase];
  const running = rank > 0 && rank < 5;
  const providerName = providerById(settings.provider)?.name ?? settings.provider;

  // One pass through the four stages, so the motion is reviewable on load.
  useEffect(() => {
    const timer = setTimeout(() => setPhase("scanning"), 700);
    return () => clearTimeout(timer);
  }, []);

  // `?draft&modal=…` deep-links a modal for design review.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modal = params.get("modal");
    if (!modal) return;
    if (modal === "settings") {
      const section = params.get("section");
      if (
        section === "provider" ||
        section === "sandbox" ||
        section === "keys" ||
        section === "pipeline" ||
        section === "appearance"
      ) {
        setSettingsSection(section);
      }
      setSettingsOpen(true);
    }
    if (modal === "log") setLogOpen(true);
    if (modal === "diff") setDiffPath(GENERATED[0]?.source);
    if (modal === "source") setSourcePath(GENERATED[0]?.source);
    if (modal === "endpoint") setEndpointKey("POST /api/v1/sync");
    if (modal === "spec") {
      const key = params.get("endpoint");
      setSpecFocus(
        key ? ENDPOINTS.find((item) => `${item.method} ${item.path}` === key) : undefined,
      );
      setSpecOpen(true);
    }
    if (modal === "facts") setFactsOpen(true);
    if (modal === "pulls") setPullsOpen(true);
    if (modal === "pr") setPrOpen(true);
  }, []);

  useEffect(() => {
    if (phase !== "scanning" && phase !== "analyzing") return;
    const next: DraftPhase = phase === "scanning" ? "analyzing" : "testing";
    const timer = setTimeout(() => setPhase(next), phase === "scanning" ? 1200 : 1500);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "testing") return;
    if (tested >= ENDPOINTS.length) {
      const timer = setTimeout(() => setPhase("fixing"), 600);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setTested((count) => count + 1), 170);
    return () => clearTimeout(timer);
  }, [phase, tested]);

  useEffect(() => {
    if (phase !== "fixing") return;
    if (written >= GENERATED.length) {
      const timer = setTimeout(() => {
        setFixed(true);
        setPhase("review");
      }, 700);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setWritten((count) => count + 1), 140);
    return () => clearTimeout(timer);
  }, [phase, written]);

  // Autonomous: accept the pending files, then open the package for a look.
  useEffect(() => {
    if (phase !== "review" || mode !== "auto") return;
    const accept = setTimeout(
      () =>
        setReviews((current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, value]) => [
              key,
              value === "pending" ? "accepted" : value,
            ]),
          ),
        ),
      900,
    );
    const open = setTimeout(() => setPrOpen(true), 1700);
    return () => {
      clearTimeout(accept);
      clearTimeout(open);
    };
  }, [phase, mode]);

  useEffect(() => {
    if (queued !== "done") return;
    const timer = setTimeout(() => setQueued("idle"), 3600);
    return () => clearTimeout(timer);
  }, [queued]);

  const setReview = (source: string, state: ReviewState) => {
    setReviews((current) => ({ ...current, [source]: state }));
  };

  useEffect(() => {
    if (!regenerating) return;
    const timer = setTimeout(() => {
      setReview(regenerating, "pending");
      setRegenerating(null);
    }, 1000);
    return () => clearTimeout(timer);
  }, [regenerating]);

  const resetRun = () => {
    setPhase("idle");
    setTested(0);
    setWritten(0);
    setFixed(false);
    setQueued("idle");
    setReviews(
      Object.fromEntries(GENERATED.map((file) => [file.source, "pending" as ReviewState])),
    );
    setDiffPath(undefined);
    setSourcePath(undefined);
    setEndpointKey(undefined);
    setPrOpen(false);
  };

  const start = () => {
    resetRun();
    setPhase("scanning");
  };

  const openDiff = (source: string) => setDiffPath(source);
  const openSource = (source: string) => {
    setDiffPath(undefined);
    setSourcePath(source);
  };
  const openSpec = (focus?: EndpointRow) => {
    setSpecFocus(focus);
    setSpecOpen(true);
  };

  const openSettings = (section?: SettingsSection) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const rows: EndpointRow[] = ENDPOINTS.map((endpoint, index) => {
    const visible = index < tested || rank >= 5;
    const first = endpoint.firstHttp ?? endpoint.http;
    const pendingFix = endpoint.outcome === "fixed" && !fixed;
    return {
      ...endpoint,
      visible,
      firstHttp: endpoint.firstHttp,
      http: pendingFix ? first : endpoint.http,
      outcome: pendingFix ? undefined : endpoint.outcome,
    };
  });
  const passed = rows.filter((row) => row.visible && row.http < 300).length;
  const fixedCount = rows.filter(
    (row) => row.outcome === "fixed" && row.firstHttp !== undefined,
  ).length;
  const skippedCount = rows.filter((row) => row.outcome === "skipped").length;
  const endpointRow = rows.find((row) => `${row.method} ${row.path}` === endpointKey);

  const acceptedCount = statusOf(reviews, "accepted");
  const rejectedCount = statusOf(reviews, "rejected");
  const pendingCount = statusOf(reviews, "pending");
  const entries: ReviewEntry[] = GENERATED.map((file) => ({
    file,
    state: reviews[file.source] ?? "pending",
  }));
  const diffEntry = entries.find((entry) => entry.file.source === diffPath);
  const sourceEntry = entries.find((entry) => entry.file.source === sourcePath);

  const stages: Array<{
    id: StageId;
    label: string;
    sub: string;
    icon: typeof FolderGit2;
    tone: Tone;
    state: StageState;
    pct: number;
  }> = [
    {
      id: "clone",
      label: "Cloned Repo",
      sub: rank >= 2 ? "2,140 files · AST parsed" : "git clone --depth 1",
      icon: FolderGit2,
      tone: "clone",
      state: rank >= 2 ? "done" : rank === 1 ? "running" : "idle",
      pct: rank >= 2 ? 100 : rank === 1 ? 55 : 0,
    },
    {
      id: "analyze",
      label: "Analyzed Gaps",
      sub:
        rank >= 2
          ? `${GAPS.length} gaps · ${GAPS.filter((gap) => gap.kind === "missing").length} missing`
          : "sibling test scan",
      icon: Search,
      tone: "analyze",
      state: rank >= 3 ? "done" : rank === 2 ? "running" : "idle",
      pct: rank >= 3 ? 100 : rank === 2 ? 60 : 0,
    },
    {
      id: "test",
      label: "Testing OpenSpec",
      sub: rank >= 3 ? `${tested}/${ENDPOINTS.length} endpoints` : "live execution",
      icon: Zap,
      tone: "test",
      state: rank >= 4 ? "done" : rank === 3 ? "running" : "idle",
      pct: (tested / ENDPOINTS.length) * 100,
    },
    {
      id: "fix",
      label: "Fixing & Generating",
      sub: rank >= 4 ? `${written}/${GENERATED.length} tests` : "bounded self-correction",
      icon: Wrench,
      tone: "fix",
      state: rank >= 5 ? "done" : rank === 4 ? "running" : "idle",
      pct: (written / GENERATED.length) * 100,
    },
  ];

  const filteredGaps = GAPS.filter((gap) => gap.kind === gapKind);
  const groups = filteredGaps.reduce<Record<string, DraftGap[]>>((all, gap) => {
    const dir = gap.path.split("/").slice(0, -1).join("/");
    (all[dir] ??= []).push(gap);
    return all;
  }, {});
  const allSelected =
    filteredGaps.length > 0 && filteredGaps.every((gap) => selection.includes(gap.path));

  const openStage = (stage: StageId) => {
    setLogStage(stage);
    setLogOpen(true);
  };

  const generateSelected = () => {
    if (selection.length === 0) return;
    setQueuedCount(selection.length);
    setQueued("running");
    window.setTimeout(() => setQueued("done"), 1200);
  };

  const generateTest = (source: string) => setRegenerating(source);

  const dispatch = () => {
    setPrOpen(false);
    setPhase("dispatched");
  };

  const statusText =
    phase === "review"
      ? `${acceptedCount} accepted · ${rejectedCount} rejected · ${pendingCount} pending`
      : phase === "dispatched"
        ? "PR #128 opened on acme/edge-api"
        : phase === "idle"
          ? `Ready · acme/edge-api · ${branch}`
          : phase === "scanning"
            ? "Cloning and parsing the tree"
            : phase === "analyzing"
              ? "14 gaps found, ranking by risk"
              : phase === "testing"
                ? "Contract tests executing on Docker"
                : "Correcting the failing contract, writing tests";

  return (
    <TooltipProvider delayDuration={180}>
      <div className="no-scrollbar relative min-h-dvh overflow-x-hidden">
        <div className="app-backdrop" aria-hidden="true">
          <div className="app-aurora app-aurora-a" />
          <div className="app-aurora app-aurora-b" />
          <div className="app-aurora app-aurora-c" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl space-y-3 px-3 pt-3 pb-28 sm:px-6">
          <header className="app-reveal glass-panel sticky top-0 z-30 rounded-2xl px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2.5">
              <Hint label="Reset this run">
                <button
                  type="button"
                  onClick={resetRun}
                  aria-label="Reset this draft run"
                  className="relative shrink-0 rounded-xl transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:outline-none"
                >
                  <img
                    src="/favicon.svg"
                    alt=""
                    width={32}
                    height={32}
                    className="brand-mark size-8"
                  />
                  {running && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
                  )}
                </button>
              </Hint>
              <div className="min-w-0 leading-tight">
                <h1 className="truncate text-sm font-bold tracking-tight text-zinc-50">EdgeSpec</h1>
                <p className="hidden text-[10px] text-zinc-500 sm:block">Agentic Test Engineer</p>
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <Badge variant="warning" className="hidden h-9 items-center px-2 sm:inline-flex">
                  DRAFT
                </Badge>
                <Hint label={`${providerName} · 1.2k calls left · open provider settings`}>
                  <button
                    type="button"
                    onClick={() => openSettings("provider")}
                    className="rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none"
                    aria-label="Open AI provider settings"
                  >
                    <Badge variant="accent" className="h-9 items-center gap-1 px-2.5">
                      <Cloud className="size-3.5 text-sky-400" />
                      1.2k
                    </Badge>
                  </button>
                </Hint>
                <Hint label={`${settings.sandboxProvider} sandbox · open sandbox settings`}>
                  <button
                    type="button"
                    onClick={() => openSettings("sandbox")}
                    className="hidden rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none sm:block"
                    aria-label="Open sandbox settings"
                  >
                    <Badge variant="neutral" className="size-9 items-center justify-center p-0">
                      <Boxes className="size-4 text-violet-400" />
                    </Badge>
                  </button>
                </Hint>
                <Hint label="Settings">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openSettings()}
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
                        <AvatarFallback>AC</AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel>acme/edge-api · {branch}</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={toggleMode}>
                      {appearance.mode === "dark" ? <Sun /> : <Moon />}
                      {appearance.mode === "dark" ? "Light" : "Dark"} mode
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openSettings("provider")}>
                      <KeyRound />
                      Provider & keys
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPullsOpen(true)}>
                      <GitPullRequest />
                      Pull requests
                      <span className="ml-auto font-mono text-[10px] text-zinc-500">3</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={resetRun}>
                      <RefreshCw />
                      Reset this run
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Step 1 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "60ms" }}>
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="01"
                title="Target Repository"
                icon={FolderGit2}
                tone="clone"
                iconClass="text-zinc-400"
                hint="clone · parse the AST · read the tree"
                aside={
                  <Badge variant="neutral" className="font-mono">
                    {repo.includes("acme") ? "acme/edge-api" : "invalid"}
                  </Badge>
                }
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <GitBranch className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    aria-label="Repository URL"
                    spellCheck={false}
                    disabled={running}
                    className="pl-8 font-mono"
                  />
                </div>
                <Select value={branch} onValueChange={setBranch} disabled={running}>
                  <SelectTrigger aria-label="Branch" className="w-full font-mono sm:w-44">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <GitBranch className="size-3.5 shrink-0 text-zinc-500" />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {["main", "develop", "release/1.4"].map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={running ? resetRun : start}
                  disabled={!repo.trim()}
                  className="sm:w-36"
                >
                  {running ? (
                    <>
                      <Square className="size-3.5 fill-current" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5 fill-current" />
                      Start Scan
                    </>
                  )}
                </Button>
              </div>

              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <span className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                  Mode
                </span>
                <RadioGroup
                  value={mode}
                  onValueChange={(value) => setMode(value as "review" | "auto")}
                  className="grid gap-2 sm:grid-cols-2 lg:flex-1"
                >
                  {MODES.map((option) => {
                    const Icon = option.icon;
                    const active = mode === option.id;
                    return (
                      <div
                        key={option.id}
                        onClick={() => setMode(option.id)}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 transition",
                          active
                            ? "border-indigo-500/40 bg-indigo-500/10 shadow-lg shadow-indigo-950/20"
                            : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700",
                        )}
                      >
                        <RadioGroupItem value={option.id} className="mt-0.5" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
                            <Icon
                              className={cn(
                                "size-3.5",
                                active ? "text-indigo-300" : "text-zinc-500",
                              )}
                            />
                            {option.label}
                          </span>
                          <span className="block text-[10px] text-zinc-500">{option.desc}</span>
                        </span>
                      </div>
                    );
                  })}
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          {/* Step 2 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "120ms" }}>
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="02"
                title="Live Pipeline Telemetry"
                icon={Activity}
                tone="analyze"
                hint="click a stage to read its events; counters come from events"
                aside={
                  <>
                    <Badge variant="neutral" className="gap-1">
                      <Clock className="size-3" />
                      {(rank * 2.4).toFixed(1)}s
                    </Badge>
                    <Button variant="ghost" size="xs" onClick={() => setFactsOpen(true)}>
                      <FileJson className="size-3" />
                      Facts
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setLogStage("all");
                        setLogOpen(true);
                      }}
                    >
                      <Terminal className="size-3 text-amber-400" />
                      Event log
                    </Button>
                  </>
                }
              />
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                {stages.map((stage, index) => (
                  <Fragment key={stage.id}>
                    {index > 0 && (
                      <ChevronRight className="hidden size-3.5 shrink-0 text-zinc-600 md:block" />
                    )}
                    <StageNode {...stage} position={index + 1} onOpen={() => openStage(stage.id)} />
                  </Fragment>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Step 3 */}
          <Card className="app-reveal overflow-hidden" style={{ animationDelay: "180ms" }}>
            <CardContent className="space-y-3 p-4">
              <StepHead
                n="03"
                title="Triage & Findings"
                icon={ShieldCheck}
                tone="test"
                hint="missing tests and coverage gaps are counted apart"
                aside={
                  <>
                    <Badge variant="warning">
                      {GAPS.filter((gap) => gap.kind === "missing").length} missing
                    </Badge>
                    <Badge variant="accent">
                      {GAPS.filter((gap) => gap.kind === "coverage").length} coverage
                    </Badge>
                    <Badge variant={fixedCount ? "success" : "neutral"}>
                      {fixedCount} corrected
                    </Badge>
                  </>
                }
              />

              <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
                    <span className="text-[10px] font-semibold text-zinc-400">
                      File tree / gaps{" "}
                      <span className="text-zinc-600">({filteredGaps.length})</span>
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
                        onClick={generateSelected}
                        disabled={selection.length === 0 || queued === "running"}
                      >
                        {queued === "running" ? (
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
                    onValueChange={(value) => setGapKind(value as typeof gapKind)}
                    className="space-y-0"
                  >
                    <TabsList className="w-full justify-start gap-1 overflow-x-auto border-b border-zinc-800/60 px-2 py-1.5">
                      {GAP_KINDS.map((kind) => (
                        <TabsTrigger key={kind.id} value={kind.id} className="h-7 px-2 text-[10px]">
                          {kind.label} · {GAPS.filter((gap) => gap.kind === kind.id).length}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>

                  <ScrollArea className="h-[386px]">
                    <div className="p-1.5">
                      {gapKind === "coverage" && (
                        <p className="mb-1.5 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] px-2 py-1 text-[9px] text-emerald-300">
                          <CheckCircle2 className="size-3" />
                          measured from coverage/lcov.info · not a path heuristic
                        </p>
                      )}
                      {gapKind === "api" && (
                        <p className="mb-1.5 flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-2 py-1 text-[9px] text-amber-300">
                          <FileJson className="size-3" />
                          contract drift against openapi.yaml
                        </p>
                      )}
                      {Object.entries(groups).map(([dir, files], groupIndex) => (
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
                              const checked = selection.includes(gap.path);
                              const toggle = () =>
                                setSelection((current) =>
                                  checked
                                    ? current.filter((path) => path !== gap.path)
                                    : [...new Set([...current, gap.path])],
                                );
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
                                      onClick={(event) => event.stopPropagation()}
                                      onCheckedChange={toggle}
                                      aria-label={`Select ${gap.path}`}
                                    />
                                    <FileCode2
                                      className={cn(
                                        "size-3.5 shrink-0",
                                        gap.kind === "api"
                                          ? "text-amber-400"
                                          : gap.kind === "coverage"
                                            ? "text-sky-400"
                                            : "text-zinc-500",
                                      )}
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate font-mono text-[11px] text-zinc-300">
                                        {gap.path.split("/").pop()}
                                      </span>
                                      <span className="block truncate text-[10px] text-zinc-600">
                                        {gap.note}
                                      </span>
                                    </span>
                                    <Badge variant={RISK[gap.risk].variant}>
                                      {RISK[gap.risk].label}
                                    </Badge>
                                  </div>
                                </Hint>
                              );
                            })}
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </ScrollArea>

                  {queued === "done" && (
                    <div className="flex items-center gap-1.5 border-t border-zinc-800/60 px-3 py-1.5 text-[10px] text-emerald-300">
                      <CheckCircle2 className="size-3" />
                      {queuedCount} test(s) queued · the runner writes them after the current batch
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400">
                      <Zap className="size-3.5 text-amber-400" />
                      OpenAPI health matrix
                      <Badge variant="neutral" className="ml-1 font-mono">
                        openapi.yaml
                      </Badge>
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      {rank === 3 ? (
                        <>
                          <Loader2 className="size-3 animate-spin text-amber-400" />
                          live
                        </>
                      ) : rank >= 4 ? (
                        <>
                          <CheckCircle2 className="size-3 text-emerald-400" />
                          {passed} passed
                        </>
                      ) : (
                        "not run"
                      )}
                      <Button variant="ghost" size="xs" onClick={() => openSpec()}>
                        <FileJson className="size-3" />
                        Spec
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="h-[430px]">
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
                        {rows.map((row, index) => (
                          <TableRow
                            key={`${row.method}-${row.path}`}
                            className={cn(
                              "matrix-row cursor-pointer",
                              row.outcome === "fixed" &&
                                row.firstHttp !== undefined &&
                                "bg-emerald-500/[0.05]",
                            )}
                            style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                            onClick={() => setEndpointKey(`${row.method} ${row.path}`)}
                          >
                            <TableCell className="pl-3">
                              <span className="flex min-w-0 items-center gap-2">
                                <MethodChip method={row.method} />
                                <span className="truncate font-mono text-[11px] text-zinc-300">
                                  {row.path}
                                </span>
                                <ChevronRight className="size-3 shrink-0 text-zinc-700" />
                              </span>
                            </TableCell>
                            <TableCell>
                              {row.visible ? (
                                <EndpointStatus row={row} />
                              ) : (
                                <Skeleton className="h-4 w-20" />
                              )}
                            </TableCell>
                            <TableCell className="hidden pr-3 text-right font-mono text-[10px] text-zinc-500 sm:table-cell">
                              {row.visible ? `${row.ms}ms` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                  <div className="flex items-center gap-1.5 border-t border-zinc-800/60 px-3 py-1.5 text-[10px] text-zinc-500">
                    <Server className="size-3 text-sky-400" />
                    {rank >= 3
                      ? "executed on the Docker sandbox"
                      : "needs a runner · static check only"}
                    <span className="ml-auto font-mono">
                      {passed}/{ENDPOINTS.length} · {fixedCount} corrected · {skippedCount} skipped
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
                    setReviews(
                      Object.fromEntries(
                        GENERATED.map((file) => [file.source, "accepted" as ReviewState]),
                      ),
                    )
                  }
                  disabled={rank < 5}
                >
                  <Check className="size-3.5 text-emerald-400" />
                  Accept all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openSpec()}>
                  <FileJson className="size-3.5" />
                  Spec & contract
                </Button>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
                  <Sparkles className="size-3 text-violet-400" />
                  {providerName} · {settings.model}
                </span>
              </div>

              <div className="space-y-1.5">
                {entries.map((entry) => {
                  const accepted = entry.state === "accepted";
                  const rejected = entry.state === "rejected";
                  return (
                    <div
                      key={entry.file.source}
                      className={cn(
                        "flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-2 transition",
                        "border-zinc-800/70 bg-zinc-900/40",
                        regenerating === entry.file.source && "row-flash",
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
                          {entry.file.test}
                        </span>
                        <span className="block truncate text-[10px] text-zinc-500">
                          {entry.file.source} · {entry.file.model}
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <CheckSummary checks={CHECKS} />
                      </span>
                      <Hint label="Preview diff">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => openDiff(entry.file.source)}
                          disabled={rank < 5}
                          aria-label="Preview diff"
                        >
                          <FileDiff className="size-3.5" />
                        </Button>
                      </Hint>
                      <Hint label="Generate test">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => generateTest(entry.file.source)}
                          disabled={rank < 5 || regenerating === entry.file.source}
                          aria-label="Generate test"
                        >
                          <RefreshCw
                            className={cn(
                              "size-3.5",
                              regenerating === entry.file.source && "animate-spin",
                            )}
                          />
                        </Button>
                      </Hint>
                      <Hint label="Metadata and source">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => openSource(entry.file.source)}
                          disabled={rank < 5}
                          aria-label="Metadata and source"
                        >
                          <FileSearch className="size-3.5" />
                        </Button>
                      </Hint>
                      <Hint label={accepted ? "Withdraw acceptance" : "Accept this test"}>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            setReview(entry.file.source, accepted ? "pending" : "accepted")
                          }
                          disabled={rank < 5}
                          aria-label={accepted ? "Withdraw acceptance" : "Accept this test"}
                        >
                          <Check
                            className={cn(
                              "size-3.5",
                              accepted ? "text-emerald-400" : "text-zinc-500",
                            )}
                          />
                        </Button>
                      </Hint>
                      <Hint label={rejected ? "Restore this test" : "Reject this test"}>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            setReview(entry.file.source, rejected ? "pending" : "rejected")
                          }
                          disabled={rank < 5}
                          aria-label={rejected ? "Restore this test" : "Reject this test"}
                        >
                          <X
                            className={cn("size-3.5", rejected ? "text-rose-400" : "text-zinc-500")}
                          />
                        </Button>
                      </Hint>
                    </div>
                  );
                })}
              </div>

              {rejectedCount > 0 && (
                <Collapsible defaultOpen>
                  <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5 text-[10px] text-zinc-300">
                    <TriangleAlert className="size-3 text-amber-400" />
                    <span className="font-semibold">Rejected · stay out of the PR</span>
                    <span className="ml-auto font-mono">{rejectedCount} file(s)</span>
                    <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1.5 space-y-1">
                      {entries
                        .filter((entry) => entry.state === "rejected")
                        .map((entry) => (
                          <div
                            key={entry.file.source}
                            className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5"
                          >
                            <FileCode2 className="size-3.5 shrink-0 text-rose-400" />
                            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">
                              {entry.file.test}
                            </span>
                            <span className="hidden text-[10px] text-zinc-500 sm:block">
                              excluded from the PR package
                            </span>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setReview(entry.file.source, "pending")}
                            >
                              <RotateCcw className="size-3.5 text-emerald-400" />
                              Restore
                            </Button>
                          </div>
                        ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {phase === "dispatched" ? (
                <Alert variant="success">
                  <GitPullRequest />
                  <div>
                    <AlertTitle>Pull request #128 opened</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                      {acceptedCount} test files on edgespec/tests-2026-10-25.
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-300 underline-offset-2">
                        github.com/acme/edge-api/pull/128
                        <ExternalLink className="size-3" />
                      </span>
                    </AlertDescription>
                  </div>
                </Alert>
              ) : rank < 5 ? (
                <Alert variant="warning">
                  <TriangleAlert />
                  <div>
                    <AlertTitle>Not verified yet</AlertTitle>
                    <AlertDescription>
                      No runner has executed this suite yet. A static check is not a pass.
                    </AlertDescription>
                  </div>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6">
          <div className="glass-panel relative mx-auto flex max-w-7xl flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-400">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  rank >= 5
                    ? "bg-emerald-400"
                    : running
                      ? "animate-pulse bg-amber-400"
                      : "bg-zinc-600",
                )}
              />
              <span className="truncate">{statusText}</span>
              {rank >= 5 && phase !== "dispatched" && (
                <Badge variant="success" className="ml-1 hidden sm:inline-flex">
                  {acceptedCount}/{GENERATED.length} in the PR
                </Badge>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {running ? (
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
                      <AlertDialogAction variant="danger" onClick={resetRun}>
                        Stop run
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button variant="ghost" size="sm" onClick={resetRun} disabled={phase === "idle"}>
                  <X className="size-3.5" />
                  Cancel
                </Button>
              )}
              {phase === "dispatched" ? (
                <Button variant="outline" size="sm" onClick={start}>
                  <RefreshCw className="size-3.5" />
                  Run again
                </Button>
              ) : (
                <Hint
                  label={
                    rank < 5
                      ? "The run has to reach review first"
                      : "See exactly what goes into the pull request"
                  }
                >
                  <span className="inline-flex">
                    <Button
                      onClick={() => setPrOpen(true)}
                      disabled={rank < 5}
                      className="bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg shadow-indigo-950/30"
                    >
                      <GitPullRequest />
                      Review & dispatch
                      <ArrowUpRight className="size-3.5" />
                    </Button>
                  </span>
                </Hint>
              )}
            </div>
            {phase === "dispatched" && (
              <span className="success-burst pointer-events-none absolute right-10 bottom-12 flex gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                <span className="size-1.5 rounded-full bg-sky-400" />
                <span className="size-1.5 rounded-full bg-violet-400" />
              </span>
            )}
          </div>
        </div>

        <SettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          value={settings}
          onChange={setSettings}
          section={settingsSection}
        />
        <LogDialog
          open={logOpen}
          onClose={() => setLogOpen(false)}
          stage={logStage}
          onStage={setLogStage}
        />
        <SourceDialog
          open={Boolean(sourceEntry)}
          entry={sourceEntry}
          onClose={() => setSourcePath(undefined)}
          onState={(state) => {
            if (sourceEntry) setReview(sourceEntry.file.source, state);
          }}
          onGenerate={() => {
            if (sourceEntry) generateTest(sourceEntry.file.source);
          }}
          regenerating={Boolean(regenerating)}
          onViewDiff={() => {
            if (sourceEntry) setDiffPath(sourceEntry.file.source);
          }}
        />
        <DiffDialog
          open={Boolean(diffEntry)}
          entry={diffEntry}
          onClose={() => setDiffPath(undefined)}
        />
        <EndpointDialog
          open={Boolean(endpointRow)}
          row={endpointRow}
          onClose={() => setEndpointKey(undefined)}
          onOpenSpec={() => openSpec(endpointRow)}
        />
        <SpecDialog open={specOpen} onClose={() => setSpecOpen(false)} focus={specFocus} />
        <FactsDialog open={factsOpen} onClose={() => setFactsOpen(false)} />
        <PullsDialog open={pullsOpen} onClose={() => setPullsOpen(false)} />
        <PrDialog
          open={prOpen}
          onClose={() => setPrOpen(false)}
          onDispatch={dispatch}
          entries={entries}
          endpoints={rows}
          settings={settings}
          value={prDraft}
          onChange={setPrDraft}
        />
      </div>
    </TooltipProvider>
  );
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

function StageNode({
  label,
  sub,
  icon: Icon,
  tone,
  state,
  pct,
  position,
  onOpen,
}: {
  position: number;
  label: string;
  sub: string;
  icon: typeof FolderGit2;
  tone: Tone;
  state: StageState;
  pct: number;
  onOpen: () => void;
}) {
  const palette = TONES[tone];
  const running = state === "running";
  const done = state === "done";
  return (
    <Hint label={`Open ${label} events`}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "pipeline-node group relative min-w-0 flex-1 rounded-xl border px-2.5 py-2 text-left transition-all hover:-translate-y-0.5",
          done
            ? cn(palette.border, "bg-zinc-900/70")
            : running
              ? cn(palette.border, palette.soft, "shadow-lg", palette.glow)
              : "border-zinc-800/80 bg-zinc-900/40",
        )}
      >
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
            <ChevronRight className="ml-0.5 inline size-3 text-zinc-700 transition group-hover:text-zinc-400" />
          </span>
        </div>
        <Progress
          value={pct}
          aria-label={`${label} progress`}
          className="mt-2 h-1"
          indicatorClassName={done ? "bg-emerald-500" : palette.bar}
        />
      </button>
    </Hint>
  );
}
