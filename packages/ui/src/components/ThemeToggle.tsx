import { Moon, Sun } from 'lucide-react';
import { useLang } from '../i18n';
import { useTheme } from '../theme';
import styles from './ThemeToggle.module.css';

// Tiny icon button in the TopBar right cluster. Click toggles light/dark.
// We render both icons and swap via CSS rather than conditionally mounting,
// so the button size never jumps.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useLang();
  const label = theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark');
  return (
    <button type="button" className={styles.btn} onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}
