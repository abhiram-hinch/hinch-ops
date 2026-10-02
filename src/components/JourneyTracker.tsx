import { Check, IndianRupee, Pause } from "lucide-react";
import { JOURNEY, stepStates, type StepState } from "@/lib/journey";
import type { BoardRow } from "@/types/database";

const node: Record<StepState, string> = {
  done: "bg-good text-white",
  current: "bg-brand text-white ring-4 ring-brandSoft",
  todo: "bg-surface text-faint border border-lineStrong",
  owed: "bg-warnSoft text-warn border border-warn",
  hold: "bg-bad text-white ring-4 ring-badSoft",
};

const labelTone: Record<StepState, string> = {
  done: "text-muted",
  current: "font-semibold text-ink",
  todo: "text-faint",
  owed: "font-semibold text-warn",
  hold: "font-semibold text-bad",
};

/**
 * Six-milestone progress line for one order. Labels sit under every node on
 * wider screens; on a phone only the current one shows, so it never wraps.
 */
export function JourneyTracker({
  order,
}: {
  order: Pick<BoardRow, "dispatch_status" | "stage_before_hold" | "payment_status">;
}) {
  const states = stepStates(order);

  return (
    <ol className="flex w-full items-start" aria-label="Order progress">
      {JOURNEY.map((step, i) => {
        const s = states[i];
        const last = i === JOURNEY.length - 1;
        const lineDone = s === "done" || s === "owed";
        return (
          <li key={step.key} className={`flex min-w-0 items-start ${last ? "" : "flex-1"}`}>
            <div className="flex w-[18px] shrink-0 flex-col items-center sm:w-auto">
              <span
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${node[s]}`}
                aria-current={s === "current" || s === "hold" ? "step" : undefined}
              >
                {s === "done" && <Check size={11} strokeWidth={3} />}
                {s === "owed" && <IndianRupee size={10} strokeWidth={3} />}
                {s === "hold" && <Pause size={10} strokeWidth={3} />}
              </span>
              <span
                className={`mt-1 whitespace-nowrap text-[11px] leading-4 ${labelTone[s]} ${
                  s === "current" || s === "hold" || s === "owed" ? "" : "hidden sm:block"
                }`}
              >
                {step.label}
                {s === "owed" && <span className="sr-only"> — payment still owed</span>}
              </span>
            </div>
            {!last && (
              <span
                aria-hidden
                className={`mx-1 mt-[8px] h-[2px] min-w-[8px] flex-1 rounded-full ${
                  lineDone ? "bg-good" : "bg-line"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
