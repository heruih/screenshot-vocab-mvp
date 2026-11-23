/* ============ 权益计量 / 加练包 / 月度成本封顶 ============
 * 一次请求的生命周期：
 *   1) 读当月成本，已封顶则直接拒绝（不占名额、不调上游）
 *   2) reserveSlot：原子占用一个名额（基础免费或加练包），失败=超额
 *   3) 调用上游（模拟模式下为模拟接口）
 *   4) 成功 → 按真实用量折算成本并累加；失败 → releaseSlot 回退名额
 * 用条件 UPDATE 原子抢占名额，多人并发时不会超额放行。
 * ===================================================== */

import { beijingDay, beijingMonth } from './time.mjs';

/* 默认口径：每日免费句数、月度提醒/封顶（单位：微元，1 元 = 1,000,000 微元） */
function config(env) {
  const c = {
    freeDaily: { text: 10, tts: 15 },
    warnMicro: 100_000_000,   // 100 元
    capMicro: 150_000_000     // 150 元
  };
  try {
    const raw = env.ENTITLEMENT_CONFIG ? JSON.parse(env.ENTITLEMENT_CONFIG) : null;
    if (raw) {
      if (raw.freeDaily) Object.assign(c.freeDaily, raw.freeDaily);
      if (raw.warnMicro) c.warnMicro = raw.warnMicro;
      if (raw.capMicro) c.capMicro = raw.capMicro;
    }
  } catch (_) {}
  return c;
}

/* ---------- 月度成本 ---------- */

async function ensureMonthlyRow(db, month) {
  /* 幂等初始化：并发下只有一个插入成功，其余忽略，再统一读回，避免唯一键冲突 */
  await db.prepare(
    'INSERT OR IGNORE INTO monthly_cost (month, deepseek_micro, cosyvoice_micro, total_micro, alert_sent, updated_at) ' +
    'VALUES (?, 0, 0, 0, 0, ?)'
  ).bind(month, Date.now()).run();
  return db.prepare('SELECT * FROM monthly_cost WHERE month = ?').bind(month).first();
}

/* 是否已达月度封顶。返回 true 时付费功能必须停。 */
export async function isCapped(env, now = new Date()) {
  const month = beijingMonth(now);
  const row = await ensureMonthlyRow(env.DB, month);
  return row.total_micro >= config(env).capMicro;
}

/* 累加当月成本（原子），并判断是否跨过 100 元提醒线。返回 {alert,total}。 */
async function addMonthlyCost(env, service, micro, now = new Date()) {
  const db = env.DB;
  const month = beijingMonth(now);
  const row = await ensureMonthlyRow(db, month);
  const ds = row.deepseek_micro + (service === 'text' ? micro : 0);
  const cv = row.cosyvoice_micro + (service === 'tts' ? micro : 0);
  const total = row.total_micro + micro;
  let alert = 0;
  if (!row.alert_sent && total >= config(env).warnMicro) alert = 1;
  await db.prepare(
    'UPDATE monthly_cost SET deepseek_micro = ?, cosyvoice_micro = ?, total_micro = ?, ' +
    'alert_sent = ?, updated_at = ? WHERE month = ?'
  ).bind(ds, cv, total, row.alert_sent || alert, Date.now(), month).run();
  return { alert: !!alert, total };
}

/* ---------- 每日用量（原子计数器） ---------- */

async function getDaily(db, accountId, kind, day) {
  return db.prepare('SELECT * FROM daily_usage WHERE account_id = ? AND kind = ? AND day = ?')
    .bind(accountId, kind, day).first();
}

/* 无条件回退一个已占用的基础名额（上游失败时用），不会减成负数 */
async function decrementDaily(db, accountId, kind, day) {
  await db.prepare(
    'INSERT OR IGNORE INTO daily_usage (account_id, kind, day, count) VALUES (?, ?, ?, 0)'
  ).bind(accountId, kind, day).run();
  await db.prepare(
    'UPDATE daily_usage SET count = MAX(0, count - 1) WHERE account_id = ? AND kind = ? AND day = ?'
  ).bind(accountId, kind, day).run();
}

