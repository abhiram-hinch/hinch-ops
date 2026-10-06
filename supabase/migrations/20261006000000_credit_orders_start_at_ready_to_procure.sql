-- =====================================================================
-- Orders for credit_regular customers skip "Awaiting payment" and start
-- at "Ready to procure" — they don't pay up front, so there's nothing to
-- wait for.
--
-- This was the original behaviour (20260901020000_sales_credit_tag.sql).
-- It was dropped by 20260920000000_site_details_mandatory_gate.sql, which
-- forced every new order to start at awaiting_clearance because site
-- details can't exist at the instant an order is created. That gate has
-- since been switched off (20261005000000), so the fast path comes back.
-- Until now a credit customer's new order sat at Awaiting payment, because
-- the only remaining release (propagate_credit_regular) fires when a
-- customer is *tagged* credit_regular, never when a new order arrives.
--
-- credit_hold customers are deliberately not included: only credit_regular
-- ever skipped payment.
-- =====================================================================

-- 1. New orders: start at Ready to procure for a credit_regular customer.
create or replace function ensure_order_ops()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_credit credit_status;
begin
  select credit_status into v_credit from customers where id = new.customer_id;

  insert into order_ops (sales_order_id, status)
  values (
    new.id,
    case
      when v_credit = 'credit_regular' then 'to_be_ordered'::dispatch_status
      else 'awaiting_clearance'::dispatch_status
    end
  )
  on conflict (sales_order_id) do nothing;
  return new;
end $$;

-- 2. An order whose customer link arrives after it was first created (the
--    sync links customers by Zoho contact; if that resolves on a later run
--    the order was created unlinked) is released the moment it's linked.
create or replace function release_on_customer_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null
     and exists (select 1 from customers c where c.id = new.customer_id and c.credit_status = 'credit_regular') then
    update order_ops
       set status = 'to_be_ordered', status_since = now(), updated_at = now()
     where sales_order_id = new.id and status = 'awaiting_clearance';
  end if;
  return new;
end $$;

drop trigger if exists trg_release_on_customer_link on sales_orders;
create trigger trg_release_on_customer_link
after update of customer_id on sales_orders
for each row
when (new.customer_id is distinct from old.customer_id)
execute function release_on_customer_link();

-- 3. Release credit_regular orders already sitting at Awaiting payment.
--    Each move is recorded in activity_log by the order_ops audit trigger.
update order_ops o
   set status = 'to_be_ordered', status_since = now(), updated_at = now()
  from sales_orders so
  join customers c on c.id = so.customer_id
 where o.sales_order_id = so.id
   and o.status = 'awaiting_clearance'
   and c.credit_status = 'credit_regular';
