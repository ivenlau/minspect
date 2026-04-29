import styles from './Tabs.module.css';

export interface TabItem {
  key: string;
  label: string;
  href?: string; // if provided, tab is a link (preferred for hash routing)
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  onChange?: (key: string) => void;
}

export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className={styles.bar} role="tablist">
      {items.map((it) => {
        const isActive = it.key === active;
        const cls = `${styles.tab} ${isActive ? styles.active : ''}`;
        if (it.href) {
          return (
            <a key={it.key} href={it.href} className={cls} role="tab" aria-selected={isActive}>
              {it.label}
            </a>
          );
        }
        return (
          <button
            type="button"
            key={it.key}
            className={cls}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(it.key)}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
