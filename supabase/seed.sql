-- =====================================================================
-- Sample data for local development.
--
-- Run AFTER the first migration:
--   psql "$DB_URL" -f supabase/seed.sql
--
-- Safe to re-run: everything keys on zoho_salesorder_id and upserts.
-- Never run this against production.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Orders. Spread across payment states so every board view has content.
-- ---------------------------------------------------------------------

insert into sales_orders
  (zoho_salesorder_id, so_number, customer_name, salesperson_name,
   order_date, total, zoho_status, is_approved)
values
  ('SEED-1',  'SO-02418', 'Ramesh Interiors',        'Anil',    current_date - 1,  248500, 'open', true),
  ('SEED-2',  'SO-02417', 'Kalyan Constructions',    'Sridhar', current_date - 2,   86200, 'open', true),
  ('SEED-3',  'SO-02416', 'Studio Vaastu',           'Anil',    current_date - 2,  512000, 'open', true),
  ('SEED-4',  'SO-02415', 'Praneeth Reddy',          'Kavya',   current_date - 4,   34750, 'open', true),
  ('SEED-5',  'SO-02414', 'Habitat Design Co',       'Sridhar', current_date - 5,  178900, 'open', true),
  ('SEED-6',  'SO-02413', 'Sai Krupa Builders',      'Kavya',   current_date - 6,   96400, 'open', true),
  ('SEED-7',  'SO-02412', 'Ar. Meghana Rao',         'Anil',    current_date - 8,  305600, 'open', true),
  ('SEED-8',  'SO-02411', 'Nirmaan Interiors',       'Sridhar', current_date - 9,   61200, 'open', true),
  ('SEED-9',  'SO-02410', 'Vamshi Enterprises',      'Kavya',   current_date - 11, 143000, 'open', true),
  ('SEED-10', 'SO-02409', 'Lakshmi Modular Kitchens','Anil',    current_date - 13, 227400, 'open', true),
  ('SEED-11', 'SO-02408', 'Deccan Realty Fitouts',   'Sridhar', current_date - 15, 418000, 'open', true),
  ('SEED-12', 'SO-02407', 'Harish Kumar',            'Kavya',   current_date - 18,  29900, 'open', true),
  -- Draft: mirrored but must NOT appear on the board.
  ('SEED-13', 'SO-02419', 'Unconfirmed Enquiry',     'Anil',    current_date,       55000, 'draft', false)
on conflict (zoho_salesorder_id) do update
  set total = excluded.total, customer_name = excluded.customer_name;

-- ---------------------------------------------------------------------
-- Line items
-- ---------------------------------------------------------------------

insert into sales_order_lines
  (sales_order_id, zoho_line_item_id, item_name, item_sku, quantity, rate, amount, line_order)
select so.id, v.lid, v.item, v.sku, v.qty, v.rate, v.qty * v.rate, v.ord
from (values
  ('SEED-1',  'L1', '18mm BWP Plywood 8x4',            'PLY-BWP-18',  22, 4250,  0),
  ('SEED-1',  'L2', 'Merino Laminate 1mm — Walnut',    'LAM-MR-1809', 40, 1180,  1),
  ('SEED-1',  'L3', 'Soft-close Hinges',               'HW-HNG-SC',   96,  185,  2),
  ('SEED-2',  'L1', '12mm MR Plywood 8x4',             'PLY-MR-12',   14, 2900,  0),
  ('SEED-2',  'L2', 'Edge Banding 22mm',               'EB-22-WHT',   60,  145,  1),
  ('SEED-3',  'L1', 'Teak Veneer 4x8 — Crown Cut',     'VEN-TK-CR',   34, 6800,  0),
  ('SEED-3',  'L2', '18mm BWP Plywood 8x4',            'PLY-BWP-18',  48, 4250,  1),
  ('SEED-4',  'L1', 'Acrylic Wall Panel — Charcoal',   'WP-ACR-CHR',  12, 2450,  0),
  ('SEED-5',  'L1', 'Merino Laminate 1mm — Oak',       'LAM-MR-2204', 62, 1180,  0),
  ('SEED-5',  'L2', 'Telescopic Drawer Channels',      'HW-DRW-TL',   40, 1120,  1),
  ('SEED-7',  'L1', 'Recon Veneer 4x8',                'VEN-RC-40',   28, 5200,  0),
  ('SEED-7',  'L2', '18mm BWP Plywood 8x4',            'PLY-BWP-18',  38, 4250,  1),
  ('SEED-11', 'L1', 'Fire Retardant Plywood 18mm',     'PLY-FR-18',   52, 5900,  0),
  ('SEED-11', 'L2', 'Merino Laminate 1mm — Graphite',  'LAM-MR-3301', 96, 1180,  1)
) as v(zid, lid, item, sku, qty, rate, ord)
join sales_orders so on so.zoho_salesorder_id = v.zid
on conflict (sales_order_id, zoho_line_item_id) do nothing;

-- ---------------------------------------------------------------------
-- Customers. Credit standing is owned by us, not the Zoho sync.
-- ---------------------------------------------------------------------

