# Console API 契约 v1

策略包存储 Runtime API：`GET/PUT /v1/console/policy-bundle`，精确 capability 为 `console:policy-bundle:read|write`。协议、幂等和安全边界见 [持久包说明](../deploy/cloudflare/POLICY_BUNDLE_STORAGE.md)。不增加浏览器可调用的存储管理入口。

状态：历史/目标设计参考（当前 service-token 主路径以 `docs/MODULE_CONTRACTS.md`、Console `CLAUDE.md` 与 OAuth/service-client 实现为准）
最后事实核对：2026-07-11
定位：目标设计，作为 `Console-Functional-Design-v1.md` 与 `console/docs/sql/Console-SQL-DDL-Draft-v1.sql` 的配套接口文档

---

## 0. 文档目标

2026-09-06 实现补充：`POST /api/internal/policy-bundle/sync` 为内部 Gateway 调度接口，不接受用户调用或 body 参数。调用方必须通过 Foundation `requireTenantGatewaySchedulerRequest`，签名绑定此精确路径及租户运行上下文，时间窗 60 秒；Gateway 公网拦截 404。仅 runtime policy 模式可用，先从 Platform 验签再持久化，返回 `{code:0,data:{ready:true}}`；同步失败 503，不返回包内容、内部地址或 secret。允许幂等重试，更新使用 Data Runtime ETag CAS。它不代表通用 Service API，不接受或增加业务 service grant。

本文档定义 `console` 第一版对本地管理端、Foundation adapter、业务应用与 supporting services 暴露的标准接口契约，重点回答四个问题：

- 哪些接口给本地管理面使用，哪些给服务间调用使用
- `secret_ref` 与 `secret_id` 在接口层分别如何出现
- `integration-config / credential-vault / service credential` 的接口如何分工
- 初始化、轮换、受控 reveal 需要哪些关键写接口

本文档只定义：

- 接口分组
- 请求 / 响应结构建议
- 鉴权方式
- v1 行为约束

本文档不展开：

- 完整 OpenAPI
- 具体 Nuxt / Nitro handler 实现
- 前端页面交互细节

---

## 1. 设计原则

| # | 原则 |
|---|------|
| BA1 | 对外接口暴露稳定业务键，不暴露数据库主键作为主引用方式 |
| BA2 | vault 对外以 `secretCode / secretRef` 标识秘密对象，关系表内部再落 `secret_id` |
| BA3 | 默认列表 / 详情接口不返回明文 secret，明文只出现在显式 `reveal` 或服务侧 `resolve` |
| BA4 | 写接口以“切换 current 指针”为核心，不把数据库内部版本链泄漏给业务模块 |
| BA5 | v1 不支持同一 `integration` / `service client` 并行 active credential |
| BA6 | 管理面接口与服务间接口可以共用同一 API，但鉴权主体和可见字段必须区分 |

---

## 2. 参与方

### 2.1 Local Admin

本地管理端操作员，负责：

- 初始化 `org_profiles`
- 配置系统参数、字典、外部集成
- 创建 / 轮换 / reveal secret
- 创建 / 轮换 service client credential

### 2.2 Foundation Adapter

负责为业务应用封装：

- `meta / profile / settings / dictionaries`
- `integrations` 的非 secret 配置读取
- 本地服务鉴权头注入

### 2.3 Business Applications / Supporting Services

通过服务间调用读取：

- 企业基础信息
- 非 secret 配置
- 受控的 secret resolve 结果

不得直接依赖 `console` 数据库。

### 2.4 Console API

负责：

- 数据持久化
- 写接口约束校验
- current pointer 切换
- vault reveal / resolve 审计

---

## 3. 鉴权与通用约定

Base URL 建议：

- 本地直连：`http://console/api/v1/console`
- 通过 Foundation 代理：`/api/base/**`

### 3.1 鉴权方式

管理面建议：

- 本地 session / cookie
- 或管理端专用 service client

服务间调用建议：

- `Authorization: Basic base64(client_id:client_secret)`
- `client_id / client_secret` 来自 `service_client_credentials`

说明：

- v1 不建议业务应用直接拿用户 token 调 `console`
- `resolve` 接口只允许服务间调用，不应直接暴露给浏览器

### 3.2 通用响应结构

```json
{
  "code": 0,
  "message": "ok",
  "traceId": "req_20260423_xxx",
  "data": {}
}
```

### 3.3 对外标识规则

| 对象 | 对外字段 | 内部字段 |
|---|---|---|
| secret | `secretCode`, `secretRef` | `secret_id` |
| integration | `integrationCode` | `integration_id` |
| service client | `clientCode` | `service_client_id` |
| setting | `settingKey` | `setting_key` |
| dictionary | `dictionaryCode` | `dictionary_id` |

### 3.4 错误码建议

| 错误码 | 含义 |
|---|---|
| `BASE_BAD_REQUEST` | 请求参数不合法 |
| `BASE_NOT_FOUND` | 对象不存在 |
| `BASE_CONFLICT` | 唯一约束或 current 切换冲突 |
| `BASE_SECRET_POLICY_DENIED` | 不满足 reveal / resolve 策略 |
| `BASE_SECRET_APPROVAL_REQUIRED` | reveal 需要审批 |
| `BASE_CONNECTIVITY_FAILED` | 集成连通性检查失败 |
| `BASE_CONTRACT_VIOLATION` | 违反 v1 单企业 / 单 active credential 等约束 |

---

## 4. Meta / Profile / Settings

## 4.1 `GET /api/v1/console/meta`

用途：

- 返回 `console` 的契约摘要与健康概况

响应建议：

```json
{
  "code": 0,
  "data": {
    "serviceRole": "base_runtime",
    "appCode": "console",
    "contractVersion": "base.v1",
    "tenantCode": "acme",
    "profileHash": "sha256_xxx",
    "settingsHash": "sha256_xxx",
    "integrationHash": "sha256_xxx",
    "vaultHealth": "healthy",
    "integrationHealthyCount": 4,
    "integrationFailedCount": 1,
    "updatedAt": "2026-04-23T10:00:00Z"
  }
}
```

## 4.2 `GET /api/v1/console/profile`

响应建议：

```json
{
  "code": 0,
  "data": {
    "tenantCode": "acme",
    "orgName": "Acme Consulting",
    "orgShortName": "Acme",
    "displayName": "Acme China",
    "legalName": "Acme Consulting Co., Ltd.",
    "timezone": "Asia/Shanghai",
    "locale": "zh-CN",
    "currencyCode": "CNY"
  }
}
```

## 4.3 `PATCH /api/v1/console/profile`

请求体建议：

