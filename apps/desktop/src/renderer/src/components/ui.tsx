// Small shared UI pieces: buttons, cards, badges, fields, switch, modal, toasts.

import { X } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, useEffect } from "react";
import { useApp } from "../store";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-500 disabled:bg-blue-600/50",
  secondary:
    "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
  ghost: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-600/50",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  const sizing = size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3.5 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-700/70 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="font-semibold text-sm text-zinc-800 dark:text-zinc-100">{children}</h2>
      {hint !== undefined && <span className="text-xs text-zinc-500">{hint}</span>}
    </div>
  );
}

export type Tone = "gray" | "blue" | "green" | "amber" | "orange" | "red";

const TONES: Record<Tone, string> = {
  gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export const inputClass =
  "h-8 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="block">
      <span className="mb-1 block font-medium text-xs text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
      {hint !== undefined && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 ${
          wide ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        <header className="flex items-center justify-between border-zinc-200 border-b px-5 py-3 dark:border-zinc-700">
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{title}</h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer !== undefined && (
          <footer className="flex items-center justify-end gap-2 border-zinc-200 border-t px-5 py-3 dark:border-zinc-700">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon, text }: { icon: ReactNode; text: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-500">
      <div className="text-zinc-400">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          }`}
        >
          <span className="selectable min-w-0 flex-1 break-words">{t.text}</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
