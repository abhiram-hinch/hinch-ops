-- =====================================================================
-- Delivery challan detail + richer order-line fields.
--
-- A dispatch row becomes a real Delivery Challan: vehicle, transporter,
-- what's on it, and who received it. Order lines carry the extra Zoho
-- fields needed for a per-item detail view.
-- =====================================================================

alter table dispatches
  add column if not exists vehicle_no   text,
  add column if not exists transporter  text,
  add column if not exists driver_phone text,
  add column if not exists received_by  text,   -- name of who signed for it
  add column if not exists items_text   text;   -- free-text list of goods on this challan

alter table sales_order_lines
  add column if not exists description text,
  add column if not exists hsn_or_sac  text,
  add column if not exists unit        text;
