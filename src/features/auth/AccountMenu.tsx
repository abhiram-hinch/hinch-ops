import { useState } from "react";
import { CheckCircle2, KeyRound, LogOut, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Field, Input } from "@/components/Primitives";
import type { Profile } from "@/types/database";

const roleWord: Record<string, string> = {
  admin: "Admin",
  sales: "Sales",
  accounts: "Accounts",
  warehouse: "Warehouse",
  ops: "Operations",
  procurement: "Procurement",
};

/** Header button → opens the account panel (profile + change password + sign out). */
export function AccountMenu({ profile, email }: { profile: Profile; email: string }) {
  const [open, setOpen] = useState(false);
  const initial = (profile.full_name?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-2 rounded-pill border border-line px-2 py-1 hover:bg-canvas"
        aria-label="Account"
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-brandSoft text-micro font-bold text-brand">
          {initial}
        </span>
        <span className="hidden max-w-[140px] truncate text-[13px] font-semibold text-ink sm:inline">
          {profile.full_name}
        </span>
      </button>
      {open && <AccountModal profile={profile} email={email} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccountModal({
  profile,
  email,
  onClose,
}: {
  profile: Profile;
  email: string;
  onClose: () => void;
}) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !busy && !!cur && next.length >= 8 && next === confirm;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    setDone(false);

    // No email-recovery flow is available (mailboxes are placeholders), so
    // re-verify the current password by signing in with it.
    const check = await supabase.auth.signInWithPassword({ email, password: cur });
    if (check.error) {
      setErr("Current password is incorrect.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setDone(true);
    setCur("");
    setNext("");
    setConfirm("");
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 backdrop-blur-[1px] sm:p-6"
      onClick={onClose}
    >
      <div
        className="card my-auto w-full max-w-[400px] p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-ink">{profile.full_name}</p>
            <p className="truncate text-micro text-muted">
              {email} · {roleWord[profile.role] ?? profile.role}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <KeyRound size={14} /> Change password
          </p>
          <div className="space-y-2.5">
            <Field label="Current password">
              <Input
                type="password"
                autoComplete="current-password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                className="w-full"
              />
            </Field>
            <Field label="New password">
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full"
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="w-full"
              />
            </Field>

            {tooShort && <p className="text-micro text-warn">Use at least 8 characters.</p>}
            {mismatch && <p className="text-micro text-warn">The two passwords don&apos;t match.</p>}
            {err && <p className="text-sm font-medium text-bad">{err}</p>}
            {done && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-good">
                <CheckCircle2 size={14} /> Password updated.
              </p>
            )}

            <button onClick={submit} disabled={!canSubmit} className="btn-primary btn-md w-full">
              {busy ? "Updating…" : "Update password"}
            </button>
          </div>
        </div>

        <button
          onClick={() => supabase.auth.signOut()}
          className="btn-ghost btn-md mt-4 w-full gap-1.5"
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}
