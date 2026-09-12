/**
 * Hand-written to match supabase/migrations/*.sql so the repo type-checks on a
 * fresh clone. Once your project is linked, regenerate from the live schema and
 * let this file be overwritten:
 *
 *   npm run types:gen
 */

export type AppRole = "admin" | "sales" | "accounts" | "warehouse" | "ops" | "procurement";

/**
 * The single rolled-up order status. Procurement stages (ordered / in_transit /
 * at_warehouse) exist in the enum but are only reachable once vendor-PO tracking
 * is built — the rollup currently produces to_be_ordered → ready_to_dispatch →
 * (partially_)dispatched → (partially_)delivered → fulfilled, plus the manual
 * on_hold / cancelled latches.
 */
export type DispatchStatus =
  | "awaiting_clearance"
  | "to_be_ordered"
  | "ordered"
  | "in_transit"
  | "at_warehouse"
  | "ready_to_dispatch"
  | "partially_dispatched"
  | "dispatched"
  | "partially_delivered"
  | "delivered"
  | "fulfilled"
  | "on_hold"
  | "cancelled";

export type OrderAction =
  | "hold"
  | "resume"
  | "cancel"
  | "reactivate"
  | "fulfill"
  | "unfulfill";

/** Pre-dispatch stages the warehouse team can set by hand (no challans yet). */
export type SettableStage =
  | "awaiting_clearance"
  | "to_be_ordered"
  | "ordered"
  | "in_transit"
  | "at_warehouse"
  | "ready_to_dispatch";

export interface DispatchLine {
  id: string;
  dispatch_id: string;
  sales_order_line_id: string;
  quantity: number;
  sales_order_lines?: {
    item_name: string | null;
    item_sku: string | null;
    unit: string | null;
  } | null;
}

export interface Dispatch {
  id: string;
  sales_order_id: string;
  dc_number: string | null; // auto-generated on insert
  is_final: boolean;
  dispatched_at: string;
  delivered_at: string | null;
  vehicle_no: string | null;
  transporter: string | null;
  driver_phone: string | null;
  received_by: string | null;
  items_text: string | null;
  note: string | null;
  created_by: string | null;
  profiles?: { full_name: string } | null;
  dispatch_lines?: DispatchLine[];
}

export interface DispatchInput {
  is_final?: boolean;
  vehicle_no?: string | null;
  transporter?: string | null;
  driver_phone?: string | null;
  items_text?: string | null;
  note?: string | null;
  delivered_at?: string | null;
  received_by?: string | null;
}

export interface NewChallanLine {
  sales_order_line_id: string;
  quantity: number;
}

export type PaymentStatus = "pending" | "advance_paid" | "fully_paid" | "overpaid";

export type PaymentMethod =
  | "cash"
  | "upi"
  | "card_pos"
  | "bank_transfer"
  | "cheque"
  | "demand_draft"
  | "payment_gateway"
  | "emi_finance"
  | "credit_note"
  | "advance_adjustment"
  | "tds_deducted"
  | "write_off";

export type ClearanceStatus = "pending" | "cleared" | "bounced" | "reversed";
export type CreditStatus = "none" | "credit_regular" | "credit_hold";
export type TransferRail = "neft" | "rtgs" | "imps" | "other";
export type CardNetwork = "visa" | "mastercard" | "rupay" | "amex" | "diners" | "other";
export type BankAccountKind = "bank" | "cash_box" | "gateway_settlement";

export interface BankAccount {
  id: string;
  label: string;
  kind: BankAccountKind;
  active: boolean;
}

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  active: boolean;
}

export interface ZohoAddress {
  attention?: string;
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
}

