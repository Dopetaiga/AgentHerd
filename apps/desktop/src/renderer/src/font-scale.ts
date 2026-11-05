// The owner's font size for the whole app (设置 → 字体大小). Every text size and line height in
// tokens.css is multiplied by --ah-font-scale on <html>; spacing and icons keep their size.
// It is a preference of this computer's screen, so it lives in localStorage, not with the host.

import { useSyncExternalStore } from "react";

export const FONT_SCALES = [
  { value: "0.9", label: "小" },
  { value: "1", label: "标准" },
  { value: "1.1", label: "大" },
  { value: "1.2", label: "较大" },
  { value: "1.3", label: "特大" },
] as const;

export type FontScale = (typeof FONT_SCALES)[number]["value"];

const KEY = "agentherd.fontScale";
const DEFAULT: FontScale = "1";
const listeners = new Set<() => void>();

function isScale(v: string | null): v is FontScale {
  return FONT_SCALES.some((s) => s.value === v);
}

function read(): FontScale {
  try {
    const v = window.localStorage.getItem(KEY);
    return isScale(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current: FontScale = read();

function apply(scale: FontScale): void {
  document.documentElement.style.setProperty("--ah-font-scale", scale);
}

/** Applies the saved size; call once before the first render so the app never jumps. */
export function initFontScale(): void {
  apply(current);
}

export function setFontScale(scale: FontScale): void {
  current = scale;
  apply(scale);
  try {
    if (scale === DEFAULT) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, scale);
  } catch {
    // Without storage the size holds until the app restarts.
  }
  for (const l of listeners) l();
}

export function useFontScale(): FontScale {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
