# Console Auth Runtime / IdP 实施计划

状态：Draft，Phase 0 已锁定  
日期：2026-04-29  
定位：把 `console` 升级为企业侧应用用户认证运行时与下游 OIDC IdP 的实施计划；配套 `Huizhi-yun-Platform-Target-Architecture.md`、`OIDC-First-Auth-Strategy.md`、`Console-Directory-Runtime-Integration-Plan.md`、`Console-API-Contract-v1.md` 与 `Console-SQL-DDL-Draft-v1.sql`

---

## 1. 背景与目标

当前业务应用仍通过 Foundation legacy auth bridge 消费 `auth_user / token / auth_*` Cookie，并直接理解 CAS、企业微信等登录入口。`console` 已经承接目录主数据、登录审计和企业侧基础运行服务，但还没有形成标准的 auth-runtime / IdP 边界。

目标形态：

```text
上游身份源
  LDAP / AD / CAS / 企业微信 / 钉钉 / 通用 OIDC / 本地账号
        ↓
console.auth-runtime
  身份解析 / 本地 session / 登录审计 / token 签发 / OIDC Provider
        ↓
业务应用
  统一走 OIDC Authorization Code + PKCE
  本地验 Console JWT + 本地消费 Platform policy bundle
```

`platform` 继续负责控制面账户、租户订阅、角色授权、policy bundle、license 与 runtime 治理；`console` 负责企业应用用户的登录会话、上游身份源适配和对下游业务应用输出标准 OIDC。

---

## 2. 核心决策

| ID | 决策 | 说明 |
|----|------|------|
| D-01 | `console` 是客户侧应用用户 IdP | 业务应用不再直连 CAS / 企业微信 / 钉钉 / LDAP。 |
| D-02 | 对下游统一 OIDC-first | 新应用只接 Console OIDC；CAS 仅作为上游 connector。 |
| D-03 | `platform` 不保存 OIDC client secret | 应用元数据可从 bundle 获取，client secret / refresh token / session 均在 `console` 本地。 |
| D-04 | `console` token 只承载身份与策略版本摘要 | token 不塞角色明细；授权仍由业务应用本地消费 signed policy bundle。 |
| D-05 | `sub` 使用平台最小主体可稳定识别的值 | MVP 使用 `subject_type=user + subject_code=uid`；若后续 bundle 增加 platform subject id，再升级为 `sub=<subject_id>`，保留 `hzy.uid` 私有 claim。 |
| D-06 | Authorization Code + PKCE 为默认登录流 | 适配浏览器应用和 Nuxt 服务端应用，避免把共享 client secret 当成必需条件。 |
| D-07 | refresh token 只落 hash | refresh token、authorization code、session id 都不得明文落库。 |
| D-08 | `account` 只保留迁移期兼容 | 新增认证能力只落 Console，Foundation legacy bridge 逐步退场。 |

---

## 3. 目标边界

### 3.1 Console 负责

- 上游身份源配置：CAS、企业微信、钉钉、通用 OIDC、LDAP bind / 目录同步联动。
- 身份解析：外部身份映射到 `directory_users.uid` 与 `directory_identities`。
- 本地会话：`local_sessions`、登录态 Cookie、session heartbeat、logout、revoke。
- 下游 IdP：OIDC discovery、authorize、token、userinfo、jwks、revoke、logout。
- Token 签发：access token / ID token / refresh token 生命周期与签名密钥轮换。
- 登录审计：成功、失败、登出、刷新、撤销事件。
- 应用登录入口：根据 bundle applications 投影和本地 auth client 配置展示可登录应用。

### 3.2 Platform 负责

- 租户、订阅、部署、license、runtime token、policy bundle。
- 应用 manifest、角色模板、租户角色授权、最小 subject 投影治理。
- 下发 `applications` 投影：`appCode / appName / description / icon / homeUrl / callbackUrl / logoutUrl / authMode`。
- 不保存应用用户 session、refresh token、OIDC client secret、上游 IdP secret。

### 3.3 Foundation / 业务应用负责

- Foundation 提供 Console OIDC adapter、JWT/JWKS 验证、`useAuth` facade。
- 业务应用验证 Console JWT，读取 `uid / subject_code / tenant / appCode / policy_ver`。
- 业务应用继续用本地 policy bundle 做权限判断，用 Console Directory API 取人员展示信息。

---

## 4. Token 与协议模型