insert into customers (zoho_contact_id, name, credit_status, credit_limit, credit_days)
values
  ('SEED-C1', 'Studio Vaastu',            'credit_regular', 800000, 30),
  ('SEED-C2', 'Deccan Realty Fitouts',    'credit_hold',    500000, 45),
  ('SEED-C3', 'Lakshmi Modular Kitchens', 'credit_regular', 400000, 15)
on conflict (zoho_contact_id) do nothing;

update sales_orders set customer_id = (select id from customers where zoho_contact_id = 'SEED-C1')
where zoho_salesorder_id = 'SEED-3';
update sales_orders set customer_id = (select id from customers where zoho_contact_id = 'SEED-C2')
where zoho_salesorder_id = 'SEED-11';
update sales_orders set customer_id = (select id from customers where zoho_contact_id = 'SEED-C3')
where zoho_salesorder_id = 'SEED-10';

-- ---------------------------------------------------------------------
-- Payments. Attributed to the first profile in the database, so create
-- your own user first. Skipped cleanly if no profile exists yet.
-- Exercises every clearance state: instant-cleared, pending, bounced.
-- ---------------------------------------------------------------------

do $$
declare
  v_user uuid;
begin
  select id into v_user from profiles order by created_at limit 1;

  if v_user is null then
    raise notice 'No profile found — skipping payments. Add yourself to profiles, then re-run this file.';
    return;
  end if;

  insert into payments
    (sales_order_id, amount, payment_method, reference_no, recorded_by, received_by,
     paid_on, clearance_status, cleared_on, cleared_by, cheque_date, drawee_bank)
  select so.id, v.amt, v.method::payment_method, v.ref, v_user, v_user,
         current_date - v.days,
         v.clr::clearance_status,
         case when v.clr = 'cleared' then current_date - v.days end,
         case when v.clr = 'cleared' then v_user end,
         v.cheque_date, v.bank
  from (values
    -- fully cleared
    ('SEED-1',  248500.00, 'bank_transfer', 'UTR8841207734', 1,  'cleared', null::date,          null),
    ('SEED-2',   40000.00, 'upi',           'UPI/442810/RK', 1,  'cleared', null,                null),
    ('SEED-6',   96400.00, 'upi',           'UPI/441902/SK', 5,  'cleared', null,                null),
    ('SEED-9',  143000.00, 'cash',          null,            9,  'cleared', null,                null),
    ('SEED-10', 227400.00, 'bank_transfer', 'UTR8839912008', 11, 'cleared', null,                null),
    ('SEED-12',  29900.00, 'card_pos',      'POS 8841',      16, 'cleared', null,                null),
    -- pending accounts confirmation
    ('SEED-3',  256000.00, 'bank_transfer', 'UTR8841190022', 2,  'pending', null,                null),
    ('SEED-5',  178900.00, 'cheque',        'HDFC 004417',   4,  'pending', current_date + 2,    'HDFC Bank'),
    -- bounced
    ('SEED-7',  150000.00, 'cheque',        'ICICI 991200',  6,  'bounced', current_date - 3,    'ICICI Bank')
  ) as v(zid, amt, method, ref, days, clr, cheque_date, bank)
  join sales_orders so on so.zoho_salesorder_id = v.zid
  where not exists (select 1 from payments p where p.sales_order_id = so.id);

  -- Route each to an account: cash to a person's box, everything else to the bank.
  update payments set deposited_to = (
    select id from bank_accounts
    where label = case when payment_method = 'cash' then 'Kapish Account'
                       else 'Homenest HDFC Account' end
  )
  where deposited_to is null;
end $$;

-- ---------------------------------------------------------------------
-- Dispatch states. Set last so the gate sees real cleared totals.
-- Covers awaiting_clearance, ordered (procuring), at_warehouse.
-- ---------------------------------------------------------------------

update order_ops o set status = v.st::dispatch_status,
                       hold_reason = v.reason,
                       status_since = now() - (v.days || ' days')::interval
from (values
  ('SEED-1',  'ready_to_dispatch', null,                              0),
  ('SEED-2',  'ordered',           null,                              1),
  ('SEED-3',  'at_warehouse',      null,                              2),
  ('SEED-4',  'awaiting_clearance', null,                             4),
  ('SEED-5',  'awaiting_clearance', null,                             5),
  ('SEED-6',  'delivered',         null,                              3),
  ('SEED-7',  'awaiting_clearance', 'Cheque bounced',                 4),
  ('SEED-9',  'dispatched',        null,                              5),
  ('SEED-10', 'delivered',         null,                              9),
  ('SEED-11', 'awaiting_clearance', 'Customer on credit hold',        7),
  ('SEED-12', 'delivered',         null,                             14)
) as v(zid, st, reason, days)
join sales_orders so on so.zoho_salesorder_id = v.zid
where o.sales_order_id = so.id;

commit;

-- Sanity check
select dispatch_status, count(*), sum(total)::bigint as value
from v_ops_board group by dispatch_status order by 1;
