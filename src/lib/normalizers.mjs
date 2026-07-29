export function normalizePercent(value) {
  if (value === null || value === undefined) return 0;

  const text = String(value).trim();
  if (!text || text === "-") return 0;

  const hasPercentSign = text.includes("%");
  const parsed = Number.parseFloat(text.replaceAll("%", ""));
  if (!Number.isFinite(parsed)) return 0;

  if (hasPercentSign || Math.abs(parsed) > 1) return parsed / 100;
  return parsed;
}
