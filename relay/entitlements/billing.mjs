/* ============ 权益计量 / 加练包 / 月度成本硬封顶 ============
 * 一次请求的生命周期（两套账本分开记）：
 *   用户练习额度（每日免费句数 + 加练包）：reserveSlot / releaseSlot，按北京自然日重置；
 *   站方费用预算（月度 150 元硬上限，DeepSeek 与 CosyVoice 共用）：
 *     1) 调用前按本次"最高可能成本"原子预留 reserveBudget（条件 UPDATE，changes 判定）；
 *     2) 同时原子占用一个用户名额 reserveSlot；
 *     3) 调用上游（模拟模式下为模拟接口）；
 *     4) 成功 → settleBudget：按实际用量结算，退回多预留的差额；
 *     5) 确定失败（上游明确报错、确定没扣费）→ releaseBudget 释放预留 + releaseSlot 归还名额；
 *     6) 结果不确定（超时/网络异常，上游可能已扣费）→ holdBudget 挂起预留待人工核对，
 *        用户没拿到结果，仍归还其练习名额。
 * 所有金额都用条件 UPDATE / 原子自增自减，不做"读-改-写"，并发下不会超支、不会丢账。
 * ===================================================== */

import { beijingDay, beijingMonth } from './time.mjs';

/* 默认口径：每日免费句数、月度提醒/封顶（单位：微元，1 元 = 1,000,000 微元） */
function config(env) {
  const c = {
    freeDaily: { text: 10, tts: 0 },
    warnMicro: 100_000_000,   // 100 元
    capMicro: 150_000_000     // 150 元
  };
  try {
    const raw = env.ENTITLEMENT_CONFIG ? JSON.parse(env.ENTITLEMENT_CONFIG) : null;
    if (raw) {
      if (Number.isSafeInteger(raw.freeDaily?.text) && raw.freeDaily.text >= 0) c.freeDaily.text = raw.freeDaily.text;
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
    'INSERT OR IGNORE INTO monthly_cost (month, deepseek_micro, cosyvoice_micro, total_micro, ' +
    'reserved_micro, alert_sent, updated_at) VALUES (?, 0, 0, 0, 0, 0, ?)'
  ).bind(month, Date.now()).run();
  return db.prepare('SELECT * FROM monthly_cost WHERE month = ?').bind(month).first();
}

/* 调用前原子预留站方预算。仅当 total + reserved + max <= cap 时才自增，changes=1 即成功。
 * 返回 {ok, holdId, month, maxMicro}；ok=false 表示预算不足，调用方应直接 402，不调上游。 */
export async function reserveBudget(env, service, maxMicro, now = new Date()) {
  if (!Number.isSafeInteger(maxMicro) || maxMicro < 0) throw new Error('Invalid budget reservation');
  const db = env.DB;
  const month = beijingMonth(now);
  await ensureMonthlyRow(db, month);
  const cap = config(env).capMicro;
  const holdId = crypto.randomUUID();
  const at = Date.now();
  const [upd] = await db.batch([db.prepare(
    'UPDATE monthly_cost SET reserved_micro = reserved_micro + ?, updated_at = ? ' +
    'WHERE month = ? AND total_micro + reserved_micro + ? <= ?'
  ).bind(maxMicro, at, month, maxMicro, cap), db.prepare(
    'INSERT INTO budget_hold (id, month, service, max_micro, status, created_at, updated_at) ' +
    "SELECT ?, ?, ?, ?, 'reserved', ?, ? WHERE changes() = 1"
  ).bind(holdId, month, service, maxMicro, at, at)]);
  if (upd.meta.changes !== 1) return { ok: false, holdId: null, month, maxMicro };
  return { ok: true, holdId, month, service, maxMicro };
}

/* 同一事务更新请求状态和月账。重试或并发核对只能结算一次，账期沿用预留时的月份。 */
async function finishBudget(env, budget, expectedStatus, finalStatus, actualMicro) {
  if (!Number.isSafeInteger(actualMicro) || actualMicro < 0) throw new Error('Invalid billed amount');
  const db = env.DB;
  const { holdId, month, service, maxMicro } = budget;
  const serviceColumn = service === 'text' ? 'deepseek_micro' : 'cosyvoice_micro';
  const at = Date.now();
  const [updated] = await db.batch([
    db.prepare(
      'UPDATE monthly_cost SET reserved_micro = reserved_micro - ?, total_micro = total_micro + ?, ' +
      serviceColumn + ' = ' + serviceColumn + ' + ?, updated_at = ? ' +
      'WHERE month = ? AND reserved_micro >= ? AND EXISTS ' +
      '(SELECT 1 FROM budget_hold WHERE id = ? AND month = ? AND status = ?)'
    ).bind(maxMicro, actualMicro, actualMicro, at, month, maxMicro, holdId, month, expectedStatus),
    db.prepare(
      'UPDATE budget_hold SET status = ?, updated_at = ? WHERE id = ? AND status = ? AND changes() = 1'
    ).bind(finalStatus, at, holdId, expectedStatus)
  ]);
  if (updated.meta.changes !== 1) return null;
  return getBudgetCost(env, month);
}

export async function getBudgetCost(env, month = beijingMonth()) {
  const row = await env.DB.prepare('SELECT * FROM monthly_cost WHERE month = ?').bind(month).first();
  const cfg = config(env);
  const total = row?.total_micro ?? 0;
  return { alert: !row?.alert_sent && total >= cfg.warnMicro, total,
    reserved: row?.reserved_micro ?? 0, month, warnMicro: cfg.warnMicro, capMicro: cfg.capMicro };
}

export async function settleBudget(env, budget, actualMicro) {
  const cost = await finishBudget(env, budget, 'reserved', 'settled', actualMicro);
  if (!cost) throw new Error('Budget reservation is not open');
  return cost;
}

export async function markCostAlertSent(env, month) {
  await env.DB.prepare('UPDATE monthly_cost SET alert_sent = 1 WHERE month = ?').bind(month).run();
}

/* 确定失败（上游明确报错、确定未扣费）：原子释放预留，不增加已结算成本。 */
export async function releaseBudget(env, budget) {
  return finishBudget(env, budget, 'reserved', 'released', 0);
}

/* 结果不确定（超时/网络异常，上游可能已扣费）：预留继续挂在 reserved_micro，
 * 同时写 budget_hold 留痕，等人工核对后再 resolveHold。用户练习名额另行归还。 */
export async function holdBudget(env, budget, reason) {
  await env.DB.prepare(
    "UPDATE budget_hold SET status = 'held', reason = ?, updated_at = ? WHERE id = ? AND status = 'reserved'"
  ).bind(reason, Date.now(), budget.holdId).run();
}

/* 人工核对一笔挂起预留：decision='settled' 按 actualMicro 转结算；'released' 全额释放。 */
const STALE_RESERVATION_MS = 15 * 60 * 1000;

export async function listBudgetHolds(env) {
  const result = await env.DB.prepare(
    "SELECT * FROM budget_hold WHERE status = 'held' OR (status = 'reserved' AND updated_at <= ?) " +
    'ORDER BY created_at LIMIT 100'
  ).bind(Date.now() - STALE_RESERVATION_MS).all();
  return result.results;
}

export async function resolveHold(env, holdId, decision, actualMicro = 0) {
  if (!['settled', 'released'].includes(decision)) {
    return { ok: false, status: 400, message: '请选择结算或释放' };
  }
  const held = await env.DB.prepare('SELECT * FROM budget_hold WHERE id = ?').bind(holdId).first();
  if (!held) return { ok: false, status: 404, message: '没有这笔待核对记录' };
  const stale = held.status === 'reserved' && held.updated_at <= Date.now() - STALE_RESERVATION_MS;
  if (held.status !== 'held' && !stale) return { ok: false, status: 409, message: '该记录不可核对或已核对' };
  if (decision === 'settled' && (!Number.isSafeInteger(actualMicro) || actualMicro <= 0)) {
    return { ok: false, status: 400, message: '实际费用须为正整数微元' };
  }
  const budget = { holdId, month: held.month, service: held.service, maxMicro: held.max_micro };
  const cost = await finishBudget(env, budget, held.status, decision, decision === 'settled' ? actualMicro : 0);
  if (!cost) return { ok: false, status: 409, message: '该记录已核对过' };
  return { ok: true, decision, month: held.month, cost };
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

/* 占用一个用户名额。返回 {source:'free'|'grant'|'none', ...}
 * 全程用条件 UPDATE 原子抢占，靠 changes 判断成败，不依赖读回值，并发安全。 */
export async function reserveSlot(env, accountId, kind, now = new Date()) {
  const db = env.DB;
  const day = beijingDay(now);
  const freeDaily = config(env).freeDaily[kind];

  if (freeDaily > 0) {
    await db.prepare(
      'INSERT OR IGNORE INTO daily_usage (account_id, kind, day, count) VALUES (?, ?, ?, 0)'
    ).bind(accountId, kind, day).run();
    const upd = await db.prepare(
      'UPDATE daily_usage SET count = count + 1 ' +
      'WHERE account_id = ? AND kind = ? AND day = ? AND count < ?'
    ).bind(accountId, kind, day, freeDaily).run();
    if (upd.meta.changes === 1) return { source: 'free', day, freeDaily };
  }

  /* 同一句 SQL 选中并扣减，优先用即将到期的包。 */
  const grant = await db.prepare(
    'UPDATE grants SET remaining = remaining - 1 WHERE id = (' +
    'SELECT id FROM grants WHERE account_id = ? AND kind = ? AND remaining > 0 ' +
    'AND (expires_at IS NULL OR expires_at > ?) ' +
    'ORDER BY (expires_at IS NULL), expires_at, id LIMIT 1) RETURNING id'
  ).bind(accountId, kind, now.getTime()).first();
  if (grant) return { source: 'grant', day, grantId: grant.id, freeDaily };
  return { source: 'none', day, freeDaily };
}

/* 上游失败/用户没拿到结果时回退用户练习名额，失败的请求不消耗用户额度 */
export async function releaseSlot(env, accountId, kind, reservation, now = new Date()) {
  const db = env.DB;
  if (reservation.source === 'free') {
    await decrementDaily(db, accountId, kind, reservation.day);
  } else if (reservation.source === 'grant') {
    await db.prepare('UPDATE grants SET remaining = remaining + 1 WHERE id = ?')
      .bind(reservation.grantId).run();
  }
}

/* ---------- 前端状态汇总 ---------- */

export async function getGrantBalance(env, accountId, kind, now = new Date()) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS packs, COALESCE(SUM(remaining), 0) AS remaining FROM grants ' +
    'WHERE account_id = ? AND kind = ? AND (expires_at IS NULL OR expires_at > ?)'
  ).bind(accountId, kind, now.getTime()).first();
  return { hasPackage: row.packs > 0, remaining: row.remaining };
}

