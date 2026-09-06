-- =====================================================================
-- Manual order-status actions.
--
-- The rollup (recompute_order_ops) owns the automatic stages. These are
-- the human overrides warehouse/ops apply on top: hold, resume, cancel,
-- reactivate, mark ready-to-dispatch, mark fulfilled. All go through one
-- role-checked, audited function so the client never writes order_ops
-- directly.
-- =====================================================================

create or replace function order_action(
  p_so uuid,
  p_action text,
  p_reason text default null
)
returns dispatch_status
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  cur    dispatch_status;
  nextv  dispatch_status;
  reason text := nullif(btrim(p_reason), '');
  n_disp int;
begin
  if not can_edit_dispatch() then
    raise exception 'Your role cannot change dispatch status'
      using errcode = 'insufficient_privilege';
  end if;

  select status into cur from order_ops where sales_order_id = p_so;
  if cur is null then
    raise exception 'No order_ops row for %', p_so;
  end if;

  select count(*) into n_disp from dispatches where sales_order_id = p_so;

  case p_action
    when 'hold' then
      if reason is null then
        raise exception 'A hold needs a reason' using errcode = 'check_violation';
      end if;
      if cur not in ('on_hold', 'cancelled') then
        update order_ops set stage_before_hold = cur where sales_order_id = p_so;
      end if;
      nextv := 'on_hold';
      update order_ops
         set status = nextv, hold_reason = reason, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'resume' then
      if cur <> 'on_hold' then return cur; end if;
      nextv := compute_order_stage(p_so);
      update order_ops
         set status = nextv, hold_reason = null, stage_before_hold = null,
             status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'cancel' then
      if cur not in ('on_hold', 'cancelled') then
        update order_ops set stage_before_hold = cur where sales_order_id = p_so;
      end if;
      nextv := 'cancelled';
      update order_ops
         set status = nextv, hold_reason = null, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'reactivate' then
      if cur <> 'cancelled' then return cur; end if;
      nextv := compute_order_stage(p_so);
      update order_ops
         set status = nextv, stage_before_hold = null,
             status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'ready' then
      if n_disp > 0 then
        raise exception 'Order already has dispatch challans' using errcode = 'check_violation';
      end if;
      nextv := 'ready_to_dispatch';
      update order_ops
         set status = nextv, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'unready' then
      nextv := compute_order_stage(p_so);
      update order_ops
         set status = nextv, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'fulfill' then
      if cur <> 'delivered' then
        raise exception 'Only a delivered order can be marked fulfilled'
          using errcode = 'check_violation';
      end if;
      nextv := 'fulfilled';
      update order_ops
         set status = nextv, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'unfulfill' then
      if cur <> 'fulfilled' then return cur; end if;
      nextv := compute_order_stage(p_so);
      update order_ops
         set status = nextv, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    else
      raise exception 'Unknown action %', p_action;
  end case;

  perform log_activity(
    p_so, 'order_ops', p_so::text, 'status_' || p_action,
    jsonb_build_object('status', cur),
    jsonb_build_object('status', nextv, 'reason', reason));

  return nextv;
end $$;

revoke execute on function order_action(uuid, text, text) from anon;
