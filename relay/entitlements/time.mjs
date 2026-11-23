/* ============ 北京时间（UTC+8）工具 ============
 * 每日免费额度与月度成本都按北京时间的"日/月"重置，
 * 因此不能直接用 Worker 的 UTC 字段，需要先 +8 小时再取数。
 * =================================================== */

const BEIJING_SHIFT_MS = 8 * 60 * 60 * 1000;
const pad = n => String(n).padStart(2, '0');

function shifted(date) {
  return new Date(date.getTime() + BEIJING_SHIFT_MS);
}

/* 北京日期 YYYY-MM-DD */
export function beijingDay(date = new Date()) {
  const d = shifted(date);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/* 北京年月 YYYY-MM */
export function beijingMonth(date = new Date()) {
  const d = shifted(date);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
}

/* DeepSeek 高峰时段：北京时间周一至周五 9:00–12:00、14:00–18:00。
 * 法定节假日的优惠按官方账单核对，本机账本不低估这几天的成本。 */
export function isPeakHour(date = new Date()) {
  const d = shifted(date);
  const weekday = d.getUTCDay(); // 0=周日，6=周六
  if (weekday === 0 || weekday === 6) return false;
  const hour = d.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}
