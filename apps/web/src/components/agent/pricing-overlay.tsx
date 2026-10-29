/** The pricing page, rendered over the dashboard at /pricing. */
import { useState } from "react";
import { PLANS } from "@edge-spec/core/plans";
import { Button } from "@edge-spec/ui";
import { signOut, type AccountUser } from "@/lib/account";
import { Link, Overlay } from "./account-overlay";

export function PricingOverlay({
  account,
  onSignedOut,
}: {
  account: AccountUser | null;
  onSignedOut?: () => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const activate = async (planId: string) => {
    const key = window.prompt(
      `Admin key to activate "${planId}" (manual activation until a payment gateway exists):`,
    );
    if (!key) return;
    setBusy(planId);
    setError(undefined);
    try {
      const response = await fetch("/api/admin/plans/activate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ email: account?.email, plan: planId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Activation failed (${response.status}).`);
      }
      setError(undefined);
      window.alert(`Plan "${planId}" activated for ${account?.email}. Reload to see it.`);
      window.history.replaceState(null, "", "/");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Overlay>
      <div className="flex w-fit max-w-full flex-col items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <h2 className="text-sm font-bold text-zinc-50">Plans</h2>
        {!account && (
          <p className="text-[11px] text-zinc-500">
            <Link to="/signup">Create an account</Link> first — plans attach to it.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {PLANS.map((plan) => {
            const active = account?.plan === plan.id;
            return (
              <div
                key={plan.id}
                className={`flex w-56 flex-col gap-2 rounded-xl border p-4 text-left ${
                  active ? "border-indigo-500/60 bg-indigo-500/5" : "border-zinc-800"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-zinc-100">{plan.name}</span>
                  <span className="text-xs text-zinc-400">
                    {plan.price === 0 ? "Free" : `$${plan.price}/mo`}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500">{plan.tagline}</p>
                <ul className="flex flex-col gap-1 text-[11px] text-zinc-400">
                  {plan.features.map((feature) => (
                    <li key={feature}>· {feature}</li>
                  ))}
                </ul>
                <Button
                  className="mt-auto"
                  disabled={!account || Boolean(busy)}
                  onClick={() => void activate(plan.id)}
                  title={active ? "Current plan" : plan.id === "free" ? "Downgrade" : "Activate"}
                >
                  {busy === plan.id
                    ? "…"
                    : active
                      ? "Current"
                      : plan.id === "free"
                        ? "Downgrade"
                        : "Activate"}
                </Button>
              </div>
            );
          })}
        </div>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        {account && (
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span>{account.email}</span>
            <button
              type="button"
              className="text-indigo-400 underline-offset-2 hover:underline"
              onClick={() => void signOut().then(() => onSignedOut?.())}
            >
              Sign out
            </button>
          </div>
        )}
        <p className="max-w-prose text-[11px] text-zinc-600">
          Activation is manual for now — an admin applies it with the deployment's
          <code className="mx-1 rounded bg-zinc-900 px-1">ADMIN_KEY</code>. Checkout lands here when
          the gateway is added.
        </p>
        <Link to="/">Back to EdgeSpec</Link>
      </div>
    </Overlay>
  );
}
