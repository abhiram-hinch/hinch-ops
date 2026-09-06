# Running locally

Three stages. Don't skip ahead — each one rules out a whole class of problem
before the next introduces new ones.

1. **The app runs** with fake data, no Zoho at all.
2. **Zoho auth works** — the function talks to Zoho, triggered by you.
3. **Zoho triggers it** — a real approval fires the webhook.

---

## Stage 1 — Run the app with seed data

You need Docker for this stage, because `supabase start` runs Postgres, Auth,
Storage and the function runtime in containers. This is the *only* place Docker
is involved — nothing gets containerised for deployment.

Install Docker Desktop, then:

```bash
npm install
supabase start
```

First run pulls a few GB of images and takes a while. When it finishes it prints
your local API URL, anon key, and service role key.

```bash
cp .env.example .env
```

Set `VITE_SUPABASE_URL=http://127.0.0.1:54321` and paste the local anon key.

`supabase start` applies everything in `migrations/` automatically. Now create a
user and seed:

```bash
# Studio at http://127.0.0.1:54323 → Authentication → Add user
# (or use the API — local Auth accepts any email, no confirmation needed)

# Then give that user a profile:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "insert into profiles (id, full_name, role)
      values ('<user-uuid>', 'Your Name', 'admin');"

# Load 12 sample orders across every payment and dispatch state:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f supabase/seed.sql
```

```bash
npm run dev
```

Sign in at http://localhost:5173. You should see a populated board: 12 approved
orders, a mix of paid / part paid / unpaid, two on hold with reasons, ageing
counters, and the draft order correctly absent.

**What to check before moving on**

- Clicking a status tile filters the board
- The panel opens, tabs work, line items render on SO-02418 and SO-02416
- Recording a payment updates the bar immediately
- Moving an underpaid order to dispatch shows the shortfall warning
- The move then appears in the History tab under your name

If all of that works, the app is fine and any later problem is Zoho's.

### If you'd rather skip Docker

Point `.env` at a free cloud Supabase project instead and run only `npm run dev`
locally. You lose local function testing, but Stage 1 needs no functions. This is
the faster path if Docker is a hassle on your machine.

---

## Stage 2 — Zoho auth, triggered by you

**You do not need a public URL for this.** The webhook function takes an order
ID, then fetches from Zoho itself. You can supply the ID directly with curl,
which tests everything except Zoho's own trigger configuration.

Create `supabase/functions/.env.local` — it is gitignored, never commit it:

```
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...
ZOHO_ORGANIZATION_ID=...
ZOHO_WEBHOOK_SECRET=localdevsecret
```

```bash
supabase functions serve zoho-so-webhook --no-verify-jwt --env-file supabase/functions/.env.local
```

Test the auth boundary first:

```bash
# must be 401
curl -i "http://127.0.0.1:54321/functions/v1/zoho-so-webhook?secret=wrong&so_id=1"

# must be 200, with a real sales order id from your Zoho org
curl -i "http://127.0.0.1:54321/functions/v1/zoho-so-webhook?secret=localdevsecret&so_id=$REAL_SO_ID"
```

Watch the terminal for:

```
synced so=... row=... approval_via=is_approved ms=1840
```

Then confirm the row landed:

```sql
select so_number, customer_name, total, zoho_status, is_approved
from sales_orders where zoho_salesorder_id = '<the id>';
```

**If the token step fails**, the error message distinguishes the causes. A
`invalid_code` means the refresh token was revoked — usually the 20-tokens-per-
user limit, which is why the README insists on a dedicated integration user.

Test the poll the same way:

```bash
supabase functions serve zoho-so-poll --env-file supabase/functions/.env.local
curl -X POST "http://127.0.0.1:54321/functions/v1/zoho-so-poll" \
  -H "Authorization: Bearer $LOCAL_SERVICE_ROLE_KEY"
```

That pulls everything modified in the last 24 hours, which is also how you
backfill your existing orders on day one.

---

## Stage 3 — Let Zoho fire it

Zoho cannot reach `localhost`. Two options.

### Option A: deploy the function, keep the frontend local

Simplest, and what I'd do. Deploy just the function to your cloud project, point
Zoho at it, and keep `npm run dev` running against that same cloud project.

```bash
supabase functions deploy zoho-so-webhook --no-verify-jwt
```

You get a stable URL that survives laptop reboots, so you configure the Zoho
workflow rule once instead of every session.

### Option B: tunnel to your machine

Only worth it if you're actively changing the function and want the edit loop.

```bash
cloudflared tunnel --url http://127.0.0.1:54321
```

It prints a public `https://<random>.trycloudflare.com` URL. Use that in the
Zoho workflow rule:

```
https://<random>.trycloudflare.com/functions/v1/zoho-so-webhook?secret=localdevsecret&so_id=${salesorder.salesorder_id}
```

The URL changes every restart, so you'll be editing the Zoho rule repeatedly.
`ngrok http 54321` works the same way and gives you a request inspector at
`http://127.0.0.1:4040`, which is genuinely useful for seeing exactly what Zoho
posts.

**Either way, verify the merge field renders.** Check Zoho's webhook delivery
log — if the URL it called contains a literal `${salesorder.salesorder_id}`, the
placeholder syntax is wrong and the function will 400.

---

## Resetting

```bash
supabase db reset          # drops, re-migrates, re-runs seed.sql
supabase stop              # frees the containers
supabase stop --no-backup  # also discards local data
```

`db reset` runs `supabase/seed.sql` automatically, so you're back to 12 sample
orders in about twenty seconds.

---

## Known local quirks

| Symptom | Cause |
|---|---|
| Board is empty after seeding | `seed.sql` skips payments when no profile exists. Create your profile row, then re-run it. |
| Realtime doesn't push updates | The second migration adds tables to the publication. `supabase db reset` applies both. |
| "Missing VITE_SUPABASE_URL" | `.env` not created, or the dev server was started before you saved it. Restart it. |
| Function can't reach Zoho | `supabase functions serve` needs `--env-file`; without it `Deno.env.get` returns nothing and the function throws on startup. |
| Port already in use | Another Supabase project is running. `supabase stop` in that directory first. |
