import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  FileCode2,
  CheckCircle2,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  ShieldAlert,
  X,
  Zap,
} from "lucide-react";
import type {
  Gap,
  GeneratedTest,
  Generation,
  RateLimitInfo,
  RepositoryOverview,
  RunEvent,
  StepId,
  Validation,
} from "../core/types";
import type { PullSummary } from "../core/github";
import { providerById } from "../core/catalog";
import { folderFirst } from "../core/scanner";
import {
  fetchCatalog,
  fetchPulls,
  fetchQuota,
  openPullWithFiles,
  regenerate,
  runPipelineStream,
  scanRepo,
} from "@/api";
import { Gaps } from "@/components/gaps";
import { Header } from "@/components/header";
import { Overview } from "@/components/overview";
import { Pipeline, INITIAL_STEPS, type Steps, type Verification } from "@/components/pipeline";
import { Preview } from "@/components/preview";
import { TerminalPanel } from "@/components/terminal";
import { Pulls } from "@/components/pulls";
import { Review } from "@/components/review";
import { SettingsDialog, type SettingsSection } from "@/components/settings";
import type { LogEntry, LogLevel } from "@/components/terminal";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setProject, setSettings, useProject, useSecrets, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

/** The provider refused the request because the quota is gone. */
function isQuotaError(message: string): boolean {
  return /quota|allocation|insufficient|rate limit|too many requests|\b429\b|neurons/i.test(
    message,
  );
}

/** The provider could not do the job: no quota, no answer, or no route. */
function isProviderError(message: string): boolean {
  return isQuotaError(message) || /did not answer within|unreachable|timed? ?out/i.test(message);
}

/** A manual stop aborts the stream; never surface that as a failure. */
function isAbortError(message: string): boolean {
  return /signal is aborted|aborted/i.test(message);
}

/** The title a provider problem gets in a toast. */
function providerErrorTitle(message: string): string {
  if (isQuotaError(message)) return "The provider refused the request";
  if (/did not answer within/i.test(message)) return "The provider did not answer in time";
  if (/unreachable/i.test(message)) return "The provider is unreachable";
  return "Generation failed";
}

type Tab = "pipeline" | "overview" | "gaps" | "review" | "pulls";

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "pipeline", label: "Pipeline", icon: Activity },
  { id: "gaps", label: "Missing tests", icon: ShieldAlert },
  { id: "review", label: "Review", icon: ListChecks },
  { id: "pulls", label: "Pull requests", icon: GitPullRequest },
];

/** The Pull requests tab is parked until the PR list is ready to ship. */
const SHOW_PULLS_TAB: boolean = false;

interface Toast {
  title: string;
  description?: string;
  variant: "default" | "success" | "warning";
}

const clock = (): string => new Date().toLocaleTimeString("en-GB", { hour12: false });

const verificationOf = (result: Validation): Verification =>
  result.ok ? (result.verified ? "verified" : "static") : "failed";

