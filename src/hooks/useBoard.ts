import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import type {
  ActivityEntry,
  BankAccount,
  BoardRow,
  ClearanceStatus,
  CreditStatus,
  Customer,
  Dispatch,
  DispatchInput,
  DispatchStatus,
  NewChallanLine,
  OrderAction,
  OrderLine,
  OrderRecord,
  Payment,
  PaymentInput,
  Profile,
  PaymentQueueRow,
  PaymentStatus,
  SettableStage,
  SyncHealth,
} from "@/types/database";

/** "attention" is a client-side predicate, not a dispatch_status value. */
export type DispatchFilter = DispatchStatus | "all" | "attention";

/** Order-date window, driven by the date tab strip. */
export type DatePreset = "all" | "today" | "yesterday" | "week" | "month" | "custom";

/**
 * Customer segment. Credit customers run on a different rhythm (SO booked
 * late, paid on terms) so the team keeps them in their own tab.
 */
export type CustomerType = "all" | "regular" | "credit";

export interface BoardFilters {
  dispatch: DispatchFilter;
  payment: PaymentStatus | "all";
  customerType: CustomerType;
  salesperson: string;
  search: string;
  datePreset: DatePreset;
  fromDate: string; // only used when datePreset === "custom"
  toDate: string;
}

export const emptyFilters: BoardFilters = {
  dispatch: "all",
  payment: "all",
  customerType: "all",
  salesperson: "",
  search: "",
  // Daily-use default: land on today's orders. The date tabs widen from there.
  datePreset: "today",
  fromDate: "",
  toDate: "",
};

const CREDIT_STATUSES = ["credit_regular", "credit_hold"];
export const isCreditStatus = (s: string) => CREDIT_STATUSES.includes(s);

// HINCH runs in IST and order_date is Zoho's IST document date, so the date
// tabs must key off "now in IST" regardless of the viewer's machine timezone.
const IST_OFFSET_MIN = 330;
function istNow(): Date {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + IST_OFFSET_MIN) * 60_000);
}
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

/**
 * Resolve a preset to a concrete order_date range (IST). null = no date bound.
 * "week" / "month" are rolling last-7 / last-30 days — always monotonic and
 * predictable, unlike calendar periods around a month boundary.
 */
export function presetRange(p: DatePreset): { from: string; to: string } | null {
  if (p === "all" || p === "custom") return null;
  const now = istNow();
  const today = ymd(now);
  if (p === "today") return { from: today, to: today };
  if (p === "yesterday") {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    return { from: ymd(y), to: ymd(y) };
  }
  const start = new Date(now);
  start.setDate(now.getDate() - (p === "week" ? 6 : 29));
  return { from: ymd(start), to: today };
}

export function useBoard(filters: BoardFilters) {
  return useQuery({
    queryKey: qk.board(filters),
    queryFn: async (): Promise<BoardRow[]> => {
      let q = supabase.from("v_ops_board").select("*").order("order_date", { ascending: false });

      if (filters.dispatch === "attention") {
        q = q.eq("needs_attention", true);
      } else if (filters.dispatch !== "all") {
        q = q.eq("dispatch_status", filters.dispatch);
      }
      if (filters.payment !== "all") q = q.eq("payment_status", filters.payment);
      if (filters.customerType === "regular") q = q.eq("customer_credit_status", "none");
      if (filters.customerType === "credit") q = q.in("customer_credit_status", CREDIT_STATUSES);
      if (filters.salesperson) q = q.eq("salesperson_name", filters.salesperson);

      const range = presetRange(filters.datePreset);
      const from = range ? range.from : filters.fromDate;
      const to = range ? range.to : filters.toDate;
      if (from) q = q.gte("order_date", from);
      if (to) q = q.lte("order_date", to);
      if (filters.search.trim()) {
        const term = `%${filters.search.trim()}%`;
        q = q.or(
          `so_number.ilike.${term},customer_name.ilike.${term},quotation_ref.ilike.${term},quotation_ref_override.ilike.${term}`,
        );
      }

      const { data, error } = await q.limit(5000);
      if (error) throw error;
      return (data ?? []) as BoardRow[];
    },
    staleTime: 30_000,
  });
}

/**
 * Per-status counts for the filter chips — scoped to the SAME date / salesperson
 * / search as the board (but not the status filter itself), so a chip's number
 * always matches what tapping it shows.
 */
export interface BoardTotals {
  /** per dispatch_status (+ "attention"), scoped to the active customer tab */
  byStatus: Record<string, { count: number; value: number }>;
  /** customer-segment counts, NOT scoped to the customer tab (so both show) */
  customer: { all: number; regular: number; credit: number };
}

