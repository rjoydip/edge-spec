/**
 * Deployment configuration (history, artifacts, schedules) shown inside
 * Settings, plus the audit log. These are saved to the server, unlike the
 * browser-bound settings around them.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Building2,
  CalendarClock,
  CheckCircle2,
  Database,
  GitPullRequest,
  Info,
  ListChecks,
  Loader2,
  MemoryStick,
  Save,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";
import type { RepoMemory } from "@edge-spec/core/memory";
import type { PullPolicy } from "@edge-spec/core/policy";
import { setSecrets, setSettings, useSecrets, useSettings } from "@/lib/settings";
import {
  Badge,
  Button,
  Dialog,
  Hint,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@edge-spec/ui";
import {
  deleteMemory,
  deletePolicy,
  deleteSchedule,
  fetchAudit,
  fetchHealth,
  fetchMemory,
  fetchPolicy,
  fetchSchedules,
  fetchWorkspace,
  updateMemory,
  updatePolicy,
  updateSchedule,
  updateWorkspace,
  type AuditEvent,
  type DeploymentCapabilities,
  type ScheduledRepo,
} from "@/api";
import { historyNotice } from "./history-notice";

/** One `/api/health` request per page load; every block shares it. */
let healthCapabilities: Promise<DeploymentCapabilities> | undefined;

