-- =====================================================================
-- Seed the accounts / cash boxes a payment can land in. These are the
-- options behind "Received in" on the payment form; a payment's
-- deposited_to points here.
--
-- kind: bank = a real bank account, cash_box = a person's cash float
-- (they owe it back to the company — the future settlement ledger keys
-- off these).
-- =====================================================================

alter table bank_accounts
  add constraint bank_accounts_label_key unique (label);

insert into bank_accounts (label, kind) values
  ('Homenest HDFC Account', 'bank'),
  ('Third Party Account',   'bank'),
  ('Kapish Account',        'cash_box'),
  ('Abhiram Acc',           'cash_box')
on conflict (label) do nothing;

-- ---------------------------------------------------------------------
-- Payment queue: surface the destination account (deposited_to) instead
-- of the recorder-as-receiver, so accounts can see where the money went.
-- ---------------------------------------------------------------------
drop view if exists v_payment_queue;
create view v_payment_queue
with (security_invoker = true) as
select
  p.id,
  p.sales_order_id,
  p.amount,
  p.payment_method,
  p.reference_no,
  p.paid_on,
  p.recorded_at,
  p.deposited_to,
  ba.label as deposited_to_label,
  p.note,
  s.so_number,
  coalesce(s.quotation_ref_override, s.quotation_ref) as quotation_ref,
  s.customer_name,
  s.total,
  coalesce(c.credit_status, 'none')::text as customer_credit_status
from payments p
join sales_orders s on s.id = p.sales_order_id
left join customers c on c.id = s.customer_id
left join bank_accounts ba on ba.id = p.deposited_to
where p.clearance_status = 'pending' and not p.voided
order by p.paid_on asc, p.recorded_at asc;
