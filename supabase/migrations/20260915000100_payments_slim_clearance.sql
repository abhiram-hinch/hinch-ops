-- =====================================================================
-- Fold clearance_status into v_payments_slim so the Payments analytics
-- tab can derive cleared/pending trends from one raw rowset instead of
-- a separately pre-aggregated view.
-- =====================================================================

create or replace view v_payments_slim
with (security_invoker = true) as
select
  paid_on,
  amount,
  payment_method,
  clearance_status
from payments
where not voided;