```json
{
  "orgName": "Acme Consulting",
  "orgShortName": "Acme",
  "displayName": "Acme China",
  "legalName": "Acme Consulting Co., Ltd.",
  "timezone": "Asia/Shanghai",
  "locale": "zh-CN",
  "currencyCode": "CNY",
  "contactName": "张三",
  "contactEmail": "ops@acme.example"
}
```

说明：

- v1 固定单行更新，不存在“新增第二个 profile”

## 4.4 `GET /api/v1/console/settings/values`

请求参数建议：

| 参数 | 必填 | 说明 |
|---|---|---|
| `keys` | 否 | 逗号分隔的 `settingKey` 列表 |
| `scopeKey` | 否 | 默认 `__tenant__` |

响应建议：

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "settingKey": "ui.default_language",
        "scopeKey": "__tenant__",
        "value": "zh-CN",
        "source": "custom"
      }
    ]
  }
}
```

## 4.5 `PUT /api/v1/console/settings/values/:settingKey`

请求体建议：

```json
{
  "scopeKey": "__tenant__",
  "value": {
    "enabled": true,
    "threshold": 7
  }
}
```

说明：

- 只允许更新非 secret 参数

## 4.6 `GET /api/v1/console/dictionaries/:dictionaryCode`

响应建议：

```json
{
  "code": 0,
  "data": {
    "dictionaryCode": "industry",
    "dictionaryName": "行业",
    "items": [
      {
        "itemCode": "consulting",
        "itemName": "咨询服务",
        "itemValue": "consulting"
      }
    ]
  }
}
```

## 4.7 `POST /api/v1/console/service/directory/users/:uid/disable`

用途：

- service-only 接口，供 People 在员工离职或停用时同步停用 Console Directory 用户账号。

鉴权：

- `Authorization: Bearer <Console service token>`
- `aud=console_directory`
- `scope=console_directory:write`
- `hzy.appCode` 必须为 `people`

请求头：

| Header | 必填 | 说明 |
|---|---|---|
| `Idempotency-Key` | 建议 | 推荐格式 `people:employee:{uid}:disable-console-directory-user:v1` |

请求体示例：

```json
{
  "sourceApp": "people",
  "reason": "people_offboarding",
  "operatorUid": "hr.admin",
  "leaveDate": "2026-06-17"
}
```

行为：

- 将 `directory_users.status` 置为 `inactive`。
- 撤销该用户仍处于 active 状态的本地 `local_sessions` 与 `auth_refresh_tokens`。
- 若用户已为 `inactive` / `deleted`，接口幂等返回当前状态，并继续尝试撤销残留会话。

响应示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "uid": "g.zhao",
    "status": "inactive",
    "disabled": true,
    "alreadyDisabled": false,
    "revoked": {
      "sessions": 1,
      "refreshTokens": 2
    }
  }
}
```

---

## 5. Integration Config

本组接口面向 Console 管理面与 Foundation adapter。业务模块不应直接依赖 `integration_credentials` 或凭证绑定行，只能通过 Foundation 按 `integrationCode` 获取非 secret 配置、运行时客户端或服务端 resolve 结果。

## 5.1 `GET /api/v1/console/integrations`