/** One log line that says why validation failed, not just that it did. */
const failureSummary = (output: string, max = 1200): string => {
  const text = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export function App() {
  const project = useProject();
  const settings = useSettings();
  const secrets = useSecrets();

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The settings section the dialog scrolls to when it opens. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  const [tab, setTab] = useState<Tab>("overview");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  /** The log of the missing tests, apart from the pipeline run. */
  const [gapLogs, setGapLogs] = useState<LogEntry[]>([]);
  const [steps, setSteps] = useState<Steps>(INITIAL_STEPS);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [overview, setOverview] = useState<RepositoryOverview>();
  const [selected, setSelected] = useState("");
  /** The test being written or previewed right now. */
  const [live, setLive] = useState<{ generation?: Generation; validation?: Validation }>({});
  /** The path shown in the preview pane. */
  const [previewPath, setPreviewPath] = useState("");
  /** Whether the preview shows the test or what the file is missing. */
  const [previewMode, setPreviewMode] = useState<"code" | "meta">("code");
  const [verification, setVerification] = useState<Verification>("none");
  const [generated, setGenerated] = useState<GeneratedTest[]>([]);
  /** Gaps picked for a bulk generation. */
  const [checkedPaths, setCheckedPaths] = useState<string[]>([]);
  /** A bulk generation waiting for a confirmation. */
  const [pendingGenerate, setPendingGenerate] = useState<string[]>([]);
  /** What the provider says about the calls it has left. */
  const [quota, setQuota] = useState<RateLimitInfo>();
  /** The last refusal from the provider, e.g. an exhausted allocation. */
  const [providerError, setProviderError] = useState<string>();
  /** The files whose last generation failed. */
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [pullUrls, setPullUrls] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [prBusyPath, setPrBusyPath] = useState<string>();
  /** Paths whose generation is in flight right now: per-item spinner. */
  const [generatingPaths, setGeneratingPaths] = useState<string[]>([]);
  /** The path being self-corrected from the validation dialog. */
  const [correctingPath, setCorrectingPath] = useState<string>();
  /** Gap paths that failed validation in the last pipeline run, for re-run. */
  const [failedGapPaths, setFailedGapPaths] = useState<string[]>([]);
  const [pulls, setPulls] = useState<PullSummary[]>([]);
  const [pullsLoading, setPullsLoading] = useState(false);
  const [pullsError, setPullsError] = useState<string>();
  const [pullsTick, setPullsTick] = useState(0);
  const [sandbox, setSandbox] = useState(false);
  const [toast, setToast] = useState<Toast>();

  const abortRef = useRef<AbortController | null>(null);
  /** The running generation, so it can be stopped. */
  const generationAbortRef = useRef<AbortController | null>(null);
  /** How many generation batches are in flight; parallel mode allows more than one. */
  const activeBatches = useRef(0);
  const tabsRef = useRef<HTMLDivElement>(null);
  const logId = useRef(0);
  const gapLogId = useRef(0);
  /** The pipeline stage that is running, so its log entries can be filtered. */
  const currentStep = useRef<StepId | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const addLog = useCallback((level: LogLevel, text: string, step?: StepId) => {
    logId.current += 1;
    setLogs((current) => [
      ...current,
      { id: logId.current, level, time: clock(), text, ...(step ? { step } : {}) },
    ]);
  }, []);

  // The missing tests have their own log: a generation or a pull request must
  // not bury the run log of a pipeline.
  const addGapLog = useCallback((level: LogLevel, text: string) => {
    gapLogId.current += 1;
    setGapLogs((current) => [...current, { id: gapLogId.current, level, time: clock(), text }]);
  }, []);

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 4500);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Ask the provider how many calls are left. It runs on launch and whenever
  // the provider, the model or the key changes.
  useEffect(() => {
    let cancelled = false;
    setQuota(undefined);
    fetchQuota(project, settings)
      .then((result) => {
        if (!cancelled && result.rateLimit) setQuota(result.rateLimit);
      })
      .catch(() => {
        // A provider that cannot be asked is a provider we know nothing about.
      });
    return () => {
      cancelled = true;
    };
    // The key itself is a secret: the probe only needs to know that it exists.
  }, [settings.provider, settings.model, settings.accountId, secrets.aiKey, project.repo]);

  // A test joins the ready list once it has both code and a validation result.
  useEffect(() => {
    const { generation, validation } = live;
    if (!generation || !validation) return;
    setGenerated((current) => {
      const index = current.findIndex(
        (item) => item.generation.sourcePath === generation.sourcePath,
      );
      const existing = current[index];
      if (
        existing &&
        existing.generation.code === generation.code &&
        existing.validation === validation
      ) {
        return current;
      }
      const next = { generation, validation };
      if (index === -1) return [...current, next];
      const copy = current.slice();
      copy[index] = next;
      return copy;
    });
  }, [live]);

  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((catalog) => {
        if (!cancelled) setSandbox(catalog.sandbox);
      })
      .catch(() => {
        // The catalog only labels the sandbox state; the app works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== "pulls" || !project.repo) return;
    let cancelled = false;
    setPullsLoading(true);
    setPullsError(undefined);
    fetchPulls(project.repo)
      .then((result) => {
        if (!cancelled) setPulls(result.pulls);
      })
      .catch((error: unknown) => {
        if (!cancelled) setPullsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setPullsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, project.repo, pullsTick]);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      switch (event.type) {
        case "log":
          addLog(event.level, event.text, currentStep.current);
          break;
        case "step":
          currentStep.current = event.step;
          setSteps((current) => ({
            ...current,
            [event.step]: {
              status:
                event.status === "start" ? "running" : event.status === "done" ? "done" : "failed",
              ...(event.note ? { note: event.note } : {}),
            },
          }));
          break;
        case "quota":
          setQuota(event.rateLimit);
          break;
        case "gaps": {
          const ordered = folderFirst(event.gaps, project.folder);
          setGaps(event.gaps);
          if (event.overview) setOverview(event.overview);
          if (ordered[0]) setSelected(ordered[0].path);
          break;
        }
        case "generation":
          setLive({ generation: event.generation });
          setPreviewPath(event.generation.sourcePath);
          setVerification("none");
          setPullUrls((current) => {
            if (!(event.generation.sourcePath in current)) return current;
            const next = { ...current };
            delete next[event.generation.sourcePath];
            return next;
          });
          break;
        case "validation": {
          setLive((current) => ({ ...current, validation: event.validation }));
          setVerification(verificationOf(event.validation));
          const sourcePath = live.generation?.sourcePath;
          if (sourcePath) {
            if (event.validation.ok) {
              setFailedGapPaths((current) => current.filter((p) => p !== sourcePath));
            } else {
              setFailedGapPaths((current) => {
                if (current.includes(sourcePath)) return current;
                return [...current, sourcePath];
              });
            }
          }
          break;
        }
        case "result": {
          if (event.generation) {
            setLive((current) => ({ ...current, generation: event.generation }));
            setPreviewPath(event.generation.sourcePath);
          }
          // A run covers every gap it could: the first ready test is the one
          // that opens in the preview.
          if (event.ready?.length) {
            setPreviewPath(event.ready[0] as string);
          }
          if (event.ok) {
            // The run stops at the pull request stage: the preview opens here
            // and the reviewer opens the PR by hand.
            setTab("review");
            showToast({
              title: event.ready?.length ? `${event.ready.length} test(s) ready` : "Test ready",
              description: "Review the preview, then open the pull request.",
              variant: "success",
            });
          } else {
            const reason = event.reason?.split("\n")[0] ?? "Validation did not pass.";
            if (isProviderError(reason)) setProviderError(reason);
            showToast({
              title: isProviderError(reason)
                ? providerErrorTitle(reason)
                : "Run finished without a ready test",
              description: reason,
              variant: "warning",
            });
          }
          break;
        }
        case "error":
          // A manual stop aborts the stream; don't report it as a failure.
          if (isAbortError(event.message)) break;
          // The matching log event is already emitted by the pipeline.
          if (isProviderError(event.message)) setProviderError(event.message);
          showToast({
            title: isProviderError(event.message)
              ? providerErrorTitle(event.message)
              : "Run failed",
            description: event.message,
            variant: "warning",
          });
          break;
      }
    },
    [addLog, project.folder, showToast],
  );

  const run = async () => {
    if (running) return;
    if (!project.repo) {
      showToast({
        title: "Repository required",
        description: "Enter owner/name or a folder path in the header.",
        variant: "warning",
      });
      return;
    }

    setRunning(true);
    setSteps(INITIAL_STEPS);
    setLogs([]);
    setLive({});
    setVerification("none");
    setFailedGapPaths([]);
    const controller = new AbortController();
    abortRef.current = controller;
    currentStep.current = "scan";
    addLog("info", `EdgeSpec starting for ${project.repo}@${project.ref || "main"}.`, "scan");

    try {
      await runPipelineStream(project, settings, handleEvent, controller.signal, failedGapPaths);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAbortError(message)) {
        addLog("info", "Run stopped.", currentStep.current);
      } else {
        addLog("error", message, currentStep.current);
        showToast({ title: "Run failed", description: message, variant: "warning" });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      currentStep.current = undefined;
      setSteps((current) => {
        const next = { ...current };
        for (const key of Object.keys(next) as Array<keyof Steps>) {
          if (next[key].status === "running") {
            next[key] = { status: "failed", note: "stopped" };
          }
        }
        return next;
      });
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    addLog("warn", "Run stopped by the user.", currentStep.current);
  };

  const scan = async () => {
    if (scanning) return;
    if (!project.repo) {
      showToast({
        title: "Repository required",
        description: "Enter owner/name or a folder path in the header.",
        variant: "warning",
      });
      return;
    }
    setScanning(true);
    // The scan fills the Overview; the reader stays where they are.
    try {
      const result = await scanRepo(project);
      setGaps(result.gaps);
      if (result.overview) setOverview(result.overview);
      const first = folderFirst(result.gaps, project.folder)[0];
      if (first) setSelected(first.path);
      addGapLog(
        "success",
        `Scanned ${result.scanned} paths: ${result.gaps.length} untested file(s).`,
      );
      showToast({
        title: `${result.gaps.length} untested file(s) found`,
        description: `${result.scanned} paths scanned.`,
        variant: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addGapLog("error", message);
      showToast({ title: "Scan failed", description: message, variant: "warning" });
    } finally {
      setScanning(false);
    }
  };

  const selectedGap = gaps.find((gap) => gap.path === selected);
  /** The scan is whole-repo; the start folder only changes the order. */
  const displayGaps = folderFirst(gaps, project.folder);
  const generatedPaths = generated.map((item) => item.generation.sourcePath);
  /** A runner is configured, so the suite can really be executed. */
  const hasRunner = sandbox || Boolean(settings.sandboxUrl.trim());
  const readyCount = generated.filter(
    (item) => item.validation.ok && !pullUrls[item.generation.sourcePath],
  ).length;
  /** The last validation result per source path, for the gap list markers. */
  const validations: Record<string, boolean> = {};
  for (const item of generated) validations[item.generation.sourcePath] = item.validation.ok;

  /** The gaps tab previews the test of the focused gap. */
  const gapItem = generated.find((item) => item.generation.sourcePath === selected);
  const gapLive = live.generation?.sourcePath === selected ? live : undefined;
  const gapGeneration = gapItem?.generation ?? gapLive?.generation;
  const gapValidation = gapItem?.validation ?? gapLive?.validation;
  const gapPullUrl = gapItem ? pullUrls[gapItem.generation.sourcePath] : undefined;

  /** The logo clears the workspace: repository, scan, tests and run. */
  const resetAll = () => {
    setProject({ repo: "", ref: "", folder: "" });
    setGaps([]);
    setOverview(undefined);
    setGenerated([]);
    setLive({});
    setPreviewPath("");
    setSelected("");
    setCheckedPaths([]);
    setPullUrls({});
    setPulls([]);
    setLogs([]);
    setGapLogs([]);
    setSteps(INITIAL_STEPS);
    setVerification("none");
    setTab("overview");
    showToast({
      title: "Everything was reset",
      description: "The repository, the scan and the generated tests are gone.",
      variant: "success",
    });
  };

  useEffect(() => {
    if (!project.folder) return;
    // A saved start folder and an existing scan: open the first file in it.
    // Scans select their own first file, so only a folder change needs this.
    const prefix = `${project.folder.replace(/^\/+|\/+$/g, "")}/`;
    const first = gaps.find((gap) => gap.path.startsWith(prefix));
    if (first) setSelected(first.path);
  }, [project.folder]);

  /** Opens Settings, optionally at one of its sections. */
  const openSettings = (section?: SettingsSection) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const showGenerated = (item: GeneratedTest) => {
    setPreviewPath(item.generation.sourcePath);
    setPreviewMode("code");
    setLive({ generation: item.generation, validation: item.validation });
    setVerification(verificationOf(item.validation));
    setSelected(item.generation.sourcePath);
  };

  /** One generation. The caller decides whether these run in parallel. */
  const generateOne = async (
    path: string,
    signal?: AbortSignal,
    previous?: { code: string; output: string },
  ): Promise<boolean> => {
    try {
      // Clearing a stale error the moment a generation (re)starts, so the error
      // icon disappears as soon as the reader asks to try again.
      setFileErrors((current) => {
        if (!(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      const result = await regenerate(project, settings, path, signal, previous);
      if (result.rateLimit) setQuota(result.rateLimit);
      setProviderError(undefined);
      setFileErrors((current) => {
        if (!(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      setLive({ generation: result.generation, validation: result.validation });
      setPreviewPath(path);
      setVerification(verificationOf(result.validation));
      setPullUrls((current) => {
        if (!(path in current)) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      setGenerated((current) => {
        const index = current.findIndex((item) => item.generation.sourcePath === path);
        const next = { generation: result.generation, validation: result.validation };
        if (index === -1) return [...current, next];
        const copy = current.slice();
        copy[index] = next;
        return copy;
      });
      const passes = result.attempts ? ` · ${result.attempts} self-correct pass(es)` : "";
      addGapLog(
        "info",
        `${previous ? "Rewrote" : "Generated"} ${result.generation.code.split("\n").length} lines for ${path}${passes}.`,
      );
      if (result.validation.ok) {
        setFailedGapPaths((current) => current.filter((item) => item !== path));
        addGapLog("success", `${path}: validation passed${passes}.`);
      } else {
        addGapLog(
          "error",
          `${path}: validation failed${passes} — ${failureSummary(result.validation.output)}`,
        );
      }
      return result.validation.ok;
    } catch (error) {
      // A cancelled run is not a failure.
      const message = error instanceof Error ? error.message : String(error);
      if ((error instanceof DOMException && error.name === "AbortError") || isAbortError(message))
        return false;
      setFileErrors((current) => ({ ...current, [path]: message }));
      if (isProviderError(message)) setProviderError(message);
      addGapLog("error", message);
      showToast({
        title: providerErrorTitle(message),
        description: message,
        variant: "warning",
      });
      return false;
    }
  };

  /** Asks the model to fix every failure in the current validation result. */
  const correctOne = async (generation: Generation, validation: Validation) => {
    if (validation.ok) return;
    const path = generation.sourcePath;
    const failed = validation.checks?.filter((check) => !check.ok && !check.skipped).length ?? 0;
    setCorrectingPath(path);
    addGapLog("ai", `Self-correcting ${path}${failed > 1 ? ` · fixing ${failed} errors` : ""}…`);
    try {
      await generateOne(path, undefined, { code: generation.code, output: validation.output });
    } finally {
      setCorrectingPath(undefined);
    }
  };

  /**
   * One test needs no confirmation; a batch does, because every file is a
   * separate request to the model.
   */
  const requestGenerate = (paths: string[]) => {
    if (paths.length === 0) return;
    if (activeBatches.current > 0 && !settings.parallelGeneration) return;
    if (paths.length === 1) {
      void generatePaths(paths);
      return;
    }
    setPendingGenerate(paths);
  };

  /**
   * Generates tests for the given paths. Settings decide whether they run
   * side by side or one after the other. Parallel mode accepts a new batch
   * while one is still running, so the reader can queue more files.
   */
  const generatePaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    if (activeBatches.current > 0 && !settings.parallelGeneration) return;
    const controller = generationAbortRef.current ?? new AbortController();
    generationAbortRef.current = controller;
    activeBatches.current += 1;
    setGenerating(true);
    setGeneratingPaths((current) => [...new Set([...current, ...paths])]);
    if (activeBatches.current === 1) {
      setLive({});
      setVerification("none");
    }
    setCheckedPaths([]);
    addGapLog(
      "ai",
      settings.parallelGeneration
        ? `Generating ${paths.length} test(s) in parallel.`
        : `Generating ${paths.length} test(s).`,
    );
    try {
      const results = settings.parallelGeneration
        ? await Promise.all(paths.map((path) => generateOne(path, controller.signal)))
        : await paths.reduce<Promise<boolean[]>>(async (carry, path) => {
            const done = await carry;
            return [...done, await generateOne(path, controller.signal)];
          }, Promise.resolve([]));
      const failed = results.filter((ok) => !ok).length;
      // Only a run where every test arrived may say the tests are ready.
      if (failed === 0) {
        showToast({
          title: `${paths.length} test(s) ready`,
          description: "Review the preview, then open the pull request.",
          variant: "success",
        });
      } else {
        showToast({
          title: `${failed} of ${paths.length} test(s) failed`,
          description: "The reason is on the file and in the preview.",
          variant: "warning",
        });
      }
    } finally {
      activeBatches.current = Math.max(0, activeBatches.current - 1);
      setGeneratingPaths((current) => current.filter((path) => !paths.includes(path)));
      if (activeBatches.current === 0) {
        generationAbortRef.current = null;
        setGenerating(false);
      }
    }
  };

  /** Stops every running generation. */
  const stopGenerating = () => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    activeBatches.current = 0;
    setGenerating(false);
    setGeneratingPaths([]);
    addGapLog("warn", "Generation stopped.");
  };

  /** One pull request that carries every listed test. */
  const openPullForAll = async (items: GeneratedTest[]) => {
    if (prBusyPath || items.length === 0) return;
    setPrBusyPath("batch");
    try {
      const result = await openPullWithFiles(
        project,
        settings,
        items.map((item) => ({
          sourcePath: item.generation.sourcePath,
          path: item.generation.testPath,
          code: item.generation.code,
        })),
      );
      setPullUrls((current) => {
        const next = { ...current };
        for (const item of items) next[item.generation.sourcePath] = result.url;
        return next;
      });
      addGapLog("success", `Pull request opened with ${result.files} test file(s): ${result.url}`);
      showToast({
        title: `Pull request opened with ${result.files} test(s)`,
        description: result.url,
        variant: "success",
      });
      setPullsTick((tick) => tick + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addGapLog("error", message);
      showToast({ title: "Could not open the PR", description: message, variant: "warning" });
    } finally {
      setPrBusyPath(undefined);
    }
  };

  const selectGap = (gap: Gap, mode: "code" | "meta" = "code") => {
    setSelected(gap.path);
    setPreviewPath(gap.path);
    setPreviewMode(mode);
    const existing = generated.find((item) => item.generation.sourcePath === gap.path);
    if (existing) {
      setLive({ generation: existing.generation, validation: existing.validation });
      setVerification(verificationOf(existing.validation));
    }
  };

  const toggleChecked = (paths: string | string[], checked: boolean) => {
    const list = Array.isArray(paths) ? paths : [paths];
    setCheckedPaths((current) =>
      checked
        ? [...new Set([...current, ...list])]
        : current.filter((item) => !list.includes(item)),
    );
  };

  /** Select all, or clear the selection outright. */
  const setChecked = (paths: string[]) => setCheckedPaths(paths);

  const modelName =
    providerById(settings.provider)?.models.find((model) => model.id === settings.model)?.name ??
    settings.model;

  return (
    <div className="no-scrollbar relative min-h-dvh overflow-x-hidden">
      <div className="app-backdrop" aria-hidden="true">
        <div className="app-aurora app-aurora-a" />
        <div className="app-aurora app-aurora-b" />
        <div className="app-aurora app-aurora-c" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-6">
        <Header
          project={project}
          settings={settings}
          secrets={secrets}
          running={running}
          scanning={scanning}
          onScan={scan}
          onReset={resetAll}
          quota={quota}
          providerError={providerError}
          onOpenSettings={() => openSettings()}
          onOpenProvider={() => openSettings("provider")}
        />

        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="space-y-4">
          <div
            className="app-reveal glass-panel no-scrollbar flex items-center gap-1 overflow-x-auto rounded-2xl p-1.5"
            style={{ animationDelay: "70ms" }}
          >
            <TabsList
              ref={tabsRef}
              className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            >
              {TABS.filter(
                (item) =>
                  (item.id !== "review" || generated.some((entry) => entry.validation.ok)) &&
                  (item.id !== "pulls" || SHOW_PULLS_TAB),
              ).map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                // A run in flight blinks the pipeline tab, so the state is
                // visible from any tab.
                const live = running && item.id === "pipeline";
                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    className={cn(live && "tab-live text-indigo-300")}
                  >
                    <Icon
                      className={cn(
                        "size-4",
                        active || live ? "text-indigo-400" : "text-zinc-500",
                        live && "animate-pulse",
                      )}
                    />
                    {item.label}
                    {item.id === "gaps" && gaps.length > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                          active
                            ? "border border-indigo-500/30 bg-indigo-500/20 text-indigo-300"
                            : "bg-zinc-800 text-zinc-400",
                        )}
                      >
                        {gaps.length}
                      </span>
                    )}
                    {item.id === "review" && readyCount > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                          active
                            ? "border border-indigo-500/30 bg-indigo-500/20 text-indigo-300"
                            : "bg-zinc-800 text-zinc-400",
                        )}
                      >
                        {readyCount}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {!project.repo && (
              <div className="ml-auto hidden shrink-0 items-center gap-1.5 px-2 text-[11px] text-zinc-500 sm:flex">
                <AlertCircle className="size-3.5 text-amber-400" />
                no repository
              </div>
            )}
          </div>

          <TabsContent value="pipeline">
            <Pipeline steps={steps} logs={logs} running={running} onRun={run} onStop={stop} />
          </TabsContent>

          <TabsContent value="overview">
            <Overview
              overview={overview}
              gaps={gaps}
              generatedPaths={generatedPaths}
              repo={project.repo}
              providerId={settings.provider}
              providerName={providerById(settings.provider)?.name ?? settings.provider}
              modelName={modelName}
              {...(settings.baseUrl.trim() ? { baseUrl: settings.baseUrl.trim() } : {})}
              {...(settings.accountId.trim() ? { accountId: settings.accountId.trim() } : {})}
              verification={verification}
              hasRunner={hasRunner}
              {...(providerError ? { providerError } : {})}
              onOpenGap={(gap) => {
                selectGap(gap);
                setTab("gaps");
              }}
              onOpenSettings={() => openSettings("runner")}
              onChangeProvider={() => openSettings("provider")}
            />
          </TabsContent>

          <TabsContent value="gaps">
            <div className="space-y-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <Gaps
                  gaps={displayGaps}
                  generatedPaths={generatedPaths}
                  validations={validations}
                  generating={generating}
                  generatingPaths={generatingPaths}
                  parallel={settings.parallelGeneration}
                  onParallelChange={(value) => setSettings({ parallelGeneration: value })}
                  pipelineRunning={running}
                  selected={selected}
                  checked={checkedPaths}
                  onSelect={(gap, mode) => selectGap(gap, mode)}
                  onStop={stopGenerating}
                  onToggleCheck={toggleChecked}
                  onGenerate={requestGenerate}
                  onSetChecked={setChecked}
                  errors={fileErrors}
                  repo={project.repo}
                  folder={project.folder}
                  onClearFolder={() => setProject({ folder: "" })}
                />
                <Preview
                  {...(selectedGap ? { gap: selectedGap } : {})}
                  generation={gapGeneration}
                  validation={gapValidation}
                  {...(selectedGap && fileErrors[selectedGap.path]
                    ? { error: fileErrors[selectedGap.path] as string }
                    : {})}
                  {...(gapPullUrl ? { pullUrl: gapPullUrl } : {})}
                  busy={generatingPaths.includes(selectedGap?.path ?? "")}
                  onRegenerate={
                    gapGeneration ? () => void generatePaths([gapGeneration.sourcePath]) : undefined
                  }
                  {...(gapGeneration && gapValidation && !gapValidation.ok
                    ? { onCorrect: () => void correctOne(gapGeneration, gapValidation) }
                    : {})}
                  correcting={correctingPath === gapGeneration?.sourcePath}
                  mode={previewMode}
                  placeholder="Pick an untested file to generate its test, or review one that is already here."
                />
              </div>

              <TerminalPanel
                logs={gapLogs}
                running={generating}
                title="Missing tests log"
                empty="No events yet. Scan a repository, or generate a test."
              />
            </div>
          </TabsContent>

          <TabsContent value="review">
            <Review
              items={generated}
              pullUrls={pullUrls}
              generatingPaths={generatingPaths}
              {...(prBusyPath ? { busyPath: prBusyPath } : {})}
              {...(previewPath ? { activePath: previewPath } : {})}
              onPreview={showGenerated}
              onOpenPull={(items) => void openPullForAll(items)}
              onRegenerate={(item) => void generatePaths([item.generation.sourcePath])}
            />
          </TabsContent>

          <TabsContent value="pulls">
            <Pulls
              pulls={pulls}
              loading={pullsLoading}
              {...(pullsError ? { error: pullsError } : {})}
              repo={project.repo}
              onRefresh={() => setPullsTick((tick) => tick + 1)}
            />
          </TabsContent>
        </Tabs>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsSection(undefined);
        }}
        settings={settings}
        secrets={secrets}
        {...(settingsSection ? { section: settingsSection } : {})}
      />

      <Dialog
        open={pendingGenerate.length > 0}
        onClose={() => setPendingGenerate([])}
        title={`Generate ${pendingGenerate.length} test${pendingGenerate.length === 1 ? "" : "s"}?`}
        description="Every selected file is a separate request to the model. It costs tokens and takes a moment."
        footer={
          <>
            <Button variant="ghost" size="xs" onClick={() => setPendingGenerate([])}>
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={() => {
                const paths = pendingGenerate;
                setPendingGenerate([]);
                void generatePaths(paths);
              }}
            >
              <FileCode2 className="size-4" />
              Generate {pendingGenerate.length} test{pendingGenerate.length === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        <ul className="no-scrollbar max-h-48 space-y-1 overflow-auto font-mono text-[11px] text-zinc-400">
          {pendingGenerate.slice(0, 12).map((path) => (
            <li key={path} className="truncate">
              {path}
            </li>
          ))}
          {pendingGenerate.length > 12 && (
            <li className="text-zinc-600">and {pendingGenerate.length - 12} more</li>
          )}
        </ul>
      </Dialog>

      {toast && (
        <div
          role="status"
          className={cn(
            "toast-in fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border p-4 shadow-2xl backdrop-blur-xl",
            toast.variant === "success"
              ? "border-emerald-500/40 bg-zinc-900/90"
              : toast.variant === "warning"
                ? "border-amber-500/40 bg-zinc-900/90"
                : "border-zinc-700/60 bg-zinc-900/90",
          )}
        >
          {toast.variant === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          ) : toast.variant === "warning" ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          ) : (
            <Zap className="mt-0.5 size-4 shrink-0 text-indigo-400" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-zinc-100">{toast.title}</p>
            {toast.description && (
              <p className="mt-0.5 truncate text-[11px] text-zinc-400">{toast.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setToast(undefined)}
            aria-label="Dismiss notification"
            className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
