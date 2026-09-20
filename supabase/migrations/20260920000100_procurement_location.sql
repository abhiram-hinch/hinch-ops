-- =====================================================================
-- Procurement location — which physical location an order is procured/
-- dispatched from. Usually implicit, but urgent orders sometimes get
-- pulled from a different hub, and sales needs to say so explicitly per
-- order. A lookup table (not a hardcoded enum) so admin can add a third
-- location later without a migration — mirrors bank_accounts.
-- =====================================================================

create table procurement_locations (
  id     uuid primary key default gen_random_uuid(),
  label  text not null unique,
  active boolean not null default true
);

insert into procurement_locations (label) values
  ('Hafeezpet Warehouse'),
  ('Goshamahal Hub');

alter table procurement_locations enable row level security;
create policy read_procurement_locations on procurement_locations
  for select to authenticated using (true);
create policy write_procurement_locations on procurement_locations
  for all to authenticated
  using (is_admin()) with check (is_admin());

alter table order_ops
  add column if not exists procurement_location_id uuid references procurement_locations(id);

-- Sales calls the shot on where an order is procured from; can_edit_dispatch()
-- (ops/warehouse/admin) already owns order_ops directly, so this needs its own
-- RPC the same way set_procure_first does.
create or replace function can_set_procurement_location() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth_role() in ('sales', 'admin'), false)
$$;

create or replace function set_procurement_location(p_so uuid, p_location_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not can_set_procurement_location() then
    raise exception 'Your role cannot set the procurement location'
      using errcode = 'insufficient_privilege';
  end if;

  if p_location_id is not null and not exists (
    select 1 from procurement_locations where id = p_location_id and active
  ) then
    raise exception 'Unknown or inactive procurement location' using errcode = 'check_violation';
  end if;

  update order_ops set procurement_location_id = p_location_id, updated_at = now()
  where sales_order_id = p_so;

  if not found then
    raise exception 'No order found for %', p_so using errcode = 'no_data_found';
  end if;

  perform log_activity(p_so, 'order_ops', p_so::text, 'procurement_location_set',
    null, jsonb_build_object('location_id', p_location_id));
end $$;

revoke execute on function set_procurement_location(uuid, uuid) from anon;

create or replace view v_ops_board
with (security_invoker = true) as
select v.*, pl.label as procurement_location_label
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
      and not coalesce(
        dsd.maps_url is not null and btrim(dsd.maps_url) <> ''
        and dsd.floor is not null and btrim(dsd.floor) <> ''
        and dsd.has_service_lift is not null,
        false
      )
    ) as blocked_on_site_details,
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
