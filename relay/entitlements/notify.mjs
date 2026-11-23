/* ============ 站方主动通知（月度 100 元提醒等） ============
 *  - simulate（默认）：不接 Resend，只在 KV 写一条留痕，模拟"已发送"，可重复验证、零成本；
 *  - live：有 RESEND_API_KEY 且配置了 ALERT_EMAIL 时，发真实邮件到站方邮箱；
 *  - 用 dedupeKey 做幂等：同一事件（如某月的 100 元提醒）无论多少并发请求只发一次。
 * ===================================================== */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RECORD_TTL = 60 * 60 * 24 * 40; // 留痕保留 40 天，足以覆盖一个账期

function isLive(env) {
  return String(env.BILLING_MODE || 'simulate') === 'live';
}

export async function notifyOwner(env, dedupeKey, { subject, text, html }) {
  const kv = env.RELAY_KV;
  const live = isLive(env);
  if (live && (!env.RESEND_API_KEY || !env.ALERT_EMAIL)) {
    throw new Error('站方提醒邮箱未配置');
  }

  /* 幂等：已处理过的事件直接返回，重复请求不再发送 */
  if (kv) {
    const flag = await kv.get('notify:' + dedupeKey);
    if (flag) {
      let rec = {};
      try { rec = JSON.parse(flag); } catch (_) {}
      if (!live || rec.live) return { ok: true, deduped: true, simulated: !live };
    }
  }

  if (live) {
    const from = env.MAIL_FROM || 'onboarding@resend.dev';
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Idempotency-Key': dedupeKey
      },
      body: JSON.stringify({ from, to: [env.ALERT_EMAIL], subject, text, html })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error('站方通知发送失败 HTTP ' + res.status + ' ' + t.slice(0, 150));
    }
  }

  /* 真实发送或模拟发送都写一条留痕，同时承担幂等标记 */
  if (kv) {
    await kv.put('notify:' + dedupeKey,
      JSON.stringify({ at: Date.now(), live, subject }),
      { expirationTtl: RECORD_TTL });
  }
  return { ok: true, deduped: false, simulated: !live };
}