响应建议：

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "integrationCode": "gitlab.default",
        "integrationType": "gitlab",
        "integrationName": "Default GitLab",
        "baseUrl": "https://gitlab.example.com",
        "connectivityStatus": "healthy",
        "lastCheckedAt": "2026-04-23T10:20:00Z",
        "currentCredential": {
          "credentialName": "primary",
          "credentialVersionNo": 3,
          "versionNo": 4,
          "secretCode": "gitlab.bot",
          "secretRef": "hzybase://vault/gitlab.bot@v4",
          "status": "active"
        }
      }
    ]
  }
}
```

## 5.2 `POST /api/v1/console/integrations`

请求体建议：

```json
{
  "integrationCode": "gitlab.default",
  "integrationType": "gitlab",
  "integrationName": "Default GitLab",
  "baseUrl": "https://gitlab.example.com",
  "config": {
    "groupPath": "acme/dev",
    "defaultBranch": "main"
  },
  "credential": {
    "secretCode": "gitlab.bot",
    "versionNo": 1
  }
}
```

说明：

- `secretCode` 必须已在本地 `vault_secrets` 建档
- v1 创建时自动生成第一条 `integration_credentials(primary, version_no=1)`，并绑定到具体 `vault_secret_versions`
- `integration_credentials` 是 Console 内部绑定模型，不作为业务模块直接消费的 API surface

## 5.3 `PATCH /api/v1/console/integrations/:integrationCode`

用途：

- 更新非 secret 配置

请求体建议：

```json
{
  "integrationName": "Primary GitLab",
  "baseUrl": "https://gitlab.example.com",
  "config": {
    "groupPath": "acme/platform"
  }
}
```

## 5.4 `POST /api/v1/console/integrations/:integrationCode/check`

响应建议：

```json
{
  "code": 0,
  "data": {
    "integrationCode": "gitlab.default",
    "status": "healthy",
    "checkedAt": "2026-04-23T10:30:00Z",
    "summary": {
      "latencyMs": 220
    }
  }
}
```

## 5.5 `POST /api/v1/console/integrations/:integrationCode/rotate`

用途：

- 基于本地 vault 中已存在的 secret/version 切换当前集成凭证

请求体建议：

```json
{
  "secretCode": "gitlab.bot",
  "versionNo": 4,
  "expiresAt": "2027-04-23T00:00:00Z",
  "reason": "quarterly_rotation"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "integrationCode": "gitlab.default",
    "currentCredential": {
      "credentialName": "primary",
      "versionNo": 4,
      "secretCode": "gitlab.bot",
      "secretRef": "hzybase://vault/gitlab.bot@v4",
      "status": "active"
    }
  }
}
```

约束：

- v1 同一 `integration` 同时只允许一条 `status='active'` 记录
- `currentCredential` 的切换由服务端在单事务内完成
- `integration_credentials.secret_version_id` 必须指向目标 vault 版本；为空仅用于兼容历史数据，读取时回退到 vault current version
- 连通性检查属于切换后的验证动作，不与数据库事务绑定为一个原子外部操作

## 5.6 `POST /api/v1/console/notification-runtime/wecom-check`

用途：

- 检测企业微信通知链路所需配置是否完备
- 覆盖 `notification.runtimeApiUrl`、notification-runtime health/capabilities、`wecom.default` 基础参数、vault secret 解析、notification-runtime service client 授权
- 不发送企业微信消息

请求体建议：

```json
{
  "integrationCode": "wecom.default"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "integrationCode": "wecom.default",
    "checkedAt": "2026-06-14T10:30:00.000Z",
    "ready": true,
    "checks": [
      {
        "key": "runtimeApiUrl",
        "label": "Runtime 地址",
        "status": "pass",
        "message": "https://wecom-api.example.com"
      }
    ]
  }
}
```

## 5.7 `POST /api/v1/console/notification-runtime/wecom-test`

用途：

- 在通知运行时页面测试完整企业微信消息链路
- 使用当前 integration 绑定的 vault secret；`corpsecret` 只由 notification-runtime 通过 Console Vault 解析，不接受前端传入 secret
- 必须已配置 `notification.runtimeApiUrl`；Console 只使用绑定 `sourceAppCode=console` 的短期 service token 调用 notification-runtime，不再直连企业微信发送消息

请求体建议：

```json
{
  "integrationCode": "wecom.default",
  "touser": "zhangsan",
  "requestKey": "6e04ad55-2bb3-4db0-a452-ecf093f766b4"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "integrationCode": "wecom.default",
    "touser": "zhangsan",
    "status": "sent",
    "sentAt": "2026-06-14T10:30:00.000Z",
    "deliveryMode": "notification-runtime",
    "messageCenter": {
      "logged": true,
      "notificationId": "notif_3a0f..."
    }
  }
}
```

说明：

- `touser` 是企业微信通讯录中的 UserID / 账号
- `requestKey` 是每次用户发起测试时生成、HTTP 重试时保持不变的请求级幂等键
- runtime 模式下由 notification-runtime 读取 `config.corpid`、`config.agentid` 与当前凭证并发送 textcard 测试消息
- Cloudflare 部署建议将企业微信 `corpsecret` 保存为 vault `db_encrypted`；如果仍使用 `env_ref=WECOM_CORPSECRET`，必须确保 Console Worker 运行环境也配置该 secret，否则 runtime 解析凭证仍会失败
- 发送成功或失败都会写入 `integration_check_logs(check_type='wecom_test_message')`，并更新 `integrations.connectivity_status / last_checked_at / last_error_message`
- 发送成功或失败都会尽量向当前操作者写入一条 Console 统一消息中心通知，并在 `portal_notification_deliveries` 记录 `wecom` 通道投递结果；该记录用于通知抽屉展示测试结果，不代表 notification-runtime 自身保存消息

## 5.8 Actionable 待办投影

- `GET /api/v1/console/notifications/todos` 使用当前用户会话，仅返回该 UID 的 pending actionable 安全信封列表。支持 `todoKind=approval|due|risk|follow_up`、`category`、`sourceAppCode`、`limit=1..100` 和 opaque `cursor`。
- 列表项仅包含 `notificationId / sourceAppCode / targetAppCode / todoKind / category / severity / displayLabel / createdAt / updatedAt`；不返回 `actionUrl / bizType / bizId / businessKey / actionableKey / raw metadata`。点击时必须继续用 `notificationId` 调用通知详情代理并重新执行来源授权。
- `GET /api/v1/console/notifications/todos/summary` 使用当前用户会话，只返回该 UID 的 `totalPending / approvalPending / followUpPending`。
- `POST /api/v1/console/notifications/actionable-lifecycle` 使用 `aud=notifications`、`scope=notifications:publish` 的 service token。服务身份 `appCode` 必须等于请求 `sourceAppCode`。
- lifecycle 请求必须提供 `actionableKey / expectedVersion / nextVersion / state`，`state` 只允许 `resolved / cancelled`；可用显式 `recipients` 限定关闭范围，不接受 `@all`。
- `portal_notification_recipients` 继续只保存 unread/read/archive。当前待办独立保存在 `portal_actionable_projections`，以 `(uid, source_app_code, actionable_key)` 唯一。
- exact `(state,nextVersion)` 重放零写成功；expected version 不匹配、CAS 失败或不同请求命中终态均返回 409。终态 generation 不得复活，重新打开必须使用新的 `actionableKey`。
- 只有 canonical publish 真正新建通知时才允许首次创建 projection；同 key/hash replay 不写 recipient 或 projection。
- 所有 pending actionable 必须提供非空且格式合法的 `metadata.targetAppCode`，并在 `portal_actionable_projections.target_app_code` 以 NOT NULL 保存。历史空 target pending 行在迁移中先失败关闭为 cancelled，不根据来源应用或 URL 猜测目标路由。
- `sourceAppCode=workflow` 的 publish 保持既有 catalog binding；此外，任意 `metadata.actionableState='pending'` 的 publish 都必须在任何通知/projection 写入和 canonical request hash 计算前，用 Console 本地已验签 policy bundle 的 active `applications[].homeUrl` 将 `actionUrl` 绑定到受控统一的 `metadata.actionTargetAppCode / metadata.targetAppCode`。两个 alias 同时提供但不一致时失败关闭；Console 重写为同一小写 app code，并写入 `actionTargetCatalogBinding='catalog-v1'`。canonical absolute URL 必须与登记 origin 完全一致且 pathname 位于登记 home path 内；未知/inactive 应用、协议相对 URL、凭据 URL、危险协议、路径逃逸、错 origin/base path 或 target alias 冲突返回 HTTP 400 `invalid_action_target`。签名 application catalog 不可用返回 HTTP 503 `action_target_catalog_unavailable`。非 Workflow 的普通通知和 `resolved/cancelled` lifecycle publication 不读取 catalog。等价的 app-relative 与 deployment-prefixed 路径必须先归一为同一 URL，再参与 idempotency hash；pending projection 拒绝缺少该 Console-owned binding marker 或 alias 不一致的内部直写。
- 旧 pending projection 没有可验证的 catalog binding 证据，升级时必须先经批准执行 `console/docs/notification_actionable_catalog_binding_20260711.sql`：仅关闭缺少 `catalog-v1` marker 的 pending projection，不猜测 source、URL 或 target，不改 immutable notification/recipient 历史，也不得由应用启动或 Cloudflare 部署自动执行。
- `POST /api/v1/console/notifications/integration-operation-dead-letter` 的新 source 合同必须完整提供 `generation / operationVersion / actionableKey / objectVersion`；四项全部缺失仅作为 legacy 普通通知兼容，任意部分缺失返回 400，Console 不从 attempt count 或时间推导伪版本。新合同固定创建 pending actionable，`targetAppCode=sourceApp`，descriptor 为 `{resource:'integration_operation',id:operationId}`；不得持久化或返回 operation command、hash、raw error/response、token、internal URL 或 source `operationKey`。
- dead-letter 浏览器诊断 URL 只能把固定 Aims、Assets、Finance、People `/integration-operations` 或 Altoc `/admin/integration-operations` 相对路径绑定到 Console 已验签 application catalog 中该 source app 的 active `homeUrl`；不得使用服务调用 URL 或 appCode 猜测域名。目录不可用返回 503，错 origin/path 返回 400，且发生在通知写入前。
- dead-letter publish 返回实际 active recipients；Foundation 必须把非空、非 `@all`、无控制字符且有界的 `recipientUids` 与 notification ID 回写 source。source closure 使用冻结的 `actionableKey / expectedVersion / nextVersion / state` 调 lifecycle；Console 成功而 source ack 丢失时，同一 closure 重放必须零写成功。
- 用户读取 `integration_operation` 通知详情时，Console 在调用 Aims/Altoc/Assets/Finance/People 来源 verifier 前，先以当前 UID、source app、`integration_operations:view` 执行 fresh merged policy 与 active Directory 检查，禁用 simulation/privileged/cache。停用或撤权返回 restricted，Directory/Policy 不可用返回 unavailable，且均不得调用来源 verifier；来源 verifier 仍负责 operation generation、当前收件事实和 tenant/deployment/source 绑定。

---

## 6. Credential Vault

## 6.1 `GET /api/v1/console/vault/secrets`

响应建议：

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "secretCode": "gitlab.bot",
        "secretRef": "hzybase://vault/gitlab.bot",
        "secretName": "GitLab Bot Token",
        "secretType": "api_key",
        "usageType": "integration",
        "storageBackend": "db_encrypted",
        "maskedPreview": "glpat_****",
        "currentVersionNo": 4,
        "status": "active"
      }
    ]
  }
}
```

