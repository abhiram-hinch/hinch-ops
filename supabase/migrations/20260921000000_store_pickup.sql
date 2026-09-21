-- =====================================================================
-- Store pickup — some customers collect their order in person from the
-- Hafeezpet store instead of us delivering. That order has no delivery
-- site at all, so the location/floor/service-lift fields are not just
-- unfillable, they're meaningless. Sales tags this explicitly; from
-- that point site_details_complete() treats it as automatically
-- satisfied, with no fields required.
--
-- This migration also restores a check that was silently lost: when
-- 20260920000100 did its own `create or replace view v_ops_board` (to
-- add procurement_location_label), it carried forward blocked_on_site_
-- details' PRE-grandfather-clause logic instead of the fixed version
-- from 20260920000000 — so the cutoff-date check never actually made
-- it into the live view, only into the trigger functions that do the
-- real gating. The functions were correct the whole time (confirmed:
-- zero production orders currently have an order_date on/after the
-- cutoff, so this had no visible effect yet), but the view's own copy
-- of the logic had drifted. Fixed here by having the view call
-- site_details_gate_required()/site_details_complete() directly
-- instead of duplicating their logic inline — a future column change
-- to either function now can't cause this again.
-- =====================================================================

alter table delivery_site_details add column if not exists is_store_pickup boolean not null default false;

create or replace function site_details_complete(p_so uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from delivery_site_details
    where sales_order_id = p_so
      and (
        is_store_pickup
        or (
          maps_url is not null and btrim(maps_url) <> ''
          and floor is not null and btrim(floor) <> ''
          and has_service_lift is not null
        )
      )
  )
$$;

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
  v.is_store_pickup
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
      )
      and site_details_gate_required(so.id)
      and not site_details_complete(so.id)
    ) as blocked_on_site_details,
    coalesce(dsd.is_store_pickup, false) as is_store_pickup,
    ops.procurement_location_id
  from sales_orders so
  join order_ops ops on ops.sales_order_id = so.id
  left join customers c on c.id = so.customer_id
  left join profiles pf on pf.id = ops.procure_first_by
  left join delivery_site_details dsd on dsd.sales_order_id = so.id
  where so.is_approved
    and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval')
) v
left join procurement_locations pl on pl.id = v.procurement_location_id;
