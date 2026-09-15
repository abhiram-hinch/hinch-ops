-- =====================================================================
-- Zoho's ship-to address is often just typed free text and can land the
-- auto-generated Maps search link on the wrong building entirely. Let
-- sales/dispatch paste a corrected Maps share link once per order —
-- same "override the unreliable Zoho field" idiom as
-- quotation_ref_override.
-- =====================================================================

alter table delivery_site_details add column if not exists maps_url text;