## 6.2 `POST /api/v1/console/vault/secrets`

请求体建议：

```json
{
  "secretCode": "gitlab.bot",
  "secretName": "GitLab Bot Token",
  "secretType": "api_key",
  "usageType": "integration",
  "storageBackend": "db_encrypted",
  "material": {
    "plaintext": "glpat_xxx"
  }
}
```

或：

```json
{
  "secretCode": "wecom.secret",
  "secretName": "WeCom Secret",
  "secretType": "client_secret",
  "usageType": "integration",
  "storageBackend": "k8s_secret",
  "material": {
    "backendSecretRef": "k8s://console/wecom-secret"
  }
}
```

说明：

- `storageBackend` 仅允许 `db_encrypted / env_ref / docker_secret / k8s_secret`
- `usageType` 允许 `integration / service / bootstrap / custody`
- `usageType=custody` 表示仅托管保管，默认禁止程序化 resolve
- 创建接口默认建立 `versionNo = 1` 且设为 current

## 6.3 `POST /api/v1/console/vault/secrets/:secretCode/versions`

用途：

- 追加新版本，但不强制切 current

请求体建议：

```json
{
  "storageBackend": "db_encrypted",
  "material": {
    "plaintext": "glpat_new"
  }
}
```

## 6.4 `POST /api/v1/console/vault/secrets/:secretCode/rotate`

用途：

- 创建新版本并立即切为 current

请求体建议：

```json
{
  "storageBackend": "db_encrypted",
  "material": {
    "plaintext": "glpat_rotated"
  }
}
```

## 6.5 `POST /api/v1/console/vault/secrets/:secretCode/reveal`

用途：

- 受控查看当前或指定版本明文

请求体建议：

```json
{
  "versionNo": 4,
  "reason": "manual_copy_for_break_glass"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "secretCode": "gitlab.bot",
    "versionNo": 4,
    "plaintext": "glpat_xxx",
    "revealedAt": "2026-04-23T10:40:00Z"
  }
}
```

说明：

- 该接口默认只给管理面
- 必须写 `vault_access_logs`

## 6.6 `POST /api/v1/console/vault/resolve`

用途：

- 服务间按 `secretCode` 或 `secretRef` 获取明文

请求体建议：

```json
{
  "secretCode": "gitlab.bot",
  "versionNo": 4,
  "purpose": "gitlab_sync"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "secretCode": "gitlab.bot",
    "versionNo": 4,
    "value": "glpat_xxx"
  }
}
```

说明：

- `resolve` 返回明文，但只允许服务间调用，调用方必须使用 Console OAuth2 `client_credentials` 换取 `audience=credential_vault` 且包含 `credential_vault:resolve` scope 的 service token
- 浏览器端不应直接获得该响应
- `usageType=custody` 的 secret 默认拒绝 resolve，只能通过受控 reveal 查看

---

## 7. Service Clients

## 7.1 `GET /api/v1/console/service-clients`

响应建议：

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "clientCode": "aims.runtime",
        "clientName": "Aims Runtime",
        "clientType": "app",
        "appCode": "aims",
        "currentCredential": {
          "clientId": "sc_aims_xxx",
          "versionNo": 2,
          "secretCode": "svc.aims.runtime",
          "status": "active"
        }
      }
    ]
  }
}
```

## 7.2 `POST /api/v1/console/service-clients`

请求体建议：

```json
{
  "clientCode": "aims.runtime",
  "clientName": "Aims Runtime",
  "clientType": "app",
  "appCode": "aims",
  "issueMode": "generate",
  "grants": [
    {
      "resourceCode": "base.settings",
      "action": "read",
      "scope": {
        "scopeType": "tenant"
      }
    },
    {
      "resourceCode": "base.integrations",
      "action": "read",
      "scope": {
        "types": ["gitlab"]
      }
    }
  ]
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "clientCode": "aims.runtime",
    "issuedCredential": {
      "clientId": "sc_aims_xxx",
      "clientSecretPlaintext": "sec_xxx",
      "versionNo": 1,
      "secretCode": "svc.aims.runtime"
    }
  }
}
```

说明：

- `clientSecretPlaintext` 只在签发时返回一次
- 后续仅能通过轮换重新获取新 secret

## 7.3 `POST /api/v1/console/service-clients/:clientCode/rotate`

请求体建议：

```json
{
  "issueMode": "generate",
  "reason": "credential_rotation"
}
```

或：

```json
{
  "issueMode": "bind_existing_secret",
  "secretCode": "svc.aims.runtime",
  "versionNo": 3,
  "reason": "manual_cutover"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "clientCode": "aims.runtime",
    "issuedCredential": {
      "clientId": "sc_aims_xxx",
      "clientSecretPlaintext": "sec_new_xxx",
      "versionNo": 3,
      "secretCode": "svc.aims.runtime"
    }
  }
}
```

约束：

- v1 不支持旧新凭证并行 active
- 若选择 `generate`，服务端应同时完成 vault 建档 / 新版本入库 / current 切换

## 7.4 `GET /api/v1/console/service-clients/:clientCode/grants`

响应建议：

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "resourceCode": "base.settings",
        "action": "read",
        "scope": {
          "scopeType": "tenant"
        },
        "status": "active"
      }
    ]
  }
}
```

## 7.5 `PUT /api/v1/console/service-clients/:clientCode/grants`

请求体建议：

```json
{
  "items": [
    {
      "resourceCode": "base.settings",
      "action": "read",
      "scope": {
        "scopeType": "tenant"
      }
    },
    {
      "resourceCode": "base.integrations",
      "action": "read",
      "scope": {
        "types": ["gitlab"]
      }
    }
  ]
}
```

