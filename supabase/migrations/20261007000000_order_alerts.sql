-- =====================================================================
-- Internal WhatsApp alert the first time a sales order shows up on the
-- dashboard (sent by the sync edge functions through Periskope).
--
-- This migration is only the bookkeeping: one row per order that has been
-- alerted, claimed atomically so a duplicate Zoho webhook, a poll and a
-- panel-open sync racing on the same order can never post it twice.
--
-- Nothing sends until BOTH hold:
--   * the Periskope secrets are set on the edge functions, and
--   * app_config.order_alerts_from is set to a timestamp.
-- Only orders created on or after that timestamp are ever alerted, so
-- switching this on can't blast a message for every order already in the
-- system. Set it to now() when you're ready; set it back to null to pause.
-- =====================================================================

create table order_alerts (
  sales_order_id      uuid primary key references sales_orders(id) on delete cascade,
  status              text not null check (status in ('sending', 'sent', 'failed')),
  attempts            int  not null default 1,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz
);

create index idx_order_alerts_retry on order_alerts (status, updated_at) where status <> 'sent';

alter table order_alerts enable row level security;

-- Written only by the edge functions (service role bypasses RLS). Admins can
-- read it to see what was sent and what failed.
create policy read_order_alerts on order_alerts for select to authenticated using (is_admin());

insert into app_config (key, value)
values ('order_alerts_from', 'null'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Claim an order for alerting. Returns true if THIS caller should send it:
--   * no row yet                                     -> claim it
--   * a previous attempt failed (under 3 attempts)   -> claim it for a retry
--   * 'sending' for over 10 minutes (the sender died) -> claim it for a retry
-- Anything else (already sent, in flight, out of attempts) returns false.
-- A single INSERT ... ON CONFLICT, so two concurrent callers cannot both win.
-- ---------------------------------------------------------------------
create or replace function claim_order_alert(p_so uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_claimed int;
begin
  insert into order_alerts (sales_order_id, status)
  values (p_so, 'sending')
  on conflict (sales_order_id) do update
    set status     = 'sending',
        attempts   = order_alerts.attempts + 1,
        last_error = null,
        updated_at = now()
    where order_alerts.attempts < 3
      and (
        order_alerts.status = 'failed'
        or (order_alerts.status = 'sending' and order_alerts.updated_at < now() - interval '10 minutes')
      );
  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end $$;

revoke execute on function claim_order_alert(uuid) from public, anon, authenticated;
grant execute on function claim_order_alert(uuid) to service_role;
