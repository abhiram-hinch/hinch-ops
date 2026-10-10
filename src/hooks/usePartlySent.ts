import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PendingItem {
  name: string | null;
  sku: string | null;
  unit: string | null;
  quantity: number;
  remaining: number;
}

export interface PartlySentOrder {
  id: string;
  so_number: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  order_date: string | null;
  total: number;
  quotation_ref: string | null;
  quotation_ref_override: string | null;
  dispatch_status: "partially_dispatched" | "partially_delivered";
  status_since: string;
  days_in_stage: number;
  challans: number;
  last_dispatched_at: string | null;
  days_since_last_dispatch: number | null;
  goods_total: number;
  goods_sent: number;
  pending_goods: PendingItem[];
  /** Service-type lines still open — nothing physical to ship, so they're closed out, not dispatched. */
  pending_service: PendingItem[];
}

/**
 * Every order that has been partly sent and is still waiting on the rest —
 * across all order dates, since the board only shows today by default. Reads
 * v_partly_sent (a handful of rows), shared by the tab and its count badge.
 * Lives under ["board"] so realtime invalidation keeps it fresh.
 */
export function usePartlySent() {
  return useQuery({
    queryKey: ["board", "partly-sent"],
    queryFn: async (): Promise<PartlySentOrder[]> => {
      const { data, error } = await supabase
        .from("v_partly_sent")
        .select("*")
        .order("last_dispatched_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as PartlySentOrder[];
    },
    staleTime: 60_000,
  });
}