说明：

- v1 建议按“整集覆盖”处理，避免 grant 级增量 PATCH 复杂化

## 7.6 `console.runtime` 内部 bootstrap 契约

`console.runtime` 不提供返回 client secret 的公网 API。Console 本地 service-token issuer 在首次需要跨服务 token 时执行内部 bootstrap，并保证：

- service client 固定为 `client_code=console.runtime`、`app_code=console`、`status=active`；
- 复用已有 active、未过期的 current credential，重复执行不轮换；
- 仅在 credential 缺失时生成随机 secret，并直接以 `db_encrypted` 写入 Vault；响应、日志和 SQL 均不得包含明文；
- JWT 必须签入真实 `client_id`、非零 `hzy.credentialId`、`token_use=service`、source app `console`、tenant、deployment 和请求 scope；
- bootstrap 必须补齐 Workflow、Aims、Assets、People、Finance、Altoc 通知详情重验所需的 `<source-app>:notification-details:authorize` grants；Assets descriptor 固定为 metadata `authorizationDescriptor:{resource:'asset_item'|'ip_asset'|'customer_delivery_asset'|'offboarding_recovery_case',id:objectCode}`，People 固定为 `{resource:'offboarding_task',id:taskCode}`，Finance 固定为 `{resource:'invoice_request',id:requestCode}` 或 `{resource:'finance_receipt',id:receiptCode}`，Altoc 固定为 `{resource:'receivable_plan',id:planCode}`，必须与 `bizType/bizId` 精确一致且不得有额外字段；Assets/People/Finance/Altoc 只使用来源直接精确 tuple 判定，不在 Console 进入 scoped challenge；
- active credential/grant 被撤销时返回 401；数据库、JWKS、Vault 或控制面故障返回可重试 503；已验证身份缺 scope 返回 403。

部署使用 `console/docs/sql/Console-SQL-Seed-v1.37-console-runtime-identity.sql` 补基础 metadata/grants，并依次使用 repeatable v1.38-v1.40 seed/verify 增补 People、Finance、Altoc 通知详情 grant；People → Assets 离职回收投影另执行 secret-free v1.41 seed/verify，授予现有 active People service client 精确 `assets:offboarding-recovery:sync`。seed 不创建或轮换 credential，缺少 `HZY_CONSOLE_VAULT_MASTER_KEY` 属于 issuer bootstrap 前置条件失败。

## 产品中心原用户范围授权（开发中）

`POST /api/v1/console/service/authorization/subject-scoped` 要求 `aud=console`、精确 `console:subject-authorization:read`、已验证服务主体和 Console runtime tenant/deployment 绑定。请求仅 `{subjectUid,purpose}`，不接受 query、资源、动作或模拟参数。固定用途由 Console subjectScopedAuthorizationContract 维护：AIMS 反馈创建及 Assets 两类采用对象查看。

用户必须在 Directory 中 active；按原 UID 加载 fresh merged scoped grants，禁用所有模拟并绕过 snapshot cache。返回 `{code:0,data:{uid,appCode,purpose,resourceCode,action,authorizationMode,policyRevision,bundleVersion,grants,actionPolicy}}`，无角色列表；业务对象授权仍由目标业务应用执行。不存在／停用用户返回 403，Directory／policy 不可用返回 503，错误 snapshot 身份拒绝。调用方必须先验证自身接收的签名用户委托，不得从浏览器任意指定 subjectUid。

当前入口与能力声明已实现；调用方 grants、Foundation 客户端及真实租户联调尚未完成，不代表业务链路已启用。

## 7.7 `POST /api/v1/console/service/authorization/subject-eligibility`

Purpose-bound 的目标应用用户资格检查。仅接受 `aud=console`、scope `console:authorization:subject-eligibility` 的 service JWT，并要求 `source_app` 与 `hzy.appCode` 双 claim 一致、`target_app=console`、tenant/deployment 完整且与可信 Console runtime binding 一致。请求体只允许 `{subjectUid,purpose}`；调用方应用、tenant/deployment 及固定 `resource:action` 均由已验证身份、runtime binding 和 Console registry 派生，拒绝 app/resource/action/object/scope/simulation/role/tenant/deployment override。该 audience 与目标应用一致，且 scope 以 `console:` 开头，满足 Console service-token 签发器的 audience/scope 绑定。

Registry 登记现有责任通知目标：Aims `response_due / resolution_due / work_item_due → work_items:view`；Assets `resource_expiry → asset_items:view`、`ip_expiry → ip_assets:view`、三类 delivery purpose → `deliveries:view`、`offboarding_unrecovered → offboarding_recoveries:view`；People 两类 offboarding purpose → `offboarding_tasks:view`；Finance `invoice_issuance_due → invoices:view`、`receipt_reconciliation_due → receipts:view`；Altoc `receivable_plan_due → receivable:view`。Workflow 只允许服务端按可信 event 与 task/instance 身份派生 `task_actionable → workflow_tasks:view`、`instance_actionable / instance_status → workflow_instances:view`，并按受信代理路由派生 `task_approve/task_reject/task_delegate → workflow_tasks:approve|reject|delegate` 与 `instance_cancel/instance_resubmit → workflow_instances:cancel|resubmit`。跨模块静态合同直接读取 producer stream union、Workflow 固定动作及对应 manifest，要求每个 registry 目标的资源与动作均已声明。Console 先要求 Directory `status` 显式为 `active`，再使用 fresh normal merged policy snapshot，忽略 simulation session 并绕过 30 秒 snapshot cache。managed cloud 刷新失败、Directory/Policy 不可用返回 503；inactive 或无有效权限返回 200。响应设置 `Cache-Control: no-store`，且仅包含 `{active,allowed,reason,policyRevision}`。`subjectUid` 必须是 64 字符以内的单一用户 UID，拒绝控制字符、`@all` 以及明显 system/service principal；purpose 只允许 1–64 位小写字母、数字、下划线或连字符。

Aims、Assets、People、Finance、Altoc 的 due/offboarding drain 已在旧 UID projection closure 之后、publish/ack 之前执行该检查；negative 或依赖不可用均不 publish、不 ack，并保留重试。Workflow 对全部去重收件人执行检查，单 task 使用 canonical task URL，并行多 task 使用 canonical instance URL，状态事件使用 instance URL；任一收件人不合格或检查不可用则整条通知保持失败，业务 target 只保留为事实，不再作为实际点击授权目标。初始化需执行 secret-free、repeatable v1.42 seed/verify；存量 Workflow 缺失或需要补齐审批动作 purpose 时执行 v1.97 Workflow 专用 seed/verify。两者均不创建或旋转 credential，也不能由应用代码自动执行。

