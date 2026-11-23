/* ============ 邮件发送（Resend） ============
 * 仅用于发送 6 位登录验证码。密钥与发件人从 env 读取，不进代码库。
 * ============================================ */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendCodeEmail(env, email, code) {
  const from = env.MAIL_FROM || 'Simon的截图错题本 <onboarding@resend.dev>';
  const body = {
    from,
    to: [email],
    subject: '你的登录验证码：' + code,
    text: `你的验证码是 ${code}，10 分钟内有效。如非本人操作，请忽略此邮件。`,
    html: `<p>你的验证码是 <strong style="font-size:20px;letter-spacing:2px">${code}</strong></p>` +
          '<p>10 分钟内有效。如非本人操作，请忽略此邮件。</p>'
  };
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('邮件发送失败 HTTP ' + res.status + ' ' + txt.slice(0, 200));
  }
  return res.json();
}
