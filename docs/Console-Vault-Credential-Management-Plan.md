# Console Vault 凭证统一管理方案与实施计划

状态：Draft  
日期：2026-04-30  
定位：`console.credential-vault` 的凭证分类、零配置运行链路与迁移实施计划

---

## 1. 目标

平台目标是把汇智云各应用所需的 Key 与客户侧托管凭证统一收敛到 `console` 的 `credential-vault` 中管理。

最终形态：

- 业务应用不再在 `.env` 中配置 GitLab、OSS、企业微信、AI Provider、云资源 AKSK 等外部 Key。
- 业务应用本地只保留 `license.lic`，其中包含 Console 地址、应用身份和最小 bootstrap access key。
- 应用启动后通过 Foundation 读取 `license.lic`，向 Console 换取短期 service token，再读取非 secret 配置并按授权 `resolve` 运行所需 secret。
- Console 统一负责 secret 元数据、版本、轮换、授权、受控 reveal、程序化 resolve 与审计。
- Assets 可在资产视角增强凭证治理，但不成为 vault 事实源。

---

## 2. 凭证分类模型

Console vault 采用一套存储模型，按 `vault_secrets.usage_type` 区分凭证用途：

```text
Console vault
  ├─ runtime credentials
  │   ├─ integration credential
  │   ├─ service credential
  │   └─ bootstrap credential
  └─ custody credentials
      └─ only reveal by authorization
```

| usage_type | 类型 | 典型例子 | 主要使用者 | resolve | reveal |
|---|---|---|---|---|---|
| `integration` | 集成凭证 | GitLab Token、OSS AKSK、企业微信 Secret、AI API Key、云厂商采集 AKSK | 业务应用 / supporting service | 允许，需 service grant 与 purpose | 受控 |
| `service` | 服务凭证 | Aims / Codocs / Workflow / Assets 访问 Console 的 client secret | 本地应用 / supporting service | 不作为普通 secret 暴露；用于认证换 token | 原则上只签发时展示一次 |
| `bootstrap` | 启动凭证 | `license.lic` 中的应用启动 access key | 业务应用启动流程 | 只用于 bootstrap 换短期 token | 不建议 reveal，轮换重发 |
| `custody` | 托管凭证 | 客户云账号 Root AKSK、供应商后台密钥、数据库临时口令、设备管理密码、交付给客户的密钥 | 默认无人直接消费 | 默认禁止 | 经授权 / 审批 / 审计后展示 |

关键区别：

- `integration credential` 是系统运行要用的 Key。
- `custody credential` 是企业要集中保管的 Key，默认不进入应用零配置运行链路。
- `service credential` 和 `bootstrap credential` 服务于应用与 Console 的信任建立，不应被业务代码当成普通第三方密钥使用。

---

## 3. 权限与访问规则

### 3.1 通用规则

- 所有明文返回必须经过显式接口，且必须写入 `vault_access_logs`。
- 前端浏览器不得直接调用 `/api/v1/console/vault/resolve`。
- 日志、错误、审计摘要、heartbeat、Platform 上报内容中不得包含 secret 明文或可恢复密文。
- 业务应用只能通过 Foundation adapter 或 Console service token 消费 vault 能力，不得直连 `hzy_console` 数据库。
- 对 Nuxt 业务模块，`integration_credentials` 只允许由 Console 内部和 Foundation adapter 间接使用；模块自身不得直接读取、缓存或解释 `integration_credentials`，只能按 `integrationCode` 调用 Foundation 提供的语义接口。

### 3.2 Runtime Credentials

`integration / service / bootstrap` 属于运行时凭证，访问规则不同：

- `integration`
  - 通过 `integrations + integration_credentials` 绑定到具体集成。
  - `integration_credentials` 是 Console 内部的凭证绑定模型，不作为业务模块 API surface；业务模块只感知 `integrationCode`、非 secret 配置和 Foundation 返回的运行时客户端/配置。
  - 程序化 `resolve` 必须校验调用方 service client、授权 scope、`purpose` 和 secret 归属。
  - 可按短 TTL 在应用内存缓存，不得落盘。
- `service`
  - 由 `service_clients + service_client_credentials + service_client_grants` 管理。
  - 用于向 Console `/oauth/token` 或 bootstrap endpoint 换取短期 token。
  - 签发或轮换时可一次性返回明文，列表和详情只显示 masked preview。
- `bootstrap`
  - 写入应用本地 `license.lic`。
  - 权限只覆盖启动所需能力，例如换取短期 token、拉取本应用运行配置。
  - 不授予任意 vault resolve 权限。

### 3.3 Custody Credentials

`custody` 属于托管保管凭证，默认规则更严格：

- 默认禁止 `/vault/resolve`。
- 只能通过 `/vault/secrets/:secretCode/reveal` 查看明文。
- reveal 必须填写 `reason`，并记录 actor、审批单号、用途、IP、时间、版本号。
- 高敏凭证建议要求审批后 reveal。
- 可绑定责任人、业务系统、供应商、资产编号、过期时间、轮换周期。
- Assets 启用后可读取元数据和审计摘要做治理视图，但不读取明文。

