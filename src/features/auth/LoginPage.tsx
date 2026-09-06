import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Field, Input } from "@/components/Primitives";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="card w-full max-w-[360px] p-6">
        <h1 className="text-xl font-bold tracking-tight">
          HINCH <span className="text-brand">Ops</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Sales orders, payments and dispatch — all in one place.
        </p>

        <div className="mt-6 space-y-3">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
          </Field>

          {error && <p className="text-sm font-medium text-bad">{error}</p>}

          <button
            onClick={signIn}
            disabled={busy || !email || !password}
            className="btn-primary btn-md w-full"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>

        <p className="mt-5 text-micro text-faint">
          No account? Ask an admin to add you and give you a role.
        </p>
      </div>
    </div>
  );
}
