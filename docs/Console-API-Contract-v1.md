# Console API 契约 v1

状态：Draft  
日期：2026-06-17
定位：目标设计，作为 `Console-Functional-Design-v1.md` 与 `Console-SQL-DDL-Draft-v1.sql` 的配套接口文档

---

## 0. 文档目标

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
- 使用当前 integration 绑定的 vault secret 解析 `corpsecret`，不会接受前端传入 secret
- 如果已配置 `notification.runtimeApiUrl`，服务端优先调用客户侧 notification-runtime 发送；未配置时才回退 Console 直连企业微信 API

请求体建议：

```json
{
  "integrationCode": "wecom.default",
  "touser": "zhangsan"
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
- runtime 模式下由 notification-runtime 读取 `config.corpid`、`config.agentid` 与当前凭证并发送 textcard 测试消息
- Cloudflare 部署建议将企业微信 `corpsecret` 保存为 vault `db_encrypted`；如果仍使用 `env_ref=WECOM_CORPSECRET`，必须确保 Console Worker 运行环境也配置该 secret，否则 runtime 解析凭证仍会失败
- 发送成功或失败都会写入 `integration_check_logs(check_type='wecom_test_message')`，并更新 `integrations.connectivity_status / last_checked_at / last_error_message`
- 发送成功或失败都会尽量向当前操作者写入一条 Console 统一消息中心通知，并在 `portal_notification_deliveries` 记录 `wecom` 通道投递结果；该记录用于通知抽屉展示测试结果，不代表 notification-runtime 自身保存消息

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
  "expires_in": 3600
}
```

约束：

- authorization code 只能使用一次，落库只保存 hash。
- refresh token 必须 rotation，落库只保存 hash。
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
- 标准模板初始化会幂等创建华北、东北、华东、中南、西南、西北、港澳台七大区。

### 9.3 日志查询

- `GET /api/v1/login-logs`
- `GET /api/v1/operation-logs`
- `GET /api/v1/heartbeat/online`

说明：

- 登录日志读取 `auth_login_events`，兼容返回 `login_result: 1 | 0`。
- 操作日志读取 `operation_logs`，兼容返回 `source_app / session_id / detail / ip_address`。
- 在线用户读取 Console runtime heartbeat 兼容表。

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
