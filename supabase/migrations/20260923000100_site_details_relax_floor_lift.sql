-- =====================================================================
-- Floor and service lift were blocking too many orders for details that
-- turned out not to be essential to get procurement started — only the
-- precise location genuinely needs to be known before that. Relaxing
-- the gate to precise-location-only, for now. Floor and service lift
-- stay on the form (still useful for warehouse/delivery), just no
-- longer required — sales fills them in when known, nothing blocks on
-- them being empty.
--
-- Every caller (the dispatch/credit-tag/manual-override gates, the
-- release trigger, and v_ops_board's blocked_on_site_details) already
-- goes through this one function, so relaxing it here is the entire
-- change — nothing else needs touching.
-- =====================================================================

create or replace function site_details_complete(p_so uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from delivery_site_details
    where sales_order_id = p_so
      and (
        is_store_pickup
        or (maps_url is not null and btrim(maps_url) <> '')
      )
  )
$$;