export async function getStatus(env, accountId, now = new Date()) {
  const db = env.DB;
  const day = beijingDay(now);
  const month = beijingMonth(now);
  const out = {};
  for (const kind of ['text', 'tts']) {
    const freeDaily = config(env).freeDaily[kind];
    const daily = await getDaily(db, accountId, kind, day);
    const used = daily ? daily.count : 0;
    const { hasPackage, remaining: grantRemaining } = await getGrantBalance(env, accountId, kind, now);
    out[kind] = {
      freeDaily,
      used,
      freeLeft: Math.max(0, freeDaily - used),
      hasPackage,
      grantRemaining,
      totalLeft: Math.max(0, freeDaily - used) + grantRemaining
    };
  }
  const monthlyRow = await ensureMonthlyRow(db, month);
  const held = await db.prepare(
    "SELECT COALESCE(SUM(max_micro), 0) AS held_micro, COUNT(*) AS held_count " +
    "FROM budget_hold WHERE month = ? AND status = 'held'"
  ).bind(month).first();
  return {
    day, month,
    limits: out,
    monthly: {
      warnMicro: config(env).warnMicro,
      capMicro: config(env).capMicro,
      totalMicro: monthlyRow.total_micro,
      reservedMicro: monthlyRow.reserved_micro,
      heldMicro: held ? held.held_micro : 0,
      heldCount: held ? held.held_count : 0,
      deepseekMicro: monthlyRow.deepseek_micro,
      cosyvoiceMicro: monthlyRow.cosyvoice_micro
    }
  };
}

export { config as billingConfig };
