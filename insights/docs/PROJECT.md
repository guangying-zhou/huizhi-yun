# RepoInsight 平台技术概览（核心要点）

本文档汇总当前生产架构、关键技术决策、运行与调试要点，作为后续功能演进（例如：自定义域名登录）的基础文档。

## 变更日志（2025-09）

### 用户设置页面单一来源（Profile & Security）
- 统一位置：仅保留 `/user/profile` 与 `/user/security` 两条路由。
- Dashboard 复用：`/dashboard/settings` 与 `/dashboard/settings/security` 直接复用同一套表单组件：
  - `app/components/user/ProfileForm.vue`（导入名：`UserProfileForm`）
  - `app/components/user/SecurityForm.vue`（导入名：`UserSecurityForm`）
- 已移除：`/[business]/user/*`（`index.vue`、`profile.vue`、`security.vue`）。
- 好处：
  - 消除重复实现与维护成本。
  - 避免页面命名与自动导入产生的模板错误/水合不一致。
  - 同构一套校验与提交逻辑，减少行为分叉。

> 若有历史链接指向 `/:business/user/...`，建议在 Nginx/Worker 层做 301 到 `/user/...`，或以应用内导航替代。

## 1. 架构总览

- 前端与 SSR：Nuxt 3/4（Nuxt UI Pro），Cloudflare Pages 托管 SSR 输出。
- 统一入口代理：Cloudflare Worker 作为反向代理，主要用于平台根域与子域流量归一化与透传关键头。文件：`worker.js`，配置：`wrangler-worker.toml`。
- 认证域策略：生产环境统一使用 `auth.repoinsight.com` 发起与接收 OAuth 回调。
- 多租户与自定义域：使用 `nuxt-multi-tenancy`；平台根域/子域由 Worker+Pages 提供；自定义域通过 Cloudflare Pages Custom Domains 绑定。

## 2. 关键请求路径与职责

- 浏览器点击登录 → `GET /api/auth/prepare-google`
  - 中间件 `server/middleware/force-oauth-host.ts` 会把初始发起统一引导至 `auth.repoinsight.com`（开发环境保持本地 host）。
  - 端点 `server/api/auth/prepare-google.get.ts` 校验/标准化 returnUrl，并在平台根域（`.repoinsight.com`）写入 `href` Cookie，随后 302 跳转到 `auth.repoinsight.com/api/auth/google`。
- Google 授权页 → 回调：`https://auth.repoinsight.com/api/auth/google?code=...&state=...`
  - 端点 `server/api/auth/google.get.js` 通过 `defineOAuthGoogleEventHandler` 处理成功回调：
    - 从 `href`/query 解析 returnUrl，并做白名单校验（平台根域/子域 + 已激活自定义域）。
    - 设置 `user` Cookie（平台根域），必要时为“自定义域”额外设置同名 Cookie（domain=自定义域）。
    - 302 跳转到 returnUrl；若为空则跳主域 `/dashboard`。

## 3. Worker 代理策略（`worker.js`）

- 识别子域：`tenant.repoinsight.com` → 透传到 Pages（`https://repoinsight.pages.dev`），并附加：
  - `X-Forwarded-Host`: 原始 Host（必需）
  - `X-Forwarded-Proto`: 原始协议 http/https（用于服务端判断是否设置 Secure Cookie）
  - `x-original-host`, `x-tenant-subdomain`, `x-tenant-name`
- 系统子域（如 `auth`）与根域统一走同一 Worker 路由，最终仍回源到 Pages。
- 目标：让 Nuxt 端始终“感知到”浏览器真实 Host/Proto，避免 pages.dev 与实际域错位引发的回调错误。

## 4. Nuxt 运行时配置（`nuxt.config.ts`）

- OAuth（Google）：
  - `runtimeConfig.oauth.google.clientId` ← `NUXT_OAUTH_GOOGLE_CLIENT_ID`
  - `runtimeConfig.oauth.google.clientSecret` ← `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`
  - `runtimeConfig.oauth.google.redirectURL`：默认值固定为 `https://auth.repoinsight.com/api/auth/google`（可用 `NUXT_OAUTH_GOOGLE_REDIRECT_URL` 覆盖），避免默认回退 pages.dev。
