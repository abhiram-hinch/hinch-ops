-- =====================================================================
-- Shared notes thread per order — cross-team communication (sales,
-- accounts, warehouse) that doesn't belong in the system activity log.
-- Append-only, like payments and activity_log: no edit, no delete. If a
-- note is wrong, the fix is a follow-up note, not a rewritten one.
-- =====================================================================

create table order_comments (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders(id) on delete cascade,
  body           text not null check (btrim(body) <> ''),
  created_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now()
);
create index idx_order_comments_so on order_comments(sales_order_id, created_at);

alter table order_comments enable row level security;

create policy read_order_comments on order_comments
  for select to authenticated using (true);

-- Any active team member can post; attribution is enforced the same way
-- as payments — the row must claim to be authored by whoever is calling.
create policy write_order_comments on order_comments
  for insert to authenticated
  with check (created_by = auth.uid() and auth_role() is not null);

alter publication supabase_realtime add table order_comments;