## 7.8 `GET /api/v1/console/service/authorization/role-holders`

供 Aims 和 Workflow 读取公司级唯一 `project_director` / `qa` 当前持有人。仅接受 `aud=console`、精确 scope `console:authorization-role-holders:read` 的 active service JWT，并要求 source/target app、tenant、deployment 与可信 Console runtime binding 一致；调用方不得使用浏览器会话或管理员人类权限替代。

Query `roleCodes` 可省略，省略时返回两类角色；显式值只能是逗号分隔的 `project_director,qa` 子集。接口从当前已验签 policy bundle 的有效 user `roleAssignments`、`subjects` 和 `roleHolderRevisions` 解析，managed cloud 每次先刷新当前租户 bundle，忽略所有角色/用户模拟并设置 `Cache-Control: no-store`。

`holders[].uid` 固定使用 Platform 用户主体的 `subjectCode`，与 Console 会话及下游应用用户 UID 一致；`subjects[].externalRef` 仅标识上游目录同步记录，可能为不透明哈希，不得作为应用用户 UID。

每个角色返回：

```json
{
  "roleCode": "project_director",
  "revision": 3,
  "policyRevision": 17,
  "status": "resolved",
  "errorCode": null,
  "holders": [{ "uid": "director-uid", "displayName": "项目总监" }]
}
```

只有恰好一个 active user holder 时 `status=resolved`。0 人返回 `missing/role_holder_missing`，多人脏数据返回 `ambiguous/role_holder_ambiguous`；接口不会选择数组第一项或回退系统管理员。依赖、bundle 或 runtime binding 不可验证时返回 503。Aims/Workflow 必须对非 resolved 结果失败关闭。服务授权由 v1.87 seed/verify 初始化。

---

## 8. Auth Runtime / OIDC

本节定义 `console` 作为企业侧应用用户 auth-runtime / OIDC IdP 的第一版接口边界。Platform 只治理控制面账户、授权、license、bundle 与 runtime token；业务应用用户的登录会话、上游身份源适配、refresh token 与 OIDC client secret 均由 `console` 本地持有。

### 8.1 协议定位

认证链路：

```text
LDAP / AD / CAS / 企业微信 / 钉钉 / 通用 OIDC / 本地账号
  -> console.auth-runtime
  -> OIDC Authorization Code + PKCE
  -> aims / codocs / other apps
```

约束：

- 业务应用不得直接接 CAS / 企业微信 / LDAP。
- 新应用统一接 `console` OIDC issuer。
- Platform 下发的 bundle `applications` 投影是 `auth_clients` 的默认事实来源，字段至少包含 `appCode / appName / description / icon / homeUrl / callbackUrl / logoutUrl / authMode / sortOrder / status`。
- `console` 可对 redirect URI 做本地安全覆盖，但不得另起一套应用注册事实源。

### 8.2 OIDC Discovery

#### `GET /.well-known/openid-configuration`

响应建议：

```json
{
  "issuer": "https://console.example.com",
  "authorization_endpoint": "https://console.example.com/oauth/authorize",
  "token_endpoint": "https://console.example.com/oauth/token",
  "userinfo_endpoint": "https://console.example.com/oauth/userinfo",
  "jwks_uri": "https://console.example.com/.well-known/jwks.json",
  "revocation_endpoint": "https://console.example.com/oauth/revoke",
  "end_session_endpoint": "https://console.example.com/oauth/logout",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "code_challenge_methods_supported": ["S256"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["EdDSA"]
}
```

#### `GET /.well-known/jwks.json`

返回当前可用于验签的 Console IdP 公钥。JWKS 必须同时支持 `current / next / retired` 宽限发布，旧 key 至少保留到最大 token TTL 后再退役。

### 8.3 OIDC 登录与 Token

#### `GET /oauth/authorize`

用途：启动 Authorization Code + PKCE 登录。

请求参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `client_id` | 是 | 业务应用 client，默认等于 `appCode` |
| `redirect_uri` | 是 | 必须 exact match 白名单 |
| `response_type` | 是 | 仅支持 `code` |
| `scope` | 是 | 至少包含 `openid` |
| `state` | 是 | 调用方 CSRF 防护 |
| `nonce` | 建议 | 进入 ID token |
| `code_challenge` | 是 | PKCE challenge |
| `code_challenge_method` | 是 | 仅支持 `S256` |

行为：

1. 校验 client 状态、redirect URI、scope、PKCE 参数。
2. 若当前无有效 `local_sessions`，跳转到 Console 登录入口并携带原始 authorize 请求。
3. 登录完成后签发一次性 authorization code。
4. 通过 `redirect_uri?code=...&state=...` 返回业务应用。

#### `POST /oauth/token`

用途：code 换 token、refresh token，或为本地 service client 签发短期服务访问令牌。

支持 grant：

- `authorization_code`
- `refresh_token`
- `client_credentials`

响应建议：

```json
{
  "access_token": "eyJ...",
  "id_token": "eyJ...",
  "refresh_token": "hzy_rt_xxx",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_expires_in": 28800
}
```

约束：

- authorization code 只能使用一次，落库只保存 hash。
- refresh token 必须 rotation，落库只保存 hash。
- `refresh_expires_in` 表示 refresh token 剩余有效秒数；不得超过其绑定的 Console `local_session` 剩余有效期，避免 Session 已到期但业务应用仍反复尝试刷新。
- refresh token reuse 命中后撤销同一 token family。
- `client_credentials` 的 `client_id / client_secret` 来自 `service_client_credentials`；请求必须携带 `audience`，`scope` 必须匹配 `service_client_grants`。
- service token 只返回 `access_token`，不返回 `id_token / refresh_token`；JWT 使用 `token_use=service`、`sub=client:{clientCode}`、`aud={targetAppCode}`。

#### `GET /oauth/userinfo`

鉴权：`Authorization: Bearer <access_token>`。

默认只返回最小资料：

```json
{
  "sub": "user:dongxin",
  "uid": "dongxin",
  "tenant": "wiztek"
}
```

当 scope 允许时，可返回 `name / email / picture` 等展示字段；这些字段以 Console Directory 为权威源，不写入 Platform。

#### `POST /oauth/revoke`

用途：撤销 refresh token 或 access token 对应的 session/token family。

语义：撤销 refresh token 时撤销同一 token family；撤销 access token 时撤销其 `sid` 对应的 Console session，并同步撤销该 session 下仍有效的 refresh token。

#### `GET /oauth/logout`

用途：RP-initiated logout / Console 本地 session 退出。

语义：清理 Console 本地 session，并同步撤销该 session 下发给各 OIDC client 的 refresh token。业务应用侧应在本地 access token 过期时先尝试 refresh；refresh 失败表示用户已全局退出或 session 已失效，应清理本地 Cookie 并停留在退出状态。

