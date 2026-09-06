# HINCH Ops Dashboard

Internal operations dashboard for HINCH. Mirrors approved sales orders from Zoho Books
and lets the team see payment status and dispatch status in one shared place.

**Zoho Books is the system of record for sales orders. This app never writes to Zoho.**

---

## Stack

- **Frontend:** Vite + React 18 + TypeScript (strict), TanStack Query, shadcn/ui, Tailwind
- **Backend:** Supabase — Postgres, Auth, Storage, Edge Functions (Deno), pg_cron
- **Integration:** Zoho Books API v3, India datacenter (`zohoapis.in` / `accounts.zoho.in`)
- **Deploy:** Vercel (frontend), `supabase functions deploy` (functions)

```
/src
  /components      shadcn primitives + shared UI
  /features        orders/, payments/, dispatch/  — colocated by domain
  /lib             supabase client, query keys, formatters
  /types           generated from `supabase gen types typescript`
/supabase
  /migrations      timestamped SQL, forward-only, never edited after apply
  /functions
    zoho-so-webhook/     receives Zoho workflow-rule webhook
    zoho-so-poll/        cron safety net, reconciles missed webhooks
    _shared/             zoho auth + mapping, imported by both
```

---

## Security rules — non-negotiable

These are not style preferences. Violating any of them is a defect, regardless of
whether tests pass.

1. **The browser holds the anon key and nothing else.** The service role key never
   appears in `/src`, never in any `VITE_`-prefixed variable, never in a committed
   `.env`. Anything `VITE_`-prefixed is bundled and public — treat it as such.
2. **Zoho credentials live only in Supabase secrets.** Client ID, client secret, and
   refresh token are read via `Deno.env.get()` inside Edge Functions. They must never
   reach the frontend, a migration, or a log line.
3. **RLS is enabled on every table, deny by default.** A new table without an RLS
   policy is an incomplete table. No exceptions for "internal" tables.
4. **Authorization lives in Postgres, not in React.** Hiding a button is UX. RLS is
   security. Every write path must be independently safe if someone opens the console
   and calls the API directly.
5. **The webhook function is deployed `--no-verify-jwt`** (Zoho cannot send a JWT) and
   guarded by a shared secret compared in **constant time**. Reject before doing any
   work if it fails.
6. **Storage buckets are private.** Files are served only through short-lived signed
   URLs generated server-side.
7. **Never log a token, a secret, a signed URL, or a full customer record.** Log IDs
   and counts.
8. **`activity_log` is append-only.** UPDATE and DELETE are revoked at the grant level.
   Do not add a policy that re-enables them.

---

## Domain rules

### Status axes — never collapse these into one field

- **Zoho status** (`sales_orders.zoho_status`) — mirrored, read-only. Never write it.
- **Payment status** (`sales_orders.payment_status`) — computed by trigger from the
  `payments` ledger. **Never set it directly in application code.**
- **Dispatch status** (`order_ops.dispatch_status`) — owned by this app.
  `pending → ready_to_dispatch → dispatched → delivered`, plus `on_hold` (requires a
  reason) and `partially_dispatched`.

### Ingestion filter

Only sales orders that are **approved and open** in Zoho appear in ops queues. Drafts,
pending-approval, void, and closed orders are mirrored but hidden by default.

### The dispatch gate

`app_config.dispatch_gate_mode` is `soft` or `hard`.

- `soft` — the UI warns when moving an under-paid order to `ready_to_dispatch`; the
  user may proceed, and the override is written to `activity_log` with their identity.
- `hard` — the Postgres trigger raises an exception and the transition fails.

Both paths already exist in the schema. **Do not add a third mode, and do not implement
the check only in the client.**

### Money

All amounts are `numeric(14,2)`. Never `float`. Format for display with
`Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.

---

## Zoho integration rules

1. **Read `api_domain` from the token response.** Do not hardcode `zohoapis.in` —
   hardcoding breaks if Zoho migrates the org.
2. **Authorize with a dedicated integration Zoho user**, never a personal account.
   Zoho allows ~20 active refresh tokens per user and silently deletes the oldest when
   the 21st is created — a personal account will kill this integration with no warning.
3. **Access tokens expire in 1 hour.** Mint on demand inside the function; cache in
   memory for the invocation only. Never persist an access token to the database.
4. **Rate limits:** ~100 req/min, ~5,000/day. The poll must page, not fan out. Never
   call Zoho from a React component — always frontend → Edge Function → Zoho.
5. **Webhooks have no retry** and are capped near 500/day. The 15-minute poll is
   required infrastructure, not an optimisation. Do not remove it as "redundant."
6. **The webhook handler must be idempotent** on `zoho_salesorder_id`. Zoho sends
   duplicates. Every write is an upsert on that key.
7. **Field names and enum values must be confirmed against a live API response from
   our own org** before being coded against. Zoho Books, Zoho Inventory, and Zoho
   Commerce expose different fields for sales orders — docs for the wrong product will
   compile and silently produce wrong data. Fixtures live in
   `/supabase/functions/_shared/__fixtures__/`.
8. **Store the full payload** in `sales_orders.raw`. When a mapping turns out wrong,
   backfill from `raw` instead of re-pulling 5,000 orders.

---

## Conventions

- TypeScript strict. **No `any`.** Database types are generated, never hand-written:
  `supabase gen types typescript --local > src/types/database.ts`
- All server state through TanStack Query. No `useEffect` fetching.
- Errors surface to the user with what happened and what to do. Never a bare
  `catch {}`, never a silent failure, never a toast that says "Something went wrong."
- Migrations are forward-only. Once applied, a migration file is never edited.
- Every mutation that changes payment or dispatch state writes to `activity_log`
  (handled by trigger — do not duplicate it in application code).

---

## Definition of done

A feature is not done until:

- [ ] RLS policies exist and are tested from the perspective of each role
- [ ] The write path is safe when called directly against the API, bypassing the UI
- [ ] Loading, empty, and error states are all implemented
- [ ] Amounts format as INR and never lose precision
- [ ] No secret, token, or signed URL appears in any log or client bundle
- [ ] `npm run build` passes with zero TypeScript errors

---

## Explicitly out of scope

Do not build these without being asked. If a task seems to require one, stop and ask.

- Writing anything back to Zoho Books
- Invoice or accounting reconciliation
- Inventory or stock management
- Customer-facing order tracking
- Delivery routing or a driver app
- Any two-way sync of any kind
