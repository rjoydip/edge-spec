/** Editable settings bound to the real stores. Keys stay in localStorage and travel as headers. */
import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  Boxes,
  CheckCircle2,
  Gauge,
  KeyRound,
  Loader2,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { PROVIDERS, providerById } from "@edge-spec/core/catalog";
import { sandboxProvidersFor } from "@edge-spec/core/sandbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
  cn,
} from "@edge-spec/ui";
import { checkSandbox } from "@/api";
import { isLocalDashboard } from "@/lib/env";
import {
  DEFAULT_SETTINGS,
  clearSecrets,
  setSecrets,
  setSettings,
  useSecrets,
  useSettings,
} from "@/lib/settings";
import { ACCENTS, setAccent, toggleMode, useAppearance } from "@/lib/theme";

export type SettingsSection =
  "provider" | "sandbox" | "keys" | "pipeline" | "policy" | "appearance";

const SECTION_TONE: Record<string, string> = {
  provider: "text-violet-300",
  sandbox: "text-sky-300",
  keys: "text-amber-300",
  pipeline: "text-indigo-300",
  policy: "text-rose-300",
  appearance: "text-fuchsia-300",
};

export function SettingsSheet({
  open,
  onOpenChange,
  section,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section?: SettingsSection;
}) {
  const settings = useSettings();
  const secrets = useSecrets();
  const appearance = useAppearance();
  const [openSections, setOpenSections] = useState<string[]>(["provider", "sandbox"]);
  const [health, setHealth] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [healthText, setHealthText] = useState("");

  useEffect(() => {
    if (!open || !section) return;
    setOpenSections((current) => (current.includes(section) ? current : [...current, section]));
    const timer = window.setTimeout(() => {
      document
        .getElementById(`settings-${section}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, section]);

  const provider = providerById(settings.provider);
  const needsKey = provider?.needsKey ?? false;
  const sandboxProviders = sandboxProvidersFor(isLocalDashboard() ? "local" : "deployed");
  const update = (patch: Parameters<typeof setSettings>[0]) => setSettings(patch);
  const setPolicy = (patch: Partial<typeof settings.policy>) =>
    update({ policy: { ...settings.policy, ...patch } });
  const updateSecrets = (patch: Parameters<typeof setSecrets>[0]) => setSecrets(patch);

  const checkHealth = async () => {
    if (!settings.sandboxUrl.trim()) {
      setHealth("error");
      setHealthText("Add a runner URL first.");
      return;
    }
    setHealth("checking");
    try {
      const result = await checkSandbox(settings.sandboxUrl, secrets.sandboxKey);
      if (result.ok) {
        setHealth("ok");
        setHealthText(
          [result.provider, result.version, result.isolation].filter(Boolean).join(" · ") ||
            "Runner answered.",
        );
      } else {
        setHealth("error");
        setHealthText(result.error ?? "The runner did not answer.");
      }
    } catch (error) {
      setHealth("error");
      setHealthText(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-lg">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Stored in this browser. Keys travel as request headers and never enter the Worker.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-3">
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="space-y-2"
          >
            <Section
              id="provider"
              icon={Bot}
              title="AI provider"
              summary={provider?.name ?? settings.provider}
            >
              <Field label="Provider" hint="Controls the protocol, the key and the model.">
                <Select
                  value={settings.provider}
                  onValueChange={(next) => {
                    const nextProvider = PROVIDERS.find((item) => item.id === next);
                    update({
                      provider: next,
                      model: nextProvider?.models[0]?.id ?? settings.model,
                    });
                  }}
                >
                  <SelectTrigger aria-label="AI provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Model" hint={provider?.hint ?? "Pick the model that writes the tests."}>
                {provider?.custom ? (
                  <Input
                    value={settings.model}
                    onChange={(event) => update({ model: event.target.value })}
                    placeholder="model name"
                    className="font-mono"
                  />
                ) : (
                  <Select
                    value={settings.model}
                    onValueChange={(model) => update({ model })}
                    disabled={!provider}
                  >
                    <SelectTrigger aria-label="AI model">
                      <SelectValue placeholder="Choose a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {(provider?.models ?? []).map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              {provider?.custom && (
                <Field label="Base URL" hint="OpenAI-compatible endpoint. Required for custom.">
                  <Input
                    value={settings.baseUrl}
                    onChange={(event) => update({ baseUrl: event.target.value })}
                    placeholder="http://localhost:11434/v1"
                    className="font-mono"
                  />
                </Field>
              )}
              {provider?.id === "workers-ai" && (
                <Field label="Cloudflare account ID" hint="Optional, for Workers AI BYOK.">
                  <Input
                    value={settings.accountId}
                    onChange={(event) => update({ accountId: event.target.value })}
                    placeholder="32-character account id"
                    className="font-mono"
                  />
                </Field>
              )}
              <Alert variant={needsKey && !secrets.aiKey ? "warning" : "success"}>
                {needsKey && !secrets.aiKey ? <KeyRound /> : <CheckCircle2 />}
                <div>
                  <AlertTitle>
                    {needsKey ? "A key is needed for this provider" : "Ready"}
                  </AlertTitle>
                  <AlertDescription>
                    {needsKey
                      ? "Add it under Keys. It travels as x-ai-key."
                      : "Workers AI uses the deployment binding, so no key is required."}
                  </AlertDescription>
                </div>
              </Alert>
            </Section>

            <Section
              id="sandbox"
              icon={Boxes}
              title="Sandbox"
              summary={`${settings.sandboxProvider} · ${settings.sandboxConcurrency} in flight`}
            >
              <Field
                label="Runner driver"
                hint="Verified runs need a runner. Without one, only static checks run."
              >
                <Select
                  value={settings.sandboxProvider}
                  onValueChange={(value) =>
                    update({ sandboxProvider: value as typeof settings.sandboxProvider })
                  }
                >
                  <SelectTrigger aria-label="Runner driver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sandboxProviders.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Runner URL" hint="The self-hosted runner or a hosted driver endpoint.">
                <Input
                  value={settings.sandboxUrl}
                  onChange={(event) => update({ sandboxUrl: event.target.value })}
                  placeholder="http://127.0.0.1:8788"
                  className="font-mono"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Concurrency" hint="Runs in flight, 1–6.">
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={settings.sandboxConcurrency}
                    onChange={(event) =>
                      update({ sandboxConcurrency: Number(event.target.value) || 1 })
                    }
                  />
                </Field>
                <Field label="Timeout (s)" hint="Per suite.">
                  <Input
                    type="number"
                    min={30}
                    step={30}
                    value={Math.round(settings.sandboxTimeoutMs / 1000)}
                    onChange={(event) =>
                      update({ sandboxTimeoutMs: (Number(event.target.value) || 30) * 1000 })
                    }
                  />
                </Field>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <span>
                  <span className="block text-[11px] font-medium text-zinc-300">
                    Ask for coverage
                  </span>
                  <span className="block text-[10px] text-zinc-500">
                    LCOV in the run, which turns coverage gaps into measurements.
                  </span>
                </span>
                <Switch
                  checked={settings.sandboxCoverage}
                  onCheckedChange={(sandboxCoverage) => update({ sandboxCoverage })}
                  size="sm"
                  aria-label="Ask for coverage"
                />
              </label>
              <Field label="Setup commands" hint="One per line, before the tests.">
                <Textarea
                  rows={2}
                  value={settings.sandboxSetup}
                  onChange={(event) => update({ sandboxSetup: event.target.value })}
                  placeholder="bun install --frozen-lockfile"
                  className="font-mono text-[10px]"
                />
              </Field>
              <Field label="Environment" hint="KEY=VALUE, one per line. Sent to the runner only.">
                <Textarea
                  rows={2}
                  value={settings.sandboxEnv}
                  onChange={(event) => update({ sandboxEnv: event.target.value })}
                  placeholder="DATABASE_URL=postgres://…"
                  className="font-mono text-[10px]"
                />
              </Field>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="App command" hint="Optional; for live API tests.">
                  <Input
                    value={settings.sandboxServerCommand}
                    onChange={(event) => update({ sandboxServerCommand: event.target.value })}
                    placeholder="bun run dev"
                    className="font-mono"
                  />
                </Field>
                <Field label="App ready URL" hint="Polled before the suite runs.">
                  <Input
                    value={settings.sandboxReadyUrl}
                    onChange={(event) => update({ sandboxReadyUrl: event.target.value })}
                    placeholder="http://127.0.0.1:3000/health"
                    className="font-mono"
                  />
                </Field>
              </div>
              <Field label="Working directory" hint="Relative path inside the repository.">
                <Input
                  value={settings.sandboxCwd}
                  onChange={(event) => update({ sandboxCwd: event.target.value })}
                  placeholder="packages/api"
                  className="font-mono"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkHealth}
                  disabled={health === "checking"}
                >
                  {health === "checking" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-3.5" />
                  )}
                  Check health
                </Button>
                {health === "ok" && (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="size-3" />
                    {healthText}
                  </Badge>
                )}
                {health === "error" && (
                  <Badge variant="danger" className="max-w-56 truncate">
                    {healthText}
                  </Badge>
                )}
                {health === "idle" && (
                  <span className="text-[10px] text-zinc-500">unchecked in this tab</span>
                )}
              </div>
            </Section>

            <Section
              id="keys"
              icon={KeyRound}
              title="Keys"
              summary={
                secrets.githubToken || secrets.aiKey || secrets.sandboxKey
                  ? "set for this browser"
                  : "none set"
              }
            >
              <Field
                label="GitHub token"
                hint="Needed for private repos and opening pull requests."
              >
                <Input
                  type="password"
                  value={secrets.githubToken}
                  onChange={(event) => updateSecrets({ githubToken: event.target.value })}
                  placeholder="ghp_…"
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field label="AI key" hint={`Used by ${provider?.name ?? "the provider"}.`}>
                <Input
                  type="password"
                  value={secrets.aiKey}
                  onChange={(event) => updateSecrets({ aiKey: event.target.value })}
                  placeholder={needsKey ? "sk-…" : "not needed for Workers AI"}
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field label="Sandbox key" hint="Optional; only for a protected runner.">
                <Input
                  type="password"
                  value={secrets.sandboxKey}
                  onChange={(event) => updateSecrets({ sandboxKey: event.target.value })}
                  placeholder="runner key"
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Alert variant="info">
                <ShieldCheck />
                <div>
                  <AlertTitle>Headers, never storage</AlertTitle>
                  <AlertDescription>
                    x-github-token, x-ai-key and x-sandbox-key travel per request. The deployment
                    keeps none of them.
                  </AlertDescription>
                </div>
              </Alert>
            </Section>

            <Section
              id="pipeline"
              icon={Gauge}
              title="Pipeline"
              summary={`${settings.maxFiles} files · ${settings.maxRetries} retries · strict ${settings.strictTypes ? "on" : "off"}`}
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Max files" hint="Per run.">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.maxFiles}
                    onChange={(event) => update({ maxFiles: Number(event.target.value) || 1 })}
                  />
                </Field>
                <Field label="Generation concurrency" hint="Files in flight, 1–6.">
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={settings.concurrency}
                    onChange={(event) => update({ concurrency: Number(event.target.value) || 1 })}
                  />
                </Field>
                <Field label="Validation retries" hint="Per failing file.">
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={settings.maxRetries}
                    onChange={(event) => update({ maxRetries: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field label="AI retries" hint="Provider errors.">
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={settings.maxAiRetries}
                    onChange={(event) => update({ maxAiRetries: Number(event.target.value) || 0 })}
                  />
                </Field>
                <Field label="Flaky repeats" hint="Extra runs after a pass; 0 = off.">
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={settings.flakyRuns}
                    onChange={(event) =>
                      update({
                        flakyRuns: Math.min(5, Math.max(0, Number(event.target.value) || 0)),
                      })
                    }
                  />
                </Field>
                <Field label="Token budget" hint="Provider-reported tokens per run; 0 = no cap.">
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    value={settings.maxTokens}
                    onChange={(event) =>
                      update({ maxTokens: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </Field>
                <Field label="Coverage target (%)" hint="Used for coverage gaps.">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={settings.coverageTarget}
                    onChange={(event) =>
                      update({ coverageTarget: Number(event.target.value) || 0 })
                    }
                  />
                </Field>
                <Field
                  label="Mutation command"
                  hint="Stryker-compatible; {file}/{test} optional. Empty = not measured."
                >
                  <Input
                    value={settings.mutationCommand}
                    onChange={(event) =>
                      update({ mutationCommand: event.target.value.slice(0, 500) })
                    }
                    placeholder="npx stryker run --mutate {file}"
                  />
                </Field>
                <Field label="Verification" hint="Runner or static only.">
                  <Badge
                    variant={settings.sandboxUrl.trim() ? "success" : "warning"}
                    className="mt-1.5 h-6 gap-1"
                  >
                    <ShieldCheck className="size-3" />
                    {settings.sandboxUrl.trim() ? "runner" : "static only"}
                  </Badge>
                </Field>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <span>
                  <span className="block text-[11px] font-medium text-zinc-300">
                    Parallel test generation
                  </span>
                  <span className="block text-[10px] text-zinc-500">
                    Write several files at once instead of one after another.
                  </span>
                </span>
                <Switch
                  checked={settings.parallelGeneration}
                  onCheckedChange={(parallelGeneration) => update({ parallelGeneration })}
                  size="sm"
                  aria-label="Parallel test generation"
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <span>
                  <span className="block text-[11px] font-medium text-zinc-300">
                    Strict TypeScript
                  </span>
                  <span className="block text-[10px] text-zinc-500">
                    Type errors fail the generated test before it leaves.
                  </span>
                </span>
                <Switch
                  checked={settings.strictTypes}
                  onCheckedChange={(strictTypes) => update({ strictTypes })}
                  size="sm"
                  aria-label="Strict TypeScript"
                />
              </label>
            </Section>

            <Section
              id="policy"
              icon={ShieldCheck}
              title="Policy"
              summary={`${
                settings.policy.killSwitch
                  ? "kill switch on"
                  : settings.policy.draftOnly
                    ? "draft only"
                    : "advisory"
              } · ${settings.policy.maxFiles ? `${settings.policy.maxFiles} files` : "no file cap"}`}
            >
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.035] px-3 py-2">
                  <span>
                    <span className="block text-[11px] font-medium text-rose-200">Kill switch</span>
                    <span className="block text-[10px] text-zinc-500">
                      Blocks every pull request until this is turned off.
                    </span>
                  </span>
                  <Switch
                    checked={settings.policy.killSwitch === true}
                    onCheckedChange={(killSwitch) => setPolicy({ killSwitch })}
                    size="sm"
                    aria-label="Kill switch"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                  <span>
                    <span className="block text-[11px] font-medium text-zinc-300">Draft only</span>
                    <span className="block text-[10px] text-zinc-500">
                      Requires a draft pull request for human approval.
                    </span>
                  </span>
                  <Switch
                    checked={settings.policy.draftOnly === true}
                    onCheckedChange={(draftOnly) => setPolicy({ draftOnly })}
                    size="sm"
                    aria-label="Draft only"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Max files" hint="0 = no gate.">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={settings.policy.maxFiles ?? 0}
                      onChange={(event) =>
                        setPolicy({ maxFiles: Math.max(0, Number(event.target.value) || 0) })
                      }
                    />
                  </Field>
                  <Field label="Min coverage delta" hint="Covered lines; 0 = no gate.">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={settings.policy.minCoverageDelta ?? 0}
                      onChange={(event) =>
                        setPolicy({
                          minCoverageDelta: Math.max(0, Number(event.target.value) || 0),
                        })
                      }
                    />
                  </Field>
                </div>
                <Field
                  label="Allowed test paths"
                  hint="One glob per line (tests/**, src/*.test.ts). Empty allows all test paths."
                >
                  <Textarea
                    rows={3}
                    value={(settings.policy.allowedPaths ?? []).join("\n")}
                    onChange={(event) =>
                      setPolicy({
                        allowedPaths: event.target.value
                          .split(/[\n,]+/)
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={"tests/**\npackages/**/__tests__/**"}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Labels" hint="Comma-separated, applied after opening.">
                    <Input
                      value={(settings.policy.labels ?? []).join(", ")}
                      onChange={(event) =>
                        setPolicy({
                          labels: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="tests, edge-spec"
                    />
                  </Field>
                  <Field label="Reviewers" hint="Comma-separated GitHub logins.">
                    <Input
                      value={(settings.policy.reviewers ?? []).join(", ")}
                      onChange={(event) =>
                        setPolicy({
                          reviewers: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="octocat"
                    />
                  </Field>
                </div>
                <p className="text-[10px] text-zinc-500">
                  Gates run in the Worker before any branch is created. The pull request dialog
                  shows which gate blocked it.
                </p>
              </div>
            </Section>

            <Section
              id="appearance"
              icon={Sparkles}
              title="Appearance"
              summary={`${appearance.mode} · ${ACCENTS.find((item) => item.id === appearance.accentId)?.name ?? "accent"}`}
            >
              <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                    Accent
                  </span>
                  <span className="block text-[10px] leading-snug text-zinc-500">
                    Recolours the primary action, focus rings and the aurora.
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      type="button"
                      onClick={() => setAccent(accent.base)}
                      title={accent.name}
                      aria-label={accent.name}
                      style={{ background: accent.base }}
                      className={cn(
                        "size-5 rounded-full ring-2 ring-offset-2 ring-offset-zinc-950 transition hover:scale-110",
                        appearance.accentId === accent.id ? "ring-white/80" : "ring-transparent",
                      )}
                    />
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={toggleMode}>
                {appearance.mode === "dark" ? <Sun /> : <Moon />}
                {appearance.mode === "dark" ? "Light" : "Dark"} mode
              </Button>
            </Section>
          </Accordion>

          <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-3 py-2">
            <span className="text-[10px] text-zinc-500">
              Reset the settings and clear the keys in this browser.
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSettings(DEFAULT_SETTINGS);
                clearSecrets();
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  summary,
  children,
}: {
  id: string;
  icon: typeof Bot;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      id={`settings-${id}`}
      value={id}
      className="scroll-mt-2 overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-3"
    >
      <AccordionTrigger className="hover:no-underline">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className={cn("size-3.5 shrink-0", SECTION_TONE[id] ?? "text-zinc-500")} />
          <span className="text-[11px] font-semibold text-zinc-200">{title}</span>
          <span className="ml-2 truncate font-mono text-[9px] text-zinc-500">{summary}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-2.5">{children}</AccordionContent>
    </AccordionItem>
  );
}

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
