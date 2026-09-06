-- =====================================================================
-- SOP operational statuses — enum changes only.
--
-- The single order status now spans procurement → warehouse → customer:
--   to_be_ordered → ordered → in_transit → at_warehouse →
--   ready_to_dispatch → partially_dispatched → dispatched →
--   partially_delivered → delivered → fulfilled
-- with on_hold / cancelled as latching manual overrides.
--
-- ADD VALUE / RENAME VALUE run alone in this file (Postgres forbids using
-- a new enum value in the same transaction that adds it).
-- =====================================================================

alter type dispatch_status rename value 'pending' to 'to_be_ordered';

alter type dispatch_status add value if not exists 'ordered';
alter type dispatch_status add value if not exists 'in_transit';
alter type dispatch_status add value if not exists 'at_warehouse';
alter type dispatch_status add value if not exists 'partially_delivered';
alter type dispatch_status add value if not exists 'fulfilled';

-- Procurement is now a first-class team.
alter type app_role add value if not exists 'procurement';