### 4.1 OIDC Access Token / ID Token Claims

MVP claims：

```json
{
  "iss": "https://console.example.com",
  "sub": "user:dongxin",
  "aud": "aims",
  "tenant": "wiztek",
  "deployment": "dep_console_wiztek",
  "sid": "sess_xxx",
  "policy_ver": "pb_20260429120000_1",
  "caps": "sha256_xxx",
  "hzy": {
    "uid": "dongxin",
    "subjectType": "user",
    "subjectCode": "dongxin",
    "directorySnapshot": "sha256_xxx"
  },
  "iat": 1777464000,
  "exp": 1777467600
}
```

约束：

- 不放真实姓名、邮箱、手机号、部门名等展示型 PII。
- `email / name / picture` 只通过 `/userinfo` 在授权范围允许时返回，且来源为 Console Directory。
- `policy_ver` 与 `caps` 用于业务应用判断本地 bundle 是否需要刷新。
- `sid` 用于本地 session 撤销和全局登出。

### 4.2 OIDC 端点

| Endpoint | 用途 |
|---|---|
| `GET /.well-known/openid-configuration` | OIDC discovery |
| `GET /.well-known/jwks.json` | Console token 验签公钥 |
| `GET /oauth/authorize` | Authorization Code + PKCE 登录入口 |
| `POST /oauth/token` | code 换 token、refresh token、service client `client_credentials` |
| `POST /oauth/revoke` | 撤销 refresh/access token |
| `GET /oauth/userinfo` | 返回允许 scope 下的用户资料 |
| `GET /oauth/logout` | RP-initiated logout / 本地 session 退出 |
| `GET /api/v1/console/auth/me` | Console 自身和兼容层读取当前登录用户 |

---

## 5. 数据模型增量

现有 `Console-SQL-DDL-Draft-v1.sql` 已有 `local_sessions` 与 `auth_login_events`，需要增量补齐：

| 表 | 用途 |
|---|---|
| `auth_identity_providers` | 上游 IdP 配置索引，secret 通过 `integration_credentials / vault` 引用 |
| `auth_clients` | 下游 OIDC client，默认由 policy bundle applications 投影物化，可本地覆盖 redirect/logout URI |
| `auth_authorization_codes` | code flow 一次性授权码，保存 hash、PKCE challenge、nonce、redirect_uri、expires_at |
| `auth_refresh_tokens` | refresh token hash、session_id、client_id、rotation family、revoked_at |
| `auth_token_events` | token issue / refresh / revoke / introspection 事件，可与 `auth_login_events` 分表 |
| `auth_signing_keys` | Console IdP 签名密钥元数据；私钥进 vault 或外部 secret backend，表内只存 `kid / alg / public_jwk / status` |
| `auth_client_redirect_uris` | client 多 redirect URI 白名单，必须 exact match |

实现约束：

- authorization code、refresh token、session id 明文只返回一次，落库一律 hash。
- signing private key 不进普通配置表；必须使用 vault 或 secret backend。
- redirect URI 必须精确匹配，不支持通配符。
- 所有 auth 写操作记录 `operation_logs` 或专用 auth 事件。

---

## 6. 实施阶段与 TODO

### Phase 0：协议与边界锁定

- [x] A0-T1：确认 Console 作为应用用户 IdP，Platform 只保留控制面登录与授权治理。
- [x] A0-T2：确认 token claims、`sub` 取值、`hzy.uid` 私有 claim 与 PII 边界。
- [x] A0-T3：确认业务应用统一使用 OIDC Authorization Code + PKCE。
- [x] A0-T4：确认 bundle applications 投影作为 `auth_clients` 的默认来源。
- [x] A0-T5：补充 Console API 契约中的 Auth Runtime / OIDC 章节。

完成标准：协议文档冻结，AIMS / Codocs / Console 自身登录改造都按同一协议实现。

Phase 0 冻结结论：

- 应用用户登录链路统一为 `上游身份源 -> Console auth-runtime -> Console OIDC -> 业务应用`。
- Platform Identity Plane 不再作为应用用户 IdP；它只治理控制面账户、平台 session、policy bundle / license / revocation 签名与 runtime token。
- Console access token / ID token 不携带真实姓名、邮箱、手机号、部门名、角色明细和 scope 明细。
- MVP `sub` 固定为 `user:<uid>`，同时在 `hzy.uid / hzy.subjectType / hzy.subjectCode` 中保留可读私有 claim；授权匹配以 bundle `subjects.subjectCode` 对齐。
- 下游业务应用默认只支持 Authorization Code + PKCE；不新增 CAS 直连。
- `auth_clients` 默认从 Platform 下发的 bundle `applications` 投影物化，Console 可做本地安全覆盖，但不得另起一套应用事实源。

