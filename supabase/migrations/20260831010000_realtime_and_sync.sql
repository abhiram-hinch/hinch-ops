-- =====================================================================
-- Live sync: realtime publication, poll cursor, scheduled reconciliation
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1. Poll cursor
-- ---------------------------------------------------------------------

create table sync_state (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table sync_state enable row level security;
create policy read_sync_state on sync_state for select to authenticated using (true);
-- No write policy: only the service role (edge functions) advances the cursor.

-- ---------------------------------------------------------------------
-- 2. Realtime — push changes to every open dashboard
-- ---------------------------------------------------------------------

-- Realtime respects RLS, so the read-all policies from the first migration
-- carry over. No extra exposure here.
alter publication supabase_realtime add table sales_orders;
alter publication supabase_realtime add table order_ops;
alter publication supabase_realtime add table payments;

-- REPLICA IDENTITY FULL so the old row is available on UPDATE payloads —
-- needed to tell "moved into ready_to_dispatch" from "was already there".
alter table sales_orders replica identity full;
alter table order_ops    replica identity full;

-- ---------------------------------------------------------------------
-- 3. Scheduled reconciliation
-- ---------------------------------------------------------------------

-- Store the service role key as a Vault secret, NOT inline in this migration.
-- Run once, manually, in the SQL editor (never commit the value):
--
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');

create or replace function trigger_so_poll()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise warning 'poll skipped: vault secrets not configured';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/zoho-so-poll',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end $$;

revoke execute on function trigger_so_poll() from authenticated, anon;

select cron.schedule(
  'zoho-so-poll-15min',
  '*/15 * * * *',
  $$select trigger_so_poll()$$
);

-- ---------------------------------------------------------------------
-- 4. Sync health, for the dashboard indicator
-- ---------------------------------------------------------------------

create or replace view v_sync_health
with (security_invoker = true) as
select
  (select max(started_at) from sync_runs where error is null)          as last_success_at,
  (select count(*) from sync_runs
     where started_at > now() - interval '24 hours' and error is not null) as errors_24h,
  (select count(*) from sales_orders
     where last_synced_at > now() - interval '1 hour')                 as synced_last_hour;
