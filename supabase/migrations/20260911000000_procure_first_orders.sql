-- =====================================================================
-- Procure-first orders
--
-- Two real sales patterns, neither of which is a credit sale:
--   1. Customer pays an advance, we procure, we dispatch on full payment.
--   2. Customer asks us to procure first with nothing (or little) paid,
--      and we still dispatch only on full payment.
--
-- (1) already works: an advance clears, the order leaves
-- `awaiting_clearance`, the ADVISORY procurement gate lets it through, and
-- the dispatch gate holds it until `fully_paid`.
--
-- (2) also moves today, but leaves no trace of the decision. Committing
-- working capital to stock for a customer with no credit standing is a
-- commercial call, and right now it is indistinguishable from someone
-- pushing an unpaid order forward by mistake — both emit the same
-- `procurement_gate_override` line.
--
-- This migration records the decision instead of inferring it:
--   - who authorised procure-first on this order, when, and why
--   - the advisory procurement override stops firing once authorised
--     (the authorisation IS the record; a second warning is noise)
--   - the board can tell the two apart and stops flagging an authorised
--     order that is legitimately parked awaiting final payment
--
-- THE DISPATCH GATE IS DELIBERATELY UNTOUCHED. Both patterns dispatch
-- against full payment, which is already what the gate demands of a
-- non-credit customer. No third gate mode (see CLAUDE.md).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The authorisation, on the order
-- ---------------------------------------------------------------------
alter table order_ops
  add column if not exists procure_first_at   timestamptz,
  add column if not exists procure_first_by   uuid references profiles(id),
  add column if not exists procure_first_note text;

comment on column order_ops.procure_first_at is
  'Set when someone authorises procuring this order ahead of payment. Null = ordinary order.';

create index if not exists idx_ops_procure_first
  on order_ops(procure_first_at) where procure_first_at is not null;

-- ---------------------------------------------------------------------
-- 2. Who may authorise it
--
-- Sales hear the request, accounts carry the cash exposure, admin covers
-- both. Deliberately NOT can_edit_dispatch(): warehouse moves stock, it
-- does not commit working capital.
-- ---------------------------------------------------------------------
create or replace function can_authorize_procure_first() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth_role() in ('sales', 'accounts', 'admin'), false)
$$;

