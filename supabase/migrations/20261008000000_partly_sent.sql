-- =====================================================================
-- "Partly sent" worklist for the operations team.
--
-- v_partly_sent: every order that has had at least one challan but isn't
-- fully sent/delivered, regardless of its order date (the board defaults
-- to today, so an order that went out in two halves a week apart would
-- otherwise drop out of sight). For each one: how many goods lines are
-- sent, which are still pending and how much of each, when the last
-- challan went, and any service-type lines still open.
--
-- Goods and service lines are kept apart on purpose. The order stays
-- "partly sent" until EVERY line is sent (or a challan is marked final),
-- and a service line has nothing physical to ship — so an order whose
-- goods have all gone out can sit at "partly sent" for weeks over one
-- service line. Separating them lets the team see that case for what it
-- is (close the order out) instead of chasing stock that doesn't exist.
--
-- Built straight on order_ops / sales_orders, not on v_ops_board, whose
-- per-row subqueries make it slow to join against.
--
-- daily_digests: one row per (kind, day), claimed before the daily
-- WhatsApp nudge is sent so a retry or double trigger can't post it twice.
-- =====================================================================

create or replace view v_partly_sent
with (security_invoker = true) as
select
  so.id,
  so.so_number,
  so.customer_name,
  so.salesperson_name,
  so.order_date,
  so.total,
  so.quotation_ref,
  so.quotation_ref_override,
  o.status                                            as dispatch_status,
  o.status_since,
  extract(day from now() - o.status_since)::int       as days_in_stage,
  d.challans,
  d.last_dispatched_at,
  extract(day from now() - d.last_dispatched_at)::int as days_since_last_dispatch,
  g.goods_total,
  g.goods_sent,
  g.pending_goods,
  g.pending_service
from order_ops o
join sales_orders so on so.id = o.sales_order_id
cross join lateral (
  select count(*) as challans, max(dispatched_at) as last_dispatched_at
  from dispatches where sales_order_id = so.id
) d
cross join lateral (
  select
    count(*) filter (where coalesce(l.line_item_kind, 'goods') <> 'service' and l.quantity > 0)
      as goods_total,
    count(*) filter (where coalesce(l.line_item_kind, 'goods') <> 'service' and l.quantity > 0
                       and l.qty_dispatched >= l.quantity)
      as goods_sent,
    coalesce(jsonb_agg(
      jsonb_build_object('name', l.item_name, 'sku', l.item_sku, 'unit', l.unit,
                         'quantity', l.quantity, 'remaining', l.quantity - l.qty_dispatched)
      order by l.line_order)
      filter (where coalesce(l.line_item_kind, 'goods') <> 'service' and l.quantity > 0
                and l.qty_dispatched < l.quantity), '[]'::jsonb)
      as pending_goods,
    coalesce(jsonb_agg(
      jsonb_build_object('name', l.item_name, 'sku', l.item_sku, 'unit', l.unit,
                         'quantity', l.quantity, 'remaining', l.quantity - l.qty_dispatched)
      order by l.line_order)
      filter (where l.line_item_kind = 'service' and l.quantity > 0
                and l.qty_dispatched < l.quantity), '[]'::jsonb)
      as pending_service
  from sales_order_lines l where l.sales_order_id = so.id
) g
where o.status in ('partially_dispatched', 'partially_delivered')
  and so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval', 'deleted_in_zoho');

-- ---------------------------------------------------------------------
-- Once-a-day claim for the WhatsApp digest.
-- ---------------------------------------------------------------------
create table daily_digests (
  kind       text not null,
  day        date not null,
  status     text not null check (status in ('sending', 'sent')),
  order_count int,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  primary key (kind, day)
);

alter table daily_digests enable row level security;

-- Written only by the edge function (service role bypasses RLS); admins can read.
create policy read_daily_digests on daily_digests for select to authenticated using (is_admin());

-- ---------------------------------------------------------------------
-- Daily schedule — same vault-secret + pg_net dispatch pattern as the
-- Zoho poll. 04:30 UTC = 10:00 IST, Monday to Saturday. The function
-- does nothing until PERISKOPE_OPS_GROUP_CHAT_ID is set.
-- ---------------------------------------------------------------------
create or replace function trigger_pending_digest()
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
    raise warning 'pending digest skipped: vault secrets not configured';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/pending-dispatch-digest',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;

revoke execute on function trigger_pending_digest() from authenticated, anon;

select cron.schedule(
  'pending-dispatch-digest-daily',
  '30 4 * * 1-6',
  $$select trigger_pending_digest()$$
);