### Phase 1：Console 本地 session 核心

- [x] A1-T1：新增 auth-runtime migration，补齐 `auth_clients / auth_authorization_codes / auth_refresh_tokens / auth_signing_keys` 等表。
- [x] A1-T2：实现 `server/utils/authSession.ts`：创建、读取、刷新、撤销 `local_sessions`。
- [x] A1-T3：实现 `server/utils/authIdentity.ts`：按 provider identity 解析或绑定 `directory_identities -> directory_users.uid`。
- [x] A1-T4：改造 CAS / 企业微信 callback：不再直接写 legacy `token/auth_user` 作为唯一登录态，而是创建 `local_sessions`。
- [x] A1-T5：实现 `GET /api/v1/console/auth/me` 与 `POST /api/v1/console/auth/logout`。
- [x] A1-T6：保留 legacy Cookie 兼容写入，但标记为 bridge 输出，不作为权威 session。

完成标准：Console 自身页面可只依赖 `local_sessions` 判断登录，登录审计完整写入。

实现进度（2026-04-29）：已新增 `docs/Console-SQL-Migration-v1.3-auth-runtime-core.sql`，补齐 `local_sessions` 与后续 OIDC Provider 所需核心表；已新增 `console/server/utils/authSession.ts` 与 `console/server/utils/authIdentity.ts`；CAS / 企业微信回调已改为先解析或绑定 `directory_identities`，再创建 Console 本地 session，并在 `CONSOLE_AUTH_COOKIE_MODE=dual` 下双写 `console_session` 与 legacy `token/auth_user/auth_*` Cookie；已新增 `/api/v1/console/auth/me` 与 `/api/v1/console/auth/logout`，Console 路由守卫和登录页已改为读取 `/auth/me`，`/api/auth/permissions` 也改为使用已校验的 Console session。

### Phase 2：Console OIDC Provider MVP

- [x] A2-T1：实现 Console signing key 管理：生成 key、发布 JWKS、支持 current/next/retired 状态。
- [x] A2-T2：实现 OIDC discovery 与 JWKS endpoint。
- [x] A2-T3：实现 `/oauth/authorize`：校验 client、redirect_uri、scope、state、nonce、PKCE。
- [x] A2-T4：实现 `/oauth/token`：code 换 access token / ID token / refresh token。
- [x] A2-T5：实现 `/oauth/userinfo`、`/oauth/revoke`、`/oauth/logout`。
- [x] A2-T6：实现 token TTL、refresh rotation、session revoke 后 token 失效检查。
- [ ] A2-T7：增加 OIDC 协议级测试：invalid redirect_uri、code 重放、PKCE mismatch、expired code、refresh rotation。

完成标准：一个测试 client 可通过标准 OIDC code flow 登录并拿到可由 JWKS 验证的 token。

实现进度（2026-04-29）：已新增 `console/server/utils/oidc.ts`，支持 EdDSA signing key 按需生成、私钥落本地 `CONSOLE_AUTH_SIGNING_KEY_DIR` 文件引用、公钥进入 `auth_signing_keys.public_jwk_json` 并由 JWKS 发布；已新增 `/.well-known/openid-configuration`、`/.well-known/jwks.json`、`/oauth/authorize`、`/oauth/token`、`/oauth/userinfo`、`/oauth/revoke`、`/oauth/logout`。当前实现使用 `auth_clients` 与 `auth_client_redirect_uris` 做 exact match，authorization code 与 refresh token 只保存 hash，code 支持一次性消费，refresh token 支持 rotation 与 reuse detection 后 token family 撤销。`/oauth/token` 已支持 service client `client_credentials`，按 `service_client_credentials` 校验凭证并按 `service_client_grants` 签发短期 `token_use=service` access token。协议级自动化测试尚未补齐，待 A2-T7。

### Phase 3：应用 client 物化与 Platform 集成

