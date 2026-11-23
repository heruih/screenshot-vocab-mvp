const MODEL = 'cosyvoice-v3.5-flash';
const MAX_TEXT_CHARACTERS = 240;
const MAX_AUDIO_BYTES = 2_000_000;

/* 错误分类，供 worker 决定预算如何处理：
 *   config       = 请求发出前的配置/输入问题，确定未扣费 → 释放预留；
 *   rejected     = 上游明确返回失败响应，确定未扣费 → 释放预留；
 *   inconclusive = 超时/网络异常，或合成已成功但后续环节失败（上游可能已计费）→ 挂起待核对。 */
export class TtsError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'TtsError';
    this.kind = kind;
  }
}

export async function synthesizeCosyVoice(text, { workspaceId, voiceId, apiKey }, fetcher = fetch) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value || Array.from(value).length > MAX_TEXT_CHARACTERS) {
    throw new TtsError('config', 'invalid speech text length');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(workspaceId) || !voiceId || !apiKey) {
    throw new TtsError('config', 'speech provider is not configured');
  }

  const signal = AbortSignal.timeout(10000);
  const origin = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
  let result;
  try {
    result = await fetcher(origin + '/api/v1/services/audio/tts/SpeechSynthesizer', {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        input: {
          text: value,
          voice: voiceId,
          format: 'mp3',
          sample_rate: 24000,
          rate: 1,
          pitch: 1,
          language_hints: ['en']
        }
      })
    });
  } catch (err) {
    /* 超时 / 连接失败：是否已处理、是否计费都不确定 */
    throw new TtsError('inconclusive', 'speech request network error: ' + (err && err.message));
  }
  if (!result.ok) {
    const kind = result.status >= 500 ? 'inconclusive' : 'rejected';
    throw new TtsError(kind, 'speech provider rejected the request');
  }

  try {
    const payload = await result.json();
    const audioUrl = new URL(payload?.output?.audio?.url);
    if (!['http:', 'https:'].includes(audioUrl.protocol) ||
        !audioUrl.hostname.endsWith('.oss-cn-beijing.aliyuncs.com') ||
        audioUrl.username || audioUrl.password || audioUrl.port) {
      throw new Error('unexpected audio URL');
    }
    audioUrl.protocol = 'https:';
    const audio = await fetcher(audioUrl, { signal, redirect: 'error' });
    if (!audio.ok || Number(audio.headers.get('content-length')) > MAX_AUDIO_BYTES) {
      throw new Error('speech audio download failed');
    }
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error('invalid speech audio size');
    const characters = payload.usage?.characters;
    if (!Number.isSafeInteger(characters) || characters <= 0) throw new Error('speech usage was not reported');
    return { bytes, characters };
  } catch (_) {
    throw new TtsError('inconclusive', 'speech was accepted but its result could not be confirmed');
  }
}
