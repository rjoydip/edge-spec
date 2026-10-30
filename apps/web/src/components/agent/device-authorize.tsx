/** CLI device authorization. Shown over the dashboard when it opens /authorize. */
import { useState, type ReactNode } from "react";
import { Button } from "@edge-spec/ui";
import { ShieldCheck } from "lucide-react";
import { approveDeviceCode, type DevicePage } from "@/lib/device";

export function DeviceAuthorize({ page }: { page: DevicePage }) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string>();

  const ready = page.userCode.length === 9 && Boolean(page.payloadKey);

  const approve = async () => {
    if (!ready) return;
    setError(undefined);
    setState("working");
    try {
      await approveDeviceCode(page.userCode, page.payloadKey as string);
      setState("done");
    } catch (cause) {
      setState("idle");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (state === "done") {
    return (
      <Overlay>
        <Card>
          <ShieldCheck className="size-5 text-emerald-500" />
          <h2 className="text-sm font-semibold text-zinc-900">Device authorized</h2>
          <p className="text-xs text-zinc-500">
            Return to the terminal that asked for this code. You can close this window.
          </p>
          <Button variant="secondary" onClick={() => window.close()}>
            Close
          </Button>
        </Card>
      </Overlay>
    );
  }

  return (
    <Overlay>
      <Card>
        <ShieldCheck className="size-5 text-accent" />
        <h2 className="text-sm font-semibold text-zinc-900">Authorize a CLI or MCP app</h2>
        <p className="text-xs text-zinc-500">
          Confirm the code matches the one printed in that terminal, then approve.
        </p>
        <div className="select-all rounded-md border border-zinc-200 px-4 py-2 font-mono text-2xl tracking-[0.2em] text-zinc-900">
          {page.userCode || "????-????"}
        </div>
        {!ready && (
          <p className="text-xs text-amber-600">
            This link is incomplete. Start the flow again with{" "}
            <code className="font-mono">edge-spec auth login</code>.
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <Button disabled={!ready || state === "working"} onClick={() => void approve()}>
            {state === "working" ? "Authorizing…" : "Authorize"}
          </Button>
          <Button variant="secondary" onClick={() => window.close()}>
            Cancel
          </Button>
        </div>
      </Card>
    </Overlay>
  );
}

const Overlay = ({ children }: { children: ReactNode }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
    {children}
  </div>
);

const Card = ({ children }: { children: ReactNode }) => (
  <div className="flex w-80 flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-center shadow-lg">
    {children}
  </div>
);
