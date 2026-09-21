import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import { creditLabel, creditTone } from "@/lib/labels";
import { toneChip } from "@/lib/statusUi";
import { useCustomerSummaries } from "@/hooks/useCustomers";
import { Empty, ErrorNote, Skeleton } from "@/components/Primitives";
import { CustomerPanel } from "./CustomerPanel";
import type { Profile } from "@/types/database";

export function CustomersPage({
  profile,
  onSelectOrder,
}: {
  profile: Profile;
  onSelectOrder: (orderId: string) => void;
}) {
  const { data, isLoading, error, refetch } = useCustomerSummaries();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter((c) => c.name?.toLowerCase().includes(term));
  }, [data, search]);

  if (isLoading) return <Skeleton rows={6} />;
  if (error) return <ErrorNote error={error} retry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          <Users size={16} className="text-muted" /> Customers
        </h2>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers"
            aria-label="Search customers"
            className="field h-9 w-full pl-8 text-sm"
          />
        </div>
      </div>

      {filtered.length === 0 && (
        <Empty
          icon={<Users size={28} />}
          title="No customers found"
          hint={search ? "Try a different name." : "Customers appear here once they have an order."}
        />
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpenId(c.id)}
              className="card flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:border-lineStrong hover:shadow-raised"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-[15px] font-semibold text-ink">
                  {c.name ?? "Unnamed customer"}
                  {c.credit_status !== "none" && (
                    <span className={`chip px-2 py-0.5 text-micro ${toneChip[creditTone[c.credit_status]]}`}>
                      {creditLabel[c.credit_status]}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-micro text-muted">
                  <span className="num">{c.order_count}</span> order{c.order_count === 1 ? "" : "s"}
                  {c.last_order_date && <> · last {shortDate(c.last_order_date)}</>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="num text-base font-bold text-ink">{money(c.total_value)}</p>
                {c.total_outstanding > 0.01 && (
                  <p className="num text-micro text-warn">{money(c.total_outstanding)} outstanding</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {openId && (
        <CustomerPanel
          customerId={openId}
          profile={profile}
          onClose={() => setOpenId(null)}
          onSelectOrder={onSelectOrder}
        />
      )}
    </div>
  );
}
