-- =====================================================================
-- Delivery site logistics — floor, block, flat/villa number, whether a
-- service (goods) lift exists, and free-form access notes. Captured so
-- dispatch can plan hamali headcount and equipment before the truck
-- leaves, not after it's stuck outside a building with no lift.
--
-- Not a payment/dispatch-state mutation, so no activity_log entry and
-- no gate logic — any active team member may record or correct it, same
-- as order_comments.
-- =====================================================================

create type building_type as enum ('apartment', 'villa', 'independent_house', 'commercial', 'other');

create table delivery_site_details (
  sales_order_id    uuid primary key references sales_orders(id) on delete cascade,
  building_type     building_type,
  block             text,
  floor             text,
  flat_or_villa_no  text,
  has_service_lift  boolean,
  notes             text,
  updated_by        uuid references profiles(id),
  updated_at        timestamptz not null default now()
);

alter table delivery_site_details enable row level security;

create policy read_site_details on delivery_site_details
  for select to authenticated using (true);

create policy write_site_details on delivery_site_details
  for all to authenticated
  using (auth_role() is not null)
  with check (auth_role() is not null);

-- Surface the one fact worth a board-level heads-up: no service lift.
-- Everything else lives on the order's Site tab. `create or replace` (not
-- drop+create) because v_ops_board_totals depends on this view — adding
-- a trailing column is compatible, dropping would cascade-break it.
-- Reproduces the live definition (incl. the procure-first columns added
-- since the copy in 20260901030000) verbatim, plus one appended column.
create or replace view v_ops_board
with (security_invoker = true) as
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
  dsd.has_service_lift
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
left join customers c on c.id = so.customer_id
left join profiles pf on pf.id = ops.procure_first_by
left join delivery_site_details dsd on dsd.sales_order_id = so.id
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval');