支持参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `post_logout_redirect_uri` | 否 | 必须匹配 client 白名单 |
| `id_token_hint` | 否 | 用于定位 session / client |
| `state` | 否 | 登出后原样返回 |

### 8.4 Console Auth API

#### `GET /api/v1/console/auth/me`

用途：Console 自身、Foundation adapter 与迁移期兼容层读取当前用户。

响应建议：

```json
{
  "code": 0,
  "data": {
    "authenticated": true,
    "session": {
      "sid": "sess_xxx",
      "expiresAt": "2026-04-29T12:00:00Z"
    },
    "subject": {
      "subjectType": "user",
      "subjectCode": "dongxin",
      "uid": "dongxin"
    },
    "directory": {
      "displayName": "董欣",
      "avatarUrl": null,
      "primaryDeptCode": "AF"
    }
  }
}
```

说明：

- `subject` 是鉴权语义。
- `directory` 是展示语义，可随 Directory API 字段扩展。
- `directory.mobileTail4` 仅向当前已验证会话本人返回四位数字或 `null`，用于文档水印；不返回完整手机号，也不加入跨应用共享用户投影。每次请求从当前 Directory 用户解析，已有有效会话无需重新登录即可读取同步后的尾号。

#### `POST /api/v1/console/auth/logout`

用途：撤销当前 `local_sessions`，清理 Console 登录 Cookie，并写审计。

### 8.5 Token Claims

MVP access token / ID token claims：

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

不允许放入 token：

- 真实姓名、邮箱、手机号、部门名
- 角色明细、权限明细、scope 明细
- refresh token 或其他长期凭证

### 8.6 Auth 错误码建议

| 错误码 | 含义 |
|---|---|
| `AUTH_LOGIN_REQUIRED` | 当前无有效 Console session |
| `AUTH_INVALID_CLIENT` | client 不存在或不可用 |
| `AUTH_INVALID_REDIRECT_URI` | redirect URI 不匹配 |
| `AUTH_INVALID_SCOPE` | scope 不允许 |
| `AUTH_INVALID_GRANT` | code / refresh token 无效、过期或已使用 |
| `AUTH_PKCE_VERIFICATION_FAILED` | PKCE 校验失败 |
| `AUTH_TOKEN_REUSE_DETECTED` | refresh token reuse 命中 |
| `AUTH_SESSION_REVOKED` | session 已撤销 |

---

## 9. Account 管理面兼容接口

迁移期 Console 承接 Account 系统管理中的企业业务领域、区域和日志管理页面。以下接口保留 Account 管理面使用的响应结构，但数据源落到 Console 本地表。

### 9.1 业务领域

- `GET /api/v1/companies/:companyCode/business-domains`
- `POST /api/v1/companies/:companyCode/business-domains`
- `PATCH /api/v1/companies/:companyCode/business-domains/:domainCode`
- `DELETE /api/v1/companies/:companyCode/business-domains/:domainCode`

说明：

- `companyCode` 通过 `org_profiles.tenant_code` 校验；Console v1 仍是单企业实例。
- `POST / PATCH / DELETE` 写接口在读取请求体或修改 `org_business_domains` 前要求当前用户具备 `system_settings:edit`。
- 数据源为 `org_business_domains`，对前端返回 Account 兼容字段：`domainCode / domainName / category / aliasName / displayName / source / sortOrder`。
- `source='preset'` 表示从标准领域字典选择，`source='custom'` 表示企业自建。

### 9.2 区域管理

- `GET /api/v1/companies/:companyCode/regions`
- `POST /api/v1/companies/:companyCode/regions`
- `POST /api/v1/companies/:companyCode/regions?fromTemplate=STANDARD_7`
- `PATCH /api/v1/companies/:companyCode/regions/:regionCode`
- `DELETE /api/v1/companies/:companyCode/regions/:regionCode`
- `GET /api/v1/companies/:companyCode/regions/:regionCode/divisions`
- `PUT /api/v1/companies/:companyCode/regions/:regionCode/divisions`

说明：

- 数据源为 `regions` 与 `region_divisions`。
- `POST / PATCH / DELETE / PUT divisions` 写接口在读取请求体、初始化模板或修改区域/行政区划前要求当前用户具备 `system_settings:edit`。
- 标准模板初始化会幂等创建华北、东北、华东、中南、西南、西北、港澳台七大区。

### 9.3 日志查询

- `GET /api/v1/login-logs`
- `GET /api/v1/operation-logs`
- `GET /api/v1/heartbeat/online`

说明：

- 登录日志读取 `auth_login_events`，兼容返回 `login_result: 1 | 0`。
- 操作日志读取 `operation_logs`，兼容返回 `source_app / session_id / detail / ip_address`。
- 在线用户读取 Console runtime heartbeat 兼容表。

### 9.4 Platform runtime 配置兼容读取

- `POST /api/v1/platform-runtime/config`

说明：

- 该接口仅用于历史 Foundation Platform activation 兼容读取 Console 自身的 Platform runtime 配置；新业务应用通过 runtime/app identity 与 Foundation `requestServiceAccessToken()` 获取短期 service token，不得再使用 app-level bootstrap。
- `/api/v1/console/bootstrap/token` 仅保留给已部署的 legacy 客户端：即使 runtime config 为兼容发现而返回该 URL，也只返回 URL，绝不返回 access key 或 secret。调用者必须同时提供有效 license 和与 Vault `bootstrap.{deploymentCode}.access_key` 精确匹配的 access key；缺失或错误 key 在读取 service client、grant 或签发 token 前返回 401。
- 请求必须携带 Console deployment 的 `licenseToken`，且 token 中的 `tenantCode`、`appCode=console`、`deploymentCode`、`kid`、签名和有效期均需匹配当前 Console runtime 配置；其他业务应用 license 不得换取 Console 的 `runtimeToken`。

---

## 10. 可见性与字段脱敏

默认列表 / 详情接口返回：

- `secretCode`
- `secretRef`
- `maskedPreview`
- `currentVersionNo`
- `expiresAt`
- `status`

默认不返回：

- `plaintext`
- `ciphertextBlob`
- `backendSecretRef`
- `kmsKeyRef`

仅以下动作允许明文进入响应：

- `POST /vault/secrets/:secretCode/reveal`
- `POST /vault/resolve`
- `POST /service-clients`
- `POST /service-clients/:clientCode/rotate`（仅 `issueMode=generate`）

---

## 11. 写入不变量

服务端写入流程必须保证：

