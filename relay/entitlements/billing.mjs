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
    'INSERT OR IGNORE INTO monthly_cost (month, deepseek_micro, cosyvoice_micro, total_micro, ' +
    'reserved_micro, alert_sent, updated_at) VALUES (?, 0, 0, 0, 0, 0, ?)'
  ).bind(month, Date.now()).run();
  return db.prepare('SELECT * FROM monthly_cost WHERE month = ?').bind(month).first();
}

/* 是否已达月度封顶（含在途预留）。返回 true 时付费功能必须停。 */
export async function isCapped(env, now = new Date()) {
  const month = beijingMonth(now);
  const row = await ensureMonthlyRow(env.DB, month);
  return row.total_micro + row.reserved_micro >= config(env).capMicro;
}

/* 调用前原子预留站方预算。仅当 total + reserved + max <= cap 时才自增，changes=1 即成功。
 * 返回 {ok, holdId, month, maxMicro}；ok=false 表示预算不足，调用方应直接 402，不调上游。 */
export async function reserveBudget(env, service, maxMicro, now = new Date()) {
  const db = env.DB;
  const month = beijingMonth(now);
  await ensureMonthlyRow(db, month);
  const cap = config(env).capMicro;
  const holdId = crypto.randomUUID();
  const upd = await db.prepare(
    'UPDATE monthly_cost SET reserved_micro = reserved_micro + ?, updated_at = ? ' +
    'WHERE month = ? AND total_micro + reserved_micro + ? <= ?'
  ).bind(maxMicro, Date.now(), month, maxMicro, cap).run();
  if (upd.meta.changes !== 1) return { ok: false, holdId: null, month, maxMicro };
  return { ok: true, holdId, month, maxMicro };
}

/* 调用成功后原子结算：reserved 减回最高预留，total 与分服务列按实际成本自增。
 * 用 CASE 原子翻转 alert_sent；返回是否首次跨过 100 元提醒线。 */
export async function settleBudget(env, service, maxMicro, actualMicro, now = new Date()) {
  const db = env.DB;
  const month = beijingMonth(now);
  const cfg = config(env);
  const before = await ensureMonthlyRow(db, month);
  const wasAlert = before.alert_sent;

  if (service === 'text') {
    await db.prepare(
      'UPDATE monthly_cost SET reserved_micro = MAX(0, reserved_micro - ?), ' +
      'total_micro = total_micro + ?, deepseek_micro = deepseek_micro + ?, ' +
      'alert_sent = CASE WHEN total_micro + ? >= ? THEN 1 ELSE alert_sent END, ' +
      'updated_at = ? WHERE month = ?'
    ).bind(maxMicro, actualMicro, actualMicro, actualMicro, cfg.warnMicro, Date.now(), month).run();
  } else {
    await db.prepare(
      'UPDATE monthly_cost SET reserved_micro = MAX(0, reserved_micro - ?), ' +
      'total_micro = total_micro + ?, cosyvoice_micro = cosyvoice_micro + ?, ' +
      'alert_sent = CASE WHEN total_micro + ? >= ? THEN 1 ELSE alert_sent END, ' +
      'updated_at = ? WHERE month = ?'
    ).bind(maxMicro, actualMicro, actualMicro, actualMicro, cfg.warnMicro, Date.now(), month).run();
  }

  const row = await ensureMonthlyRow(db, month);
  const alert = !wasAlert && row.total_micro >= cfg.warnMicro;
  return { alert, total: row.total_micro, reserved: row.reserved_micro, month: row.month };
}

/* 确定失败（上游明确报错、确定未扣费）：原子释放预留，不增加已结算成本。 */
export async function releaseBudget(env, maxMicro, now = new Date()) {
  const db = env.DB;
  const month = beijingMonth(now);
  await db.prepare(
    'UPDATE monthly_cost SET reserved_micro = MAX(0, reserved_micro - ?), updated_at = ? WHERE month = ?'
  ).bind(maxMicro, Date.now(), month).run();
}

/* 结果不确定（超时/网络异常，上游可能已扣费）：预留继续挂在 reserved_micro，
 * 同时写 budget_hold 留痕，等人工核对后再 resolveHold。用户练习名额另行归还。 */
export async function holdBudget(env, holdId, service, maxMicro, reason, now = new Date()) {
  const db = env.DB;
  const month = beijingMonth(now);
  await db.prepare(
    'INSERT INTO budget_hold (id, month, service, max_micro, status, reason, created_at, updated_at) ' +
    "VALUES (?, ?, ?, ?, 'held', ?, ?, ?)"
  ).bind(holdId, month, service, maxMicro, reason || '', Date.now(), Date.now()).run();
  return { holdId, month, maxMicro };
}

/* 人工核对一笔挂起预留：decision='settled' 按 actualMicro 转结算；'released' 全额释放。 */
export async function resolveHold(env, holdId, decision, actualMicro = 0, now = new Date()) {
  const held = await env.DB.prepare('SELECT * FROM budget_hold WHERE id = ?').bind(holdId).first();
  if (!held) return { ok: false, status: 404, message: '没有这笔待核对记录' };
  if (held.status !== 'held') return { ok: false, status: 409, message: '该记录已核对过' };
  const month = beijingMonth(now);
  if (decision === 'settled') {
    const actual = Math.max(0, Math.min(held.max_micro, parseInt(actualMicro, 10) || 0));
    if (held.service === 'text') {
      await env.DB.prepare(
        'UPDATE monthly_cost SET reserved_micro = MAX(0, reserved_micro - ?), ' +
        'total_micro = total_micro + ?, deepseek_micro = deepseek_micro + ?, updated_at = ? WHERE month = ?'
      ).bind(held.max_micro, actual, actual, Date.now(), month).run();
    } else {
      await env.DB.prepare(
        'UPDATE monthly_cost SET reserved_micro = MAX(0, reserved_micro - ?), ' +
        'total_micro = total_micro + ?, cosyvoice_micro = cosyvoice_micro + ?, updated_at = ? WHERE month = ?'
      ).bind(held.max_micro, actual, actual, Date.now(), month).run();
    }
  } else if (decision === 'released') {
    await env.DB.prepare(
      'UPDATE monthly_cost SET reserved_micro = MAX(0, reserved_micro - ?), updated_at = ? WHERE month = ?'
    ).bind(held.max_micro, Date.now(), month).run();
  } else {
    return { ok: false, status: 400, message: "decision 必须是 settled 或 released" };
  }
  await env.DB.prepare(
    "UPDATE budget_hold SET status = ?, updated_at = ? WHERE id = ?"
  ).bind(decision === 'settled' ? 'settled' : 'released', Date.now(), holdId).run();
  return { ok: true, decision, month };
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

/* 占用一个用户名额。返回 {source:'free'|'grant'|'none', ...}
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