/** Row shape of the v_ops_board view. */
export interface BoardRow {
  id: string;
  so_number: string | null;
  quotation_ref: string | null;
  quotation_ref_override: string | null;
  order_date: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  total: number;
  amount_received: number;
  balance_due: number;
  payment_status: PaymentStatus;
  zoho_status: string | null;
  dispatch_status: DispatchStatus;
  hold_reason: string | null;
  status_since: string;
  days_in_status: number;
  last_synced_at: string;
  zoho_salesorder_id: string;
  zoho_shipped_status: string | null;
  zoho_invoiced_status: string | null;
  delivery_date: string | null;
  total_quantity: number | null;
  ship_to: ZohoAddress | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  so_pdf_path: string | null;
  detail_synced_at: string | null;
  needs_attention: boolean;
  stage_before_hold: DispatchStatus | null;
  po_count: number;
  po_received: number;
  dispatch_count: number;
  delivered_count: number;
  amount_pending_clearance: number;
  customer_credit_status: CreditStatus;
  credit_days: number | null;
  is_overdue: boolean;
  /** Authorised to be procured ahead of payment — not a credit sale. */
  is_procure_first: boolean;
  procure_first_at: string | null;
  procure_first_note: string | null;
  procure_first_by_name: string | null;
}

export interface Customer {
  id: string;
  zoho_contact_id: string | null;
  name: string | null;
  credit_status: CreditStatus;
  credit_limit: number | null;
  credit_days: number | null;
  notes: string | null;
}

export interface PaymentQueueRow {
  id: string;
  sales_order_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference_no: string | null;
  paid_on: string;
  recorded_at: string;
  deposited_to: string | null;
  deposited_to_label: string | null;
  note: string | null;
  so_number: string | null;
  quotation_ref: string | null;
  customer_name: string | null;
  total: number;
  customer_credit_status: CreditStatus;
}

/** Detail columns + full payload, read straight from sales_orders on panel open. */
export interface OrderRecord {
  id: string;
  customer_id: string | null;
  ship_to: ZohoAddress | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  delivery_date: string | null;
  total_quantity: number | null;
  zoho_shipped_status: string | null;
  zoho_invoiced_status: string | null;
  so_pdf_path: string | null;
  detail_synced_at: string | null;
  detail_raw: Record<string, unknown> | null;
}

export interface OrderLine {
  id: string;
  item_name: string | null;
  item_sku: string | null;
  description: string | null;
  hsn_or_sac: string | null;
  unit: string | null;
  line_item_kind: string | null; // 'goods' | 'service'
  quantity: number;
  qty_dispatched: number;
  rate: number;
  amount: number;
  line_order: number | null;
}

export interface PaymentReceipt {
  id: string;
  payment_id: string;
  storage_path: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface Payment {
  id: string;
  sales_order_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference_no: string | null;
  note: string | null;
  paid_on: string;
  recorded_by: string;
  recorded_at: string;
  received_by: string;
  clearance_status: ClearanceStatus;
  cleared_on: string | null;
  cleared_by: string | null;
  deposited_to: string | null;
  transfer_rail: TransferRail | null;
  card_network: CardNetwork | null;
  card_last4: string | null;
  cheque_date: string | null;
  drawee_bank: string | null;
  fee_amount: number;
  approved_by: string | null;
  source: string;
  voided: boolean;
  voided_reason: string | null;
  profiles?: { full_name: string } | null;
  bank_accounts?: { label: string } | null;
  payment_receipts?: PaymentReceipt[];
}

export interface PaymentInput {
  amount: number;
  payment_method: PaymentMethod;
  reference_no?: string | null;
  note?: string | null;
  paid_on: string;
  deposited_to: string;
  transfer_rail?: TransferRail | null;
  card_network?: CardNetwork | null;
  card_last4?: string | null;
  cheque_date?: string | null;
  drawee_bank?: string | null;
  approved_by?: string | null;
}

export interface ActivityEntry {
  id: number;
  action: string;
  entity: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor_name: string | null;
  at: string;
}

export interface SyncHealth {
  last_success_at: string | null;
  errors_24h: number;
  synced_last_hour: number;
}

/** A free-form note on an order — cross-team communication, not a system event. */
export interface OrderComment {
  id: string;
  sales_order_id: string;
  body: string;
  created_by: string;
  created_at: string;
  profiles?: { full_name: string } | null;
}
