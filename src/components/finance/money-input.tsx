import { useLayoutEffect, useRef } from "react";

/** Numeric amount input that displays grouping separators while keeping raw state. */
export function formatAmountInput(value: string) {
  const normalized = value.replace(/,/g, "").replace(/[^0-9.]/g, "");
  const dot = normalized.indexOf(".");
  const clean = dot < 0 ? normalized : `${normalized.slice(0, dot)}.${normalized.slice(dot + 1).replace(/\./g, "")}`;
  const [integer = "", fraction] = clean.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function MoneyInput({ value, onChange, className, ...props }: {
  value: string;
  onChange: (rawValue: string) => void;
  className?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const display = formatAmountInput(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) {
      let pos = 0;
      let visibleChars = 0;
      while (pos < display.length && visibleChars < caret.current) {
        if (display[pos] !== ",") visibleChars++;
        pos++;
      }
      el.setSelectionRange(pos, pos);
      caret.current = null;
    }
  }, [display]);

  return <input
    {...props}
    ref={ref}
    type="text"
    inputMode="decimal"
    value={display}
    className={className}
    onChange={(event) => {
      const el = event.currentTarget;
      const start = el.selectionStart ?? el.value.length;
      const rawBefore = el.value.slice(0, start).replace(/,/g, "").replace(/[^0-9.]/g, "");
      const raw = el.value.replace(/,/g, "").replace(/[^0-9.]/g, "");
      const dot = raw.indexOf(".");
      const clean = dot < 0 ? raw : `${raw.slice(0, dot)}.${raw.slice(dot + 1).replace(/\./g, "")}`;
      caret.current = rawBefore.length;
      onChange(clean);
    }}
  />;
}
