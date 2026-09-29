-- =====================================================================
-- A sales order deleted outright in Zoho (not voided — actually removed)
-- never generates a webhook and never reappears in the poll's "modified
-- since" scan, so it would otherwise sit in our mirror forever, still
-- showing on the dashboard with stale data. This adds a daily full
-- reconciliation: page through every sales order Zoho currently has,
-- and any order we still show as active whose id is no longer in that
-- list gets marked 'deleted_in_zoho' — a distinct status from a real
-- Zoho-side void, so the two are never confused later — and excluded
-- from the board the same way void/draft orders already are.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Recognise the new status everywhere "hidden by default" is decided
-- ---------------------------------------------------------------------

create or replace view v_ops_board
with (security_invoker = true) as
select
  v.id,
  v.so_number,
  v.order_date,
  v.customer_name,
  v.salesperson_name,
  v.total,
  v.amount_received,
  v.amount_pending_clearance,
  v.balance_due,
  v.payment_status,
  v.zoho_status,
  v.dispatch_status,
  v.hold_reason,
  v.stage_before_hold,
  v.status_since,
  v.days_in_status,
  v.last_synced_at,
  v.quotation_ref,
  v.zoho_salesorder_id,
  v.zoho_shipped_status,
  v.zoho_invoiced_status,
  v.delivery_date,
  v.total_quantity,
  v.ship_to,
  v.contact_phone,
  v.contact_email,
  v.notes,
  v.so_pdf_path,
  v.detail_synced_at,
  v.quotation_ref_override,
  v.customer_credit_status,
  v.credit_days,
  v.is_procure_first,
  v.procure_first_at,
  v.procure_first_note,
  v.procure_first_by_name,
  v.is_overdue,
  v.needs_attention,
  v.po_count,
  v.po_received,
  v.dispatch_count,
  v.delivered_count,
  v.has_service_lift,
  v.customer_id,
  v.blocked_on_site_details,
  v.procurement_location_id,
  pl.label as procurement_location_label,
  v.is_store_pickup,
  v.dispatch_before_payment_at,
  v.dispatch_before_payment_note,
  v.dispatch_before_payment_by_name,
  v.dispatch_locked_on_payment,
  v.dispatched_awaiting_payment
from (
  select
    so.id,
    so.so_number,
    so.order_date,
    so.customer_name,
    so.salesperson_name,
    so.total,
    so.amount_received,
    so.amount_pending_clearance,
    so.total - so.amount_received as balance_due,
    so.payment_status,
    so.zoho_status,
    ops.status        as dispatch_status,
    ops.hold_reason,
    ops.stage_before_hold,
    ops.status_since,
    extract(day from now() - ops.status_since)::int as days_in_status,
    so.last_synced_at,
    so.quotation_ref,
    so.zoho_salesorder_id,
    so.zoho_shipped_status,
    so.zoho_invoiced_status,
    so.delivery_date,
    so.total_quantity,
    so.ship_to,
    so.contact_phone,
    so.contact_email,
    so.notes,
    so.so_pdf_path,
    so.detail_synced_at,
    so.quotation_ref_override,
    coalesce(c.credit_status, 'none')::text as customer_credit_status,
    c.credit_days,
    ops.procure_first_at is not null as is_procure_first,
    ops.procure_first_at,
    ops.procure_first_note,
    pf.full_name as procure_first_by_name,
    (
      c.credit_status in ('credit_regular', 'credit_hold')
      and (so.total - so.amount_received) > 0.01
      and (so.order_date + coalesce(c.credit_days, 0)) < current_date
    ) as is_overdue,
    (
      ops.status = 'on_hold'
      or (
        ops.status in ('at_warehouse', 'ready_to_dispatch')
        and so.total - so.amount_received > 0.01
        and ops.procure_first_at is null
      )
      or (
        ops.status in ('awaiting_clearance', 'to_be_ordered', 'ordered', 'in_transit',
                       'at_warehouse', 'ready_to_dispatch', 'partially_dispatched',
                       'partially_delivered')
        and extract(day from now() - ops.status_since)::int >= 3
        and not (
          ops.procure_first_at is not null
          and ops.status in ('at_warehouse', 'ready_to_dispatch')
        )
      )
    ) as needs_attention,
    (select count(*) from vendor_pos v where v.sales_order_id = so.id) as po_count,
    (select count(*) from vendor_pos v
       where v.sales_order_id = so.id and v.stage = 'received') as po_received,
    (select count(*) from dispatches d where d.sales_order_id = so.id) as dispatch_count,
    (select count(*) from dispatches d
       where d.sales_order_id = so.id and d.delivered_at is not null) as delivered_count,
    dsd.has_service_lift,
    so.customer_id,
    (
      ops.status = 'awaiting_clearance'
      and (
        so.payment_status in ('advance_paid', 'fully_paid', 'overpaid')
        or coalesce(c.credit_status, 'none') = 'credit_regular'
        or ops.procure_first_at is not null
      )
      and site_details_gate_required(so.id)
      and not site_details_complete(so.id)
    ) as blocked_on_site_details,
    ops.procurement_location_id,
    coalesce(dsd.is_store_pickup, false) as is_store_pickup,
    ops.dispatch_before_payment_at,
    ops.dispatch_before_payment_note,
    dbf.full_name as dispatch_before_payment_by_name,
    (
      ops.procure_first_at is not null
      and ops.dispatch_before_payment_at is null
      and so.payment_status <> 'fully_paid'
      and coalesce(c.credit_status, 'none') <> 'credit_regular'
    ) as dispatch_locked_on_payment,
    (
      ops.status in ('partially_dispatched', 'dispatched', 'partially_delivered',
                     'delivered', 'fulfilled')
      and so.payment_status in ('pending', 'advance_paid')
    ) as dispatched_awaiting_payment
  from sales_orders so
  join order_ops ops on ops.sales_order_id = so.id
  left join customers c on c.id = so.customer_id
  left join profiles pf on pf.id = ops.procure_first_by
  left join profiles dbf on dbf.id = ops.dispatch_before_payment_by
  left join delivery_site_details dsd on dsd.sales_order_id = so.id
  where so.is_approved
    and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval', 'deleted_in_zoho')
) v
left join procurement_locations pl on pl.id = v.procurement_location_id;

-- ---------------------------------------------------------------------
-- 2. sync_runs needs a source value distinct from the 15-minute poll —
--    this is a much heavier, once-a-day job and the two should never be
--    confused when reading the sync health table.
-- ---------------------------------------------------------------------

alter table sync_runs drop constraint sync_runs_source_check;
alter table sync_runs add constraint sync_runs_source_check
  check (source in ('webhook', 'poll', 'manual', 'reconcile'));

-- ---------------------------------------------------------------------
-- 3. Daily schedule — same vault-secret + pg_net dispatch pattern as the
--    15-minute poll (see 20260831010000_realtime_and_sync.sql). Runs at
--    21:30 UTC = 03:00 IST, well outside working hours.
-- ---------------------------------------------------------------------

create or replace function trigger_so_reconcile()
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
    raise warning 'reconcile skipped: vault secrets not configured';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/zoho-so-reconcile',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    -- A full-catalogue page-through is slower than the incremental poll.
    timeout_milliseconds := 120000
  );
end $$;

revoke execute on function trigger_so_reconcile() from authenticated, anon;

select cron.schedule(
  'zoho-so-reconcile-daily',
  '30 21 * * *',
  $$select trigger_so_reconcile()$$
);
