-- =====================================================================
-- Fixups for the payment clearance guard, found in acceptance testing.
--
--  1. guard_payment_clearance blocked *every* caller without a JWT —
--     the seed, the reconcile cron, and (later) the Gmail auto-confirm
--     all run with no auth.uid(). Only gate real logged-in users.
--  2. set_payment_clearance_default clobbered an explicitly-supplied
--     clearance_status. Treat 'pending' (the column default) as
--     "derive from method"; keep any other explicit value.
-- =====================================================================

create or replace function guard_payment_clearance()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.clearance_status is distinct from old.clearance_status then
    -- A real end user must be accounts/admin. Server contexts (service
    -- role, cron, migrations) have no auth.uid() and are trusted.
    if auth.uid() is not null
       and not coalesce(auth_role() in ('accounts', 'admin'), false) then
      raise exception 'Only accounts can confirm or bounce a payment'
        using errcode = 'insufficient_privilege';
    end if;
    if new.clearance_status = 'cleared' then
      new.cleared_on := coalesce(new.cleared_on, current_date);
      new.cleared_by := coalesce(new.cleared_by, auth.uid());
    end if;
    if new.clearance_status = 'bounced' then
      new.cleared_by := coalesce(new.cleared_by, auth.uid());
    end if;
  end if;
  return new;
end $$;

create or replace function set_payment_clearance_default()
returns trigger language plpgsql as $$
begin
  -- 'pending' means "not set" (it is the column default). Any other
  -- value was supplied on purpose (seed / import / backfill) — keep it.
  if new.clearance_status = 'pending' then
    new.clearance_status := case new.payment_method
      when 'cash'               then 'cleared'
      when 'upi'                then 'cleared'
      when 'credit_note'       then 'cleared'
      when 'advance_adjustment' then 'cleared'
      when 'tds_deducted'      then 'cleared'
      when 'write_off'         then 'cleared'
      else 'pending'
    end::clearance_status;
  end if;

  if new.clearance_status = 'cleared' then
    new.cleared_on := coalesce(new.cleared_on, new.paid_on, current_date);
    new.cleared_by := coalesce(new.cleared_by, new.recorded_by);
  end if;
  return new;
end $$;