function useCapabilities(): DeploymentCapabilities | undefined {
  const [capabilities, setCapabilities] = useState<DeploymentCapabilities>();
  useEffect(() => {
    let cancelled = false;
    healthCapabilities ??= fetchHealth().then((health) => health.capabilities);
    healthCapabilities
      .then((value) => {
        if (!cancelled) setCapabilities(value);
      })
      .catch(() => {
        // The notice falls back to generic copy; a later mount retries.
        healthCapabilities = undefined;
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return capabilities;
}

const linesOf = (raw: string): string[] =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const linesText = (values: string[] | undefined): string => (values ?? []).join("\n");

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] leading-snug text-zinc-500">{hint}</span>}
    </label>
  );
}

function SubHead({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Database;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-zinc-500" />
      <span className="text-[10px] font-semibold tracking-wide text-zinc-200 uppercase">
        {title}
      </span>
      {hint && <span className="ml-auto truncate font-mono text-[9px] text-zinc-500">{hint}</span>}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-zinc-800/70" />;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-2.5 py-3 text-center text-[10px] text-zinc-500">
      {children}
    </p>
  );
}

function HistoryNotice() {
  return <Notice>{historyNotice(useCapabilities())}</Notice>;
}

function Loading() {
  return (
    <p className="flex items-center justify-center gap-2 py-4 text-[10px] text-zinc-500">
      <Loader2 className="size-3 animate-spin" /> Loading…
    </p>
  );
}

function SaveState({ saved }: { saved: boolean }) {
  return saved ? <span className="text-[10px] text-emerald-300">Saved.</span> : null;
}

function WorkspaceBlock() {
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState("");
  const [retentionDays, setRetentionDays] = useState(30);
  const [driftWebhookUrl, setDriftWebhookUrl] = useState("");
  const [driftWebhookSecret, setDriftWebhookSecret] = useState("");
  const [driftWebhookSecretSet, setDriftWebhookSecretSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchWorkspace()
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        if (result.workspace) {
          setName(result.workspace.name);
          setRetentionDays(result.workspace.retentionDays);
          setDriftWebhookUrl(result.workspace.driftWebhookUrl ?? "");
          setDriftWebhookSecretSet(result.workspace.driftWebhookSecretSet);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updateWorkspace({
        name,
        retentionDays,
        driftWebhookUrl,
        ...(driftWebhookSecret.trim() ? { driftWebhookSecret } : {}),
      });
      setDriftWebhookUrl(result.workspace.driftWebhookUrl ?? "");
      setDriftWebhookSecret("");
      setDriftWebhookSecretSet(result.workspace.driftWebhookSecretSet);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!enabled) return <HistoryNotice />;

  return (
    <div className="space-y-2.5">
      <SubHead icon={Building2} title="Workspace" hint="deployment-wide" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name" hint="Trimmed to 100 characters.">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Retention (days)" hint="Runs, audit and rate limits.">
          <Input
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(event) => setRetentionDays(Number(event.target.value))}
          />
        </Field>
      </div>
      <Field
        label="Drift webhook URL"
        hint="Workspace default. A repository schedule can override it. Empty clears the setting."
      >
        <Input
          value={driftWebhookUrl}
          placeholder="https://hooks.slack.com/services/..."
          onChange={(event) => setDriftWebhookUrl(event.target.value)}
        />
      </Field>
      <Field
        label="Drift webhook secret"
        hint={
          driftWebhookSecretSet
            ? "Stored. Leave blank to keep it; typing replaces it."
            : "Optional; sent as x-edgespec-secret."
        }
      >
        <Input
          type="password"
          value={driftWebhookSecret}
          placeholder={driftWebhookSecretSet ? "Stored" : "Optional shared secret"}
          onChange={(event) => setDriftWebhookSecret(event.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
        <SaveState saved={saved} />
      </div>
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

function MemoryBlock({ repo }: { repo: string }) {
  const [enabled, setEnabled] = useState(true);
  const [naming, setNaming] = useState("");
  const [conventions, setConventions] = useState("");
  const [helpers, setHelpers] = useState("");
  const [fixtures, setFixtures] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMemory(repo)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setNaming(result.memory.naming ?? "");
        setConventions(linesText(result.memory.conventions));
        setHelpers(linesText(result.memory.helpers));
        setFixtures(linesText(result.memory.fixtures));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const fill = (memory: RepoMemory) => {
    setNaming(memory.naming ?? "");
    setConventions(linesText(memory.conventions));
    setHelpers(linesText(memory.helpers));
    setFixtures(linesText(memory.fixtures));
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updateMemory(repo, {
        ...(naming.trim() ? { naming: naming.trim() } : {}),
        ...(linesOf(conventions).length > 0 ? { conventions: linesOf(conventions) } : {}),
        ...(linesOf(helpers).length > 0 ? { helpers: linesOf(helpers) } : {}),
        ...(linesOf(fixtures).length > 0 ? { fixtures: linesOf(fixtures) } : {}),
      });
      fill(result.memory);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(`Delete the stored memory for ${repo}?`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteMemory(repo);
      fill({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!enabled) return <HistoryNotice />;

  return (
    <div className="space-y-2.5">
      <SubHead icon={MemoryStick} title="Repository memory" hint={repo} />
      <Field label="Naming" hint="Short and approved; never source code.">
        <Input value={naming} onChange={(event) => setNaming(event.target.value)} />
      </Field>
      <Field label="Conventions" hint="One per line. Injected into every generation.">
        <Textarea
          rows={2}
          value={conventions}
          onChange={(event) => setConventions(event.target.value)}
        />
      </Field>
      <Field label="Existing helpers" hint="One per line; imports the model may reuse.">
        <Textarea rows={2} value={helpers} onChange={(event) => setHelpers(event.target.value)} />
      </Field>
      <Field label="Existing fixtures" hint="One per line; paths or names already present.">
        <Textarea rows={2} value={fixtures} onChange={(event) => setFixtures(event.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
        <Hint label="Delete stored memory">
          <Button
            size="icon"
            variant="outline"
            onClick={clear}
            disabled={busy}
            aria-label="Delete stored memory"
          >
            <Trash2 className="size-3.5 text-rose-300" />
          </Button>
        </Hint>
        <SaveState saved={saved} />
      </div>
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

function PolicyBlock({ repo }: { repo: string }) {
  const [enabled, setEnabled] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [draftOnly, setDraftOnly] = useState(false);
  const [maxFiles, setMaxFiles] = useState(0);
  const [minCoverageDelta, setMinCoverageDelta] = useState(0);
  const [allowedPaths, setAllowedPaths] = useState("");
  const [labels, setLabels] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const fill = (policy: PullPolicy) => {
    setKillSwitch(policy.killSwitch === true);
    setDraftOnly(policy.draftOnly === true);
    setMaxFiles(policy.maxFiles ?? 0);
    setMinCoverageDelta(policy.minCoverageDelta ?? 0);
    setAllowedPaths(linesText(policy.allowedPaths));
    setLabels(linesText(policy.labels));
    setReviewers(linesText(policy.reviewers));
  };

  useEffect(() => {
    let cancelled = false;
    fetchPolicy(repo)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        fill(result.policy);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await updatePolicy(repo, {
        ...(killSwitch ? { killSwitch: true } : {}),
        ...(draftOnly ? { draftOnly: true } : {}),
        ...(maxFiles > 0 ? { maxFiles } : {}),
        ...(minCoverageDelta > 0 ? { minCoverageDelta } : {}),
        ...(linesOf(allowedPaths).length > 0 ? { allowedPaths: linesOf(allowedPaths) } : {}),
        ...(linesOf(labels).length > 0 ? { labels: linesOf(labels) } : {}),
        ...(linesOf(reviewers).length > 0 ? { reviewers: linesOf(reviewers) } : {}),
      });
      fill(result.policy);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(`Delete the stored pull request policy for ${repo}?`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await deletePolicy(repo);
      fill({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!enabled) return <HistoryNotice />;

  return (
    <div className="space-y-2.5">
      <SubHead icon={ShieldCheck} title="Pull request policy" hint={repo} />
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-[10px] text-zinc-300">
          <Switch
            checked={killSwitch}
            onCheckedChange={setKillSwitch}
            size="sm"
            aria-label="Kill switch"
          />
          Kill switch
        </label>
        <label className="flex items-center gap-2 text-[10px] text-zinc-300">
          <Switch
            checked={draftOnly}
            onCheckedChange={setDraftOnly}
            size="sm"
            aria-label="Draft only"
          />
          Draft only
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Max files" hint="0 = no gate.">
          <Input
            type="number"
            min={0}
            max={100}
            value={maxFiles}
            onChange={(event) => setMaxFiles(Number(event.target.value))}
          />
        </Field>
        <Field label="Coverage delta" hint="0 = no gate.">
          <Input
            type="number"
            min={0}
            value={minCoverageDelta}
            onChange={(event) => setMinCoverageDelta(Number(event.target.value))}
          />
        </Field>
      </div>
      <Field label="Extra allowed paths" hint="One glob per line.">
        <Textarea
          rows={2}
          value={allowedPaths}
          onChange={(event) => setAllowedPaths(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Labels" hint="One per line.">
          <Textarea rows={2} value={labels} onChange={(event) => setLabels(event.target.value)} />
        </Field>
        <Field label="Reviewers" hint="One GitHub login per line.">
          <Textarea
            rows={2}
            value={reviewers}
            onChange={(event) => setReviewers(event.target.value)}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
        <Hint label="Delete stored policy">
          <Button
            size="icon"
            variant="outline"
            onClick={clear}
            disabled={busy}
            aria-label="Delete stored policy"
          >
            <Trash2 className="size-3.5 text-rose-300" />
          </Button>
        </Hint>
        <SaveState saved={saved} />
      </div>
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

function SchedulesBlock({ repo }: { repo: string }) {
  const [schedules, setSchedules] = useState<ScheduledRepo[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [intervalDays, setIntervalDays] = useState(7);
  const [scheduleOn, setScheduleOn] = useState(true);
  const [overrideWebhook, setOverrideWebhook] = useState(false);
  const [driftWebhookUrl, setDriftWebhookUrl] = useState("");
  const [driftWebhookSecret, setDriftWebhookSecret] = useState("");
  const [driftWebhookSecretSet, setDriftWebhookSecretSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSchedules()
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setSchedules(result.schedules);
        const mine = result.schedules.find((entry) => entry.repo === repo);
        if (mine) {
          setIntervalDays(mine.intervalDays);
          setScheduleOn(mine.enabled);
          setOverrideWebhook(Boolean(mine.driftWebhookUrl));
          setDriftWebhookUrl(mine.driftWebhookUrl ?? "");
          setDriftWebhookSecretSet(Boolean(mine.driftWebhookSecretSet));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    if (overrideWebhook && !driftWebhookUrl.trim()) {
      setError("Enter a webhook URL or disable the repository override.");
      return;
    }
    try {
      const result = await updateSchedule({
        repo,
        intervalDays,
        enabled: scheduleOn,
        driftWebhookUrl: overrideWebhook ? driftWebhookUrl : "",
        ...(overrideWebhook && driftWebhookSecret.trim() ? { driftWebhookSecret } : {}),
      });
      setSchedules(result.schedules);
      const saved = result.schedules.find((entry) => entry.repo === repo);
      setOverrideWebhook(Boolean(saved?.driftWebhookUrl));
      setDriftWebhookUrl(saved?.driftWebhookUrl ?? "");
      setDriftWebhookSecret("");
      setDriftWebhookSecretSet(Boolean(saved?.driftWebhookSecretSet));
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    if (!window.confirm(`Remove the scheduled drift scan for ${target}?`)) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteSchedule(target);
      setSchedules((current) => current.filter((entry) => entry.repo !== target));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!enabled) return <HistoryNotice />;

  return (
    <div className="space-y-2.5">
      <SubHead icon={CalendarClock} title="Drift scans" hint={repo} />
      <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-300">{repo}</span>
          <Switch
            size="sm"
            className="ml-auto"
            checked={scheduleOn}
            onCheckedChange={setScheduleOn}
            aria-label="Enable the scheduled drift scan"
          />
        </div>
        <div className="mt-2">
          <Field label="Every (days)" hint="1–30.">
            <Input
              type="number"
              min={1}
              max={30}
              value={intervalDays}
              onChange={(event) => setIntervalDays(Number(event.target.value))}
            />
          </Field>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-zinc-400">Override workspace webhook</span>
          <Switch
            size="sm"
            className="ml-auto"
            checked={overrideWebhook}
            onCheckedChange={setOverrideWebhook}
            aria-label="Override the workspace drift webhook for this repository"
          />
        </div>
        {overrideWebhook && (
          <div className="mt-2 space-y-2">
            <Field label="Repository webhook URL" hint="Used before the workspace and environment.">
              <Input
                value={driftWebhookUrl}
                placeholder="https://hooks.slack.com/services/..."
                onChange={(event) => setDriftWebhookUrl(event.target.value)}
              />
            </Field>
            <Field
              label="Repository webhook secret"
              hint={
                driftWebhookSecretSet
                  ? "Stored. Leave blank to keep it; typing replaces it."
                  : "Optional; sent as x-edgespec-secret."
              }
            >
              <Input
                type="password"
                value={driftWebhookSecret}
                placeholder={driftWebhookSecretSet ? "Stored" : "Optional shared secret"}
                onChange={(event) => setDriftWebhookSecret(event.target.value)}
              />
            </Field>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
          <SaveState saved={saved} />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
          The daily cron posts one summary when untested paths or operations change. It never opens
          a pull request.
        </p>
      </div>
      {schedules.length > 0 && (
        <div className="space-y-1">
          {schedules.map((entry) => (
            <div
              key={entry.repo}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2.5 py-1.5",
                entry.repo === repo
                  ? "border-indigo-500/40 bg-indigo-500/10"
                  : "border-zinc-800/70 bg-zinc-900/40",
              )}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">
                {entry.repo}
              </span>
              <Badge variant={entry.enabled ? "success" : "neutral"}>
                {entry.enabled ? "on" : "paused"}
              </Badge>
              <span className="text-[9px] text-zinc-500">{entry.intervalDays}d</span>
              <Hint label="Remove this schedule">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove schedule for ${entry.repo}`}
                  onClick={() => remove(entry.repo)}
                  disabled={busy}
                >
                  <Trash2 className="size-3.5 text-rose-300" />
                </Button>
              </Hint>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
}

/** The Settings → Deployment body: server-side configuration only. */
export function DeploymentSettings({ repo }: { repo: string }) {
  return (
    <div className="space-y-3">
      <EmailBlock />
      <Divider />
      <WorkspaceBlock />
      <Divider />
      {repo ? (
        <>
          <MemoryBlock repo={repo} />
          <Divider />
          <PolicyBlock repo={repo} />
          <Divider />
          <SchedulesBlock repo={repo} />
        </>
      ) : (
        <Notice>Select a repository to edit its memory, policy and drift scan.</Notice>
      )}
    </div>
  );
}

/** Settings → Deployment → Email: the Resend sender for transactional email. */
function EmailBlock() {
  const settings = useSettings();
  const secrets = useSecrets();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          Email API key (Resend)
        </span>
        <Input
          type="password"
          value={secrets.emailKey}
          onChange={(event) => setSecrets({ emailKey: event.target.value })}
          placeholder="re_… (sent per request, never stored server-side)"
        />
        <span className="text-[10px] text-zinc-500">
          Sender identity for verification and reset links.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">From address</span>
        <Input
          value={settings.emailFrom}
          onChange={(event) => setSettings({ emailFrom: event.target.value })}
          placeholder="EdgeSpec <noreply@you.example>"
        />
      </label>
    </div>
  );
}

type AuditTone = {
  icon: typeof Activity;
  dot: string;
  badge: "success" | "danger" | "accent" | "warning" | "neutral";
};

const AUDIT_TONE: Record<string, AuditTone> = {
  pr_opened: { icon: GitPullRequest, dot: "bg-emerald-400", badge: "success" },
  pr_blocked: { icon: ShieldCheck, dot: "bg-rose-400", badge: "danger" },
  pr_check: { icon: CheckCircle2, dot: "bg-sky-400", badge: "accent" },
  command: { icon: Terminal, dot: "bg-sky-400", badge: "accent" },
  policy_updated: { icon: ShieldCheck, dot: "bg-violet-400", badge: "accent" },
  memory_updated: { icon: MemoryStick, dot: "bg-indigo-400", badge: "accent" },
  schedule_updated: {
    icon: CalendarClock,
    dot: "bg-amber-400",
    badge: "warning",
  },
  schedule_deleted: {
    icon: CalendarClock,
    dot: "bg-amber-400",
    badge: "warning",
  },
  backlog_updated: {
    icon: ListChecks,
    dot: "bg-emerald-400",
    badge: "success",
  },
  workspace_updated: { icon: Database, dot: "bg-indigo-400", badge: "accent" },
  drift_scan: { icon: Activity, dot: "bg-amber-400", badge: "warning" },
  retention_purge: { icon: Trash2, dot: "bg-rose-400", badge: "danger" },
};

const auditTone = (action: string): AuditTone =>
  AUDIT_TONE[action] ?? { icon: Info, dot: "bg-zinc-500", badge: "neutral" };

const dayKeyOf = (value: number): string => new Date(value).toDateString();

const dayLabelOf = (key: string): string =>
  key === new Date().toDateString()
    ? "Today"
    : new Date(key).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

const timeOf = (value: number): string =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

const detailOf = (detail: Record<string, unknown>): string =>
  Object.entries(detail)
    .map(([key, value]) => {
      const text =
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? value.join(", ")
            : value !== null && typeof value === "object"
              ? JSON.stringify(value)
              : String(value);
      return `${key}: ${text}`;
    })
    .join(" · ");

/** Deployment-wide log, opened from the profile menu. */
export function AuditDialog({
  open,
  onClose,
  repo,
}: {
  open: boolean;
  onClose: () => void;
  repo: string;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [scope, setScope] = useState<"repo" | "all">(repo ? "repo" : "all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchAudit(scope === "repo" && repo ? repo : undefined)
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled);
        setEvents(result.events);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repo, scope]);

  const groups = events.reduce<Record<string, AuditEvent[]>>((result, event) => {
    const key = dayKeyOf(event.createdAt);
    (result[key] ??= []).push(event);
    return result;
  }, {});

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Audit log"
      description="Newest first. Token, key, secret, password, authorization and cookie fields are dropped before storage."
      className="max-w-3xl"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={scope} onValueChange={(value) => setScope(value as "repo" | "all")}>
          <SelectTrigger className="h-8 w-60 text-[11px]" aria-label="Audit scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="repo" disabled={!repo}>
              This repository{repo ? ` · ${repo}` : ""}
            </SelectItem>
            <SelectItem value="all">Every repository</SelectItem>
          </SelectContent>
        </Select>
        {loading && <Loader2 className="size-3.5 animate-spin text-zinc-500" />}
        <span className="ml-auto text-[10px] text-zinc-500">{events.length} events</span>
      </div>
      {!enabled ? (
        <div className="flex h-[min(26rem,50vh)] items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 px-3 text-center text-[11px] text-zinc-500">
          <HistoryNotice />
        </div>
      ) : (
        <div
          className={cn(
            "no-scrollbar h-[min(26rem,50vh)] overflow-y-auto pr-1 transition-opacity",
            loading && "opacity-60",
          )}
        >
          {loading && events.length === 0 ? (
            <p className="flex h-full items-center justify-center gap-2 text-[11px] text-zinc-500">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </p>
          ) : events.length === 0 ? (
            <p className="flex h-full items-center justify-center px-3 text-center text-[11px] text-zinc-500">
              No audit events yet. Workspace, memory, policy and schedule updates write here.
            </p>
          ) : (
            Object.entries(groups).map(([day, list]) => (
              <div key={day} className="mb-3 last:mb-0">
                <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                  {dayLabelOf(day)}
                </p>
                <div className="relative ml-1.5 space-y-1.5 border-l border-zinc-800 pl-3">
                  {list.map((event, index) => {
                    const tone = auditTone(event.action);
                    const Icon = tone.icon;
                    const detail = detailOf(event.detail);
                    return (
                      <div key={event.id ?? `${event.createdAt}-${index}`} className="relative">
                        <span
                          className={cn(
                            "absolute top-2.5 -left-[19px] size-2 rounded-full ring-2 ring-zinc-900",
                            tone.dot,
                          )}
                        />
                        <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                              <Icon className="size-3.5 text-zinc-400" />
                              {event.action.replace(/_/g, " ")}
                            </span>
                            <Badge variant={tone.badge}>{event.actor}</Badge>
                            {event.repo && (
                              <span className="font-mono text-[10px] text-zinc-400">
                                {event.repo}
                              </span>
                            )}
                            <span className="ml-auto text-[10px] text-zinc-500">
                              {timeOf(event.createdAt)}
                            </span>
                          </div>
                          {detail && (
                            <p
                              className="mt-1 line-clamp-2 text-[10px] text-zinc-500"
                              title={detail}
                            >
                              {detail}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {error && <p className="mt-3 text-[11px] text-rose-300">{error}</p>}
    </Dialog>
  );
}
