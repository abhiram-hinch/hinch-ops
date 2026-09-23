-- =====================================================================
-- Combined payments — a customer sometimes pays one lump sum that
-- covers 2-3 sales orders at once. Every payment row is still scoped to
-- exactly one order (matches Zoho's own model, and every gate/trigger
-- already keyed off that), so this doesn't change the write path at
-- all — a combined payment is just several ordinary payment rows,
-- inserted together in one request (Postgres already makes a multi-row
-- INSERT atomic, so no new RPC is needed), tagged with a shared
-- grouping id purely for traceability. The existing write_payments RLS
-- policy already covers this correctly since it's evaluated per row.
-- =====================================================================

alter table payments add column if not exists combined_payment_group uuid;

create index if not exists idx_payments_combined_group
  on payments(combined_payment_group)
  where combined_payment_group is not null;

comment on column payments.combined_payment_group is
  'Set when this payment was recorded as part of one customer payment split across several orders. Null = an ordinary single-order payment.';
