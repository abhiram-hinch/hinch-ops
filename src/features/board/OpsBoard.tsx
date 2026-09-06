import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  useBoard,
  useBoardTotals,
  usePaymentQueue,
  emptyFilters,
  type BoardFilters,
} from "@/hooks/useBoard";
import { readBoardState, writeBoardState } from "@/lib/urlState";
import { useRealtimeOrders } from "@/hooks/useRealtime";
import { canClearPayments } from "@/hooks/useAuth";
import { Empty, ErrorNote, Skeleton } from "@/components/Primitives";
import { StatusRail } from "./StatusRail";
import { OrderTable } from "./OrderTable";
import { Filters } from "./Filters";
import { CustomerTypeTabs } from "./CustomerTypeTabs";
import { SyncStatus } from "./SyncStatus";
import { OrderPanel } from "@/features/order/OrderPanel";
import { PaymentQueue } from "@/features/payments/PaymentQueue";
import { AccountMenu } from "@/features/auth/AccountMenu";
import type { BoardRow, Profile } from "@/types/database";

export function OpsBoard({ profile, email }: { profile: Profile; email: string }) {
  const initial = useMemo(() => readBoardState(), []);
  const [filters, setFilters] = useState<BoardFilters>(initial.filters);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [view, setView] = useState<"board" | "queue">("board");
  const mayClear = canClearPayments(profile.role);
  const { data: pendingQueue } = usePaymentQueue(mayClear);
  const pendingCount = pendingQueue?.length ?? 0;

  useEffect(() => {
    writeBoardState({ filters, selectedId });
  }, [filters, selectedId]);

  useEffect(() => {
    const onPop = () => {
      const s = readBoardState();
      setFilters(s.filters);
      setSelectedId(s.selectedId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const touched = useRealtimeOrders();
  const { data: rows, isLoading, error, refetch } = useBoard(filters);
  const { data: totals } = useBoardTotals(filters);

  const salespeople = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.salesperson_name).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const selected = rows?.find((r) => r.id === selectedId) ?? null;
  const patch = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <h1 className="shrink-0 text-lg font-bold tracking-tight text-ink">
            HINCH <span className="text-brand">Ops</span>
          </h1>

          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
              placeholder="Search order, quote or customer"
              aria-label="Search orders"
              className="field h-10 w-full pl-9"
            />
          </div>

          {mayClear && (
            <div className="hidden shrink-0 rounded-pill border border-line p-0.5 sm:flex">
              <button
                onClick={() => setView("board")}
                className={`rounded-pill px-3 py-1 text-[13px] font-semibold ${
                  view === "board" ? "bg-brand text-white" : "text-muted hover:text-ink"
                }`}
              >
                Board
              </button>
              <button
                onClick={() => setView("queue")}
                className={`flex items-center gap-1.5 rounded-pill px-3 py-1 text-[13px] font-semibold ${
                  view === "queue" ? "bg-brand text-white" : "text-muted hover:text-ink"
                }`}
              >
                Payments queue
                {pendingCount > 0 && (
                  <span
                    className={`inline-flex min-w-[18px] items-center justify-center rounded-pill px-1 text-micro font-bold ${
                      view === "queue" ? "bg-white/25 text-white" : "bg-warn text-white"
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
            </div>
          )}

          <SyncStatus />

          <AccountMenu profile={profile} email={email} />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-4 sm:px-6">
        {view === "queue" ? (
          <PaymentQueue profile={profile} />
        ) : (
        <>
        {/* One calm toolbar: the customer lens, then date / payment / person */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CustomerTypeTabs
            value={filters.customerType}
            counts={totals?.customer}
            onSelect={(customerType) => patch({ customerType })}
          />
          <Filters
            value={filters}
            salespeople={salespeople}
            onChange={patch}
            onReset={() =>
              setFilters({
                ...emptyFilters,
                dispatch: filters.dispatch,
                customerType: filters.customerType,
              })
            }
          />
        </div>

        <div className="mt-3">
          <StatusRail
            totals={totals?.byStatus}
            active={filters.dispatch}
            onSelect={(dispatch) => patch({ dispatch })}
          />
        </div>

        <div className="mt-4">
          {isLoading && <Skeleton />}
          {error && <ErrorNote error={error} retry={() => refetch()} />}

          {rows && rows.length === 0 && (
            <Empty
              icon={<Search size={28} />}
              title="No orders in this view"
              hint={
                filters.datePreset === "today"
                  ? "Nothing dated today. Widen the date range to see more."
                  : filters.datePreset === "yesterday"
                    ? "Nothing dated yesterday. Try a wider date range."
                    : filters.dispatch !== "all"
                      ? "No orders at this stage for the chosen filters."
                      : "Approved orders from Zoho Books show up here automatically."
              }
            />
          )}

          {rows && rows.length > 0 && (
            <OrderTable
              rows={rows}
              touched={touched}
              selectedId={selectedId}
              onSelect={(r: BoardRow) => setSelectedId(r.id)}
            />
          )}
        </div>
        </>
        )}
      </div>

      {selected && (
        <OrderPanel order={selected} profile={profile} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