---

## 4. 零配置运行链路

目标应用本地只保留 `license.lic`：

```json
{
  "consoleUrl": "https://console.example.com",
  "appCode": "aims",
  "deploymentCode": "dep_acme_aims",
  "accessKey": "hzy_boot_xxx",
  "licenseSignature": "..."
}
```

启动流程：

```text
App start
  -> Foundation 读取 license.lic
  -> 校验 license 签名与 appCode/deploymentCode
  -> 使用 bootstrap access key 向 Console 换取短期 service token
  -> 读取 profile/settings/integrations 等非 secret 配置
  -> 按授权 resolve 本应用运行所需 integration secret
  -> 应用内存短 TTL 缓存 secret
```

运行时配置来源：

- 非 secret 配置：`system-settings` / `integration-config`
- secret 引用：`secretRef` / `secretCode`
- secret 明文：仅服务端按授权 `resolve`
- 平台授权与能力：Platform 签名 policy bundle / license

---

## 5. 数据模型落点

v1 不新增一套 vault 表，复用现有模型：

- `vault_secrets.usage_type`
  - `integration`
  - `service`
  - `bootstrap`
  - `custody`
- `vault_secret_versions`
  - 保存版本链、密文或 backend secret ref
- `vault_access_logs`
  - 记录 `resolve / reveal / rotate / validate` 等操作
- `integrations / integration_credentials`
  - 管理运行时集成凭证绑定；`integration_credentials.secret_version_id` 固定到具体 vault 版本，避免 vault current 变化绕过 integration rotate
- `service_clients / service_client_credentials / service_client_grants`
  - 管理本地服务身份、密钥和访问授权

建议后续在 API 层强校验 `usage_type`，并按 `usage_type` 执行不同访问策略。DDL 可暂不加枚举约束，避免未来类型扩展需要频繁迁移。

---

## 6. Foundation 能力规划

Foundation 应提供统一客户端，业务应用不直接拼 Console API：

- `readLicenseFile()`
- `createConsoleBootstrapClient()`
- `getConsoleRuntimeConfig(appCode)`
- `getIntegrationConfig(integrationCode)`
- `resolveIntegrationSecret(integrationCode, purpose)`
- `getOssRuntimeConfig(integrationCode)`
- `getGitLabRuntimeConfig(integrationCode)`
- `getAiProviderRuntimeConfig(integrationCode)`

调用约束：

- 只在服务端可调用 secret resolve。
- 前端 composable 只能读取 masked metadata 和非 secret 配置。
- resolver 内部统一做 token 获取、重试、缓存、审计 purpose 传递和错误脱敏。
- 业务模块不得直接调用 Console 的 vault resolve 或 integration credential 绑定接口；需要 GitLab、OSS、AI、企业微信等能力时，只调用 Foundation 的 `get*RuntimeConfig` / `resolveIntegrationSecret` / provider client helper。
- 业务模块不得持久化 `secretRef` 到自身业务表，除非该字段是业务对象与集成配置的显式引用；即使保存引用，也不得保存 resolved secret 或 `integration_credentials` 内部标识。

---

## 7. 实施计划

### 阶段 0：方案固化

目标：

- 固化四类凭证分类。
- 明确 `custody` 不进入默认运行链路，只做授权展示。
- 明确业务应用最终只保留 `license.lic`。

交付：

- 更新目标架构、Console 功能设计、API 契约和启动时序文档。
- 在 Console API 契约中写明 `usageType` 枚举与 `custody` 的 resolve 禁止规则。

### 阶段 1：Console Vault MVP

目标：

- 补齐 secret 创建、版本、轮换、reveal、resolve、访问日志。
- 按 `usage_type` 执行基本策略。

交付：

- `POST /api/v1/console/vault/secrets`
- `POST /api/v1/console/vault/secrets/:secretCode/versions`
- `POST /api/v1/console/vault/secrets/:secretCode/rotate`
- `POST /api/v1/console/vault/secrets/:secretCode/reveal`
- `POST /api/v1/console/vault/resolve`
- `vault_access_logs` 全量落审计
- `db_encrypted` 使用 Console 本地 vault master key 加密；未配置 master key 时拒绝写入明文
- `/vault/resolve` 只接受 `audience=credential_vault` 且包含 `credential_vault:resolve` scope 的 service token

验收：

- `integration` 可被授权服务 resolve。
- `custody` 调用 resolve 被拒绝。
- reveal / resolve 都能追溯 actor、purpose/reason、版本与时间。

### 阶段 2：Integration Config 收口

目标：

- GitLab、OSS、企业微信、AI Provider、云厂商 AKSK 等统一进入 `integrations + vault`。
- 业务应用不再保存这些 Key。
- 业务应用只通过 Foundation 的集成客户端消费 `integrationCode`，不直接调用 Console 的 `integration_credentials` 绑定模型。

交付：

