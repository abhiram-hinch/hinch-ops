-- =====================================================================
-- Proof-of-delivery photos — mirrors payment_receipts exactly (private
-- bucket, one-to-many, signed URLs). Ammunition for a hamali dispute:
-- "we delivered it, here's the timestamped photo."
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('delivery-photos', 'delivery-photos', false)
on conflict (id) do nothing;

create policy read_delivery_photos on storage.objects
  for select to authenticated
  using (bucket_id = 'delivery-photos');

create policy upload_delivery_photos on storage.objects
  for insert to authenticated
  with check (bucket_id = 'delivery-photos' and can_edit_dispatch());

create table dispatch_photos (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references dispatches(id) on delete cascade,
  storage_path text not null,
  uploaded_by  uuid references profiles(id),
  uploaded_at  timestamptz not null default now()
);
create index idx_dispatch_photos_dispatch on dispatch_photos(dispatch_id);

alter table dispatch_photos enable row level security;
create policy read_dispatch_photos on dispatch_photos for select to authenticated using (true);
create policy write_dispatch_photos on dispatch_photos for insert to authenticated
  with check (can_edit_dispatch());
