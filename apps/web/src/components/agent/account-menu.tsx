/**
 * Account menu in the dashboard header: avatar + name trigger, a popover with
 * the identity and plan, profile editing (name + uploaded avatar) and the
 * pricing screen. The avatar is resized in the browser and stored on the
 * Better Auth user record as a small data URL, so no new storage is needed.
 */
import { useRef, useState, type ChangeEvent } from "react";
import {
  Badge,
  Button,
  Dialog,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Input,
} from "@edge-spec/ui";
import { CreditCard, LogOut, Pencil, Sparkles } from "lucide-react";
import { signOut, updateProfile, type AccountUser } from "@/lib/account";

const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", team: "Team" };

const initialsOf = (user: AccountUser): string => {
  const source = user.name?.trim() || user.email;
  const [first, second] = source.split(/[\s@._-]+/).filter(Boolean);
  return `${(first?.[0] ?? "?").toUpperCase()}${(second?.[0] ?? "").toUpperCase()}`;
};

/**
 * Profile block for the header's existing account dropdown: identity, plan,
 * profile editing and the pricing screen. No extra trigger button.
 */
export function AccountSection({
  account,
  onUpdated,
  onOpenPricing,
}: {
  account: AccountUser;
  onUpdated: (user: AccountUser) => void;
  onOpenPricing: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <DropdownMenuLabel className="px-2 pt-1 pb-0.5 text-[9px] tracking-wide text-zinc-500 uppercase">
        Profile
      </DropdownMenuLabel>
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <Avatar user={account} size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[11.5px] font-semibold text-zinc-100">
            {account.name?.trim() || "EdgeSpec member"}
          </p>
          <p className="truncate text-[10px] text-zinc-500">{account.email}</p>
          <div className="mt-1 flex items-center gap-1">
            <Badge variant="accent" className="px-1.5 py-0 text-[9px]">
              {PLAN_LABEL[account.plan ?? "free"] ?? account.plan}
            </Badge>
            {!account.emailVerified && (
              <Badge variant="warning" className="px-1.5 py-0 text-[9px]">
                unverified
              </Badge>
            )}
          </div>
        </div>
      </div>
      <DropdownMenuItem onSelect={() => window.setTimeout(() => setEditing(true), 0)}>
        <Pencil />
        Edit profile
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => window.setTimeout(onOpenPricing, 0)}>
        <CreditCard />
        Plans &amp; billing
        {(account.plan ?? "free") === "free" && (
          <Sparkles className="ml-auto size-3.5 text-fuchsia-400" />
        )}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          void signOut().then(() => window.location.assign("/"));
        }}
        className="text-rose-300 focus:text-rose-200"
      >
        <LogOut />
        Sign out
      </DropdownMenuItem>
      <DropdownMenuSeparator />

      <ProfileDialog
        open={editing}
        onOpenChange={setEditing}
        account={account}
        onUpdated={onUpdated}
      />
    </>
  );
}

function ProfileDialog({
  open,
  onOpenChange,
  account,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountUser;
  onUpdated: (user: AccountUser) => void;
}) {
  const [name, setName] = useState(account.name ?? "");
  const [image, setImage] = useState<string | undefined>(account.image ?? undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setError(undefined);
    try {
      setImage(await resizeAvatar(selected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that image.");
    }
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const user = await updateProfile({
        name: name.trim() || account.email.split("@")[0] || "Member",
        image: image ?? null,
      });
      onUpdated(user);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Edit profile"
      description="Your name and avatar show in the dashboard; the email is managed by your account."
      className="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {image ? (
            <img
              src={image}
              alt=""
              className="size-14 rounded-2xl border border-zinc-700 object-cover"
            />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 text-sm font-semibold text-zinc-300">
              {initialsOf({ ...account, name })}
            </span>
          )}
          <div className="flex flex-col gap-1.5">
            <Button variant="outline" size="xs" onClick={() => file.current?.click()}>
              Upload image
            </Button>
            {image && (
              <Button variant="ghost" size="xs" onClick={() => setImage(undefined)}>
                Remove
              </Button>
            )}
            <span className="text-[10px] text-zinc-500">PNG, JPEG or WebP · resized to 192px</span>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => void pick(event)}
          />
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">
            Name
          </span>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">
            Email
          </span>
          <Input value={account.email} disabled />
        </label>

        {error && <p className="text-[11px] text-rose-400">{error}</p>}
      </div>
    </Dialog>
  );
}

export function Avatar({ user, size = 28 }: { user: AccountUser; size?: number }) {
  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-lg border border-zinc-700 object-cover"
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-lg border border-indigo-400/25 bg-gradient-to-br from-indigo-500/25 via-violet-500/20 to-emerald-500/20 text-[10px] font-bold text-indigo-200"
    >
      {initialsOf(user)}
    </span>
  );
}

/** Downscales + compresses to keep the stored data URL small (DB friendly). */
async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("That image is larger than 8 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot process images.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}
