/* ============ 模拟上游（BILLING_MODE=simulate） ============
 * 不接真实 DeepSeek/阿里云，返回 OpenAI 兼容的占位响应与单帧静音 MP3，
 * 完整走权益/计量/成本逻辑，零外部成本、可重复验证。
 * 成本仍由 pricing 模块按模拟 usage 折算；测试时可用 env 注入固定成本快速封顶。
 * ===================================================== */

/* 单帧 MPEG-1 Layer III，44.1kHz / 128kbps / 单声道，帧头 FF FB 90 C0，帧体置零（解码器视为静音） */
const SILENT_FRAME_BYTES = 417;

function silentMp3() {
  const frame = new Uint8Array(SILENT_FRAME_BYTES);
  frame[0] = 0xFF; frame[1] = 0xFB; frame[2] = 0x90; frame[3] = 0xC0;
  return frame;
}
function toBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* 模拟 DeepSeek：按请求特征返回对应占位 JSON，包在 OpenAI 兼容结构里 */
export function simulateText(input, reviewCount) {
  const blob = JSON.stringify(input.messages || []);
  let content;
  if (reviewCount) {
    content = JSON.stringify({ reviews: Array.from({ length: reviewCount }, (_, index) => ({
      index: index + 1,
      standard: 'Could we try that again?',
      fit: '模拟批改：请用问句提出请求。',
      pitfalls: []
    })) });
  } else if (blob.includes('情景口语设计者')) {
    content = JSON.stringify({ scenes: [{ title: '模拟场景', desc: '模拟场景说明', wordIds: [] }] });
  } else if (blob.includes('口语教练') || blob.includes('"lines"')) {
    content = JSON.stringify({ lines: [
      { who: 'A', en: 'Sure, let us settle the bill together.', cn: '他说一起结账（settle the bill）' },
      { who: 'YOU', wordId: '', promptCn: '把卡递过去，问能否刷卡' },
      { who: 'A', en: 'Of course, we accept cards.', cn: '他说可以刷卡' }
    ]});
  } else if (blob.includes('mental image')) {
    content = JSON.stringify({ emoji: '💳', scene: '一个人在柜台递出银行卡' });
  } else if (blob.includes('stock-photo')) {
    content = JSON.stringify({ keywords: ['credit card payment', 'shop counter'] });
  } else {
    content = JSON.stringify({ reply: '模拟回复' });
  }
  const promptTokens = Math.max(80, Math.round(blob.length / 3));
  const completionTokens = 60;
  return {
    response: {
      id: 'simulate-' + Date.now(),
      model: 'deepseek-flash',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    },
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens }
  };
}

/* 模拟 CosyVoice：返回静音 MP3 与字符数 */
export function simulateTts(text) {
  const characters = Array.from(String(text).trim()).length;
  return { audio: 'data:audio/mpeg;base64,' + toBase64(silentMp3()), characters };
}
