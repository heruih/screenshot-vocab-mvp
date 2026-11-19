/* Service Worker · 核心资源预缓存实现 PWA 秒开/离线可用；OCR 引擎等大文件运行时缓存 */
const CACHE_NAME='svocab-20261119124903';
const CORE=[
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];
const RUNTIME_RE=/ocr-assets\//;
const GUIDE_RE=/guide-assets\//;

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c=>c.addAll(CORE))
      .then(()=>self.skipWaiting())
      .catch(err=>console.error('SW 预缓存失败',err))
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return; // 跨域 AI 接口等不缓存

  // 页面导航：stale-while-revalidate（有缓存秒开，同时后台更新）
  if(req.mode==='navigation'){
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache=>{
        const cached=await cache.match(req);
        const network=fetch(req)
          .then(res=>{ if(res&&res.ok)cache.put(req,res.clone()); return res; })
          .catch(()=>cached);
        return cached||network;
      })
    );
    return;
  }

  // 本地静态资源（含 ocr-assets、icons）：cache-first，未命中则联网并运行时缓存
  e.respondWith(
    caches.match(req).then(cached=>{
      if(cached)return cached;
      return fetch(req).then(res=>{
        if(res&&res.ok&&(RUNTIME_RE.test(url.pathname)||GUIDE_RE.test(url.pathname)||url.pathname.includes('/icons/'))){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(c=>c.put(req,copy));
        }
        return res;
      });
    })
  );
});
