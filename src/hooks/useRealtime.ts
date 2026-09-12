import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Row = Record<string, unknown>;

const idOf = (payload: RealtimePostgresChangesPayload<Row>, key: string): string | null => {
  const next = payload.new as Row | undefined;
  const prev = payload.old as Row | undefined;
  const value = next?.[key] ?? prev?.[key];
  return typeof value === "string" ? value : null;
};

/**
 * Subscribes to Postgres changes and invalidates the affected queries.
 *
 * Deliberately does NOT patch cached rows by hand. Invalidate, let the query
 * refetch, keep one source of truth for what is on screen. Hand-patching is
 * where live dashboards start quietly disagreeing with the database.
 *
 * Returns the ids touched in the last two seconds so rows can flash to show
 * what moved -- the only non-user-triggered motion in the app.
 */
export function useRealtimeOrders() {
  const qc = useQueryClient();
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, number>>(new Map());

  const flash = useCallback((id: string | null) => {
    if (!id) return;
    setTouched((prev) => new Set(prev).add(id));
    const existing = timers.current.get(id);
    if (existing) window.clearTimeout(existing);
    timers.current.set(
      id,
      window.setTimeout(() => {
        setTouched((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        timers.current.delete(id);
      }, 2000),
    );
  }, []);

  useEffect(() => {
    const timerMap = timers.current;

    const channel = supabase
      .channel("ops-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_orders" },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          flash(idOf(payload, "id"));
          qc.invalidateQueries({ queryKey: ["board"] });
          qc.invalidateQueries({ queryKey: ["sync-health"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_ops" },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          flash(idOf(payload, "sales_order_id"));
          qc.invalidateQueries({ queryKey: ["board"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments" },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          const id = idOf(payload, "sales_order_id");
          flash(id);
          qc.invalidateQueries({ queryKey: ["board"] });
          if (id) qc.invalidateQueries({ queryKey: ["payments", id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatches" },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          const id = idOf(payload, "sales_order_id");
          flash(id);
          qc.invalidateQueries({ queryKey: ["board"] });
          if (id) qc.invalidateQueries({ queryKey: ["dispatches", id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatch_lines" },
        () => {
          qc.invalidateQueries({ queryKey: ["board"] });
          qc.invalidateQueries({ queryKey: ["dispatches"] });
          qc.invalidateQueries({ queryKey: ["lines"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_comments" },
        (payload: RealtimePostgresChangesPayload<Row>) => {
          const id = idOf(payload, "sales_order_id");
          flash(id);
          if (id) qc.invalidateQueries({ queryKey: ["comments", id] });
        },
      )
      .subscribe();

    return () => {
      timerMap.forEach((t) => window.clearTimeout(t));
      timerMap.clear();
      supabase.removeChannel(channel);
    };
  }, [qc, flash]);

  return touched;
}
