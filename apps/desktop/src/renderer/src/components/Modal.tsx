// The dialog shell used by the service forms and the Feishu setup.
// Colors come from the --ah-* tokens through the Tailwind theme (see styles.css).

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  actions,
  wide = false,
  size,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Buttons in the header, after the title; they replace the close button. */
  actions?: ReactNode;
  wide?: boolean;
  /**
   * "large": a fixed-size work dialog (the model service form). It does not grow with its
   * content and its body does not scroll; the parts inside scroll on their own.
   */
  size?: "default" | "wide" | "large";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (size === "large") {
    return (
      <div className="app-no-drag ah-fade-in fixed inset-0 z-40 flex items-center justify-center bg-overlay">
        <div
          role="dialog"
          aria-modal="true"
          className="ah-dialog-in flex h-[min(720px,calc(100vh-64px))] w-[min(1040px,calc(100vw-48px))] flex-col gap-3 overflow-hidden rounded-card bg-canvas p-4 shadow-(--ah-shadow-dialog) ring-1 ring-(color:--ah-dialog-ring)"
        >
          <header className="flex min-h-8 shrink-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-3">
              <h3 className="truncate font-semibold text-base text-ink">{title}</h3>
              {description !== undefined && (
                <div className="min-w-0 truncate text-ink-muted text-sm">{description}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions ?? (
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              )}
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-3">{children}</div>
        </div>
      </div>
    );
  }
  const widened = wide || size === "wide";
  return (
    <div className="app-no-drag ah-fade-in fixed inset-0 z-40 flex items-center justify-center bg-overlay p-8">
      <div
        role="dialog"
        aria-modal="true"
        className={`ah-dialog-in flex max-h-full w-full flex-col overflow-hidden rounded-card bg-canvas shadow-(--ah-shadow-dialog) ring-1 ring-(color:--ah-dialog-ring) ${
          widened ? "max-w-[560px]" : "max-w-[460px]"
        }`}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-ink text-lg">{title}</h3>
            {description !== undefined && (
              <p className="mt-1 text-ink-muted text-md">{description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="-mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
        {footer !== undefined && (
          <footer className="flex items-center justify-end gap-2 border-line border-t px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
