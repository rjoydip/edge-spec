/**
 * Account entry screens: sign in, sign up, forgot/reset password and email
 * confirmation. The dashboard shows this full-page before it starts; a CLI
 * device login lands here first too when the visitor is signed out.
 *
 * Styling is intentionally theme-independent (`.auth-scene`): a dark, colorful
 * entry page in both light and dark mode, with motion that respects
 * `prefers-reduced-motion`.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  GitPullRequest,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  confirmPasswordReset,
  requestPasswordReset,
  signIn,
  signUp,
  verifyEmail,
  type AccountUser,
} from "@/lib/account";

export type AuthMode = "login" | "signup" | "forgot-password" | "reset-password" | "verify-email";

/** Turns the pathname into a screen, or undefined for normal dashboard URLs. */
export const authModeOfPath = (pathname: string, query: string): AuthMode | undefined => {
  switch (pathname) {
    case "/login":
      return "login";
    case "/signup":
      return "signup";
    case "/forgot-password":
      return "forgot-password";
    case "/reset-password":
      return "reset-password";
    case "/verify-email": {
      // A bare ?token= is consumed and confirmed, then lands on sign-in.
      const token = new URLSearchParams(query).get("token");
      return token ? "verify-email" : undefined;
    }
    default:
      return undefined;
  }
};

/** The reset token arrives from the email link's query string. */
export const tokenOfQuery = (query: string): string =>
  new URLSearchParams(query).get("token")?.trim() ?? "";

const COPY: Record<AuthMode, { title: string; subtitle: string; cta: string }> = {
  login: {
    title: "Welcome back",
    subtitle: "Sign in to keep shipping tests alongside your code.",
    cta: "Sign in",
  },
  signup: {
    title: "Create your account",
    subtitle: "One account, every repository you point EdgeSpec at.",
    cta: "Create account",
  },
  "forgot-password": {
    title: "Forgot your password?",
    subtitle: "Enter the account email and we will send a one-hour reset link.",
    cta: "Send reset link",
  },
  "reset-password": {
    title: "Choose a new password",
    subtitle: "Pick something at least 8 characters long.",
    cta: "Update password",
  },
  "verify-email": {
    title: "Confirm your email",
    subtitle: "This finishes the verification link from your inbox.",
    cta: "Confirm email",
  },
};