- [x] A3-T1：Console bundle 刷新后读取 `payload.applications`，幂等物化 `auth_clients`。
- [x] A3-T2：使用 `callbackUrl / logoutUrl / homeUrl / icon / description` 生成应用登录入口与 client 元数据。
- [x] A3-T3：支持 dashboard 对应用 redirect URI 的平台侧治理，Console 本地只允许基于 bundle 下发值加本地安全覆盖。
- [x] A3-T4：当订阅取消或应用停用时，将对应 `auth_clients.status` 置为 inactive。
- [x] A3-T5：Console heartbeat 上报 IdP 健康摘要：signing kid、active clients、session count、last auth error。

完成标准：无需在 Console 手工硬编码 AIMS / Codocs client，订阅与 bundle 更新后自动可登录。

实现进度（2026-04-29）：已新增 `console/server/utils/authClients.ts`，在 startup cache 命中、startup refresh、heartbeat `download_bundle` refresh 后读取 `payload.applications` 并物化 `auth_clients` 与 `auth_client_redirect_uris`。Platform `applications` 投影已补齐 `callbackUrl/logoutUrl`；Console 对 bundle 来源的 redirect/logout URI 采用追加/保活策略，允许本地、预发和生产回调地址在共享库场景下同时保持 active，废弃 URI 需通过治理或人工审计显式停用。bundle 中消失的 bundle-sourced client 会被置为 `inactive`。Heartbeat payload 已增加 `authRuntime` 摘要，包括 `signingKid / activeClients / activeSessions / lastAuthError / lastAuthErrorAt`。

### Phase 4：Foundation Auth Adapter 改造

- [x] A4-T1：新增 Foundation Console OIDC adapter，封装 login redirect、callback exchange、token storage、logout。
- [x] A4-T2：`useAuth` 从 legacy cookie bridge 切到 Console session / OIDC token 数据源。
- [x] A4-T3：`auth.global.ts` 改为发现未登录时跳 Console `/oauth/authorize`，不再直接拼 CAS / 企业微信入口。
- [x] A4-T4：服务端 request context 注入 verified token、uid、subjectCode、tenant、policyVersion。
- [x] A4-T5：保留 `useLegacyAuthBridge` 开关，作为迁移期 fallback，不作为默认路径。
- [x] A4-T6：更新 Foundation 文档与能力清单。

完成标准：业务模块无需感知 CAS / 企业微信，统一通过 Foundation 接入 Console OIDC。

### Phase 5：业务应用迁移

- [x] A5-T1：AIMS 接入 Console OIDC，移除直接依赖 `auth_user` Cookie 的主路径。
- [x] A5-T2：AIMS 服务端 API 改用 verified token + policy bundle 判断身份和权限。
- [ ] A5-T3：Codocs 接入 Console OIDC，协作服务同步支持 token 校验。（本轮按要求跳过，后续单独迁移）
- [x] A5-T4：Console 自身管理页面切到 auth-runtime session。
- [x] A5-T5：验证 logout：Console 全局退出后 AIMS 会话刷新失败并停在已退出页；Codocs 接入延后。

完成标准：AIMS / Codocs / Console 自身均走 Console IdP；旧 CAS 入口只作为 Console 上游 connector。