/* 取一个可用加练包：优先用即将过期的，否则按发放顺序（FIFO） */
async function pickUsableGrant(db, accountId, kind, now) {
  return db.prepare(
    'SELECT * FROM grants WHERE account_id = ? AND kind = ? AND remaining > 0 ' +
    'AND (expires_at IS NULL OR expires_at > ?) ' +
    'ORDER BY (expires_at IS NULL), expires_at, id LIMIT 1'
  ).bind(accountId, kind, now).first();
}

/* 占用一个名额。返回 {source:'free'|'grant'|'none', ...}
 * 全程用条件 UPDATE 原子抢占，靠 changes 判断成败，不依赖读回值，并发安全。 */
export async function reserveSlot(env, accountId, kind, now = new Date()) {
  const db = env.DB;
  const day = beijingDay(now);
  const freeDaily = config(env).freeDaily[kind];

  /* 幂等确保当日行存在 */
  await db.prepare(
    'INSERT OR IGNORE INTO daily_usage (account_id, kind, day, count) VALUES (?, ?, ?, 0)'
  ).bind(accountId, kind, day).run();

  /* 原子抢基础名额：仅当 count < freeDaily 才自增；changes=1 即抢到 */
  const upd = await db.prepare(
    'UPDATE daily_usage SET count = count + 1 ' +
    'WHERE account_id = ? AND kind = ? AND day = ? AND count < ?'
  ).bind(accountId, kind, day, freeDaily).run();
  if (upd.meta.changes === 1) {
    return { source: 'free', day, freeDaily };
  }

  /* 基础已满，原子抢加练包 */
  const grant = await pickUsableGrant(db, accountId, kind, Date.now());
  if (grant) {
    const g = await db.prepare(
      'UPDATE grants SET remaining = remaining - 1 WHERE id = ? AND remaining > 0'
    ).bind(grant.id).run();
    if (g.meta.changes === 1) {
      return { source: 'grant', day, grantId: grant.id, freeDaily };
    }
  }
  return { source: 'none', day, freeDaily };
}

/* 上游失败时回退名额，失败的请求不消耗用户额度 */
export async function releaseSlot(env, accountId, kind, reservation, now = new Date()) {
  const db = env.DB;
  if (reservation.source === 'free') {
    await decrementDaily(db, accountId, kind, reservation.day);
  } else if (reservation.source === 'grant') {
    await db.prepare('UPDATE grants SET remaining = remaining + 1 WHERE id = ?')
      .bind(reservation.grantId).run();
  }
}

/* 上游成功后记账：折算成本并累加，返回提醒信号 */
export async function recordCost(env, kind, cents, now = new Date()) {
  return addMonthlyCost(env, kind, cents, now);
}

/* ---------- 前端状态汇总 ---------- */

export async function getStatus(env, accountId, now = new Date()) {
  const db = env.DB;
  const day = beijingDay(now);
  const month = beijingMonth(now);
  const out = {};
  for (const kind of ['text', 'tts']) {
    const freeDaily = config(env).freeDaily[kind];
    const daily = await getDaily(db, accountId, kind, day);
    const used = daily ? daily.count : 0;
    const grants = await db.prepare(
      'SELECT COALESCE(SUM(remaining), 0) AS remaining FROM grants ' +
      'WHERE account_id = ? AND kind = ? AND (expires_at IS NULL OR expires_at > ?)'
    ).bind(accountId, kind, Date.now()).first();
    const grantRemaining = grants ? grants.remaining : 0;
    out[kind] = {
      freeDaily,
      used,
      freeLeft: Math.max(0, freeDaily - used),
      grantRemaining,
      totalLeft: Math.max(0, freeDaily - used) + grantRemaining
    };
  }
  const monthly = await ensureMonthlyRow(db, month);
  return {
    day, month,
    limits: out,
    monthly: {
      warnMicro: config(env).warnMicro,
      capMicro: config(env).capMicro,
      totalMicro: monthly.total_micro,
      deepseekMicro: monthly.deepseek_micro,
      cosyvoiceMicro: monthly.cosyvoice_micro
    }
  };
}

export { config as billingConfig };