export function AuthOverlay({
  mode,
  onAuthorized,
}: {
  mode: AuthMode;
  onAuthorized: (user: AccountUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const autoRan = useRef(false);

  const token = tokenOfQuery(window.location.search);
  const resetToken = mode === "reset-password" ? token : "";
  const entry = mode === "login" || mode === "signup";

  const goHome = () => {
    // A device login brought the visitor here; keep them on it.
    const keep = window.location.pathname === "/authorize";
    if (keep) return;
    window.history.replaceState(null, "", "/");
    window.location.assign("/");
  };

  /** All modes share one async path; the form and the verify deep link call it. */
  const run = async () => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      if (mode === "login") {
        onAuthorized((await signIn(email, password)).user);
        goHome();
      } else if (mode === "signup") {
        const result = await signUp({
          email,
          password,
          name: name.trim() || email.split("@")[0] || "Member",
        });
        onAuthorized(result.user);
        goHome();
      } else if (mode === "forgot-password") {
        await requestPasswordReset(email);
        setNote(
          "If that address has an account, a reset link is on its way. It expires in one hour.",
        );
      } else if (mode === "reset-password") {
        if (resetToken.length < 8)
          setError("This reset link is incomplete. Open the link from your email again.");
        else {
          await confirmPasswordReset(resetToken, password);
          setNote("Password updated. Sign in with the new password.");
        }
      } else if (mode === "verify-email") {
        await verifyEmail(token);
        setNote("Email confirmed. You can close this tab and sign in.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run();
  };

  // The emailed verification link lands here with a token; confirm it once.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (mode !== "verify-email" || autoRan.current || token.length < 8) return;
    autoRan.current = true;
    void runRef.current();
  }, [mode, token]);

  const done = note?.startsWith("Password updated") || note?.startsWith("Email confirmed");

  return (
    <div className="auth-scene">
      <div className="auth-decor" aria-hidden="true">
        <div className="auth-grid" />
        <span className="auth-blob auth-blob-a" />
        <span className="auth-blob auth-blob-b" />
        <span className="auth-blob auth-blob-c" />
      </div>

      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_minmax(360px,420px)] lg:gap-16 lg:px-8">
        <BrandPanel />

        <section className="auth-card w-full justify-self-center p-6 sm:p-7">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" alt="" width={26} height={26} className="brand-mark" />
            <span className="text-sm font-bold tracking-tight">EdgeSpec</span>
          </div>

          {entry && <ModeTabs mode={mode} />}

          <header className="mb-5">
            <h1 className="text-xl font-bold tracking-tight text-white">
              {done ? "You're all set" : COPY[mode].title}
            </h1>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
              {done ? "Close this tab or continue to the dashboard." : COPY[mode].subtitle}
            </p>
          </header>

          {!done && (
            <form className="flex flex-col gap-3" onSubmit={submit}>
              {mode === "signup" && (
                <Field icon={<UserRound className="size-4" />} label="Name" hint="optional">
                  <input
                    className="auth-input"
                    autoComplete="name"
                    placeholder="Ada Lovelace"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              )}

              {(mode === "login" || mode === "signup" || mode === "forgot-password") && (
                <Field icon={<Mail className="size-4" />} label="Email">
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    className="auth-input"
                    placeholder="you@example.dev"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
              )}

              {(mode === "login" || mode === "signup" || mode === "reset-password") && (
                <Field
                  icon={<Lock className="size-4" />}
                  label={mode === "reset-password" ? "New password" : "Password"}
                  hint={mode === "signup" ? "8+ characters" : undefined}
                >
                  <input
                    required
                    minLength={8}
                    type={reveal ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    className="auth-input pr-11"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={reveal ? "Hide password" : "Show password"}
                    onClick={() => setReveal((value) => !value)}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500 transition hover:text-zinc-200"
                  >
                    {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </Field>
              )}

              {mode === "login" && (
                <div className="flex justify-end">
                  <Link to="/forgot-password">Forgot password?</Link>
                </div>
              )}

              {error && <Alert tone="error">{error}</Alert>}
              {note && <Alert tone="success">{note}</Alert>}

              <button type="submit" disabled={busy} className="auth-cta mt-1">
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy ? "Just a moment…" : COPY[mode].cta}
                {!busy && <ArrowRight className="size-4" />}
              </button>
            </form>
          )}

          {done && (
            <div className="flex flex-col gap-3">
              <Alert tone="success">{note}</Alert>
              <a href="/login" className="auth-cta">
                Continue to sign in
                <ArrowRight className="size-4" />
              </a>
            </div>
          )}

          <footer className="mt-5 flex flex-col gap-3">
            {mode === "login" && (
              <p className="text-center text-[12px] text-zinc-500">
                New to EdgeSpec? <Link to="/signup">Create an account</Link>
              </p>
            )}
            {(mode === "signup" || mode === "reset-password" || mode === "verify-email") && (
              <p className="text-center text-[12px] text-zinc-500">
                Already have an account? <Link to="/login">Sign in</Link>
              </p>
            )}
            {mode !== "login" && mode !== "signup" && (
              <button
                type="button"
                onClick={() => {
                  window.history.replaceState(null, "", "/login");
                  window.location.assign("/login");
                }}
                className="inline-flex items-center justify-center gap-1.5 text-[12px] text-zinc-400 transition hover:text-white"
              >
                <ArrowLeft className="size-3.5" />
                Back to sign in
              </button>
            )}

            <button
              type="button"
              onClick={goHome}
              className="mx-auto text-[11px] text-zinc-500 transition hover:text-zinc-200"
            >
              Back to EdgeSpec
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BrandPanel() {
  const points = [
    {
      icon: <Sparkles className="size-4" />,
      title: "Agentic coverage",
      body: "Scan the tree, find the gaps, generate bun:test suites with the model you choose.",
    },
    {
      icon: <ShieldCheck className="size-4" />,
      title: "Honest validation",
      body: "Static checks or a real runner — verified means executed, never guessed.",
    },
    {
      icon: <GitPullRequest className="size-4" />,
      title: "Tests to production",
      body: "Review the drafts, accept what passes, and open the pull request in one flow.",
    },
  ];

  return (
    <section className="auth-stagger hidden flex-col gap-8 lg:flex">
      <div className="flex items-center gap-3">
        <img src="/favicon.svg" alt="" width={40} height={40} className="brand-mark" />
        <div className="leading-tight">
          <p className="text-xl font-bold tracking-tight">EdgeSpec</p>
          <p className="text-[11px] text-zinc-500">Agentic test coverage</p>
        </div>
      </div>

      <div className="space-y-4">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-zinc-300">
          <KeyRound className="size-3.5 text-emerald-400" />
          Your keys stay yours
        </p>
        <h2 className="max-w-md text-4xl leading-[1.08] font-bold tracking-tight text-white">
          Tests that keep up with <span className="auth-gradient-text">your code.</span>
        </h2>
        <p className="max-w-md text-[13px] leading-relaxed text-zinc-400">
          EdgeSpec scans a repository, generates tests with your AI provider, validates them, and
          opens a reviewable pull request — on Cloudflare or any cloud you already run.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {points.map((point) => (
          <li
            key={point.title}
            className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3 transition hover:border-white/15 hover:bg-white/[0.05]"
          >
            <span className="mt-0.5 rounded-lg border border-white/10 bg-white/5 p-1.5 text-emerald-300">
              {point.icon}
            </span>
            <span>
              <span className="block text-[12.5px] font-semibold text-zinc-100">{point.title}</span>
              <span className="block text-[11.5px] leading-relaxed text-zinc-500">
                {point.body}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModeTabs({ mode }: { mode: AuthMode }) {
  const tab = (target: AuthMode, label: string) => {
    const active = mode === target;
    const href = target === "login" ? "/login" : "/signup";
    return (
      <a
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex-1 rounded-lg py-2 text-center text-[12px] font-semibold transition ${
          active
            ? "bg-white/10 text-white shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset]"
            : "text-zinc-500 hover:text-zinc-200"
        }`}
      >
        {label}
      </a>
    );
  };
  return (
    <div className="mb-5 flex gap-1 rounded-xl border border-white/8 bg-black/25 p-1">
      {tab("login", "Sign in")}
      {tab("signup", "Create account")}
    </div>
  );
}

function Field({
  children,
  icon,
  label,
  hint,
}: {
  children: ReactNode;
  icon: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <label className="group flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
        {label}
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </span>
      <span className="relative block">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500 transition group-focus-within:text-emerald-300">
          {icon}
        </span>
        {children}
      </span>
    </label>
  );
}

function Alert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const error = tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${
        error
          ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
          : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      {error ? (
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Inline link used by the auth card. */
export function Link({ to, children }: { to: string; children: string }) {
  return (
    <a
      href={to}
      className="font-medium text-emerald-300 underline-offset-4 transition hover:text-emerald-200 hover:underline"
    >
      {children}
    </a>
  );
}