- Public：
  - `public.baseDomain`（默认 `repoinsight.com`）
  - `public.authHost`（默认 `auth.repoinsight.com`）
- 安全头与跨域：`nitro.routeRules` 中为 `/api/**` 下发显式 CORS 头；提供宽松但受控的 CSP，适配 Google OAuth 所需的脚本、frame、connect 源。
- 多租户：`multiTenancy.rootDomains` 包含 `repoinsight.com`、`lvh.me`（开发）。

## 5. 中间件与端点（关键文件）

- `server/middleware/force-oauth-host.ts`
  - 仅在“发起阶段”（无 `code`/`state`）生效；基于 `X-Forwarded-Host`/`X-Forwarded-Proto` 判断实际 Host/Proto。
  - 生产：将 `/api/auth/prepare-google` 与 `/api/auth/google`（发起）统一重定向到 `authHost`。
  - 开发：保持当前 baseDomain:port，避免证书问题。
- `server/api/auth/prepare-google.get.ts`
  - 读取 `returnUrl`（参数或 `referer`），做平台根域/子域 + 自定义域白名单校验；设置 `href` Cookie（`.repoinsight.com`）。
  - 根据环境跳转至 `auth.repoinsight.com/api/auth/google`（或本地）。
- `server/api/auth/google.get.js`
  - OAuth 成功回调：
    - 取 `href`/query 的 returnUrl，进行域白名单校验；将登录状态写入平台根域 Cookie；若目标是自定义域，额外设置该域 Cookie。
    - 直接 302 返回 returnUrl（或主域 `/dashboard`）。
  - 已移除“pages.dev 回调后再 hostfix 转发”的逻辑，以杜绝中途再跳导致的 400/404。

## 6. 环境/控制台侧配置

- Google Cloud Console：Authorized redirect URIs 必须包含：
  - `https://auth.repoinsight.com/api/auth/google`
- Cloudflare Pages：
  - 绑定 `repoinsight.com` 与 `auth.repoinsight.com` 自定义域至最新构建。
  - Pages 与 Worker 协同：Worker 负责透传真实 Host/Proto；Pages 托管 Nuxt SSR。
- Wrangler（Worker 部署）：
### 6.1 环境变量（Plan A）

统一的环境变量集合已简化。以下历史变量已废弃并从代码中移除：
`PLATFORM_ROOT_DOMAINS`（改用 `NUXT_PUBLIC_PLATFORM_ROOT_DOMAINS`）、`NUXT_PUBLIC_PLATFORM_URL`（语义不清，统一用 `NUXT_PUBLIC_SITE_URL`）、`NUXT_PUBLIC_R2_PUBLIC_URL`（统一改为 `NUXT_PUBLIC_STORAGE_URL`）。
如果你的部署环境（Pages / Worker / 本地 .env）里还保留这些旧键，可安全删除，避免团队误用。

核心分类：
| 类别             | 关键变量                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 域与多租户       | `NUXT_PUBLIC_PLATFORM_ROOT_DOMAINS`, `NUXT_PUBLIC_DEV_ROOT_DOMAINS`, `NUXT_PUBLIC_BASE_DOMAIN`, `NUXT_PUBLIC_SITE_URL`, `NUXT_PUBLIC_PLATFORM_RESERVED_SUBDOMAINS` |
| OAuth            | `NUXT_OAUTH_GOOGLE_CLIENT_ID`, `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`                                                                                                   |
| 会话与加密       | `NUXT_SESSION_PASSWORD`, `AUTH_SECRET`                                                                                                                             |
| 数据库           | `TURSO_DB_URL`, `TURSO_DB_TOKEN`                                                                                                                                   |
| 存储 (S3/R2)     | `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `NUXT_PUBLIC_STORAGE_URL`                                         |
| 邮件 (Resend)    | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `FROM_EMAIL`                                                                                                            |
| 支付 (Stripe)    | `PAYMENT_PROVIDER=stripe`, `STRIPE_PUBLIC_KEY`, `stripeSecretKey`, `STRIPE_WEBHOOK_SECRET`(prod), `STRIPE_TAX_ID`(可选)                                            |
| 自定义域名自动化 | `PLATFORM_CNAME_TARGET`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_PAGES_PROJECT_NAME`, `CF_ZONE_ID`, `INTERNAL_CRON_TOKEN`                                             |

