# Console Tenant Runtime API Contract v1

状态：P0 v1 已冻结；实现补充至 2026-07-18

建立日期：2026-07-14

修订日期：2026-07-18

决策依据：`docs/ADR-017-Console-Tenant-Data-Plane-Separation.md`

适用范围：Cloudflare、PM2、Self-hosted Console 访问客户侧 Console/Auth/Directory/Vault/Audit Runtime。

## 1. 边界

- Console 领域 API 基础路径：`/v1/console/**`。
- 标准 OIDC 路径保持 `/.well-known/**`、`/oauth/**`，由 Console/Gateway 对外暴露并代理到客户侧 Auth Runtime。
- API 只暴露领域动作和受限查询，不提供 SQL、表名、任意列、任意 filter、通用事务或 Secret 通用读取入口。
- 数据库连接只由客户侧 tenant-runtime 持有。Cloudflare Worker、PM2 Console、浏览器、Tenant Gateway 和 Platform 均不得获得 DSN、数据库密码或 Vault 主密钥。
- Session、Refresh Token、OIDC/Service Token 私钥和 Service Client credential 属于本契约的客户侧 Auth Runtime 范围，不存在中央 `hzy_console_control` 例外。
- Tenant/deployment/environment/target app 只来自已验证 Token、Gateway 身份和本机 enrollment。Query、Body 和浏览器 Header 均不能覆盖。
- PM2/Self-hosted 只改变 Runtime endpoint 为 loopback/内网，不改变 API、Token、权限和审计。

## 2. 调用类型

### 2.1 用户会话调用

用户进入 Console 或业务应用后，数据访问必须携带以下一种客户侧 Auth Runtime 已验证身份：

- Runtime 签发的短期用户 Access Token；
- Runtime 可验证的 opaque Session handle；
- Foundation 标准的签名用户委托，且其根身份来自已验证用户会话。

约束：

- `sub/uid/tenant/deployment/sid` 由 Runtime 验证，BFF 传入的 `x-hzy-actor-uid` 不构成身份。
- Runtime 是最终 Session、用户状态和对象范围校验边界。
- 高价值 mutation 要求短 TTL request-target proof，绑定 method、path、query、body hash、nonce 和 session。
- 角色、权限和数据范围继续消费 Platform 签名 Policy Bundle，但 Runtime 必须验证 bundle revision、用户状态和 endpoint 固定要求。

### 2.2 Service 调用

Actorless 后台任务或跨应用调用使用短期 `token_use=service` JWT。

必须校验：

- Console/tenant Auth Runtime JWKS；
- `iss`、`aud`、`token_use=service`；
- `source_app`、`target_app`；
- tenant、source deployment、target deployment；
- 精确 capability；
- 有效期、credential 状态和撤销状态；
- 本机 Runtime enrollment 和目标 app binding。

Capability 使用 `<target-app>:<resource>:<action>`，例如：

```text
console:directory-user:view
console:directory-user:edit
console:integration:test
console:notification:publish
console:audit:view
```

不得新增 `data-runtime:console:read`、`console.read` 或 `app:write` 作为新合同。传输层 audience 与业务 capability 分离。

### 2.3 Bootstrap/enrollment 调用

一次性 bootstrap 只允许：

- 兑换 Runtime enrollment；
- 注册 Runtime 本地生成的公钥/kid/指纹；
- 建立 deployment/app binding；
- 获取非 Secret 的最小 Runtime 配置；
- 执行受限健康检查。

Bootstrap credential 不能调用 `/v1/console/**` 业务数据、Vault、Directory、Session 或 Token 签发接口。完成后立即消费并记录 hash/receipt。

## 3. 通用请求约束

### 3.1 Mutation

- 必须携带 `Idempotency-Key`。
- 安全关键写入必须携带 `expectedRevision` 或 `expectedVersion`。
- Mutation 与 succeeded Receipt 在同一客户侧事务提交。
- 长任务返回 `202 operation_pending`，由固定状态 endpoint 查询。
- 请求体默认不超过 1 MiB；批量 endpoint 另设条数和字段上限。

### 3.2 响应与错误

