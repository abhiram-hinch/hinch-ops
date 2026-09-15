import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import type {
  BoardRow,
  DeliveryPerformanceRow,
  DispatchDailyRow,
  PaymentSlim,
  SalesOrderSlim,
} from "@/types/database";

/** Date presets for the analytics page. null = no lower bound. */
export type AnalyticsRange = "30" | "90" | "365" | "all";

export function rangeFromDate(range: AnalyticsRange): string | null {
  if (range === "all") return null;
  const days = Number(range);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function useSalesOrdersSlim(from: string | null) {
  return useQuery({
    queryKey: qk.salesSlim(from),
    queryFn: async (): Promise<SalesOrderSlim[]> => {
      let q = supabase.from("v_sales_orders_slim").select("*");
      if (from) q = q.gte("order_date", from);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SalesOrderSlim[];
    },
    staleTime: 60_000,
  });
}

export function usePaymentsSlim(from: string | null) {
  return useQuery({
    queryKey: qk.paymentsSlim(from),
    queryFn: async (): Promise<PaymentSlim[]> => {
      let q = supabase.from("v_payments_slim").select("*");
      if (from) q = q.gte("paid_on", from);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PaymentSlim[];
    },
    staleTime: 60_000,
  });
}

export function useDeliveryPerformance(from: string | null) {
  return useQuery({
    queryKey: qk.deliveryPerformance(from),
    queryFn: async (): Promise<DeliveryPerformanceRow[]> => {
      let q = supabase.from("v_delivery_performance").select("*");
      if (from) q = q.gte("delivered_at", from);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DeliveryPerformanceRow[];
    },
    staleTime: 60_000,
  });
}

export function useDispatchDaily(from: string | null) {
  return useQuery({
    queryKey: qk.dispatchDaily(from),
    queryFn: async (): Promise<DispatchDailyRow[]> => {
      let q = supabase.from("v_dispatch_daily").select("*").order("day", { ascending: true });
      if (from) q = q.gte("day", from);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DispatchDailyRow[];
    },
    staleTime: 60_000,
  });
}

/** Right-now snapshot of every open order's stage — not date-ranged. */
export function useStageSnapshot() {
  return useQuery({
    queryKey: qk.stageSnapshot,
    queryFn: async (): Promise<Pick<BoardRow, "dispatch_status" | "days_in_status">[]> => {
      const { data, error } = await supabase.from("v_ops_board").select("dispatch_status, days_in_status");
      if (error) throw error;
      return (data ?? []) as Pick<BoardRow, "dispatch_status" | "days_in_status">[];
    },
    staleTime: 60_000,
  });
}

type CreditExposureRow = Pick<
  BoardRow,
  "customer_name" | "balance_due" | "order_date" | "credit_days" | "so_number"
>;

/** Right-now outstanding balance for credit customers — not date-ranged. */
export function useCreditExposure() {
  return useQuery({
    queryKey: ["analytics", "credit-exposure"],
    queryFn: async (): Promise<CreditExposureRow[]> => {
      const { data, error } = await supabase
        .from("v_ops_board")
        .select("customer_name, balance_due, order_date, credit_days, so_number")
        .neq("customer_credit_status", "none")
        .gt("balance_due", 0.01);
      if (error) throw error;
      return (data ?? []) as CreditExposureRow[];
    },
    staleTime: 60_000,
  });
}
