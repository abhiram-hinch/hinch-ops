# HINCH Ops Dashboard

Live operations board for HINCH. Approved sales orders stream in from Zoho Books
within seconds of approval, and the whole team sees payment status and dispatch
status on one screen.

**Zoho Books stays the system of record. This app never writes to Zoho.**

---

## What's in here

```
src/                      React app (Vite + TypeScript + Tailwind)
  features/board/         the ops board: status rail, table, filters, sync
  features/order/         slide-over panel: payments, items, history
  hooks/                  auth, realtime subscription, queries and mutations
supabase/
  migrations/             schema, RLS, triggers, realtime, cron
  functions/
    _shared/              Zoho API client + upsert logic
    zoho-so-webhook/      receives Zoho approval events
    zoho-so-poll/         15-minute reconciliation safety net
CLAUDE.md                 standing rules — read by Claude Code every session
DESIGN.md                 visual language, so the UI stays coherent
```

---

## Setup

Running locally first? See **LOCAL.md** — it covers seed data, testing Zoho auth
without a public URL, and tunnelling for real webhooks.

### 1. Install

```bash
npm install
npm i -g supabase        # if you don't have the CLI
```

### 2. Create the Supabase project

Create a project at supabase.com (choose the Mumbai region), then:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or paste both files in `supabase/migrations/` into the SQL editor, in filename
order. Hold the second migration until the webhook is proven — see step 6.

### 3. Frontend environment

```bash
cp .env.example .env
```

Fill in your project URL and **anon** key from Settings → API.

The service role key never goes in this file. Anything `VITE_`-prefixed is
bundled into the JavaScript your team downloads.

### 4. Add yourself as a user

Auth → Users → Add user in the Supabase dashboard, then in the SQL editor:

```sql
insert into profiles (id, full_name, role)
values ('<the-new-user-uuid>', 'Your Name', 'admin');
```

Self-signup is disabled by design. Roles: `admin`, `sales`, `accounts`,
`warehouse`, `ops`.

```bash
npm run dev     # http://localhost:5173
```

You should be able to sign in and see an empty board.

### 5. Zoho credentials

Do this **logged in as a dedicated integration Zoho user**, not your personal
account. Zoho allows about 20 active refresh tokens per user and silently drops
the oldest when the 21st appears — a personal account will kill this integration
months from now with no warning.

At `api-console.zoho.in` → **Self Client**:

1. Copy the Client ID and Client Secret.
2. **Generate Code**, scope `ZohoBooks.salesorders.READ,ZohoBooks.settings.READ`,
   duration 10 minutes, select your org.
3. Exchange it immediately — the code expires fast:

```bash
curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "code=$GENERATED_CODE"
```

The `refresh_token` is returned **once**. Lose it and you start over.

```bash
supabase secrets set \
  ZOHO_CLIENT_ID="..." \
  ZOHO_CLIENT_SECRET="..." \
  ZOHO_REFRESH_TOKEN="..." \
  ZOHO_ORGANIZATION_ID="..." \
  ZOHO_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

Save that webhook secret — you need it in the Zoho URL and it can't be read back.

### 6. Deploy the functions

```bash
supabase functions deploy zoho-so-webhook --no-verify-jwt
supabase functions deploy zoho-so-poll
```

Test the auth boundary before Zoho ever calls it:

```bash
# must return 401
curl -i "https://<ref>.supabase.co/functions/v1/zoho-so-webhook?secret=wrong&so_id=1"

# must return 200 and insert a row
curl -i "https://<ref>.supabase.co/functions/v1/zoho-so-webhook?secret=$SECRET&so_id=$REAL_SO_ID"
```

If the first returns anything other than 401, stop and fix it — nothing else
matters until that's right.

### 7. Zoho workflow rules

Settings → Automation → Workflow Rules → New, on the **Sales Orders** module.
All three point at the same URL:

```
https://<ref>.supabase.co/functions/v1/zoho-so-webhook?secret=<SECRET>&so_id=${salesorder.salesorder_id}
```

| Rule | Action type | Notes |
|---|---|---|
| SO Approved | Approved | The primary trigger |
| SO Created | Created | Mirrors early, stays hidden until approved |
| SO Edited | Edited → selected fields | Zoho caps at three. Use **total, status, customer** |

Check the merge field renders in Zoho's preview before saving. A URL containing a
literal `${...}` will reach the function and 400.

Never use "when any field is updated" — that exhausts the ~500/day webhook cap on
rate tweaks.

### 8. Turn on live updates

Once a real approval lands in `sales_orders`, apply the second migration.

Before running it, store the Vault secrets it needs (one time, in the SQL editor,
never committed):

```sql
select vault.create_secret('<service-role-key>', 'service_role_key');
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
```

Then push the migration. Approve an order in Zoho and watch it appear on an open
board without a refresh.

### 9. Deploy

```bash
npm run build
```

Push to Vercel or Netlify with the two `VITE_` variables set. Add your production
URL to Supabase → Authentication → URL Configuration.

---

## Verifying it works

```sql
select so_number, customer_name, total, zoho_status, is_approved, last_synced_at
from sales_orders order by last_synced_at desc limit 5;

select source, started_at, records_upsert, error
from sync_runs order by started_at desc limit 10;
```

In the function logs, look for:

```
synced so=... row=... approval_via=is_approved ms=1840
```

**`approval_via` is the one thing left to pin down.** It reports which field
actually told us the order was approved. Once it's consistent across a few
orders, open `supabase/functions/_shared/upsert.ts`, collapse `deriveApproval()`
to that single check, and delete the fallbacks. A permanent guess-cascade in
production is how you end up with silently wrong data a year from now.

---

## The dispatch gate

`app_config.dispatch_gate_mode` ships as `soft`: moving an underpaid order to
ready-or-dispatched shows what's still due, lets the user proceed, and writes the
override to the order history against their name.

To make it blocking:

```sql
update app_config set value = '"hard"' where key = 'dispatch_gate_mode';
```

Postgres then refuses the transition outright. For a partial-advance policy:

```sql
update app_config set value = '0.5' where key = 'dispatch_min_paid_ratio';
```

Both are enforced by a trigger, so they hold whether the call comes from the UI
or straight from the API.

---

## Working with Claude Code

`CLAUDE.md` is read at the start of every session and carries the security rules,
domain rules, and Zoho gotchas. Two habits worth keeping:

- When a rule gets violated repeatedly, add it to `CLAUDE.md` rather than
  correcting it again in chat.
- Regenerate types after any schema change: `npm run types:gen`. The hand-written
  `src/types/database.ts` is a starting point that exists so a fresh clone
  type-checks — the generated file is the real one.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Zoho returns 200 but no row appears | Merge field didn't render. Check Zoho's webhook delivery log for the URL it actually called. |
| Works for an hour, then 401 | Refresh token revoked, usually the 20-token limit. Re-authorize the integration user. |
| Rows appear only on refresh | Second migration not applied, or Realtime disabled in project settings. |
| `approval_via=status:open` every time | Zoho isn't exposing an explicit approval field on your plan. Approval is being inferred from status — workable, but `is_approved` is then only as good as the status. |
| Dispatch change rejected with "check_violation" | The gate is in `hard` mode and the order is underpaid. That's it working. |