使用脚本快速校验：
```
pnpm run check:env
```
脚本会在缺失或明显弱值（长度不足 32）时以非零退出码失败，便于在 CI 中提前发现配置问题。

> `NUXT_PUBLIC_STORAGE_URL` 是前端引用媒体（图片/静态资源）唯一来源。若未设置，会回退到 S3/R2 endpoint 拼接，可能暴露内部域名。务必在生产设置此值（当前：`https://storage.repoinsight.com`）。

  - `wrangler-worker.toml`：
    - `main = "worker.js"`
    - `[[routes]]` 指向 `*.repoinsight.com/*` 与 `repoinsight.com/*`
    - `vars.PAGES_URL = "repoinsight.pages.dev"`
    - `observability.logs.enabled = true`

## 7. 调试要点与常见问题

- 400 Bad Request（Google 回调）：
  - 核对 redirect_uri 是否为 `https://auth.repoinsight.com/api/auth/google`。
  - 检查是否还出现了 `hostfix=1`（不应再出现）。
  - 核查 `X-Forwarded-Proto` 是否为 `https`，以便服务端设置 `Secure` Cookie。
- Page not found（回调 404/HTML）：
  - 说明路由未命中或被 SPA fallback；检查 `server/api/auth/google.get.js` 是否存在、部署产物是否最新。
- 重定向循环：
  - 检查 `force-oauth-host.ts` 是否对带 `code/state` 的回调也进行了重定向（应避免）。
- Cookie 未生效：
  - 平台根域 Cookie 由 `domain=.repoinsight.com` + `SameSite=Lax` + 条件 `Secure` 控制。
  - 若目标是“自定义域”，回调成功时会额外在该域设置 Cookie（`domain=<custom-host>`）。

## 8. 部署与验证流程（速查）

1) 修改/提交代码后：Cloudflare Pages 自动构建发布。
2) 若 Worker 有更改：执行 `wrangler deploy -c wrangler-worker.toml`。
3) 验证链路：
   - repoinsight.com → 302 → auth.repoinsight.com → Google → 回调至 auth.repoinsight.com → 302 至 returnUrl。
   - Network 中确认 `redirect_uri` 与回调 Host 均为 `auth.repoinsight.com`。

## 9. 下一步：自定义域名登录

自定义域站点期望行为：
- 在自定义域页面点击登录 → 通过平台策略跳至 `auth.repoinsight.com` 发起 → 回调成功后 302 回自定义域的 returnUrl；
- 同时在平台根域与该自定义域分别设置 `user` Cookie，保证登录态可用。

落地注意事项：
- `prepare-google.get.ts` 与 `google.get.js` 已支持 returnUrl 白名单校验与“为自定义域额外设置 Cookie”的逻辑。
- 需确认：
  - 自定义域是否已在 Cloudflare Pages 绑定且激活（DNS 生效）。
  - 回调设置 Cookie 时，`X-Forwarded-Proto` 为 `https`，确保 Secure Cookie 可写。
  - returnUrl 指向的自定义域在服务端白名单中可解析（`DomainService.resolveActiveCached`）。
  - CSR 页面不会覆盖/清空服务端 Set-Cookie（避免额外的客户端写 Cookie 操作）。

调试建议：
- 用同一浏览器会话观察 Network 中的每一次 302 Location、Set-Cookie 与最终落地 URL。
- 若仍遇 400/404，打印：`host`、`X-Forwarded-Host`、`X-Forwarded-Proto`、`redirectURL`、`returnUrl`、`state` 的服务端日志，并复核 Google Console 的 redirect URIs 配置。

---

本文作为“活文档”，随代码与流程变更及时更新。下一个工作重点：联调自定义域名登录闭环与回归测试（主域/子域/自定义域三类场景）。
