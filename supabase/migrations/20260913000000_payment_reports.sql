-- =====================================================================
-- Daily / weekly payment totals for the admin-only reports view. Voided
-- payments are excluded entirely — they were never really received.
-- Grouped by paid_on (the business date money came in), not recorded_at
-- (when someone happened to type it into the system).
-- =====================================================================

create view v_payment_daily_totals
with (security_invoker = true) as
select
  paid_on::date as day,
  count(*) as payment_count,
  coalesce(sum(amount), 0)::numeric(14,2) as total_amount,
  coalesce(sum(amount) filter (where clearance_status = 'cleared'), 0)::numeric(14,2) as cleared_amount,
  coalesce(sum(amount) filter (where clearance_status = 'pending'), 0)::numeric(14,2) as pending_amount
from payments
where not voided
group by paid_on::date
order by day desc;

create view v_payment_weekly_totals
with (security_invoker = true) as
select
  date_trunc('week', paid_on)::date as week_start,
  count(*) as payment_count,
  coalesce(sum(amount), 0)::numeric(14,2) as total_amount,
  coalesce(sum(amount) filter (where clearance_status = 'cleared'), 0)::numeric(14,2) as cleared_amount,
  coalesce(sum(amount) filter (where clearance_status = 'pending'), 0)::numeric(14,2) as pending_amount
from payments
where not voided
group by date_trunc('week', paid_on)
order by week_start desc;
