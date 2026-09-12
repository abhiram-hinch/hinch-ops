import { useState } from "react";
import { relativeTime } from "@/lib/format";
import { useAddComment, useOrderComments } from "@/hooks/useBoard";
import { ErrorNote, Skeleton } from "@/components/Primitives";
import type { BoardRow, Profile } from "@/types/database";

/**
 * Shared notes thread — cross-team communication that doesn't belong in the
 * system activity log. Visible to every role regardless of payment
 * visibility, since "call the customer back" isn't a payment or dispatch fact.
 */
export function NotesTab({ order, profile }: { order: BoardRow; profile: Profile }) {
  const { data, isLoading, error, refetch } = useOrderComments(order.id);
  const add = useAddComment(order.id);
  const [body, setBody] = useState("");

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || add.isPending) return;
    await add.mutateAsync({ body: trimmed, userId: profile.id });
    setBody("");
  }

  return (
    <div className="space-y-4">
      <div className="card p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={3}
          placeholder="Leave a note for the team — a call-back, a special instruction, anything worth flagging…"
          className="field w-full resize-y py-2"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-micro text-faint">Visible to everyone on this order. Cmd/Ctrl+Enter to post.</p>
          <button
            onClick={submit}
            disabled={!body.trim() || add.isPending}
            className="btn-primary btn-sm"
          >
            {add.isPending ? "Posting…" : "Post note"}
          </button>
        </div>
        {add.error && (
          <p className="mt-2 text-sm text-bad">
            {add.error instanceof Error ? add.error.message : "Could not post that."}
          </p>
        )}
      </div>

      {isLoading && <Skeleton rows={3} />}
      {error && <ErrorNote error={error} retry={() => refetch()} />}

      {data && data.length === 0 && (
        <p className="rounded-lg bg-raised px-3 py-4 text-center text-[13px] text-muted">
          No notes yet. Leave one for the team above.
        </p>
      )}

      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brandSoft text-micro font-bold text-brand">
                {(c.profiles?.full_name?.trim()?.[0] ?? "?").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-2">
                <p className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-ink">
                    {c.profiles?.full_name ?? "Someone"}
                  </span>
                  <span className="text-micro text-faint">{relativeTime(c.created_at)}</span>
                </p>
                <p className="mt-0.5 whitespace-pre-line text-sm text-ink">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
