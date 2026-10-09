import { GitCommitVertical, LayoutList } from "lucide-react";

export type BoardLayout = "cards" | "timeline";

const KEY = "hinch.boardLayout";

export function readLayout(): BoardLayout {
  try {
    return localStorage.getItem(KEY) === "timeline" ? "timeline" : "cards";
  } catch {
    return "cards";
  }
}

export function saveLayout(l: BoardLayout) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // private window / blocked storage — the choice just won't persist
  }
}

/** Switch between the original card list (v1) and the timeline (v2). */
export function LayoutToggle({
  value,
  onChange,
}: {
  value: BoardLayout;
  onChange: (l: BoardLayout) => void;
}) {
  const opt = (v: BoardLayout, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={value === v}
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-sm font-semibold transition-colors ${
        value === v ? "bg-ink text-white" : "text-muted hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 rounded-pill border border-line p-0.5" role="group" aria-label="Board layout">
      {opt("cards", "Cards", <LayoutList size={14} />)}
      {opt("timeline", "Timeline", <GitCommitVertical size={14} />)}
    </div>
  );
}
