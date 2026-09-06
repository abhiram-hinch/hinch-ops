-- =====================================================================
-- Payment model — enum-only prelude.
--
-- ADD VALUE on an existing enum cannot be used in the same transaction
-- that adds it, so `awaiting_clearance` lands here alone. Everything that
-- references it (default, data migration, triggers) is in the next file.
--
-- Flow it enables:
--   Sales records a payment -> order sits in `awaiting_clearance`
--   -> Accounts confirms the payment (clearance_status = cleared)
--   -> order auto-moves to `to_be_ordered` (procurement's queue)
-- =====================================================================

alter type dispatch_status add value if not exists 'awaiting_clearance';
