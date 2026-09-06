-- =====================================================================
-- Sales-set credit customer tag.
--
-- The sales team tags a customer as a "credit customer" at order time.
-- For a credit customer, payment is NOT collected upfront — the order
-- skips `awaiting_clearance` and drops straight into procurement's queue
-- (`to_be_ordered`). A regular customer's order still waits for a payment
-- to be recorded and confirmed by accounts.
--
-- Split of control:
--   * sales / accounts / admin  -> none <-> credit_regular
--   * accounts / admin only     -> place or lift `credit_hold`
--     (credit_hold is the value that hard-blocks dispatch, so it keeps a
--      segregation-of-duties backstop)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Let sales write the credit tag. credit_hold stays gated in a
--    trigger (an RLS policy can't branch on the *value* being set).
-- ---------------------------------------------------------------------

drop policy if exists write_customers on customers;
create policy write_customers on customers for all to authenticated
  using (coalesce(auth_role() in ('sales', 'accounts', 'admin'), false))
  with check (coalesce(auth_role() in ('sales', 'accounts', 'admin'), false));

create or replace function guard_customer_credit()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_old credit_status := case when tg_op = 'update' then old.credit_status else 'none' end;
begin
  -- Placing a hold, or lifting one, is accounts/admin only. Real end users
  -- only — server contexts (service role, Zoho sync) have no auth.uid().
  if new.credit_status is distinct from v_old
     and 'credit_hold' in (new.credit_status, v_old)
     and auth.uid() is not null
     and not coalesce(auth_role() in ('accounts', 'admin'), false) then
    raise exception 'Only accounts can place or lift a credit hold'
      using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_customer_credit on customers;
create trigger trg_guard_customer_credit
before insert or update on customers
for each row execute function guard_customer_credit();

-- ---------------------------------------------------------------------
-- 2. Entry state depends on the customer's credit standing.
--    credit_regular -> straight to procurement; everyone else waits.
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- 3. Tagging a customer credit_regular after their orders already exist
--    must release anything stuck in awaiting_clearance. Going on hold
--    or back to none leaves orders where they are — the dispatch gate
--    handles the block at transition time.
-- ---------------------------------------------------------------------

create or replace function propagate_credit_regular()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.credit_status = 'credit_regular'
     and new.credit_status is distinct from old.credit_status then
    update order_ops
      set status = 'to_be_ordered', status_since = now()
    where status = 'awaiting_clearance'
      and sales_order_id in (select id from sales_orders where customer_id = new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_propagate_credit_regular on customers;
create trigger trg_propagate_credit_regular
after update on customers
for each row execute function propagate_credit_regular();

-- ---------------------------------------------------------------------
-- 4. One-time backfill: existing credit_regular customers whose orders
--    are still parked in awaiting_clearance.
-- ---------------------------------------------------------------------

update order_ops o
  set status = 'to_be_ordered', status_since = now()
from sales_orders so
join customers c on c.id = so.customer_id
where o.sales_order_id = so.id
  and o.status = 'awaiting_clearance'
  and c.credit_status = 'credit_regular';