错误统一为：

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "Resource revision changed.",
    "retryable": false,
    "requestId": "req_xxx",
    "details": {}
  }
}
```

不得返回：

- SQL、表名、DSN、Runtime 内部 URL；
- Authorization/Cookie/Secret/ciphertext；
- 原始 LDAP、企业微信、钉钉或第三方错误响应；
- Operation command/result 原文；
- 其他租户的存在性信息。

### 3.3 分页与查询

- 使用 Runtime 签名的不透明游标，绑定 tenant、endpoint、sort key 和 filter hash。
- 默认 `limit=50`，最大 200。
- 禁止任意 offset 扫描和一次请求 `pageSize=500` 全量目录。
- 响应默认最大 2 MiB，超限必须分页或提供聚合 endpoint。
- Filter、Sort、Field projection 均使用 endpoint 固定白名单。

### 3.4 Schema 与生产切换就绪检查

运维只读接口使用精确 scope `console.schema.read`：

| Method | Path | 结果 |
| --- | --- | --- |
| `GET` | `/runtime/schema/status?app=console` | 对照随 Runtime 二进制发布的 manifest 检查必需表、列、索引和命名约束 |
| `GET` | `/runtime/schema/status?app=console&mode=cutover` | 在 Schema 检查之上核验 Runtime DB 最小权限、租户/部署绑定、credential current pointer、OIDC signing key、Receipt、可靠操作、通知积压和 Directory 投影完整性 |

Schema manifest 从 `console/docs/hzy_console_schema.sql` 生成，revision 是源文件的
SHA-256。Runtime 发布前必须执行
`node scripts/generate-console-runtime-schema-manifest.mjs --check`；不得手工编辑生成物，
也不得仅以“表存在”替代列、索引和约束检查。

`mode=cutover` 只有在 `status=ready`、`blockers=[]` 且嵌套的
`schema.status=ok` 时才允许进入生产切换。检查失败只返回稳定检查码和计数，不返回
SQL、DSN、Secret 或行级内容。该接口是切换门禁，不是长期业务 SLO；72 小时观察仍须
使用运行指标、审计和业务 smoke 单独证明。

数据库身份门禁至少包括：

- `runtime_database_identity`：拒绝 root/MySQL 系统账号和 `%` host；
- `runtime_database_global_privileges`：拒绝除 `USAGE` 外的任何全局权限；
- `runtime_database_schema_privileges`：当前 Console schema 只允许
  `SELECT/INSERT/UPDATE/DELETE/CREATE TEMPORARY TABLES`，表/列级权限不得扩张到
  永久 DDL 或管理权限。

## 4. 企业配置 API

| Method | Path | Capability | 语义 |
| --- | --- | --- | --- |
| `GET` | `/v1/console/profile` | `console:org-profile:view` | 读取企业资料；校验库内 tenant 与 enrollment |
| `PUT` | `/v1/console/profile` | `console:org-profile:edit` | 更新允许字段，不接受 tenant/singleton 覆盖 |
| `GET` | `/v1/console/business-domains` | `console:business-domain:view` | 分页/树形读取 |
| `POST/PATCH` | `/v1/console/business-domains/**` | `console:business-domain:edit` | 领域结构 mutation |
| `GET` | `/v1/console/settings/catalog`、`/v1/console/settings/values` | `console:system-setting:view` | 非 Secret 参数目录和值投影 |
| `PUT` | `/v1/console/settings/values/{settingKey}` | `console:system-setting:edit` | 更新非 Secret 参数 |
| `PUT` | `/v1/console/settings/managed-values/{settingKey}` | `console:system-setting:manage` | 服务器工作流在完成自身授权/探测后更新托管参数；仍要求签名用户委托、`Idempotency-Key` 和 `expectedRevision` |
| `GET` | `/v1/console/regions`、`/v1/console/regions/{code}/divisions` | `console:region:view` | 行政区域和 division 投影 |
| `POST/PATCH/DELETE/PUT` | `/v1/console/regions/**` | `console:region:edit` | 区域及 division mutation |
| `GET` | `/v1/console/dictionaries/{code}/items` | `console:dictionary:view` | 有界字典项读取 |
| `POST/PATCH` | `/v1/console/dictionaries/**` | `console:dictionary:edit` | 字典 mutation |
| `GET` | `/v1/console/work-calendars`、`/{code}/months`、`/{code}/days` | `console:work-calendar:view` | 有界月份/日期范围 |
| `PATCH` | `/v1/console/work-calendars/{code}/days/{workDate}` | `console:work-calendar:edit` | 单日 CAS mutation |
| `POST` | `/v1/console/work-calendars/import-year` | `console:work-calendar:import` | Runtime 执行有界年度导入 |

### 4.1 企业资料 v1 已实现合同

- `GET` 响应除白名单资料字段外返回只读 `tenantCode`、`status`、`revision`、
  `updatedAt`；数据库中的 `id/singleton_key` 不出边界。
- `PUT` 是完整资料替换，必须包含 `expectedRevision`、`orgName`、`countryCode`、
  `timezone`、`locale`、`currencyCode`；可空字段显式传 `null` 或空字符串。
- `tenantCode`、`singletonKey`、`status`、`revision` 和未知字段一律拒绝。
- 调用方必须是 `source_app=console` 的 service token，并携带 Foundation 签名的
  Console 用户 actor；仅有 service client 或裸 `X-HZY-Actor-Uid` 不可写。
- `Idempotency-Key` 限 1～191 个安全 ASCII 字符。相同键、相同 canonical payload
  返回原结果并标记 `replayed=true`；相同键异 payload 返回
  `409 idempotency_payload_mismatch`。
- revision 过期返回 `409 profile_revision_conflict`。成功写入、mutation receipt
  和 `operation_logs` 审计在同一数据库事务中提交。
- Schema upgrade 使用
  `console/docs/org_profile_runtime_mutation_20260717.sql`；未应用时 Runtime schema
  readiness 必须失败，不允许 Console 回退直连。

## 5. Directory API

| Method | Path | Capability | 语义 |
| --- | --- | --- | --- |
| `GET` | `/v1/console/directory/users?query=&status=&departmentCode=&cursor=&limit=` | `console:directory-user:view` | 用户字段白名单分页；迁移期兼容 `page/pageSize`，最大 100 |
| `GET` | `/v1/console/directory/users/{uid}` | `console:directory-user:view` | 用户、部门和允许展示的 identity 摘要 |
| `POST` | `/v1/console/directory/users` | `console:directory-user:create` | 创建用户；幂等、revision、审计 |
| `PATCH` | `/v1/console/directory/users/{uid}` | `console:directory-user:edit` | 更新允许字段 |
| `POST` | `/v1/console/directory/users/{uid}:disable` | `console:directory-user:disable` | 禁用并触发 Session/credential 撤销 |
| `POST` | `/v1/console/directory/users/{uid}:change-password` | `console:directory-user:change-password` | 目的绑定 Connector 命令；不记录密码 |
| `GET` | `/v1/console/directory/departments?parentCode=&cursor=&limit=` | `console:directory-department:view` | 分层读取部门 |
| `POST/PATCH` | `/v1/console/directory/departments/**` | `console:directory-department:edit` | 部门 mutation |
| `GET` | `/v1/console/directory/projects?cursor=&limit=` | `console:directory-project:view` | 项目注册表投影 |
| `GET` | `/v1/console/directory/sync-jobs?cursor=&limit=` | `console:directory-sync:view` | 同步 Job 摘要 |
| `POST` | `/v1/console/directory/sync-jobs` | `console:directory-sync:execute` | 创建一次显式 `sync-now` |
| `GET` | `/v1/console/directory/sources`、`/sources/{provider}` | `console:directory-source:view` | 返回非 Secret 配置、连接状态与已绑定 credential metadata |
| `POST/PUT` | `/v1/console/directory/sources/**` | `console:directory-source:edit` | Runtime 内写 source、Vault version、credential binding、审计和 Receipt；配置禁止内嵌 Secret |
| `POST` | `/v1/console/directory-connectors/enroll` | `console:directory-connector:enroll` | 兑换 Platform Ed25519 签名单次 token；绑定 tenant/deployment 并登记 RSA-3072 Connector 公钥 |
| `GET` | `/v1/console/directory/provisioning`、`/me/password-capability` | `console:directory-connector:view` | LDAP 托管与本人改密可用性；不返回配置或 Secret |
| `GET` | `/v1/console/directory/operations/{operationId}` | `console:directory-connector:view` | 仅原发起人读取 Connector operation 状态 |
| `POST` | `/v1/console/directory/connector-operations/users` | `console:directory-connector:execute` | 排队 LDAP 用户创建；密码在 Runtime 内 RSA-OAEP 加密 |
| `POST` | `/v1/console/directory/me/password` | `console:directory-connector:execute` | 排队本人 LDAP 改密；不记录密码 |
| `POST` | `/v1/console/directory/connector-operations/ldap-sync` | `console:directory-connector:execute` | 排队一次显式 `sync-now` |
| `POST` | `/v1/console/directory/sources/ldap/test` | `console:directory-connector:execute` | 客户侧执行 LDAP 网络/TLS/bind/minimal search |

Directory 响应默认不返回外部 identity 原始值、LDAP DN、手机号或邮箱；需要展示的 PII 必须有独立字段权限和数据范围。
正式管理 UI 的首批兼容投影仍包含其既有邮箱/手机号字段，因此只能由本地
`directory_users:view` 授权后的签名 Console 用户调用；业务应用共享查询不得复用
该 capability，继续使用独立的最小 Directory sharing projection。
上述四个 Connector mutation 必须携带签名 Console 用户委托和
`Idempotency-Key`。命令、可重放 Receipt 和操作审计在 Directory Runtime 的同一
数据库事务中提交；Console 不得直接查询或写入 `integration_operation`。改密和
创建用户的密码明文不得进入 receipt、audit、operation metadata、日志或响应。
Enrollment token 的签名公钥和 `kid` 必须由 Tenant Runtime 安装时固定，不能由
兑换请求覆盖；Runtime 必须验证原始 payload 字节、算法、有效期、tenant、Console
deployment 和单次 `jti`。兑换只返回 Connector identity，不签发 Console OAuth
credential。Directory Connector 后续配置与命令流只允许 RSA-PSS 签名的本机
`/runtime/internal/directory-connector/**` 合同。

## 6. Integration 与 Vault API

| Method | Path | Capability | 语义 |
| --- | --- | --- | --- |
| `GET` | `/v1/console/integrations?type=&status=&cursor=&limit=` | `console:integration:view` | 配置和 credential 状态，不返回 Secret |
| `GET` | `/v1/console/integrations/{code}` | `console:integration:view` | 固定字段投影 |
| `PUT` | `/v1/console/integrations/{code}` | `console:integration:edit` | 更新非 Secret 配置 |
| `PUT` | `/v1/console/integrations/{code}/credential` | `console:integration:rotate` | Runtime 内加密轮换；只返回 fingerprint/version |
| `POST` | `/v1/console/integrations/{code}:test` | `console:integration:test` | Runtime 内 resolve 并执行固定测试 |
| `POST` | `/v1/console/integrations/{code}:execute` | endpoint 固定 capability | 只允许已登记 type+operation；禁止任意 URL/header/body |
| `GET` | `/v1/console/service/integrations` | `integration_config:view` + 本地 grant allowlist | 业务 service 的授权配置投影；调用方直达 Runtime |
| `GET` | `/v1/console/service/integrations/{code}` | `integration_config:view` + `integrationCodes` | 单一授权配置；Console BFF 不参与 |
| `POST` | `/v1/console/service/integrations/{code}/resolve` | `credential_vault:resolve` + `integrationCodes` | 兼容期服务端解析；active binding、usage/owner/version 均由 Runtime 派生并审计 |
| `GET` | `/v1/console/connector-runtime` | `console:connector-runtime:view` | 当前 binding 的实例、版本、状态、心跳和聚合指标 |
| `POST` | `/v1/console/connector-runtime/enrollments` | `console:connector-runtime:admin` | 生成 15 分钟单次安装码；要求签名用户委托和幂等键 |
| `POST` | `/v1/console/connector-runtime/enroll` | `console:connector-runtime:enroll` | 兑换安装码并原子建立实例、RSA 公钥、hash-only credential 和固定 grants |
| `POST` | `/v1/console/connector-runtime/heartbeat` | `console:connector-runtime:heartbeat` | 更新版本、能力、启动时间和有界聚合指标 |
| `POST` | `/v1/console/connector-runtime/revoke` | `console:connector-runtime:admin` | 原子吊销实例、未用安装码、credential 和 grants；要求签名用户委托和幂等键 |
| `GET` | `/v1/console/vault/secrets?usageType=&cursor=&limit=` | `console:vault-secret:view` | Secret metadata/fingerprint/version |
| `POST` | `/v1/console/vault/secrets/{secretRef}:rotate` | `console:vault-secret:rotate` | 客户侧加密轮换 |
| `POST` | `/v1/console/vault/secrets/{secretRef}:reveal` | `console:vault-secret:reveal` | 租户侧 MFA/审批/JIT；默认禁止平台支持身份 |

约束：

- 不提供通用 `/vault/resolve` 给浏览器或任意 Service Client；兼容期 resolve 只能按
  `integrationCode` 命中 active binding，且必须同时通过调用方 token capability 与
  客户侧 grant allowlist。新 provider 必须使用固定 operation。
- 业务应用优先调用固定 provider operation，由 Runtime 内部使用 Secret。
- Reveal 响应不可缓存，只返回一次，并写 reason、审批、actor、版本和结果审计。
- Connector enrollment 数据库只保存安装码 SHA-256；明文安装码不得进入 Receipt、
  audit、Trace 或错误。长期 client secret 只保存 SHA-256 版本，明文只在 Runtime
  内存中生成并用客户分机 RSA-3072 公钥执行 OAEP-SHA256 加密后返回。
- Heartbeat 的 `verifiedClientCode` 只能由已验证 Connector service actor 在 Console
  BFF 中派生，浏览器/body 不可指定；Runtime 仍须对 connectorId、tenant、deployment
  和 active instance 执行最终校验。

## 7. Auth Runtime 协议

### 7.1 对外端点

| Method | Path | 语义 |
| --- | --- | --- |
| `GET` | `/.well-known/openid-configuration` | 可缓存 discovery |
| `GET` | `/.well-known/jwks.json` | 可缓存 current/next/retired 公钥 |
| `GET` | `/oauth/authorize` | Authorization Code + PKCE |
| `GET/POST` | `/oauth/callback/{provider}` | 上游 IdP callback；state/browser binding 单次消费 |
| `POST` | `/oauth/token` | Code、Refresh、Client Credentials/Workload exchange |
| `POST` | `/oauth/revoke` | Token/Session revoke |
| `GET/POST` | `/oauth/logout` | RP initiated logout |
| `GET` | `/oauth/userinfo` | 当前 Session/Token 的允许字段 |
| `GET` | `/v1/console/auth/me` | Console 当前企业用户 |
| `POST` | `/v1/console/auth/logout` | 清理 Session、Refresh family 和本地 Cookie |

### 7.2 Auth 不变量

- OIDC private key 在客户侧生成和使用，不通过 API 导出。
- Authorization Code、Refresh Token、Session handle 只存 hash。
- Redirect URI exact match；State、Nonce、PKCE、Browser binding 必须执行。
- Refresh rotation 和 reuse detection 撤销整个 Token family。
- Signing key 支持 `next/current/retired`；旧 key 保留到最大 Token TTL。
- Access/ID Token 不携带姓名、邮箱、手机号、部门名、角色明细或 Secret。
- Token 至少绑定 `iss/sub/aud/tenant/deployment/sid/policy revision/iat/exp`。
- Runtime 离线时新登录、refresh、revoke 和需要实时 Session 的操作返回 503；不读中央数据库。

## 8. Service Identity API

Service Client 管理接口只供租户管理员和受控安装流程：

| Method | Path | Capability | 语义 |
| --- | --- | --- | --- |
| `GET` | `/v1/console/service-clients?cursor=&limit=` | `console:service-client:view` | Metadata/grant/fingerprint |
| `POST` | `/v1/console/service-clients` | `console:service-client:create` | 创建 deployment-bound identity |
| `POST` | `/v1/console/service-clients/{code}:rotate` | `console:service-client:rotate` | 客户侧轮换；明文最多一次 |
| `PUT` | `/v1/console/service-clients/{code}/grants` | `console:service-client:grant` | 只绑定 Manifest 声明的 capability |
| `POST` | `/v1/console/service-clients/{code}:revoke` | `console:service-client:revoke` | 撤销 credential/Token |
| `POST` | `/v1/console/admin/service-grant-repairs/aims-codocs-runtime-read` | `console:service-client:grant` | 仅受签名 Console 管理员可用的固定幂等修复；不接受可变 client/scope，只补齐 `aims.runtime` 的 Codocs 双 audience read grant 并写审计 |

Platform 管理的是 application/deployment 和 capability 治理，不直接写客户侧 credential。SQL Seed 只作为初始化迁移输入，不能成为第二授权事实源。

## 9. 通知、可靠操作与审计 API

| Method | Path | Capability | 语义 |
| --- | --- | --- | --- |
| `GET` | `/v1/console/notifications?state=&cursor=&limit=` | `console:notification:read` | 当前已签名用户通知；收件人不可由请求覆盖 |
| `GET` | `/v1/console/notifications/summary` | `console:notification:read` | 当前已签名用户的未读/归档摘要 |
| `POST` | `/v1/console/notifications/{id}/read` | `console:notification:manage` | 更新当前用户 read state |
| `POST` | `/v1/console/notifications/{id}/archive` | `console:notification:manage` | 更新当前用户 archive state |
| `POST` | `/v1/console/notifications/read-all` | `console:notification:manage` | 当前用户全部已读；要求幂等键 |
| `POST` | `/v1/console/service/notifications` | `console:notification:publish` | 固定 Service contract 发布 |
| `GET` | `/v1/console/integration-operations?sourceApp=&status=&cursor=&limit=` | `console:integration-operation:view` | Operation 摘要 |
| `POST` | `/v1/console/integration-operations/{id}:retry` | `console:integration-operation:replay` | 只允许 retryable/dead-letter |
| `GET` | `/v1/console/audit/operation-logs` | `console:audit:view` | 有界时间范围、字段白名单 |
| `GET` | `/v1/console/audit/login-logs` | `console:audit:view` | 登录方式保留 WeCom/DingTalk/OAuth 语义 |
| `GET` | `/v1/console/audit/lifecycle-metrics` | `console:audit:view` | 生命周期失败、重试和待处理聚合 |
| `POST` | `/v1/console/audit/operation-logs`、`/login-logs` | `console:audit:write` | 受信 service actor 追加；要求幂等键并递归脱敏 |
| `POST` | `/v1/console/audit/exports` | `console:audit:export` | 异步导出，租户侧生成；尚未实现 |

审计查询返回规范化 envelope，但不得暴露原始 Secret、Token、请求体、SQL、Command 或内部 URL。

## 10. 缓存

- Discovery、JWKS、Platform 已签名 Policy Bundle 可按 kid/version 缓存。
- Console 企业配置 GET 可按 tenant、authorization revision、path、canonical query 短缓存。
- Directory PII、Notification 和 Audit 响应不得进入跨用户共享缓存。
- Mutation、Vault、Auth、Integration test 和 Reveal 禁止 CDN 缓存。
- 缓存不可在 Runtime 不可用时升级为权威数据源。

## 11. 离线与错误语义

| 场景 | HTTP | code | 行为 |
| --- | --- | --- | --- |
| Runtime 不可达/超时 | `503` | `tenant_runtime_unavailable` | 可重试；不回退 DB |
| Console/Auth adapter 未启用 | `503` | `console_runtime_not_ready` | 运维修复版本/Schema |
| Schema 不兼容 | `503` | `runtime_schema_incompatible` | 阻止发布或先升级 Runtime |
| tenant/deployment/app 不匹配 | `403` | 对应 mismatch code | SQL 前失败，不尝试其他租户 |
| 用户 Session 缺失/撤销 | `401` | `session_invalid` | 清理本地 Cookie，重新登录 |
| capability/数据范围不足 | `403` | `permission_denied` | 不泄露对象存在性 |
| request proof 过期/重放 | `403` | `request_proof_invalid` | SQL 前失败 |
| revision 冲突 | `409` | `revision_conflict` | 刷新事实后重试 |
| Operation 已接受 | `202` | `operation_pending` | 返回 operation id/status URL |

Runtime 离线时：

- Discovery/JWKS 可使用未过期缓存；
- 已签发短期 Token 是否可继续离线验签，由目标接口的撤销新鲜度要求决定；
- 新登录、Token refresh、Service Token 签发和租户数据 API 不可用；
- Console 不使用 Platform、Hyperdrive 或本地 DB 补偿。

## 12. 迁移兼容

- 迁移状态按 `tenant + domain` 管理：`direct_legacy`、`shadow_read`、`runtime_only`、`verified`。
- Shadow Read 只比较规范化 hash，不把 Runtime 私有响应写入 Platform/Console 日志。
- 某领域一旦进入 `runtime_only`，失败都按本契约返回，禁止静默 fallback。
- 长期双写禁止；写入切换时只有一个事实源。
- Auth 切换采用“先同时信任新旧 JWKS → 切换签发者 → 等待最大 TTL → 退役旧 key”。
- PM2/Cloudflare 使用同一迁移状态和契约，不允许 PM2 维持长期 direct mode。

## 13. 必测安全用例

1. 两个租户使用不同数据库且拥有相同 uid/code/idempotency key 时互不命中。
2. 浏览器伪造 tenant、deployment、runtime URL、actor uid、source/target app 均在 SQL 前失败。
3. 用户 Token 和 Service Token 的 issuer/audience/capability/deployment 不匹配时返回 401/403。
4. 同一 mutation 重放只返回同一 Receipt，不重复创建用户、通知、Secret version 或 Operation。
5. Runtime 离线时登录/refresh/租户数据明确 503，不跨租户或直连 fallback。
6. Code 重放、PKCE mismatch、State/Nonce 错误、Refresh reuse 和旧 signing key 生命周期符合 OIDC 约束。
7. Secret 不出现在 API、日志、审计详情、Operation、Cloudflare Trace、缓存或错误中。
8. Platform support identity 没有租户批准的 JIT grant 时不能查询 Directory、Vault、Audit 或执行 Reveal。
9. Cloudflare 和 PM2 client 对同一请求产生相同授权、错误和幂等结果。
10. Runtime 当前版和前两个 minor 的合同兼容测试通过；超出兼容窗口时发布门禁失败。

## 14. 2026-07-17 实现补充

当前实现除前述领域端点外，还包含以下 Runtime-only 路由族：

| 路由族 | 典型路径 | 精确 capability |
|---|---|---|
| Auth OIDC state/signing | `/v1/console/auth/oidc/jwks`、`/authorization-codes/**`、`/refresh-tokens/**`、`/sign`、`/service-token-state` | `console:auth-oidc:{read,write,sign}` |
| Session | `/v1/console/auth/sessions`、`/resolve`、`/revoke` | `console:auth-session:{read,write}` |
| Auth client/identity | `/v1/console/auth/clients/materialize`、`/identities/resolve-or-bind`、`/external-login-transactions/**` | `console:auth-client:sync`、`console:auth-identity:write`、`console:auth-external-login:write` |
| 兼容运行态 | `/v1/console/runtime/clipboard`、`/presence/**` | `console:runtime-compat:{read,manage}` |
| Platform 生命周期 | `/v1/console/platform-lifecycle/operations/**`、`/drain/**`、`/actionables/**` | `console:platform-lifecycle:{view,execute}` |
| Canonical notification | `/v1/console/notifications/**`、`/todos/**`、`/deliveries` | `console:notification:{read,manage,publish}` |
| 统一审计 | `/v1/console/audit/**` | `console:audit:{view,write}` |

实现必须同时满足：

- Runtime 校验 JWT 的 `tenant`、`deployment`、`source_app`、`target_app`、
  `aud` 和 exact scope；不能用字符串前缀或“管理员”隐式扩权。
- 只有 audience 为 `data-runtime` 且声明
  `data-runtime:runtime:update` 时，才可按固定映射派生 `runtime.update`；
  其他 scope 不做别名推导。
- 用户委托中的 actor/subject 必须与已验证 session/identity 一致。
- Console 的 OIDC/Service Token 私钥、refresh/session hash 和 Vault master key
  只存在于 Tenant Runtime。
- Cloudflare policy bundle cache 使用 isolate memory；它不是持久化事实源，
  冷启动和失效时必须重新拉取已签名 bundle。
