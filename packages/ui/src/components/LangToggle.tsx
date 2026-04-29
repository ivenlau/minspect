import { useLang } from '../i18n';
import styles from './LangToggle.module.css';

// Tiny two-letter pill next to the theme toggle. Clicking flips between
// Chinese and English; the choice persists to localStorage (see i18n/index).
// We use text labels instead of an icon because a globe glyph is ambiguous
// about which language is currently active.
export function LangToggle() {
  const { lang, setLang, t } = useLang();
  const nextLang = lang === 'en' ? 'zh' : 'en';
  const label = lang === 'en' ? t('lang.switchToZh') : t('lang.switchToEn');
  return (
    <button
      type="button"
      className={styles.btn}
      onClick={() => setLang(nextLang)}
      aria-label={label}
      title={label}
    >
      <span className={`${styles.seg} ${lang === 'en' ? styles.segActive : ''}`}>EN</span>
      <span className={styles.sep}>/</span>
      <span className={`${styles.seg} ${lang === 'zh' ? styles.segActive : ''}`}>中</span>
    </button>
  );
}
