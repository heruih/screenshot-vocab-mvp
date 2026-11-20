import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const publishPages = args.includes('--pages');

// 产品维度：默认 commercial；可选 personal
const productArg = args.find((a) => a.startsWith('--product='));
const product = productArg ? productArg.split('=')[1] : 'commercial';
if (!['commercial', 'personal'].includes(product)) {
  throw new Error(`未知产品 --product=${product}，只支持 commercial / personal`);
}

const source = path.join(project, 'src');
const output = path.join(project, 'dist', publishPages ? 'pages' : '');
const read = (file) => fs.readFile(path.join(source, file), 'utf8');

const template = await read('index.html');
const style = await read('style.css');
const modules = [
  '00_capabilities.js',
  '01_core.js',
  '02_render.js',
  '03_editor.js',
  '04_move.js',
  '05_word.js',
  '06_word_modal.js',
  '07_sync_settings.js',
  '08_writing.js',
  '09_screenshot_data.js',
  '10a_inbox.js',
  '10b_ocr.js',
  '10c_ai_quota.js',
  '10d_drawer.js',
  '10e_dialogue.js',
  '10f_learning.js',
  '10g_cloud.js',
  '10h_seed.js',
  '12_feedback.js',
  '13_drag.js',
  '11_boot.js',
];
const script = (await Promise.all(modules.map((file) => read(path.join('js', file))))).join('');
if (!template.includes('__EN_STYLE__') || !template.includes('__EN_SCRIPT__')) {
  throw new Error('src/index.html is missing build placeholders');
}

function buildPagesScript(sourceScript) {
  const lines = sourceScript.split(/\r?\n/);
  const offlineLine = lines.findIndex(line => line.startsWith('const OFFLINE_FILE_MODE='));
  const seedPrefix = '  try{if(!localStorage.getItem(LS_KEY))localStorage.setItem(LS_KEY,JSON.stringify({';
  const seeds = lines.filter(line => line.startsWith(seedPrefix));
  if (offlineLine < 1 || !lines[offlineLine - 1].startsWith('/* Offline file mode:') ||
      lines[offlineLine + 1] !== 'if(OFFLINE_FILE_MODE){' || seeds.length !== 1 || lines[offlineLine + 2] !== seeds[0]) {
    throw new Error('Pages build could not isolate the local initialization data');
  }
  lines.splice(offlineLine - 1, 4, 'const OFFLINE_FILE_MODE=true;', 'if(OFFLINE_FILE_MODE){');
  return lines.join('\n')
    .replace(/  const f=\{id:'f_welcome'[\s\S]*?  return \{folders:/, '  return {folders:')
    .replace("document.title='英语学习笔记 · 离线文件版'", "document.title='英语学习笔记 · 在线版'")
    .replace('<b>离线文件：</b>表达、笔记、复习和编辑保存在当前手机浏览器。', '<b>在线网页：</b>表达、笔记、复习和编辑保存在当前浏览器。AI 功能可联网请求。')
    .replace("bSetStatus('离线本机 · 已保存');", "bSetStatus('本机已保存');");
}

// 产品配置：注入到脚本最前面，成为全局 APP_CONFIG（在 pages 处理之后注入，不干扰行定位）
const config = await read(path.join('products', `${product}.config.js`));
const bodyScript = publishPages ? buildPagesScript(script) : script;
const appScript = config + '\n' + bodyScript;

const html = template.replace('__EN_STYLE__', () => style).replace('__EN_SCRIPT__', () => appScript);
await fs.mkdir(output, { recursive: true });
// 商业版沿用现有文件名；个人版用独立文件名，两者在 pages 目录共用同一份 ocr-assets
const fileBase = product === 'commercial' ? 'index' : 'personal';
const target = path.join(output, publishPages ? `${fileBase}.html` : `英语学习笔记${product === 'commercial' ? '' : '-个人'}.html`);

// PWA：商业版与个人版各自的 manifest（start_url 指向自己的页面），图标共享
const manifestFile = product === 'commercial' ? 'manifest.webmanifest' : 'personal-manifest.webmanifest';
const manifest = {
  name: '英语学习笔记',
  short_name: '英语笔记',
  description: '截图导入单词、AI 例句、间隔复习的随身英语学习工具',
  id: `./${fileBase}.html`,
  start_url: `./${fileBase}.html`,
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#000000',
  theme_color: '#34c759',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
const finalHtml = html.replace('__MANIFEST__', () => manifestFile);
await fs.writeFile(target, finalHtml, 'utf8');
console.log(`built ${target} (${Buffer.byteLength(finalHtml, 'utf8')} bytes, product=${product}, pages=${publishPages})`);

if (publishPages) {
  await fs.writeFile(path.join(output, manifestFile), JSON.stringify(manifest, null, 2), 'utf8');
  const iconsOut = path.join(output, 'icons');
  await fs.mkdir(iconsOut, { recursive: true });
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon-180.png']) {
    await fs.copyFile(path.join(source, 'pwa', f), path.join(iconsOut, f));
  }
  console.log('pwa manifest + icons ready');

  // 引导截图：复制 guide-assets 到产物，随 App 一起发布（缺图不影响构建）
  const guideSrc = path.join(source, 'guide-assets');
  const guideOut = path.join(output, 'guide-assets');
  try {
    await fs.mkdir(guideOut, { recursive: true });
    const guideFiles = await fs.readdir(guideSrc);
    for (const f of guideFiles) {
      await fs.copyFile(path.join(guideSrc, f), path.join(guideOut, f));
    }
    console.log(`guide assets ready (${guideFiles.length} files)`);
  } catch (err) {
    console.log('guide assets skipped:', err.code || err.message);
  }

  // Service Worker：注入当前产品页面、manifest 与缓存版本，输出 sw.js（PWA 秒开/离线可用）
  const swTemplate = await fs.readFile(path.join(source, 'sw.js'), 'utf8');
  const cacheVersion = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const sw = swTemplate
    .replace('__CACHE_VERSION__', cacheVersion)
    .replace('__PAGE__', `${fileBase}.html`)
    .replace('__MANIFEST__', manifestFile);
  await fs.writeFile(path.join(output, 'sw.js'), sw, 'utf8');
  console.log('service worker ready');
}