实现进度（2026-04-29）：AIMS 前端登录已切到 Foundation Console OIDC adapter，未登录时跳本地 `/api/auth/oidc-login` 并由 Console `/oauth/authorize` 完成登录；AIMS 服务端通过 Foundation 注入的 `event.context.consoleAuth` 读取已验签 token 身份，`HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时才回退 `auth_user` Cookie。AIMS 旧 CAS / 企业微信 callback 已限制为 legacy 模式可用，不再作为默认登录入口。AIMS 权限判断继续消费本地 Platform policy bundle，项目权限工具和 API 身份读取已改为 verified token 主路径。Console 自身管理 API 已改为读取 auth-runtime session，不再以 `auth_user` Cookie 作为权威身份。

联调结果（2026-04-29）：Console OIDC discovery / JWKS / authorize / token / userinfo 可用；AIMS 通过 Authorization Code + PKCE 登录后可进入 `/projects`，`/api/auth/me` 返回 `provider=console_oidc`、`policyVersion=pv_20260429155031_0010`，已授权的 `test` 用户可解析到 `aims.member` 权限。AIMS logout 已验证可跳转到 Console `/oauth/logout` 并回到 AIMS `/login`，随后 `/api/auth/me` 为未登录。联调中发现 bundle 内 `aims.callbackUrl/logoutUrl` 为空会导致 `invalid_redirect_uri`，本地通过 Console `auth_client_redirect_uris` 覆盖继续验证；正式环境应在 Platform 应用/部署配置中补齐 OIDC callback/logout URL 并重新生成 bundle。Codocs 迁移按本轮要求延后。

Logout 80% 版本（2026-04-29）：Console access token 默认 TTL 调整为 15 分钟；任一业务应用走 `/api/auth/logout` 时会清本地 OIDC Cookie、跳 Console `/oauth/logout` 并撤销 Console `local_sessions` 与该 session 下所有 refresh token。Console 若使用 CAS 作为上游登录 connector，`/oauth/logout` 会继续跳 CAS `/cas/logout?service=...`，避免业务应用退出后因 CAS SSO 仍有效而立刻重新登录。业务应用服务端解析 Console OIDC token 时会调用 Console `/oauth/userinfo` 校验 `sid` 是否仍有效，Console 已退出后后续 API 请求会被受控 401 拦截并清理本地 Cookie；前端路由守卫也会通过 `/api/auth/me` 触发该校验并停在 `logged_out` 登录页。完整 front-channel/back-channel logout 仍留到 Phase 6+ 单独实现。

### Phase 6：安全加固与旧链路退场

- [ ] A6-T1：加入 CSRF/state/nonce/PKCE 全量校验与安全测试。
- [ ] A6-T2：实现 signing key rotation：current/next 发布、旧 token 宽限、retired 清理。
- [ ] A6-T3：实现 refresh token reuse detection，命中后撤销 token family。
- [ ] A6-T4：实现 session 管理 UI：查看在线会话、强制下线、按用户/设备撤销。
- [ ] A6-T5：下线业务应用直接 CAS / 企业微信登录入口。
- [ ] A6-T6：移除 Foundation legacy auth bridge 默认启用，`auth_*` Cookie 只保留短期兼容。

完成标准：新链路具备可审计、可撤销、可轮换、可诊断能力；旧 Account/CAS 直连不再是业务应用认证入口。

---

## 7. MVP 顺序建议

最小可运行路径：

1. 先实现 `local_sessions + /auth/me + /auth/logout`，把 Console 自身登录态从 legacy Cookie 抬到数据库 session。
2. 再实现 OIDC discovery / JWKS / authorize / token / userinfo，先让 AIMS 作为第一个 client 登录。
3. 然后把 Foundation `useAuth` 切到 Console OIDC，业务模块统一迁移。
4. 最后做 refresh rotation、key rotation、session 管理 UI 和旧链路退场。

不建议第一步就做完整 IdP 管理后台。MVP 可以从 bundle applications 自动物化 client，管理后台只做只读诊断，避免多一套应用注册事实源。

---

## 8. 验收标准

- Console 可配置 CAS / 企业微信 / 通用 OIDC 作为上游身份源。
- 业务应用只配置 Console OIDC issuer，不配置 CAS / 企业微信。
- AIMS 用户通过 Console 登录后，可拿到 Console 签发的 ID token / access token。
- AIMS 可离线验证 token 签名，并结合 policy bundle 完成权限判断。
- 登出 Console 后，refresh token 失效；业务应用刷新失败并回到 Console 登录。
- 登录成功、失败、刷新、撤销、登出均有审计记录。
- Platform 不保存应用用户 session、refresh token、OIDC client secret。

---

## 9. 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `sub` 与 platform subject id 不一致 | 授权快照匹配失败 | MVP 使用 `subjectCode=uid` 与 bundle `subjects.subjectCode` 对齐；后续再加入 subject id。 |
| redirect URI 配置不一致 | OIDC 登录失败或存在开放重定向风险 | 只允许 exact match；默认从 platform application `callbackUrl` 投影生成。 |
| legacy Cookie 与新 session 并存 | 登录态判断混乱 | 明确 `local_sessions` 是权威，legacy Cookie 只做短期兼容输出。 |
| 密钥轮换影响在线用户 | token 验签失败 | JWKS 同时发布 current/next/retired，保留旧 key 到最大 token TTL 后再退役。 |
| refresh token 泄漏 | 长期会话被劫持 | hash 落库、rotation、reuse detection、session revoke。 |
| 上游身份字段不稳定 | 用户绑定错误 | 以 provider subject 为主键，email/mobile 只能作为辅助匹配并需要审计。 |