export function useBoardTotals(filters: BoardFilters) {
  return useQuery({
    queryKey: ["board", "totals", filters],
    queryFn: async (): Promise<BoardTotals> => {
      let q = supabase
        .from("v_ops_board")
        .select("dispatch_status, total, balance_due, needs_attention, customer_credit_status");

      if (filters.payment !== "all") q = q.eq("payment_status", filters.payment);
      if (filters.salesperson) q = q.eq("salesperson_name", filters.salesperson);
      const range = presetRange(filters.datePreset);
      const from = range ? range.from : filters.fromDate;
      const to = range ? range.to : filters.toDate;
      if (from) q = q.gte("order_date", from);
      if (to) q = q.lte("order_date", to);
      if (filters.search.trim()) {
        const term = `%${filters.search.trim()}%`;
        q = q.or(
          `so_number.ilike.${term},customer_name.ilike.${term},quotation_ref.ilike.${term},quotation_ref_override.ilike.${term}`,
        );
      }

      const { data, error } = await q.limit(10000);
      if (error) throw error;

      const rows = (data ?? []) as {
        dispatch_status: string;
        total: number;
        needs_attention: boolean;
        customer_credit_status: string;
      }[];

      const customer = { all: 0, regular: 0, credit: 0 };
      const byStatus: Record<string, { count: number; value: number }> = {};

      for (const r of rows) {
        const credit = isCreditStatus(r.customer_credit_status);
        customer.all += 1;
        if (credit) customer.credit += 1;
        else customer.regular += 1;

        // Status counts follow the active customer tab so the rail matches.
        if (filters.customerType === "regular" && credit) continue;
        if (filters.customerType === "credit" && !credit) continue;

        byStatus[r.dispatch_status] ??= { count: 0, value: 0 };
        byStatus[r.dispatch_status].count += 1;
        byStatus[r.dispatch_status].value += Number(r.total ?? 0);
        if (r.needs_attention) {
          byStatus.attention ??= { count: 0, value: 0 };
          byStatus.attention.count += 1;
          byStatus.attention.value += Number(r.total ?? 0);
        }
      }
      return { byStatus, customer };
    },
    staleTime: 30_000,
  });
}

export function useOrderLines(orderId: string | null) {
  return useQuery({
    queryKey: qk.lines(orderId ?? ""),
    enabled: !!orderId,
    queryFn: async (): Promise<OrderLine[]> => {
      const { data, error } = await supabase
        .from("sales_order_lines")
        .select(
          "id, item_name, item_sku, description, hsn_or_sac, unit, line_item_kind, quantity, qty_dispatched, rate, amount, line_order",
        )
        .eq("sales_order_id", orderId!)
        .order("line_order");
      if (error) throw error;
      return (data ?? []) as OrderLine[];
    },
  });
}

/** Detail columns + full Zoho payload for the open order. */
export function useOrderRecord(orderId: string | null) {
  return useQuery({
    queryKey: qk.record(orderId ?? ""),
    enabled: !!orderId,
    queryFn: async (): Promise<OrderRecord | null> => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select(
          "id, customer_id, ship_to, contact_phone, contact_email, notes, delivery_date, total_quantity, zoho_shipped_status, zoho_invoiced_status, so_pdf_path, detail_synced_at, detail_raw",
        )
        .eq("id", orderId!)
        .maybeSingle();
      if (error) throw error;
      return data as OrderRecord | null;
    },
  });
}

/**
 * Pull the full single-order payload + PDF from Zoho for one order. Called when
 * the panel opens; the function itself no-ops if detail was fetched recently.
 */
