const MODEL = 'cosyvoice-v3.5-flash';
const MAX_TEXT_CHARACTERS = 240;
const MAX_AUDIO_BYTES = 2_000_000;

export async function synthesizeCosyVoice(text, { workspaceId, voiceId, apiKey }, fetcher = fetch) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value || Array.from(value).length > MAX_TEXT_CHARACTERS) {
    throw new Error('invalid speech text length');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(workspaceId) || !voiceId || !apiKey) {
    throw new Error('speech provider is not configured');
  }

  const signal = AbortSignal.timeout(10000);
  const origin = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
  const result = await fetcher(origin + '/api/v1/services/audio/tts/SpeechSynthesizer', {
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
  if (!result.ok) throw new Error('speech provider rejected the request');
  const payload = await result.json();
  const audioUrl = new URL(payload?.output?.audio?.url);
  if (!['http:', 'https:'].includes(audioUrl.protocol) ||
      !audioUrl.hostname.endsWith('.oss-cn-beijing.aliyuncs.com') ||
      audioUrl.username || audioUrl.password || audioUrl.port) {
    throw new Error('speech provider returned an unexpected audio URL');
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
}
