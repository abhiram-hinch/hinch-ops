import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { AGING_MIN_DAYS, AGING_STAGES, agingDays, bucketOf, istToday, type AgingBucketKey } from "@/lib/aging";
import type { BoardRow } from "@/types/database";

const COLUMNS =
  "id, so_number, quotation_ref, quotation_ref_override, customer_name, salesperson_name, order_date, total, amount_received, amount_pending_clearance, balance_due, payment_status, dispatch_status, status_since, days_in_status, customer_credit_status, is_procure_first, zoho_status";

export type AgingRow = Pick<
  BoardRow,
  | "id"
  | "so_number"
  | "quotation_ref"
  | "quotation_ref_override"
  | "customer_name"
  | "salesperson_name"
  | "order_date"
  | "total"
  | "amount_received"
  | "amount_pending_clearance"
  | "balance_due"
  | "payment_status"
  | "dispatch_status"
  | "status_since"
  | "days_in_status"
  | "customer_credit_status"
  | "is_procure_first"
  | "zoho_status"
> & { age_days: number; bucket: AgingBucketKey };

// PostgREST caps a single response (1,000 rows by default), and this list can
// run to thousands — so read it in pages rather than trusting one big limit().
const PAGE = 1000;

/**
 * Every order sitting at Awaiting payment or Ready to procure for at least
 * AGING_MIN_DAYS. Warehouse never sees Awaiting payment (same rule as the
 * board). Orders Zoho already shows as closed are shipped and finished there,
 * so they aren't "stuck" no matter what this app has recorded.
 *
 * Lives under the ["board"] key so realtime invalidation keeps it fresh.
 */
export function useAging(role?: string) {
  return useQuery({
    queryKey: ["board", "aging", role === "warehouse" ? role : undefined],
    queryFn: async (): Promise<AgingRow[]> => {
      const stages = role === "warehouse" ? AGING_STAGES.filter((s) => s !== "awaiting_clearance") : AGING_STAGES;
      const today = istToday();
      const out: AgingRow[] = [];

      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("v_ops_board")
          .select(COLUMNS)
          .in("dispatch_status", [...stages])
          .or("zoho_status.is.null,zoho_status.neq.closed")
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as unknown as Omit<AgingRow, "age_days" | "bucket">[];

        for (const r of rows) {
          const age_days = agingDays(r, today);
          if (age_days < AGING_MIN_DAYS) continue;
          const bucket = bucketOf(age_days);
          if (bucket) out.push({ ...r, age_days, bucket });
        }
        if (rows.length < PAGE) break;
      }
      return out;
    },
    staleTime: 60_000,
  });
}
