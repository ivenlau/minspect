import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import styles from './DropdownPicker.module.css';

export interface DropdownOption<V extends string> {
  value: V;
  label: string;
}

export interface DropdownPickerProps<V extends string> {
  value: V;
  options: ReadonlyArray<DropdownOption<V>>;
  onChange: (v: V) => void;
  ariaLabel?: string;
}

// Chip-style dropdown matching the dashboard's date-range picker. Native
// <select> elements can't be styled consistently across themes/platforms, so
// wherever the UI wants "looks like the dashboard's range chip" it calls
// this component instead.
export function DropdownPicker<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: DropdownPickerProps<V>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.chip}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{current?.label ?? ''}</span>
        <ChevronDown size={12} className={styles.chev} />
      </button>
      {open && (
        <div className={styles.menu} aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`${styles.item} ${o.value === value ? styles.itemActive : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              aria-pressed={o.value === value}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
