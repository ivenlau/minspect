// Timestamp formatting shared across pages. Fixed ISO-style `YYYY-MM-DD HH:MM`
// (matches the existing WorkspacePage format) rather than locale-dependent
// output — the UI is a local dev tool and mono-aligned dates scan faster.

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}`;
  return `${date} ${time}`;
}

export function fmtTimeOfDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
