import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeCosyVoice } from '../relay/cosyvoice-preview.mjs';

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = option('host') || '127.0.0.1';
const port = Number(option('port') || 8776);
const fixtures = option('fixtures');
const live = args.includes('--live');
const inspect = args.includes('--inspect');
const trial = live ? {
  workspaceId: process.env.COSYVOICE_WORKSPACE_ID?.trim(),
  voiceId: process.env.COSYVOICE_VOICE_ID?.trim(),
  apiKey: process.env.COSYVOICE_API_KEY?.trim()
} : null;
if (trial && (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(trial.workspaceId) || !trial.voiceId || !trial.apiKey)) {
  throw new Error('实时测试需要在本次启动的环境中提供北京工作空间、音色和 API Key');
}
const maxLiveAttempts = 3;
const maxTextCharacters = 240;
const localIPv4 = Object.values(networkInterfaces()).flat().map(entry => entry.address);
if (!fixtures || !localIPv4.includes(host) || !/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(host) ||
    !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('用法：node scripts/preview-cosyvoice.mjs --fixtures=正式样音目录 [--host=本机局域网地址] [--port=8776] [--live]');
}

const files = {
  'withdraw': '01-withdraw',
  'The odds are in your favor.': '02-the-odds-are-in-your-favor',
  'Would you mind checking the total before we pay? Sure, let me take a look.': '03-checkout-dialogue'
};
const samples = new Map();
for (const [text, name] of Object.entries(files)) {
  const audio = await fs.readFile(path.join(fixtures, `CosyVoice-formal-${name}.mp3`));
  samples.set(text, audio);
}

const root = fileURLToPath(new URL('../dist/cosyvoice-preview/', import.meta.url));
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
if (!html.includes('cosyVoicePreview:true')) throw new Error('先运行 node scripts/build.mjs --cosyvoice-preview');
const instrumentation = '<script>const previewOriginalPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.addEventListener("playing",()=>{document.documentElement.dataset.previewRate=String(this.playbackRate);document.documentElement.dataset.previewPlays=String(Number(document.documentElement.dataset.previewPlays||0)+1)},{once:true});return previewOriginalPlay.call(this);};</script>';
const inspectedHtml = inspect ? html.replace('<head>', '<head>' + instrumentation) : html;
const previewHtml = live ? inspectedHtml.replace('cosyVoicePreview:true', 'cosyVoicePreview:true,siteSpeechLive:true') : inspectedHtml;
const origin = `http://${host}:${port}`;
const grantedPath = `/listen/${randomBytes(24).toString('base64url')}/`;
const cacheScope = randomBytes(16).toString('hex');
const grantedHtml = previewHtml.replace('cosyVoicePreview:true',
  `cosyVoicePreview:true,siteSpeechCacheScope:${JSON.stringify(cacheScope)}`);
const types = new Map([
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.jpg', 'image/jpeg'],
  ['.webmanifest', 'application/manifest+json']
]);
let requests = 0;
let characters = 0;
let upstreamCalls = 0;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function previewSpeech(req, res, granted) {
  if (req.method !== 'POST' || (req.headers.origin && req.headers.origin !== origin)) {
    json(res, 403, { message: '预览请求无效' });
    return;
  }
  if (!granted) {
    json(res, 403, { message: '这个浏览器还未开通测试语音包' });
    return;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 4096) {
      json(res, 413, { message: '预览文本太长' });
      return;
    }
  }
  let text;
  try {
    text = JSON.parse(body).text;
  } catch {
    json(res, 400, { message: '无法读取预览文本' });
    return;
  }
  if (typeof text !== 'string' || !text.trim() || Array.from(text).length > maxTextCharacters) {
    json(res, 422, { message: '请选择 240 字符以内的英文内容朗读' });
    return;
  }
  text = text.trim();
  const sample = samples.get(text);
  if (!sample && !trial) {
    json(res, 422, { message: '当前测试语音包只提供固定样音' });
    return;
  }
  let result;
  if (sample) {
    result = { bytes: sample, characters: Array.from(text).length };
  } else {
    if (upstreamCalls >= maxLiveAttempts) {
      json(res, 429, { message: '本次预览的实时生成额度已用完' });
      return;
    }
    // An upstream attempt may be billable even when its audio cannot be played.
    upstreamCalls += 1;
    result = await synthesizeCosyVoice(text, trial);
  }
  requests++;
  characters += result.characters;
  json(res, 200, { audio: 'data:audio/mpeg;base64,' + Buffer.from(result.bytes).toString('base64') });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "connect-src 'self'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const url = new URL(req.url, origin);
    const granted = url.pathname.startsWith(grantedPath);
    const previewPath = granted ? url.pathname.slice(grantedPath.length - 1) : url.pathname;
    if (previewPath === '/preview-tts') {
      await previewSpeech(req, res, granted);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === grantedPath.slice(0, -1)) {
      res.writeHead(308, { Location: grantedPath }).end();
      return;
    }
    if (previewPath === '/preview-stats' && inspect && req.socket.remoteAddress === '127.0.0.1') {
      json(res, 200, { requests, characters, upstreamCalls });
      return;
    }
    if (previewPath === '/' || previewPath === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(granted ? grantedHtml : previewHtml);
      return;
    }
    const asset = path.resolve(root, '.' + decodeURIComponent(previewPath));
    if (!asset.startsWith(root) || !types.has(path.extname(asset))) {
      res.writeHead(404).end();
      return;
    }
    const data = await fs.readFile(asset);
    res.writeHead(200, { 'Content-Type': types.get(path.extname(asset)) }).end(data);
  } catch (error) {
    if (error.code === 'ENOENT') res.writeHead(404).end();
    else json(res, 502, { message: '测试音频暂不可用' });
  }
});
server.listen(port, host, () => {
  console.log(`测试版 ${origin}/`);
  console.log(`已开通 ${origin}${grantedPath}`);
  console.log(live ? `实时生成最多 ${maxLiveAttempts} 次` : '固定样音模式');
});
setTimeout(() => server.close(), 2 * 60 * 60 * 1000).unref();
