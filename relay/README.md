# 服务端中转（Cloudflare Workers）

两个 Worker 互相独立：

- `doubao-tts-worker.js`：豆包语音中转（已上线）。
- `english-notes-relay-worker.js`：统一中转，先做文本（DeepSeek），图片路由预留。

前端不填 Key 时，AI 文本自动走统一中转；填了 Key 就优先用自己的 Key，老逻辑不受影响。

---

## 一、统一中转（文本，免 Key）

### 1. 建 KV（用于限流和每日计数）

```powershell
npx wrangler kv namespace create RELAY_KV
```

记下返回的 `id`。

### 2. 准备配置

复制 `wrangler.toml.example` 为 `wrangler.toml`，把里面的 KV `id` 换成上一步的值。免费档、开关都在这个文件里，后台可改。

### 3. 部署 + 存 Key

在 `relay` 目录（放 wrangler.toml 的地方）执行：

```powershell
npx wrangler deploy
npx wrangler secret put DEEPSEEK_API_KEY
```

### 4. 前端确认

部署后的地址形如 `https://english-notes-relay.<账号>.workers.dev`。网页设置 → AI 里的「免 Key 中转地址」默认已填同路径，地址一致即零配置；不一致就手动改成你的地址。

说明：

- 速率限制（每分钟）硬拦截，返回 429；每日额度当前**只计数、不拦截**，`tier` 字段已预留。
- 不写 KV 也能跑：Worker 检测不到 `RELAY_KV` 会自动降级为只转发、不限流。
- 响应头 `X-Relay-Daily-Count / Limit / Tier` 回传当前用量，以后前端展示以它为准。

---

## 二、豆包 TTS 中转（现有）

部署时设置三个变量：

- `DOUBAO_API_KEY`，豆包 API Key，用 `wrangler secret put DOUBAO_API_KEY`
- `DOUBAO_RESOURCE_ID`，默认 `seed-tts-2.0`；接口报资源未授权时以控制台「API 接入」页为准
- `ALLOWED_ORIGIN`，默认 `https://heruih.github.io`

```powershell
npx wrangler deploy relay/doubao-tts-worker.js --name english-notes-tts
npx wrangler secret put DOUBAO_API_KEY --name english-notes-tts
```

网页请求体沿用豆包 V3 的 `req_params` 格式，响应原样返回，保留上游错误信息。
