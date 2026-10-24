import { useState, type ReactNode } from "react";
import { AlertCircle, Check, KeyRound, Moon, Sun } from "lucide-react";
import { PROVIDERS, providerById } from "@edge-spec/core/catalog";
import { sandboxProvidersFor, type SandboxProviderId } from "@edge-spec/core/sandbox";
import {
  Badge,
  Button,
  Dialog,
  Input,
  ProviderIcon,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
  cn,
} from "@edge-spec/ui";
import { isLocalDashboard, isLocalHost } from "@/lib/env";
import { checkSandbox } from "@/api";
import {
  clearSecrets,
  sandboxConfigOf,
  setSecrets,
  setSettings,
  type Secrets,
  type Settings,
} from "@/lib/settings";
import { ACCENTS, setAccent, setMode, useAppearance } from "@/lib/theme";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  secrets: Secrets;
  /** The section to scroll to when the dialog opens. */
  section?: SettingsSection;
}

/** The sections the dialog can be asked to jump to. */
export type SettingsSection = "github" | "runner" | "provider" | "pipeline" | "appearance";

function Section({
  title,
  hint,
  id,
  children,
}: {
  title: string;
  hint?: string;
  id: SettingsSection;
  children: ReactNode;
}) {
  return (
    <section
      id={`settings-${id}`}
      className="scroll-mt-4 space-y-3 border-b border-zinc-800 py-5 first:pt-0 last:border-0 last:pb-0"
    >
      <div>
        <h3 className="text-xs font-semibold text-zinc-200">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-zinc-200">{label}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function SettingsDialog({ open, onClose, settings, secrets, section }: SettingsDialogProps) {
  const { mode, accentId } = useAppearance();
  const [draft, setDraft] = useState<Settings>(settings);
  const [keys, setKeys] = useState<Secrets>(secrets);
  const [wasOpen, setWasOpen] = useState(false);
  const [probe, setProbe] = useState<{
    busy?: boolean;
    ok?: boolean;
    message?: string;
    capabilities?: string[];
  }>({});

  // Re-seed the drafts exactly when the dialog opens.
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(settings);
    setKeys(secrets);
    setProbe({});
    // Jump to the section the reader asked for. The dialog content mounts in
    // a portal, so the scroll waits for the second frame.
    if (section) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          document
            .getElementById(`settings-${section}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }),
      );
    }
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const provider = providerById(draft.provider);
  const workersAi = provider?.protocol === "workers-ai";
  const workersAiByok = Boolean(workersAi && keys.aiKey.trim() && draft.accountId.trim());
  // The deployment's own Workers AI binding is a local development convenience
  // only; a deployed Worker runs on the visitor's own account.
  const localBinding = workersAi && !workersAiByok && isLocalHost();
  const patch = (next: Partial<Settings>) => setDraft((current) => ({ ...current, ...next }));
  // A tested runner tells us what it supports; before a test, show every knob.
  const supports = (capability: string) =>
    !probe.capabilities || probe.capabilities.includes(capability);
  // Local drivers need a runner on this machine; a deployed dashboard hides them.
  const local = isLocalDashboard();
  const sandboxProviders = sandboxProvidersFor(local ? "local" : "deployed");

  const chooseProvider = (id: string) => {
    const next = providerById(id);
    const keepModel = next?.custom && provider?.custom ? draft.model : "";
    patch({
      provider: id,
      model: keepModel || next?.models[0]?.id || "",
    });
  };

  const save = () => {
    setSettings(draft);
    setSecrets(keys);
    onClose();
  };

  const testSandbox = async () => {
    if (!draft.sandboxUrl.trim()) {
      setProbe({ ok: false, message: "Enter a sandbox URL first." });
      return;
    }
    setProbe({ busy: true, message: "Checking…" });
    try {
      const health = await checkSandbox(draft.sandboxUrl, keys.sandboxKey, sandboxConfigOf(draft));
      const detail = [health.provider, health.isolation].filter(Boolean).join(" · ");
      setProbe(
        health.ok
          ? {
              ok: true,
              message: `Runner reachable${health.version ? ` (v${health.version})` : ""}${
                detail ? ` · ${detail}` : ""
              }.`,
              capabilities: health.capabilities,
            }
          : {
              ok: false,
              message: health.error ?? "The runner reported not ok.",
              capabilities: health.capabilities,
            },
      );
    } catch (error) {
      setProbe({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      description="Stored in this browser. Secrets are sent only to this Worker and your chosen provider."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save settings</Button>
        </>
      }
    >
      <Section
        id="github"
        title="GitHub access"
        hint="The repository and branch live in the header. Private repos and pull requests need a token."
      >
        <Field label="GitHub token">
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={keys.githubToken}
              onChange={(event) => setKeys({ ...keys, githubToken: event.target.value })}
              placeholder="ghp_… (needed for private repos and PRs)"
              className="font-mono"
            />
            <Button variant="outline" onClick={() => setKeys({ ...keys, githubToken: "" })}>
              Clear
            </Button>
          </div>
        </Field>
      </Section>

      <Section
        id="runner"
        title="Sandbox"
        hint="A sandbox executes the generated suite, so the result is a real pass or fail instead of a static check. Without one, EdgeSpec can only check the test statically."
      >
        <Field label="Runner driver">
          <Select
            value={draft.sandboxProvider}
            onValueChange={(value) => patch({ sandboxProvider: value as SandboxProviderId })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sandboxProviders.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            {local
              ? "Docker, Podman and bwrap run the suite on this machine; hosted providers work from anywhere."
              : "Hosted providers and a custom runner only. Docker, Podman and bwrap need the local dev server (bun run dev)."}
          </p>
        </Field>
        <Field label="Sandbox URL">
          <Input
            value={draft.sandboxUrl}
            onChange={(event) => patch({ sandboxUrl: event.target.value })}
            placeholder="https://sandbox.example.com"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field label="Sandbox API key (optional)">
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={keys.sandboxKey}
              onChange={(event) => setKeys({ ...keys, sandboxKey: event.target.value })}
              placeholder="sandbox key"
              className="font-mono"
            />
            <Button variant="outline" onClick={() => setKeys({ ...keys, sandboxKey: "" })}>
              Clear
            </Button>
          </div>
        </Field>
        <Field label="Setup commands (one per line)">
          <Textarea
            value={draft.sandboxSetup}
            onChange={(event) => patch({ sandboxSetup: event.target.value })}
            placeholder={"bun install --frozen-lockfile"}
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field label="Environment (KEY=VALUE, one per line)">
          <Textarea
            value={draft.sandboxEnv}
            onChange={(event) => patch({ sandboxEnv: event.target.value })}
            placeholder={"NODE_ENV=test\nBASE_URL=http://127.0.0.1:3000"}
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        {supports("server") && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="App command (optional)">
              <Input
                value={draft.sandboxServerCommand}
                onChange={(event) => patch({ sandboxServerCommand: event.target.value })}
                placeholder="bun run dev"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Field label="App ready URL (optional)">
              <Input
                value={draft.sandboxReadyUrl}
                onChange={(event) => patch({ sandboxReadyUrl: event.target.value })}
                placeholder="http://127.0.0.1:3000/health"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Timeout (seconds)">
            <Input
              type="number"
              min={10}
              max={600}
              step={10}
              value={Math.round(draft.sandboxTimeoutMs / 1000)}
              onChange={(event) => {
                const seconds = Number(event.target.value);
                if (Number.isFinite(seconds)) {
                  patch({ sandboxTimeoutMs: seconds * 1000 });
                }
              }}
            />
          </Field>
          <Field label="Working directory (optional)">
            <Input
              value={draft.sandboxCwd}
              onChange={(event) => patch({ sandboxCwd: event.target.value })}
              placeholder="packages/api"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-200">Parallel runs</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Runs in flight in the sandbox.</p>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => patch({ sandboxConcurrency: value })}
                aria-pressed={draft.sandboxConcurrency === value}
                className={cn(
                  "size-8 rounded-lg font-mono text-xs font-bold transition",
                  draft.sandboxConcurrency === value
                    ? "bg-indigo-600 text-white"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {supports("coverage") && (
          <Toggle
            checked={draft.sandboxCoverage}
            onChange={(sandboxCoverage) => patch({ sandboxCoverage })}
            label="Ask for coverage"
            hint="Runs the suite with LCOV output. Without a report, coverage stays “not measured”."
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={testSandbox} disabled={probe.busy}>
            {probe.busy ? "Testing…" : "Test connection"}
          </Button>
          {probe.message && (
            <span
              className={cn(
                "flex items-center gap-1.5 text-[11px]",
                probe.ok ? "text-emerald-400" : "text-rose-400",
              )}
            >
              {probe.ok ? <Check className="size-3.5" /> : <AlertCircle className="size-3.5" />}
              {probe.message}
            </span>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          The Worker sends repository content to this URL and the key as a bearer header. Nothing is
          stored server-side. <code className="font-mono text-zinc-400">http://localhost</code> only
          works with a Worker running on your own machine; a deployed Worker must reach an https
          runner.
        </p>
      </Section>

      <Section
        id="provider"
        title="AI provider"
        hint="Workers AI runs on your own Cloudflare account. The deployment binding is only used while developing locally. Other providers use your key; the custom provider accepts one optionally. Nothing is stored on the server."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider">
            <Select value={draft.provider} onValueChange={chooseProvider}>
              <SelectTrigger aria-label="AI provider">
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.filter((option) => !option.custom).map((option) => (
                  <SelectItem key={option.id} value={option.id} textValue={option.name}>
                    <span className="flex items-center gap-2">
                      <ProviderIcon provider={option.id} />
                      {option.name}
                    </span>
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Bring your own</SelectLabel>
                  {PROVIDERS.filter((option) => option.custom).map((option) => (
                    <SelectItem key={option.id} value={option.id} textValue={option.name}>
                      <span className="flex items-center gap-2">
                        <ProviderIcon provider={option.id} />
                        {option.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field label={provider?.custom ? "Model name" : "Model"}>
            {provider?.custom ? (
              <Input
                value={draft.model}
                onChange={(event) => patch({ model: event.target.value })}
                placeholder="qwen2.5-coder"
                spellCheck={false}
                className="font-mono"
              />
            ) : (
              <Select value={draft.model} onValueChange={(model) => patch({ model })}>
                <SelectTrigger aria-label="AI model">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {provider?.models.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.id}
                      textValue={model.name}
                      title={model.note}
                    >
                      <span className="flex flex-col">
                        <span>{model.name}</span>
                        {model.note && (
                          <span className="text-[10px] text-zinc-500">{model.note}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>

        {provider?.custom && (
          <Field label="Base URL">
            <Input
              value={draft.baseUrl}
              onChange={(event) => patch({ baseUrl: event.target.value })}
              placeholder="http://localhost:11434/v1"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        )}

        {workersAi && (
          <Field label="Cloudflare account ID (optional)">
            <Input
              value={draft.accountId}
              onChange={(event) => patch({ accountId: event.target.value })}
              placeholder="32-character account ID, for BYOK"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        )}

        <Field
          label={
            workersAi
              ? localBinding
                ? "Cloudflare API token (optional)"
                : "Cloudflare API token (required with the account ID)"
              : `${provider?.name ?? "Provider"} API key${provider?.custom ? " (optional)" : ""}`
          }
        >
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={keys.aiKey}
              onChange={(event) => setKeys({ ...keys, aiKey: event.target.value })}
              placeholder={
                workersAi
                  ? "Cloudflare API token for BYOK"
                  : provider?.custom
                    ? "sk-… (leave blank for a local server)"
                    : "sk-…"
              }
              className="font-mono"
            />
            <Button variant="outline" onClick={() => setKeys({ ...keys, aiKey: "" })}>
              Clear
            </Button>
          </div>
        </Field>

        {workersAi && (
          <Badge
            variant={workersAiByok ? "accent" : localBinding ? "success" : "warning"}
            className="gap-1"
          >
            {workersAiByok ? (
              <KeyRound className="size-3" />
            ) : localBinding ? (
              <Check className="size-3" />
            ) : (
              <AlertCircle className="size-3" />
            )}
            {workersAiByok
              ? "BYOK: your Cloudflare account"
              : localBinding
                ? "Deployment binding (local only)"
                : "Your Cloudflare account is required"}
          </Badge>
        )}

        {workersAi && !workersAiByok && !localBinding && (
          <p className="text-[11px] leading-relaxed text-amber-400/80">
            A deployed Worker never spends the deployment&apos;s Workers AI binding. Add your
            Cloudflare account ID and API token, or choose another provider.
          </p>
        )}

        {provider?.hint && <p className="text-[11px] text-zinc-500">{provider.hint}</p>}
      </Section>

      <Section
        id="pipeline"
        title="Pipeline"
        hint="Applies to the next run. Server-side bounds still apply."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-200">Coverage target</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Passed to the model as a goal.</p>
          </div>
          <span className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-indigo-300">
            {draft.coverageTarget}%
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={5}
          value={[draft.coverageTarget]}
          onValueChange={([value]) => patch({ coverageTarget: value ?? 0 })}
          aria-label="Coverage target"
        />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-200">Self-correction retries</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Extra attempts after a failed check.</p>
          </div>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => patch({ maxRetries: value })}
                aria-pressed={draft.maxRetries === value}
                className={cn(
                  "size-8 rounded-lg font-mono text-xs font-bold transition",
                  draft.maxRetries === value
                    ? "bg-indigo-600 text-white"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <Toggle
          checked={draft.strictTypes}
          onChange={(strictTypes) => patch({ strictTypes })}
          label="Strict TypeScript"
          hint="Reject any, casts to any and @ts-ignore comments."
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-200">AI call retries</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Re-attempt an AI generation when a call fails before giving up on a file.
            </p>
          </div>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => patch({ maxAiRetries: value })}
                aria-pressed={draft.maxAiRetries === value}
                className={cn(
                  "size-8 rounded-lg font-mono text-xs font-bold transition",
                  draft.maxAiRetries === value
                    ? "bg-indigo-600 text-white"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-200">Files per run</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              How many gap files one pipeline run generates a test for.
            </p>
          </div>
          <div className="flex gap-1.5">
            {[1, 3, 5, 10, 25].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => patch({ maxFiles: value })}
                aria-pressed={draft.maxFiles === value}
                className={cn(
                  "size-8 rounded-lg font-mono text-xs font-bold transition",
                  draft.maxFiles === value
                    ? "bg-indigo-600 text-white"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-zinc-200">Files in flight</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              How many files one run generates and validates at the same time.
            </p>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 6].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => patch({ concurrency: value })}
                aria-pressed={draft.concurrency === value}
                className={cn(
                  "size-8 rounded-lg font-mono text-xs font-bold transition",
                  draft.concurrency === value
                    ? "bg-indigo-600 text-white"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <Toggle
          checked={draft.parallelGeneration}
          onChange={(parallelGeneration) => patch({ parallelGeneration })}
          label="Parallel test generation"
          hint="Generate tests in parallel when multiple are selected."
        />
      </Section>

      <Section
        id="appearance"
        title="Appearance"
        hint="Applies immediately; the palette drives the whole interface."
      >
        <div className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2">
          {(
            [
              { id: "dark", name: "Dark", icon: Moon },
              { id: "light", name: "Light", icon: Sun },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={mode === option.id}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-xl border text-xs font-medium transition",
                mode === option.id
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
              )}
            >
              <option.icon className="size-3.5" />
              {option.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5 py-1">
          {ACCENTS.map((accent) => {
            const active = accent.id === accentId;
            return (
              <button
                key={accent.id}
                type="button"
                onClick={() => setAccent(accent.base)}
                title={accent.name}
                aria-label={accent.name}
                aria-pressed={active}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110",
                  active
                    ? "ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900"
                    : "ring-1 ring-zinc-700 hover:ring-zinc-500",
                )}
                style={{ backgroundColor: accent.base }}
              >
                {active && <Check className="size-3.5 text-white" />}
              </button>
            );
          })}
        </div>
      </Section>

      <div className="flex items-center justify-between gap-3 pt-5">
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <KeyRound className="size-3" />
          Keys stay in this browser.
        </p>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            clearSecrets();
            setKeys({ githubToken: "", aiKey: "", sandboxKey: "" });
          }}
        >
          Forget saved keys
        </Button>
      </div>
    </Dialog>
  );
}
