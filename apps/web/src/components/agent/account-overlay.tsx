/**
 * Account entry screens, rendered as an overlay when the dashboard is opened
 * at /login, /signup, /forgot-password, /reset-password or /verify-email.
 * Same shape as the device authorize gate: a card over the workspace.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@edge-spec/ui";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const token = tokenOfQuery(window.location.search);
  const resetToken = mode === "reset-password" ? token : "";

  const goHome = () => {
    window.history.replaceState(null, "", "/");
    window.location.assign("/");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      if (mode === "login") {
        onAuthorized((await signIn(email, password)).user);
        goHome();
      } else if (mode === "signup") {
        const result = await signUp({ email, password, name });
        onAuthorized(result.user);
        if (result.emailNote) window.alert(`Signed in. Note: ${result.emailNote}`);
        goHome();
      } else if (mode === "forgot-password") {
        const result = await requestPasswordReset(email);
        setNote(
          result.delivered
            ? "Check your inbox — the link expires in an hour."
            : "If that address has an account, a reset link is on its way once a sender is configured.",
        );
      } else if (mode === "reset-password") {
        if (resetToken.length < 8) setError("Open the link from your email again.");
        else {
          await confirmPasswordReset(resetToken, password);
          setNote("Password updated. Sign in with the new one.");
        }
      } else if (mode === "verify-email") {
        await verifyEmail(token);
        setNote("Email confirmed. You can sign in now.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<AuthMode, string> = {
    login: "Sign in",
    signup: "Create an account",
    "forgot-password": "Forgot password",
    "reset-password": "Choose a new password",
    "verify-email": "Confirm your email",
  };
  const helpers: Partial<Record<AuthMode, string>> = {
    "forgot-password": "Paste the email the account uses. A reset link expires in one hour.",
    "reset-password": "The token came from the emailed link.",
    "verify-email": "The token came from the emailed link.",
  };

  const showEmail = mode === "login" || mode === "signup" || mode === "forgot-password";
  const showPassword = mode === "login" || mode === "signup" || mode === "reset-password";
  const showName = mode === "signup";
  const submitting = busy || (mode === "reset-password" && note?.startsWith("Password updated"));

  return (
    <Card>
      <h2 className="text-sm font-bold text-zinc-50">{titles[mode]}</h2>
      {helpers[mode] && <p className="text-[11px] text-zinc-500">{helpers[mode]}</p>}
      <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)}>
        {showName && (
          <label className="flex flex-col gap-1 text-left text-[11px] text-zinc-400">
            Name (optional)
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        {showEmail && (
          <label className="flex flex-col gap-1 text-left text-[11px] text-zinc-400">
            Email
            <input
              required
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        {showPassword && (
          <label className="flex flex-col gap-1 text-left text-[11px] text-zinc-400">
            {mode === "reset-password" ? "New password" : "Password"}
            <input
              required
              type="password"
              minLength={8}
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        {note && <p className="text-[11px] text-emerald-400">{note}</p>}
        <Button type="submit">{submitting ? "…" : titles[mode]}</Button>
      </form>
      <nav className="flex items-center justify-center gap-3 text-[11px] text-zinc-500">
        {(mode === "signup" || mode === "verify-email") && <Link to="/login">Sign in</Link>}
        {mode === "login" && <Link to="/signup">Create an account</Link>}
        {mode !== "forgot-password" && mode !== "reset-password" && mode !== "verify-email" && (
          <Link to="/forgot-password">Forgot password</Link>
        )}
      </nav>
      <button
        type="button"
        onClick={goHome}
        className="text-[11px] text-zinc-500 hover:text-zinc-300"
      >
        Back to EdgeSpec
      </button>
    </Card>
  );
}

const inputClass =
  "h-9 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-indigo-500/60";

export function Link({ to, children }: { to: string; children: string }) {
  return (
    <a
      href={to}
      className="text-indigo-400 underline-offset-2 hover:underline"
      onClick={() => window.history.replaceState(null, "", to)}
    >
      {children}
    </a>
  );
}

export const Overlay = ({ children }: { children: ReactNode }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4">
    {children}
  </div>
);

export const Card = ({ children }: { children: ReactNode }) => (
  <div className="flex w-84 max-w-full flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center shadow-2xl">
    {children}
  </div>
);
