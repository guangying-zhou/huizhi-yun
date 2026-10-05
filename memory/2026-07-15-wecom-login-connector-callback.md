# 企业微信登录固定 Connector 回调域排障报告

## Symptom

- 企业微信登录把 `redirect_uri` 生成为租户 Cloudflare 域名
  `https://wiztek.huizhi.yun/api/auth/wecom-callback`。
- 企业微信管理端不接受该域名作为 wiztek 企业应用的授权回调域，登录提示
  `redirect_uri 与配置的授权完成回调域名不一致`。

## Root cause

现有 Phase 2 只把授权码换取企业成员身份的 API 调用放到了 Connector Runtime；浏览器 OAuth
回调仍由 Console `deriveWecomCallbackUrl(event)` 按当前租户域生成。因此固定出口 Runtime 并未参与
企业微信对 `redirect_uri` 的前置域名校验。

## Fix

- Connector Runtime 新增 `identity.wecom.browser-login@v1`：
  - `POST /v1/identity/wecom/authorizations`
  - `GET /v1/identity/wecom/callback`
  - `POST /v1/identity/wecom/handoffs/redeem`
- Console 先创建五分钟、tenant/deployment/state 绑定的 Connector 授权，再把
  `https://wecom-api.wiztek.cn/v1/identity/wecom/callback` 作为企业微信 `redirect_uri`。
- Connector 回调消费企业微信一次性 code，将规范化成员身份保存到本机 SQLite，并生成五分钟、
  单次兑换的随机交接码；浏览器回到租户 Console 后由 Console 服务令牌兑换并建立会话。
- SQLite 只保存 state/ticket SHA-256，不保存授权码、access token、原始供应商响应或明文交接码；
  provider subject 不进入浏览器 URL。
- Console 身份能力激活现在要求新 `identity.wecom.browser-login@v1`，避免新 Console 与旧 Runtime
  组合产生运行时 404。

## Evidence

- `go test ./...`（notification-runtime）通过。
- Connector Runtime `node --test scripts/*.test.mjs`：18/18 通过。
- Console 企业登录/Connector 相关测试：17/17 通过；lint、Nuxt typecheck 和完整 Cloudflare
  preflight 通过。
- Connector Runtime 0.4.13 已签名发布到 R2，并在 `root@gitlab.wiztek.cn` 升级运行；公网
  capabilities 返回 `identity.wecom.browser-login@v1`，`arbitraryHttpProxy=false`。
- Nginx `wecom-api.wiztek.cn` 全路径代理到 `127.0.0.1:18082`；无效 callback 探针返回受控 400，
  不是 404/502。
- Console Worker 生产版本 `28abb6f1-0cb8-44b6-bd70-be96f1f438c5` 已发布。
- 生产 `GET /api/auth/wecom-login` 返回 302；解析企业微信授权 URL 后确认：
  - provider host：`open.work.weixin.qq.com`
  - redirect host：`wecom-api.wiztek.cn`
  - redirect path：`/v1/identity/wecom/callback`
  - `authorizationId` 已生成
- 企业管理员保存回调域后完成一次真实企业微信登录；Connector SQLite 记录显示授权于
  `2026-07-15T12:52:56Z` 创建、`12:53:24Z` 完成企业微信 code exchange、`12:53:26Z`
  被 Console 单次兑换，最终状态为 `consumed`。
- 登录交接表不含企业微信 code、access token、原始供应商响应或明文 ticket；升级后的
  `/runtime/health` 返回 `status=ok`、`version=0.4.13`，服务重启次数为 0。
- 0.4.13 增加过期 `issued`/`exchanged` 记录自动终结与旧终态记录清理，避免中断的授权探针长期
  保持活跃状态，并由单元测试覆盖。

## Regression tests

- `notification-runtime/internal/identityhandoff/store_test.go`
- `notification-runtime/internal/server/server_test.go` 的
  `TestWeComBrowserCallbackUsesSingleUseConnectorHandoff`
- `console/test/connectorRuntimeWecomIdentity.test.ts`
- `connector-runtime/scripts/verify-installation.test.mjs`

## External configuration

wiztek 租户的企业微信管理后台“企业微信授权登录 / Web 网页 / 授权回调域”已设为
`wecom-api.wiztek.cn`（只填域名，不含协议和路径）。这只是 wiztek 租户的验收配置，不是平台
所有租户共用的默认配置。每个租户必须在自己的企业微信应用中单独配置其已登记 Connector 公网
域名，并在 Console 单独维护本租户的 CorpID/AgentID/CorpSecret；后续迁移 Connector 域名或
更换企业应用时也必须由对应租户同步更新。

## Status

`DONE`：代码、Runtime、R2、Cloudflare、企业微信回调域配置和真实登录验收均已完成。
