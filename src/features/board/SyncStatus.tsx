import { RefreshCw } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { useSyncHealth, useSyncNow } from "@/hooks/useBoard";

export function SyncStatus() {
  const { data } = useSyncHealth();
  const sync = useSyncNow();

  const last = data?.last_success_at ? new Date(data.last_success_at) : null;
  const stale = !last || Date.now() - last.getTime() > 30 * 60_000;

  return (
    <button
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      title={stale ? "Zoho sync is behind — click to sync now" : `Synced ${relativeTime(data?.last_success_at ?? null)}`}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill border px-3 text-[13px] font-medium transition-colors ${
        stale
          ? "border-warnSoft bg-warnSoft text-warn hover:bg-warnSoft/70"
          : "border-line bg-surface text-muted hover:text-ink"
      }`}
    >
      <RefreshCw size={14} className={sync.isPending ? "animate-spin" : ""} />
      <span className="hidden sm:inline">
        {sync.isPending ? "Syncing…" : stale ? "Sync now" : `Synced ${relativeTime(data?.last_success_at ?? null)}`}
      </span>
    </button>
  );
}
