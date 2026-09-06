# Production deployment

Everything below runs on **free tiers**. One-time setup ~30–45 min.

| Piece | Host | Free tier | URL you get |
|---|---|---|---|
| Database + Auth + Storage + Edge Functions | **Supabase** (region: Mumbai) | 500 MB DB · 1 GB storage · 500k function calls/mo · unlimited API | `https://<ref>.supabase.co` |
| Webhook endpoint | Supabase Edge Function | included | `https://<ref>.supabase.co/functions/v1/zoho-so-webhook` |
| 15-min reconcile cron | Supabase `pg_cron` | included | — |
| Frontend (the React app) | **Cloudflare Pages** | unlimited static hosting · 500 builds/mo · custom domain free | `https://<name>.pages.dev` |

Alternatives for the frontend: Vercel (Hobby) or Netlify — same idea, same env vars.

> Supabase free projects **pause after 7 days of no activity**. A daily-use ops
> tool never hits that. If it ever pauses, one dashboard click un-pauses it.

---

## A. Supabase — database + the webhook URL

1. **Create the project** — [supabase.com](https://supabase.com) → New project.
   Region **South Asia (Mumbai)**. Save the database password.

2. **CLI login + link**
   ```bash
   npm i -g supabase          # or use: npx supabase ...
   supabase login
   supabase link --project-ref <ref>     # ref is in Project Settings → General
   ```

3. **Push the schema** (all migrations in `supabase/migrations/`)
   ```bash
   supabase db push
   ```

4. **Set the function secrets** — the Zoho credentials + a fresh webhook secret
   ```bash
   supabase secrets set \
     ZOHO_CLIENT_ID="1000.xxxxxxxx" \
     ZOHO_CLIENT_SECRET="xxxxxxxx" \
     ZOHO_REFRESH_TOKEN="1000.xxxxxxxx" \
     ZOHO_ORGANIZATION_ID="60030102545" \
     ZOHO_ACCOUNTS_HOST="https://accounts.zoho.in" \
     ZOHO_WEBHOOK_SECRET="$(openssl rand -hex 24)"
   ```
   **Copy the generated `ZOHO_WEBHOOK_SECRET`** — you need it in the Zoho URL
   (step F). Read it back any time with `supabase secrets list` (value is hidden;
   if you lose it, set a new one and update the Zoho rule).

   > If your Zoho refresh token still has the broad `ZohoBooks.fullaccess.all`
   > scope, this is a good moment to regenerate a read-only one
   > (`ZohoBooks.salesorders.READ,ZohoBooks.settings.READ`) — the app never
   > writes to Zoho.

5. **Deploy the three functions**
   ```bash
   supabase functions deploy zoho-so-webhook --no-verify-jwt
   supabase functions deploy zoho-so-detail
   supabase functions deploy zoho-so-poll
   ```

6. **Your production webhook URL is now:**
   ```
   https://<ref>.supabase.co/functions/v1/zoho-so-webhook
   ```

7. **Project API settings** — Project Settings → API:
   - **Max rows**: set to `10000` (the board's "All" view needs headroom).
   - Note the **anon key** (frontend) and the **service_role key** (steps B, C).

8. **Auth settings** — Authentication → Providers → Email: keep **enabled**.
   Authentication → Settings: turn **off** "Allow new users to sign up"
   (users are added by an admin, step E).

---

## B. Vault secrets for the reconcile cron

The 15-minute safety-net poll (`trigger_so_poll`, in migration 2) needs two
Vault secrets. Run once in the Supabase **SQL editor**:

```sql
select vault.create_secret('<service_role_key>', 'service_role_key');
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
```

Verify the cron job exists:
```sql
select jobname, schedule, active from cron.job;
-- expect: zoho-so-poll-15min | */15 * * * * | t
```

---

## C. First data load (backfill)

The webhook only fires on *future* changes. Load the existing orders with the
poll. In the **SQL editor**, seed the cursor, then call the poll a few times
(it resumes from where it stopped):

```sql
insert into sync_state (key, value)
values ('so_last_modified_cursor',
        to_char(now() - interval '120 days', 'YYYY-MM-DD"T"HH24:MI:SS'))
on conflict (key) do update set value = excluded.value;
```

```bash
# repeat until "upserted" stops growing (a few thousand orders => run 3-5x)
for i in 1 2 3 4 5; do
  curl -s -X POST "https://<ref>.supabase.co/functions/v1/zoho-so-poll" \
    -H "Authorization: Bearer <service_role_key>"
  echo
done
```

Then check:
```sql
select source, records_upsert, error, started_at
from sync_runs order by started_at desc limit 10;

select count(*) from v_ops_board;   -- approved, board-visible orders
```

Line-item detail and PDFs fill in automatically the first time each order is
opened in the app (or via a webhook on its next change).

---

## D. Frontend — Cloudflare Pages

1. Push this repo to GitHub (private is fine).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**
   → pick the repo.
3. Build settings:
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. **Environment variables** (Production *and* Preview):
   ```
   VITE_SUPABASE_URL       = https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY  = <anon key from Project Settings → API>
   ```
5. Save & Deploy → you get `https://<name>.pages.dev`. Add a custom domain later
   under the project's **Custom domains** tab (free).
6. Back in Supabase → Authentication → **URL Configuration**: set **Site URL** to
   your Pages URL and add it to **Redirect URLs**.

Every push to the default branch redeploys automatically.

---

## E. Add users

Supabase → Authentication → **Users → Add user** (tick *Auto Confirm*). Then in
the **SQL editor**, give each one a profile + role:

```sql
insert into profiles (id, full_name, role) values
  ('<user-uuid>', 'Full Name', 'sales');
```

Roles: `admin`, `sales` (payments), `accounts` (payments), `warehouse` /
`ops` (dispatch + challans), `procurement` (reserved for vendor-PO tracking).

---

## F. Zoho — the real-time trigger

Zoho Books → **Settings → Automation → Workflow Rules → + New Workflow Rule**.
Module: **Sales Orders**. Create these rules — **all point at the same URL**:

| Rule name | When (trigger) | Notes |
|---|---|---|
| SO Approved | **Approve** | the primary trigger (approval is enabled in this org) |
| SO Edited | **Edit → selected fields**: `total`, `status`, `customer` | Zoho caps at 3 fields |
| SO Created *(optional)* | **Create** | mirrors drafts early; they stay hidden until approved |

For each rule → **Actions → Webhook → New Webhook**:

- **Method**: POST
- **URL to notify**:
  ```
  https://<ref>.supabase.co/functions/v1/zoho-so-webhook?secret=<ZOHO_WEBHOOK_SECRET>&so_id=${salesorder.salesorder_id}
  ```
  Use the placeholder picker for the id and **confirm it renders in the preview**
  — a URL still containing a literal `${...}` will reach the function and return
  `400 "merge field did not render"`.
- **Module**: Sales Orders. No extra auth params — the `?secret=` is the boundary.

> Never use "when any field is updated" — it burns the ~500 webhooks/day cap on
> trivial edits.

---

## G. Verify the round-trip

```bash
# 1. auth boundary — must be 401
curl -i "https://<ref>.supabase.co/functions/v1/zoho-so-webhook?secret=wrong&so_id=1"

# 2. direct call with a real Zoho sales order id — must be 200 and insert a row
curl -i "https://<ref>.supabase.co/functions/v1/zoho-so-webhook?secret=<SECRET>&so_id=<REAL_SO_ID>"
```

3. **Approve an order in Zoho Books.** Within a few seconds it should appear on
   the board.
4. Zoho → the rule's **webhook delivery log**: status 200.
5. Supabase → **Edge Functions → zoho-so-webhook → Logs**: a line like
   `webhook ok zoho=... row=... via=stage:approved pdf=true`.
6. SQL: `select source, error, started_at from sync_runs order by started_at desc limit 10;`
   — recent `webhook` rows, no errors.

---

## What runs where, after this

| Path | Trigger | Does |
|---|---|---|
| `zoho-so-webhook` | Zoho workflow rule (real time) | full sync of one order: detail + line items + PDF |
| `zoho-so-poll` | `pg_cron` every 15 min, or "Sync now" button | thin reconcile — catches anything a webhook missed |
| `zoho-so-detail` | dashboard opens an order | fills detail + PDF for orders only the poll has seen |
