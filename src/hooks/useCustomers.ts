import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { BoardRow, CustomerSummary, OrderComment, Payment } from "@/types/database";

/** Every customer with at least one real order, richest first. */
export function useCustomerSummaries() {
  return useQuery({
    queryKey: ["customers", "summary"],
    queryFn: async (): Promise<CustomerSummary[]> => {
      const { data, error } = await supabase
        .from("v_customer_summary")
        .select("*")
        .order("total_value", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerSummary[];
    },
    staleTime: 60_000,
  });
}

export function useCustomer(customerId: string | null) {
  return useQuery({
    queryKey: ["customers", "one", customerId ?? ""],
    enabled: !!customerId,
    queryFn: async (): Promise<CustomerSummary | null> => {
      const { data, error } = await supabase
        .from("v_customer_summary")
        .select("*")
        .eq("id", customerId!)
        .maybeSingle();
      if (error) throw error;
      return data as CustomerSummary | null;
    },
  });
}

/** This customer's full order history — every order, newest first. */
export function useCustomerOrders(customerId: string | null) {
  return useQuery({
    queryKey: ["customers", "orders", customerId ?? ""],
    enabled: !!customerId,
    queryFn: async (): Promise<BoardRow[]> => {
      const { data, error } = await supabase
        .from("v_ops_board")
        .select("*")
        .eq("customer_id", customerId!)
        .order("order_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BoardRow[];
    },
  });
}

/** Every payment recorded against any of this customer's orders, newest first. */
export function useCustomerPayments(orderIds: string[]) {
  return useQuery({
    queryKey: ["customers", "payments", orderIds.slice().sort().join(",")],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<(Payment & { so_number: string | null })[]> => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "*, profiles:recorded_by(full_name), bank_accounts:deposited_to(label), sales_orders!inner(so_number)",
        )
        .in("sales_order_id", orderIds)
        .eq("voided", false)
        .order("paid_on", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const { sales_orders, ...rest } = row as unknown as {
          sales_orders: { so_number: string | null };
        } & Payment;
        return { ...rest, so_number: sales_orders?.so_number ?? null };
      });
    },
  });
}

/** Notes across every one of this customer's orders, newest first. */
export function useCustomerNotes(orderIds: string[]) {
  return useQuery({
    queryKey: ["customers", "notes", orderIds.slice().sort().join(",")],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<(OrderComment & { so_number: string | null })[]> => {
      const { data, error } = await supabase
        .from("order_comments")
        .select("*, profiles:created_by(full_name), sales_orders!inner(so_number)")
        .in("sales_order_id", orderIds)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const { sales_orders, ...rest } = row as unknown as {
          sales_orders: { so_number: string | null };
        } & OrderComment;
        return { ...rest, so_number: sales_orders?.so_number ?? null };
      });
    },
  });
}
