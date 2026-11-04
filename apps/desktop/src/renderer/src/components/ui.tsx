// Small shared UI pieces: buttons, grouped lists, badges, fields, switch, toasts.
// The dialog shell lives in Modal.tsx.
// Colors come from the --ah-* tokens through the Tailwind theme (see styles.css).

import { X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useApp } from "../store";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  // Inverted: dark on a light canvas, light on a dark one.
  primary: "bg-invert text-on-invert hover:bg-invert-hover",
  secondary: "border border-line-strong bg-control text-ink hover:bg-control-hover",
  ghost: "text-ink-muted hover:bg-hover hover:text-ink",
  danger: "bg-danger-soft text-danger-text hover:bg-danger-soft-hover",
  link: "px-1! text-accent-text hover:underline",
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
  const sizing = size === "sm" ? "h-6 px-2 text-sm" : "h-7 px-3 text-md";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${sizing} ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

/** A grouped inset list: one rounded surface, rows split by inset hairlines. */
export function Group({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-line [&>*+*]:border-t ${className}`}
    >
      {children}
    </section>
  );
}

/** One row of a group: optional icon, a title with a description, and trailing controls. */
export function Row({
  icon,
  title,
  description,
  trailing,
  className = "",
  children,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`flex min-h-12 items-center gap-3 px-4 py-2.5 ${className}`}>
      {icon !== undefined && icon}
      {(title !== undefined || description !== undefined) && (
        <div className="min-w-0 flex-1">
          {title !== undefined && <div className="truncate font-medium text-ink">{title}</div>}
          {description !== undefined && (
            <div className="mt-0.5 text-ink-muted text-sm">{description}</div>
          )}
        </div>
      )}
      {children}
      {trailing !== undefined && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );
}

/** A small square that holds a row's glyph. */
export function IconTile({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "green" | "amber" | "red" | "blue";
}) {
  const tones = {
    gray: "bg-control-hover text-ink-2",
    green: "bg-success-soft text-success-text",
    amber: "bg-warning-soft text-warning-text",
    red: "bg-danger-soft text-danger-text",
    blue: "bg-accent-soft text-accent-text",
  };
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-semibold text-sm ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A titled section: a quiet heading above a group, with an optional hint and actions. */
export function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-6 items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium text-ink-2 text-md">{title}</h2>
          {hint !== undefined && <p className="mt-0.5 text-ink-muted text-sm">{hint}</p>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export type Tone = "gray" | "blue" | "green" | "amber" | "orange" | "red";

const TONES: Record<Tone, string> = {
  gray: "bg-control-hover text-ink-2",
  blue: "bg-accent-soft text-accent-text",
  green: "bg-success-soft text-success-text",
  amber: "bg-warning-soft text-warning-text",
  orange: "bg-warning-soft text-warning-text",
  red: "bg-danger-soft text-danger-text",
};

const DOTS: Record<Tone, string> = {
  gray: "bg-ink-dim",
  blue: "bg-accent",
  green: "bg-success",
  amber: "bg-warning",
  orange: "bg-warning",
  red: "bg-danger",
};

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 font-medium text-xs ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** A status dot. */
export function Dot({ tone = "gray", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && (
        <span className={`absolute inset-0 animate-ping rounded-full opacity-50 ${DOTS[tone]}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${DOTS[tone]}`} />
    </span>
  );
}

/** A light segmented control: one choice out of a few, for filtering a page. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-0.5 self-start rounded-md bg-control-hover p-0.5"
    >
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: styled as a segment, not a radio dot
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-6 rounded-sm px-2.5 text-sm transition-colors ${
            value === o.value
              ? "bg-surface-raised font-medium text-ink shadow-[0_0_0_1px_var(--ah-border-strong)]"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Class for text fields, text areas and selects (see `.ah-input` in styles.css). */
export const inputClass = "ah-input";

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
      <span className="mb-1.5 ml-0.5 block font-medium text-ink-2 text-md">{label}</span>
      {children}
      {hint !== undefined && (
        <span className="mt-1.5 ml-0.5 block text-ink-muted text-sm">{hint}</span>
      )}
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50 ${
        checked ? "bg-accent" : "bg-control-active"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-150 ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title?: ReactNode;
  text: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-9 text-center">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-control-hover text-ink-muted">
        {icon}
      </div>
      {title !== undefined && <div className="font-medium text-ink">{title}</div>}
      <div className="max-w-sm text-ink-muted text-md">{text}</div>
      {action !== undefined && <div className="mt-3">{action}</div>}
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
          className="ah-dialog-in pointer-events-auto flex items-start gap-2.5 rounded-lg bg-surface-raised px-3 py-2.5 text-ink shadow-(--ah-shadow-toast) ring-1 ring-line-strong"
        >
          <span className="mt-[5px]">
            <Dot tone={t.kind === "error" ? "red" : "green"} />
          </span>
          <span className="selectable min-w-0 flex-1 break-words">{t.text}</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-ink-muted hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