export function useSyncOrderDetail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ zohoId }: { orderId: string; zohoId: string }) => {
      const { data, error } = await supabase.functions.invoke("zoho-so-detail", {
        body: { so_id: zohoId },
      });
      if (error) throw error;
      return data as { ok: boolean; id: string; pdf_path: string | null; cached: boolean };
    },
    onSuccess: (_data, { orderId }) => {
      qc.invalidateQueries({ queryKey: qk.record(orderId) });
      qc.invalidateQueries({ queryKey: qk.lines(orderId) });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

/** Short-lived signed URL for a private so-pdfs object. */
export function usePdfUrl(path: string | null) {
  return useQuery({
    queryKey: ["pdf-url", path],
    enabled: !!path,
    staleTime: 50_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from("so-pdfs")
        .createSignedUrl(path!, 120);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

export function usePayments(orderId: string | null) {
  return useQuery({
    queryKey: qk.payments(orderId ?? ""),
    enabled: !!orderId,
    queryFn: async (): Promise<Payment[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "*, profiles:recorded_by(full_name), bank_accounts:deposited_to(label), payment_receipts(id, payment_id, storage_path, uploaded_by, uploaded_at)",
        )
        .eq("sales_order_id", orderId!)
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Payment[];
    },
  });
}

/** Accounts / cash boxes a payment can be received into. */
export function useBankAccounts() {
  return useQuery({
    queryKey: ["bank-accounts"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BankAccount[]> => {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("id, label, kind, active")
        .eq("active", true)
        .order("kind")
        .order("label");
      if (error) throw error;
      return (data ?? []) as BankAccount[];
    },
  });
}

/** Active team members — for "recorded by" / "approved by" pickers. */
export function useProfiles() {
  return useQuery({
    queryKey: ["profiles", "active"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Pick<Profile, "id" | "full_name" | "role">[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Pick<Profile, "id" | "full_name" | "role">[];
    },
  });
}

/** Customer record (credit standing) for the open order, if it has one. */
export function useCustomer(customerId: string | null) {
  return useQuery({
    queryKey: ["customer", customerId],
    enabled: !!customerId,
    queryFn: async (): Promise<Customer | null> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, zoho_contact_id, name, credit_status, credit_limit, credit_days, notes")
        .eq("id", customerId!)
        .maybeSingle();
      if (error) throw error;
      return data as Customer | null;
    },
  });
}

/** Accounts approval queue — every payment still awaiting confirmation. */
export function usePaymentQueue(enabled = true) {
  return useQuery({
    queryKey: ["payment-queue"],
    enabled,
    queryFn: async (): Promise<PaymentQueueRow[]> => {
      const { data, error } = await supabase
        .from("v_payment_queue")
        .select("*")
        .order("paid_on", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PaymentQueueRow[];
    },
    staleTime: 30_000,
  });
}

export function useActivity(orderId: string | null) {
  return useQuery({
    queryKey: qk.activity(orderId ?? ""),
    enabled: !!orderId,
    queryFn: async (): Promise<ActivityEntry[]> => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, action, entity, before, after, actor_name, at")
        .eq("sales_order_id", orderId!)
        .order("at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as ActivityEntry[];
    },
  });
}

export function useSyncHealth() {
  return useQuery({
    queryKey: qk.syncHealth,
    queryFn: async (): Promise<SyncHealth | null> => {
      const { data, error } = await supabase.from("v_sync_health").select("*").maybeSingle();
      if (error) throw error;
      return data as SyncHealth | null;
    },
    refetchInterval: 60_000,
  });
}

export function useRecordPayment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: PaymentInput & { note?: string; userId: string; proofs?: File[] },
    ) => {
      const { userId, note, proofs, ...fields } = input;
      const { data, error } = await supabase
        .from("payments")
        .insert({
          sales_order_id: orderId,
          amount: fields.amount,
          payment_method: fields.payment_method,
          reference_no: fields.reference_no || null,
          note: note || null,
          paid_on: fields.paid_on,
          recorded_by: userId,
          received_by: userId,
          deposited_to: fields.deposited_to,
          transfer_rail: fields.transfer_rail ?? null,
          card_network: fields.card_network ?? null,
          card_last4: fields.card_last4 || null,
          cheque_date: fields.cheque_date || null,
          drawee_bank: fields.drawee_bank || null,
          approved_by: fields.approved_by ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      if (proofs && proofs.length > 0) {
        await uploadReceipts(orderId, data.id, proofs, userId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.payments(orderId) });
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["payment-queue"] });
      qc.invalidateQueries({ queryKey: qk.activity(orderId) });
    },
  });
}

/**
 * Push files into the private payment-proofs bucket and record one
 * payment_receipts row per file. Path: <orderId>/<paymentId>/<uuid>.<ext>
 */
async function uploadReceipts(
  orderId: string,
  paymentId: string,
  files: File[],
  userId: string,
) {
  for (const file of files) {
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
    const path = `${orderId}/${paymentId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("payment-proofs").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (up.error) throw new Error(`Proof upload failed: ${up.error.message}`);

    const { error } = await supabase.from("payment_receipts").insert({
      payment_id: paymentId,
      storage_path: path,
      uploaded_by: userId,
    });
    if (error) throw new Error(`Could not attach proof: ${error.message}`);
  }
}

/** Attach one or more proof files to a payment that already exists. */
export function useAddPaymentReceipts(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      paymentId,
      files,
      userId,
    }: {
      paymentId: string;
      files: File[];
      userId: string;
    }) => {
      await uploadReceipts(orderId, paymentId, files, userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.payments(orderId) });
    },
  });
}

/** Short-lived signed URL for one private payment-proofs object. */
export function useReceiptUrl(path: string | null) {
  return useQuery({
    queryKey: ["receipt-url", path],
    enabled: !!path,
    staleTime: 50_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from("payment-proofs")
        .createSignedUrl(path!, 120);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

/**
 * Accounts approval leg — confirm (clear) or bounce a recorded payment.
 * The DB trigger enforces the accounts/admin gate; clearing auto-advances the
 * order out of awaiting_clearance.
 */
export function useSetPaymentClearance(orderId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      clearance_status,
      userId,
    }: {
      id: string;
      clearance_status: ClearanceStatus;
      userId: string;
    }) => {
      const { error } = await supabase
        .from("payments")
        .update({ clearance_status, cleared_by: userId })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      if (orderId) {
        qc.invalidateQueries({ queryKey: qk.payments(orderId) });
        qc.invalidateQueries({ queryKey: qk.activity(orderId) });
      }
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["payment-queue"] });
    },
  });
}

/** Set a customer's credit standing (accounts / admin only, enforced by RLS). */
export function useSetCreditStatus(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      credit_status,
      credit_limit,
      credit_days,
    }: {
      credit_status: CreditStatus;
      credit_limit?: number | null;
      credit_days?: number | null;
    }) => {
      const patch: Record<string, unknown> = { credit_status };
      if (credit_limit !== undefined) patch.credit_limit = credit_limit;
      if (credit_days !== undefined) patch.credit_days = credit_days;
      const { error } = await supabase.from("customers").update(patch).eq("id", customerId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer", customerId] });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

/** Sales-set quote reference that overrides the Zoho-synced value. */
export function useSetQuoteRef(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ref: string) => {
      const { error } = await supabase.rpc("set_quotation_ref_override", {
        p_order: orderId,
        p_ref: ref,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: qk.activity(orderId) });
    },
  });
}

export function useVoidPayment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, userId }: { id: string; reason: string; userId: string }) => {
      const { error } = await supabase
        .from("payments")
        .update({ voided: true, voided_reason: reason, voided_by: userId })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.payments(orderId) });
      qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Ops / order management — customer dispatch challans + manual status actions.
// ---------------------------------------------------------------------------

export function useDispatches(orderId: string | null) {
  return useQuery({
    queryKey: qk.dispatches(orderId ?? ""),
    enabled: !!orderId,
    queryFn: async (): Promise<Dispatch[]> => {
      const { data, error } = await supabase
        .from("dispatches")
        .select(
          "*, profiles:created_by(full_name), dispatch_lines(id, quantity, sales_order_line_id, sales_order_lines(item_name, item_sku, unit))",
        )
        .eq("sales_order_id", orderId!)
        .order("dispatched_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Dispatch[];
    },
  });
}

function invalidateOrder(qc: ReturnType<typeof useQueryClient>, orderId: string) {
  qc.invalidateQueries({ queryKey: qk.dispatches(orderId) });
  qc.invalidateQueries({ queryKey: ["board"] });
  qc.invalidateQueries({ queryKey: qk.activity(orderId) });
}

export function useAddDispatch(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: DispatchInput & { userId: string; lines?: NewChallanLine[] },
    ) => {
      const { userId, lines, ...fields } = input;
      const { data: dispatch, error } = await supabase
        .from("dispatches")
        .insert({
          sales_order_id: orderId,
          ...fields,
          note: fields.note || null,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message); // may be the payment-gate check_violation

      if (lines && lines.length > 0) {
        const { error: lErr } = await supabase.from("dispatch_lines").insert(
          lines.map((l) => ({
            dispatch_id: dispatch.id,
            sales_order_line_id: l.sales_order_line_id,
            quantity: l.quantity,
          })),
        );
        if (lErr) throw new Error(lErr.message);
      }
    },
    onSuccess: () => invalidateOrder(qc, orderId),
  });
}

export function useUpdateDispatch(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
      userId,
    }: {
      id: string;
      patch: DispatchInput;
      userId: string;
    }) => {
      const { error } = await supabase
        .from("dispatches")
        .update({ ...patch, updated_by: userId })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateOrder(qc, orderId),
  });
}

export function useDeleteDispatch(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dispatches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateOrder(qc, orderId),
  });
}

/**
 * Manual status override via the RPC — an OrderAction (hold / resume / cancel /
 * fulfil …) or a SettableStage string (ordered / in_transit / at_warehouse …).
 */
export function useOrderAction(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      action,
      reason,
    }: {
      action: OrderAction | SettableStage;
      reason?: string;
    }) => {
      const { error } = await supabase.rpc("order_action", {
        p_so: orderId,
        p_action: action,
        p_reason: reason ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateOrder(qc, orderId),
  });
}

/** Manual "Sync now" -- invokes the poll function with the caller's JWT. */
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("zoho-so-poll", { body: {} });
      if (error) throw error;
      return data as { seen: number; upserted: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: qk.syncHealth });
    },
  });
}