-- ---------------------------------------------------------------------
-- 3. The write path
--
-- RLS on order_ops restricts UPDATE to can_edit_dispatch() (ops,
-- warehouse, admin), so sales and accounts cannot write these columns
-- directly — by design. This function is the only way in, and it checks
-- the role itself. Calling it straight from the API console is as safe as
-- calling it from the UI.
-- ---------------------------------------------------------------------
create or replace function set_procure_first(
  p_so   uuid,
  p_on   boolean,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_was  timestamptz;
  v_found boolean;
begin
  if not can_authorize_procure_first() then
    raise exception 'Your role cannot authorise procuring an order before payment'
      using errcode = 'insufficient_privilege';
  end if;

  select procure_first_at, true into v_was, v_found
  from order_ops where sales_order_id = p_so;

  if not coalesce(v_found, false) then
    raise exception 'No order found for %', p_so using errcode = 'no_data_found';
  end if;

  if p_on then
    -- idempotent: re-authorising keeps the original author and timestamp
    if v_was is not null then
      return true;
    end if;
    update order_ops
       set procure_first_at   = now(),
           procure_first_by   = auth.uid(),
           procure_first_note = v_note,
           updated_at         = now()
     where sales_order_id = p_so;

    perform log_activity(p_so, 'order_ops', p_so::text, 'procure_first_authorised',
      null,
      jsonb_build_object('note', v_note, 'by', auth.uid()));
    return true;
  else
    if v_was is null then
      return false;
    end if;
    update order_ops
       set procure_first_at   = null,
           procure_first_by   = null,
           procure_first_note = null,
           updated_at         = now()
     where sales_order_id = p_so;

    perform log_activity(p_so, 'order_ops', p_so::text, 'procure_first_withdrawn',
      jsonb_build_object('authorised_at', v_was),
      jsonb_build_object('by', auth.uid()));
    return false;
  end if;
end $$;

revoke execute on function set_procure_first(uuid, boolean, text) from anon;

-- ---------------------------------------------------------------------
-- 4. Procurement gate — stay advisory, but stop crying wolf
--
-- Identical to 20260901010100 except for the single added condition on
-- the procurement branch. The dispatch branch below is byte-for-byte the
-- same: full payment still required for a non-credit customer, credit
-- hold still hard-blocks in both modes.
-- ---------------------------------------------------------------------
create or replace function enforce_dispatch_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total  numeric(14,2);
  v_recv   numeric(14,2);
  v_pstat  text;
  v_credit credit_status;
  v_mode   text;
  v_ratio  numeric;
  v_short  numeric(14,2);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  new.status_since := now();
  new.updated_at   := now();
  if new.status = 'dispatched' and new.dispatched_at is null then new.dispatched_at := now(); end if;
  if new.status = 'delivered'  and new.delivered_at  is null then new.delivered_at  := now(); end if;
  if new.status <> 'on_hold' then new.hold_reason := null; end if;

  select so.total, so.amount_received, so.payment_status, coalesce(c.credit_status, 'none')
    into v_total, v_recv, v_pstat, v_credit
  from sales_orders so
  left join customers c on c.id = so.customer_id
  where so.id = new.sales_order_id;

  -- Procurement gate — ADVISORY. Never blocks; just records the shortfall.
  -- An authorised procure-first order is not a surprise, so it is not logged
  -- as an override: the authorisation is already in activity_log.
  if new.status = 'ordered' and new.procure_first_at is null then
    v_ratio := coalesce(config_numeric('procurement_min_paid_ratio'), 0);
    v_short := (coalesce(v_total, 0) * v_ratio) - coalesce(v_recv, 0);
    if v_short > 0.01 and v_credit <> 'credit_regular' then
      perform log_activity(new.sales_order_id, 'order_ops', new.sales_order_id::text,
        'procurement_gate_override',
        jsonb_build_object('status', old.status),
        jsonb_build_object('status', new.status, 'shortfall', v_short,
          'amount_cleared', v_recv, 'order_total', v_total, 'credit_status', v_credit));
    end if;
  end if;

  -- Dispatch gate — real. UNCHANGED.
  if new.status in ('ready_to_dispatch', 'partially_dispatched', 'dispatched') then
    if v_credit = 'credit_hold' then
      raise exception 'Dispatch blocked: customer is on credit hold.'
        using errcode = 'check_violation';
    end if;
    if v_credit <> 'credit_regular' and v_pstat <> 'fully_paid' then
      v_short := coalesce(v_total, 0) - coalesce(v_recv, 0);
      v_mode  := config_text('dispatch_gate_mode');
      if v_mode = 'hard' then
        raise exception 'Dispatch blocked: % still due (cleared % of %).',
          v_short, v_recv, coalesce(v_total, 0) using errcode = 'check_violation';
      else
        perform log_activity(new.sales_order_id, 'order_ops', new.sales_order_id::text,
          'dispatch_gate_override',
          jsonb_build_object('status', old.status),
          jsonb_build_object('status', new.status, 'shortfall', v_short,
            'amount_cleared', v_recv, 'order_total', v_total, 'credit_status', v_credit));
      end if;
    end if;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Board view — surface the authorisation, and stop flagging it
--
-- Rebuilt from 20260901030000 with three added columns and one changed
-- expression. Everything else is carried over verbatim.
--
-- needs_attention, for an authorised procure-first order:
--   - parked at the warehouse awaiting final payment  -> NOT flagged.
--     That is the agreed shape of the deal, not a problem. Accounts still
--     chase it from the payment queue.
--   - slow in procurement (ordered / in transit)      -> still flagged.
--     Authorising the spend does not excuse a vendor sitting on it.
-- ---------------------------------------------------------------------
drop view if exists v_ops_board_totals;
drop view if exists v_ops_board;

create view v_ops_board
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
  (ops.procure_first_at is not null)              as is_procure_first,
  ops.procure_first_at,
  ops.procure_first_note,
  pf.full_name                                    as procure_first_by_name,
  (
    c.credit_status in ('credit_regular', 'credit_hold')
    and (so.total - so.amount_received) > 0.01
    and (so.order_date + coalesce(c.credit_days, 0)) < current_date
  ) as is_overdue,
  (
    ops.status = 'on_hold'
    or (ops.status in ('at_warehouse', 'ready_to_dispatch')
        and so.total - so.amount_received > 0.01
        and ops.procure_first_at is null)
    or (
      ops.status in ('awaiting_clearance', 'to_be_ordered', 'ordered', 'in_transit',
                     'at_warehouse', 'ready_to_dispatch', 'partially_dispatched',
                     'partially_delivered')
      and extract(day from now() - ops.status_since)::int >= 3
      and not (ops.procure_first_at is not null
               and ops.status in ('at_warehouse', 'ready_to_dispatch'))
    )
  ) as needs_attention,
  (select count(*) from vendor_pos v where v.sales_order_id = so.id) as po_count,
  (select count(*) from vendor_pos v
     where v.sales_order_id = so.id and v.stage = 'received') as po_received,
  (select count(*) from dispatches d where d.sales_order_id = so.id) as dispatch_count,
  (select count(*) from dispatches d
     where d.sales_order_id = so.id and d.delivered_at is not null) as delivered_count
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
left join customers c on c.id = so.customer_id
left join profiles pf on pf.id = ops.procure_first_by
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval');

create view v_ops_board_totals
with (security_invoker = true) as
select dispatch_status::text as key, count(*)::int as count,
       coalesce(sum(total), 0)::float8 as value
from v_ops_board
group by dispatch_status
union all
select 'attention', count(*)::int, coalesce(sum(total), 0)::float8
from v_ops_board
where needs_attention;
