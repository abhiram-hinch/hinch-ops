-- =====================================================================
-- Opening balance — a lot of older sales orders already had payments
-- made against them before this app's payment ledger existed, so
-- total_received/total_outstanding understate what's actually been
-- collected. Rather than trying to backfill a payments row for every
-- historical order, let accounts/admin record one manual correction
-- per customer: how much was already received before tracking started.
-- =====================================================================

alter table customers add column if not exists opening_balance_paid numeric(14,2) not null default 0;

create or replace view v_customer_summary
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.credit_status,
  c.credit_limit,
  c.credit_days,
  c.notes,
  count(so.id) as order_count,
  coalesce(sum(so.total), 0)::numeric(14,2) as total_value,
  (coalesce(sum(so.amount_received), 0) + c.opening_balance_paid)::numeric(14,2) as total_received,
  (coalesce(sum(so.total - so.amount_received), 0) - c.opening_balance_paid)::numeric(14,2) as total_outstanding,
  max(so.order_date) as last_order_date,
  c.opening_balance_paid
from customers c
left join sales_orders so
  on so.customer_id = c.id
  and so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval')
group by c.id, c.name, c.credit_status, c.credit_limit, c.credit_days, c.notes, c.opening_balance_paid
having count(so.id) > 0
order by total_value desc;
