/* ============ 站方语音 502 诊断脚本 ============
 * 用有语音额度的测试账号 + 一句未缓存的短句，区分四层故障：
 *   账号额度(401/403/402) / 百炼合成(502) / 音频下载(502) / 前端播放(200 后由浏览器判定)。
 * 用法：
 *   node scripts/diagnose-tts.mjs <token> "<英文短句>" [relayUrl]
 *   relayUrl 默认 https://api.simonnotes.xyz
 * 只打印状态码和脱敏证据（音频长度、X-Entitlements-Source），token/音频内容不落盘不回显。
 * ===================================================== */
const token = process.argv[2] || '';
const text = process.argv[3] || 'Could you save me a seat by the window?';
const base = (process.argv[4] || 'https://api.simonnotes.xyz').replace(/\/+$/, '');
if (!token) {
  console.error('用法: node scripts/diagnose-tts.mjs <token> "<英文短句>" [relayUrl]');
  process.exit(2);
}
const auth = { Authorization: 'Bearer ' + token };
const mask = s => (typeof s === 'string' && s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s);

async function main() {
  console.log('relay:', base, ' text:', JSON.stringify(text));

  /* 第 1 层：账号额度 / 权益 */
  const status = await fetch(base + '/v1/me/status', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: '{}' });
  const sText = await status.text();
  let sJson = {};
  try { sJson = JSON.parse(sText); } catch (_) {}
  const tts = sJson.entitlements?.limits?.tts;
  console.log('[1 账号额度] /v1/me/status ->', status.status,
    tts ? `(hasPackage=${tts.hasPackage} freeRemaining=${tts.freeRemaining} paidRemaining=${tts.paidRemaining} grantRemaining=${tts.grantRemaining})`
      : '(无权益字段: ' + mask(sText) + ')');

  /* 第 2/3 层：百炼合成 + 音频下载 */
  const t0 = Date.now();
  const syn = await fetch(base + '/v1/tts/synthesize', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ text })
  });
  const ms = Date.now() - t0;
  const bText = await syn.text();
  let bJson = {};
  try { bJson = JSON.parse(bText); } catch (_) {}
  const audio = bJson.audio;
  const audioLen = typeof audio === 'string' ? audio.length : 0;
  console.log('[2/3 合成+下载] /v1/tts/synthesize ->', syn.status,
    audioLen ? `(audio base64 长度=${audioLen}, 约 ${Math.round(audioLen * 3 / 4 / 1024)} KB)` : '(无 audio: ' + mask(bText) + ')',
    '耗时', ms + 'ms',
    'X-Entitlements-Source=' + (syn.headers.get('X-Entitlements-Source') || '无'),
    'X-Monthly-Cost-Micro=' + (syn.headers.get('X-Monthly-Cost-Micro') || '无'));

  /* 判定提示 */
  if (status.status === 401) console.log('结论: 登录失效 -> 前端会回登录，不是语音本身');
  else if (syn.status === 403) console.log('结论: 未开通或未发语音包 -> 账号额度层');
  else if (syn.status === 402) console.log('结论: 免费句数用完或本月封顶 -> 账号额度层，符合"用完回系统朗读"');
  else if (syn.status === 502) console.log('结论: 百炼合成或音频下载失败(502) -> 重点查 Worker 的 COSYVOICE_WORKSPACE_ID/VOICE_ID/API_KEY 及百炼控制台');
  else if (syn.status === 200 && audioLen) console.log('结论: 合成+下载成功 -> 若真机仍"暂不可用"，问题在前端播放层(浏览器/缓存/Authorization)');
  else console.log('结论: 其它状态，见上');
}
main().catch(e => { console.error('诊断失败:', e && e.message); process.exit(1); });
