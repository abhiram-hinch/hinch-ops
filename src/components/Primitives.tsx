import { forwardRef } from "react";
import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, ButtonHTMLAttributes } from "react";
import { paidRatio } from "@/lib/format";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`field pr-8 ${props.className ?? ""}`} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} className={`field ${props.className ?? ""}`} />;
  },
);

type Variant = "primary" | "ghost" | "soft" | "danger";
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={`btn-${variant} btn-${size} ${className}`}
    />
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-micro text-faint">{hint}</span>}
    </label>
  );
}

/**
 * The payment bar: a rounded proportion bar. Still the most decision-relevant
 * fact on a row, so it keeps visual weight.
 */
export function PaymentBar({
  received,
  total,
  color,
  width = 96,
  showPct = true,
}: {
  received: number;
  total: number;
  color: string;
  width?: number;
  showPct?: boolean;
}) {
  const r = paidRatio(received, total);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 shrink-0 overflow-hidden rounded-pill bg-line"
        style={{ width }}
        role="img"
        aria-label={`${Math.round(r * 100)} percent paid`}
      >
        <div className="h-full rounded-pill" style={{ width: `${r * 100}%`, backgroundColor: color }} />
      </div>
      {showPct && (
        <span className="num text-micro font-semibold" style={{ color }}>
          {Math.round(r * 100)}%
        </span>
      )}
    </div>
  );
}

/** Generic labelled progress bar (dispatch %, etc.). */
export function ProgressBar({
  value,
  color,
  width = 96,
}: {
  value: number; // 0..1
  color: string;
  width?: number;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className="h-2 shrink-0 overflow-hidden rounded-pill bg-line"
      style={{ width }}
      role="img"
      aria-label={`${Math.round(v * 100)} percent`}
    >
      <div className="h-full rounded-pill" style={{ width: `${v * 100}%`, backgroundColor: color }} />
    </div>
  );
}

export function Empty({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-lineStrong bg-surface px-6 py-16 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-base font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-lg border border-badSoft bg-badSoft/40 px-4 py-3">
      <p className="text-sm font-semibold text-bad">Something went wrong</p>
      <p className="mt-1 text-sm text-ink">{message}</p>
      {retry && (
        <button onClick={retry} className="btn-ghost btn-sm mt-3">
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-line/60" />
      ))}
    </div>
  );
}