- `GET /api/v1/console/integrations`
- `GET /api/v1/console/integrations/:integrationCode`
- `POST /api/v1/console/integrations`
- `PATCH /api/v1/console/integrations/:integrationCode`
- `POST /api/v1/console/integrations/:integrationCode/rotate`
- `POST /api/v1/console/integrations/:integrationCode/check`
- `integration_credentials.secret_version_id` schema 补强与迁移
- Foundation `integrationConfig.ts` adapter：封装 `getIntegrationConfig`、`resolveIntegrationSecret`、`getGitLabRuntimeConfig`、`getOssRuntimeConfig`、`getAiProviderRuntimeConfig`、`getWecomRuntimeConfig`，业务模块只按 `integrationCode` 消费

优先迁移：

1. Aims：GitLab、企业微信、OSS。企业微信 OAuth 已先接入 Foundation integration adapter：`corpid/agentid` 读取 Console integration 非 secret 配置，`corpsecret` 从 vault resolve，`WECOM_*` 仅作为 legacy fallback。
   - 初始化模板：`docs/Console-SQL-Seed-v1.6-wecom-integration.sql`，用于创建 `wecom.default`、绑定 `integration.wecom.default.corpsecret`，并给 Aims/Codocs runtime service client 授权 `integration_config:view` / `credential_vault:resolve`。
2. Codocs：OSS、协作服务 secret。
3. Workflow：通知通道、webhook signing secret。
4. Insights：GitLab / 代码仓库访问 token。
5. Assets：云资源采集 AKSK、供应商 API Key。
6. AI：Provider API Key、Base URL、模型策略。

验收：

- 应用 `.env` 不再出现上述外部 Key。
- Console 集成页面能展示 masked preview、当前版本、最近检查结果。
- 轮换后应用能通过下一次 resolve/缓存刷新使用新版本。
- 业务模块代码中不出现对 `/api/v1/console/vault/resolve`、`integration_credentials` 或 Console 内部 credential id 的直接依赖。

### 阶段 3：Service Credential 与 Bootstrap

目标：

- 每个本地应用拥有独立 service client。
- 每个应用通过 `license.lic` 的 bootstrap credential 建立启动信任。
- Aims 优先实现 env service client 向 license bootstrap 的迁移，作为其他业务模块样板。

交付：

- Console service client 签发与轮换接口。
- `bootstrap` 类型 secret 创建与轮换流程。
- Foundation 启动工具读取 `license.lic`，换取短期 service token。
- Console `POST /api/v1/console/bootstrap/token`：校验 license 签名、校验 bootstrap access key，签发短期 `token_use=service` JWT。
- Foundation `serviceOidc.ts`：当 `HZY_SERVICE_CLIENT_ID/SECRET` 缺失时，从 `license.lic` 的 `bootstrap.consoleUrl` / `bootstrap.accessKey` 走 bootstrap token exchange。
- Aims 初始化模板：`docs/Console-SQL-Seed-v1.7-aims-bootstrap.sql`，创建 Aims service client、`bootstrap.{deploymentCode}.access_key`，并授予 integration/vault scopes。

`license.lic` 阶段 3 增量字段建议放在 token 顶层，不改变已签名 `payload`：

```json
{
  "schemaVersion": "license-token.v1",
  "payload": {
    "schemaVersion": "license.v1",
    "appCode": "aims",
    "deploymentCode": "C000001-aims"
  },
  "bootstrap": {
    "consoleUrl": "http://localhost:3000",
    "accessKey": "hzy_boot_xxx"
  }
}
```

验收：

- 应用只凭 `license.lic` 可以连接 Console 并拉取授权范围内配置。
- 不同应用只能 resolve 自己被授权的 integration secret。
- access key 泄露后的禁用和轮换路径明确。

### 阶段 4：业务应用 env 缩减

目标：

- 外部集成类环境变量全部下线。
- 应用运行配置由 Console 和 license 驱动。

保留项：

- 第一阶段可保留 DB/Redis 等基础设施 env，降低改造面。
- 后续再评估 DB/Redis 是否也从 Console 下发并 lazy init。

验收：

- Aims / Codocs / Workflow / Assets 的外部 Key env 删除或仅保留 legacy fallback。
- 新部署模板只要求 `license.lic` 和必要基础设施配置。
- 文档明确 legacy fallback 的退役时间。

### 阶段 5：Custody 凭证治理增强

目标：

- 支持企业把不被系统运行消费的敏感 Key 交由 Console 托管。
- 与 Assets 形成治理协同。

交付：

- `usageType=custody` 创建、列表、详情、reveal 审批字段。
- 责任人、所属系统、供应商、资产编号、轮换周期等元数据。
- Assets 读取 custody 元数据、到期风险和 reveal 审计摘要。

验收：

- Custody 凭证不能被程序化 resolve。
- reveal 必须审计，必要时走审批。
- Assets 可展示凭证资产治理状态，但无法读取明文。

---

## 8. 非目标

v1 不做：

- 全量外部 KMS / HSM 产品能力。
- 多个 active credential 并行宽限期。
- 浏览器端直接获取 secret 明文。
- Platform 托管客户 secret 明文或可恢复密文。
- Assets 替代 Console vault 成为凭证事实源。

多 active credential、外部 vault provider 直连、复杂审批策略可作为 `base.v2` 能力。