1. `org_profiles` 始终只有一行  
2. `integration.current_credential_id` 与 `service_client.current_credential_id` 只能指向同归属对象  
3. 同一 `integration` / `service_client` 同时最多一条 `status='active'` 记录  
4. vault 版本链、integration 凭证链、service client 凭证链不能跨对象串链  
5. 任何 reveal / resolve 都必须写访问审计  
6. auth code、refresh token、session id 等高敏凭证落库只能保存 hash
7. OIDC redirect URI 必须 exact match，不允许通配符
8. signing private key 不得进入普通配置表，必须放入 vault 或外部 secret backend
9. `usageType=custody` 的托管凭证默认不得被 `/vault/resolve` 返回明文，只能通过受控 reveal 流程查看
10. 业务模块不得直接依赖 `integration_credentials`、内部 credential id 或 `/vault/resolve`；Nuxt 业务模块必须通过 Foundation adapter 按 `integrationCode` 消费集成能力

---

## 12. 版本策略

- 当前契约版本：`base.v1`
- v1 允许新增响应字段，但不允许删除既有字段
- 若未来支持并行 active credential、多条 role 凭证、外部 vault provider 直连，应升级为 `base.v2`

---

## 13. Directory Connector 与 LDAP 托管写入

### 13.1 Enrollment 与 service API

- `POST /api/v1/console/directory-connectors/enroll`：兑换 Platform 签名、单次、短期 enrollment token；返回一次性 Connector client credential。
- `POST /api/v1/console/service/directory-connector/register`
- `GET /api/v1/console/service/directory-connector/configuration`
- `POST /api/v1/console/service/directory-connector/commands/lease`
- `POST /api/v1/console/service/directory-connector/commands/{operationId}/complete`
- `POST /api/v1/console/service/directory-connector/sync`

service API 只接受 `aud=console`、`token_use=service`、精确 tenant/deployment 绑定及
`console:directory-connector:{configure,execute,sync}` capability。Enrollment API 不接受普通
浏览器授权替代签名 token。

### 13.2 管理与自助 API

- `POST /api/v1/console/directory/users`：`provisioningTarget=ldap` 时返回 HTTP 202 与 operation ID。
- `GET /api/v1/console/directory/operations/{operationId}`：仅原始操作用户可读取状态。
- `GET /api/v1/console/directory/provisioning`：返回 managed LDAP 与 Connector readiness。
- `GET /api/v1/console/directory/me/password-capability`
- `POST /api/v1/console/directory/me/password`：验证当前 LDAP 密码后异步修改，返回 HTTP 202。
- `PUT /api/v1/console/directory/me/avatar`：当前登录用户上传或替换头像。请求为
  `multipart/form-data`，文件字段名固定为 `avatar`；仅接受经文件头校验的 PNG、JPEG、WebP，
  最大 3MB。文件以 tenant、uid 和内容哈希组成的不可变路径写入 `oss.default`，随后仅更新
  当前用户的 `directory_users.avatar_url`。目录源同步不得覆盖已有的自助头像。

LDAP 初始密码、当前密码和新密码不得以明文字段进入 durable command、数据库日志或响应；
统一使用 Connector 注册 RSA 公钥的 OAEP-SHA256 密文。LDAP bind password 可用 Console Vault
`db_encrypted` 由租户页面录入，或沿用受支持的外部 secret 引用。

### 13.3 People 受控入职 service API

- `POST /api/v1/console/service/directory/onboarding/identity-reservations`
- `POST /api/v1/console/service/directory/onboarding/identity-reservation-release`
- `POST /api/v1/console/service/directory/onboarding/user-provision`
- `POST /api/v1/console/service/directory/onboarding/operation-status`
- `POST /api/v1/console/service/directory/onboarding/activation-link`

全部接口要求 `aud=console`、精确 capability、People→Console deployment HMAC 以及一致的 `actorUid / originalActorUid`。Console 向 tenant-runtime 转发时以 purpose-bound runtime actor 重签原始 HR，不得退化成 service client 或空 actor。People 开户必须携带与 UID、邮箱、来源业务键及钉钉主体完全一致的 active reservation；排队成功后只消费该 reservation。

开户接口不签发激活凭据。只有 `operation-status=succeeded` 且 LDAP identity 已落地后，`activation-link` 才签发一次性令牌，并只向冻结的钉钉 `provider_subject` 投递带令牌 URL；站内通知仅保存无令牌入口。重复签发会撤销旧令牌，库中只保存 SHA-256。operation 状态读取和凭据签发同时按 operation ID、UID、`sourceApp=people` 与入职单 `sourceBizCode` 绑定；任一具备入职管理权限的 HR 可恢复，不绑定最初操作者。
## 部门编辑补充契约（2026-09-10）

`PATCH /api/v1/console/directory/departments/{deptCode}` 沿用目录部门编辑权限与 `Idempotency-Key`，请求体只发送变化字段；可空字段传 `null` 表示清空，省略表示保持不变。

钉钉映射部门默认拒绝修改名称、父级、负责人、排序、状态和类型，返回 `409 dingtalk_department_field_managed`。根公司例外只开放 `managerId`：要求 active 钉钉 identity 的外部部门 ID 为 `1`、canonical 部门 active 且为无父级的正式部门、上游 `manager_external_subject` 为空。仍校验负责人 UID，并沿用事务审计与 subject 投影；不修改来源标识或身份映射。若请求还包含其他受保护字段，整个请求失败。`leaderId` 仍由汇智云维护，可独立编辑。

后续钉钉同步在根公司未提供负责人时保留本地值；上游一旦提供负责人，则按原同步及 People lifecycle 回填重新接管。普通子部门的空负责人仍按上游清空。无数据库 schema、service capability 或 API 路径变更。


## 产品成员使用的最小目录状态投影

`GET /api/v1/console/service/directory/users?projection=active-status&uids=<uid1>,<uid2>` 复用 `console:directory-users:read` 与现有 source app／tenant binding 检查。仅支持 1～100 个显式 UID；不支持用空集合枚举人员。

返回 `{ code: 0, data: [{ uid, active }] }`，按请求 UID 去重，缺失用户同样返回 active=false；active 仅来自当前 Directory 状态，未知状态保守为 false。响应设置 Cache-Control: no-store；不返回姓名、电话、邮箱或用户权限。不改变普通共享身份／部门投影的字段。

Aims 调用该投影前必须已完成产品对象及 admin 动作授权；结果只作为短时成员有效性依据，不是任何应用角色或操作权限。客户端不得提交 active=true 来替代该调用。

## 退出后重新认证

退出页“重新登录”将 `prompt=login` 保留到 Console 登录入口并立即启动已配置的登录方式。显式重新认证时不因现有 Console 会话而直接返回应用；上游 OIDC 请求携带 `prompt=login&max_age=0`。服务端也对“有退出标记且 force=1”的显式登录执行同样处理。普通跨应用 SSO 不附加这两个参数，仍保留现有 state、nonce、PKCE 和回调校验。
