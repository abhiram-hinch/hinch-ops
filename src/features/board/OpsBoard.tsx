import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  useBoard,
  useBoardRow,
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
import { AnalyticsPage } from "@/features/analytics/AnalyticsPage";
import { CustomersPage } from "@/features/customers/CustomersPage";
import { PartlySentPage } from "@/features/partly/PartlySentPage";
import { usePartlySent } from "@/hooks/usePartlySent";
import { AccountMenu } from "@/features/auth/AccountMenu";
import type { BoardRow, Profile } from "@/types/database";

export function OpsBoard({ profile, email }: { profile: Profile; email: string }) {
  const initial = useMemo(() => readBoardState(), []);
  const [filters, setFilters] = useState<BoardFilters>(initial.filters);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  // The daily WhatsApp nudge links to /?view=partly, so land straight on that tab.
  const [view, setView] = useState<"board" | "queue" | "analytics" | "customers" | "partly">(() =>
    new URLSearchParams(window.location.search).get("view") === "partly" ? "partly" : "board",
  );
  const { data: partlySent } = usePartlySent();
  const partlyCount = partlySent?.length ?? 0;
  const partlyOverdue = (partlySent ?? []).some((o) => (o.days_since_last_dispatch ?? 0) >= 7);
  const mayClear = canClearPayments(profile.role);
  const isAdmin = profile.role === "admin";
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
  const { data: rows, isLoading, error, refetch } = useBoard(filters, profile.role);
  const { data: totals } = useBoardTotals(filters, profile.role);

  const salespeople = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.salesperson_name).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const inRowsSelected = rows?.find((r) => r.id === selectedId) ?? null;
  // An order opened from outside the board's active filters (e.g. a
  // customer's older orders) won't be in `rows` — fetch it directly.
  const fallback = useBoardRow(selectedId && !inRowsSelected ? selectedId : null);
  const selected = inRowsSelected ?? fallback.data ?? null;
  const patch = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-4 sm:px-6">
          <h1 className="shrink-0 text-xl font-bold tracking-tight text-ink">
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

          <div className="hidden shrink-0 rounded-pill border border-line p-0.5 sm:flex">
            <button
              onClick={() => setView("board")}
              className={`rounded-pill px-3 py-1 text-sm font-semibold ${
                view === "board" ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              Board
            </button>
            <button
              onClick={() => setView("partly")}
              className={`flex items-center gap-1.5 rounded-pill px-3 py-1 text-sm font-semibold ${
                view === "partly" ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              Partly sent
              {partlyCount > 0 && (
                <span
                  className={`inline-flex min-w-[18px] items-center justify-center rounded-pill px-1 text-micro font-bold ${
                    view === "partly" ? "bg-white/25 text-white" : partlyOverdue ? "bg-bad text-white" : "bg-warn text-white"
                  }`}
                >
                  {partlyCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setView("customers")}
              className={`rounded-pill px-3 py-1 text-sm font-semibold ${
                view === "customers" ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              Customers
            </button>
            {mayClear && (
              <button
                onClick={() => setView("queue")}
                className={`flex items-center gap-1.5 rounded-pill px-3 py-1 text-sm font-semibold ${
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
            )}
            {isAdmin && (
              <button
                onClick={() => setView("analytics")}
                className={`rounded-pill px-3 py-1 text-sm font-semibold ${
                  view === "analytics" ? "bg-brand text-white" : "text-muted hover:text-ink"
                }`}
              >
                Analytics
              </button>
            )}
          </div>

          <SyncStatus />

          <AccountMenu profile={profile} email={email} />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6">
        {view === "queue" ? (
          <PaymentQueue profile={profile} />
        ) : view === "analytics" ? (
          <AnalyticsPage />
        ) : view === "partly" ? (
          <PartlySentPage onSelectOrder={setSelectedId} />
        ) : view === "customers" ? (
          <CustomersPage profile={profile} onSelectOrder={setSelectedId} />
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
                filters.dispatch === "dispatched_awaiting_payment"
                  ? "Nothing sent out is still owed money right now."
                  : filters.datePreset === "today"
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
