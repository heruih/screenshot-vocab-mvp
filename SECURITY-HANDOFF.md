# 安全加固交接清单

> 2026-11-24 数据库与 API 安全审查结论 + 待加固项。待加固 3 项交给 codex 处理。

## 审查结论（已完成，无需处理）

数据库与 API **无信息泄露风险**，核心防线是健全的：

- SQL 全部参数化（`prepare().bind()`），无注入。
- 会话 token 用 `crypto.getRandomValues` 生成 24 字节随机，30 天 TTL，存 KV，不可伪造。
- 所有用户接口（`/v1/me/status`、`/v1/tts/synthesize`、`/v1/chat/completions`、`/v1/dialogue/review`、`/v1/feedback`）都先 `getSession` 鉴权，数据一律以登录账号 id 为准，不接受外部 account_id 参数，无越权。
- `publicAccount` 只回 id/email/status/时间戳，**不回传 note（管理员备注）**。
- 管理端点（`/v1/admin/*`）全部凭 `ADMIN_TOKEN`（Secret）校验。
- 密钥（`COSYVOICE_API_KEY`/`DEEPSEEK_API_KEY`/`ADMIN_TOKEN`/`RESEND_API_KEY`/`PIXABAY_KEY`）都是 Secret，不进代码、不回传。

## 待加固（3 项，交给 codex）

### 1. `/admin` 管理页 HTML 无鉴权

- 位置：`relay/english-notes-relay-worker.js` fetch 路由 `path === '/admin'`（约 143 行）。
- 现状：任何人访问 `https://api.simonnotes.xyz/admin` 都能看到管理页面的 HTML（空壳 + 接口路径），无需登录。
- 风险：**无数据泄露**（所有 `/v1/admin/*` 操作仍需 `ADMIN_TOKEN`），但暴露了接口结构。
- 建议：给 `/admin` 加一层访问门槛（URL 参数口令，或仅允许特定来源，或干脆删掉在线 admin 只保留本地调用）。

### 2. CORS 放行 `origin='null'`

- 位置：`relay/english-notes-relay-worker.js` `originAllowed()`（约 46 行）。
- 现状：`origin === 'null'` 被放行（为兼容本地文件 / 隐私模式）。
- 风险：弱化了浏览器同源防护；真正防线是 token，只有当**前端存在 XSS** 时才会被偷 token。
- 建议：评估是否仍需要 null origin，不需要则移除；同时排查前端 XSS 注入面。

### 3. 验证码接口无「跨邮箱」限流

- 位置：`relay/entitlements/accounts.mjs` `requestCode()`。
- 现状：仅单邮箱 60 秒重发限制（`coderate:`），无「不同邮箱」维度的限流。
- 风险：可被用来给不同邮箱批量发信 → **邮件费用成本**（非数据泄露）。
- 建议：加 IP 维度限流（`CF-Connecting-IP`），或每日总发信上限。

## 已修复（本分支已完成，无需 codex 处理）

- 站方语音 CosyVoice 502：`fetch` 的 `redirect:'error'` 在 workerd 不支持，改 `manual`（`relay/cosyvoice-preview.mjs`，两处）。
- 自配豆包语音同样的 `redirect:'error'` bug：`relay/english-notes-relay-worker.js` `handleOwnDoubaoTts`（约 433 行），改 `manual`。
