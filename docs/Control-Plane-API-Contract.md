# Control Plane API 契约 v1

状态：Draft  
日期：2026-04-27  
定位：目标设计，作为 `Huizhi-yun-Platform-Target-Architecture.md` 与 `Identity-Plane-Design.md` 的配套文档

---

## 0. 文档目标

本文档定义第一版 `Control Plane / Identity Plane` 对业务应用运行时与 Foundation SDK 暴露的核心接口契约，重点覆盖：

- 登录后获取平台 Token
- 拉取 Policy Bundle
- 拉取 Revocation List
- 上报 Heartbeat
- 查询应用与资源注册信息

本文档只定义：

- 接口职责
- 请求/响应结构
- 鉴权要求
- 版本策略

本文档不展开：

- 完整 OpenAPI
- 具体数据库实现
- 详细迁移脚本与灰度发布方案

---

## 1. 设计原则

| # | 原则 |
|---|------|
| A1 | 业务应用逐请求不回源 Control Plane |
| A2 | SDK 只做少量高价值调用：登录、取 bundle、取 revocation、发 heartbeat |
| A3 | 所有接口默认围绕 `deployment_id + tenant_code` 建模 |
| A4 | 平台返回可验证对象，业务侧本地验签执行 |
| A5 | 第一版优先 tenant 级 bundle，不做用户级增量 bundle |

---

## 2. 参与方

### 2.1 Browser

用户浏览器，只参与登录跳转与拿 token。

### 2.2 App Runtime

客户侧业务应用运行时，如：

- `aims`
- `codocs`
- `altoc`

### 2.3 Foundation SDK

业务应用依赖的运行时 SDK，负责：

- Token 验证
- Bundle 拉取与验证
- Revocation 拉取与缓存
- Heartbeat 上报

### 2.4 Control Plane / Identity Plane

平台侧统一服务，负责：

- Federation
- Token 签发
- Policy Bundle 分发
- Revocation 分发
- Heartbeat 接收

---

## 3. 核心对象

所有接口围绕以下对象展开：

- `deployment_id`
- `tenant_code`
- `subject_id`
- `session_id`
- `bundle_version`
- `revocation_version`
- `license_fingerprint`

---

## 4. 接口分组

第一版建议分成四组：

1. `Auth`
2. `Policy`
3. `Runtime`
4. `Registry`

---

## 5. Auth 接口

## 5.1 `POST /api/v1/auth/federation/callback`

用途：

- Federation 成功后，由 Identity Plane 完成 subject 映射并签发平台 token

说明：

- 这是平台内部登录闭环中的关键接口
- 对业务应用来说通常不直接调用，而是通过浏览器跳转链路触发

请求体建议：

```json
{
  "deploymentId": "dep_xxx",
  "tenantCode": "c000001",
  "idpType": "oidc",
  "assertion": "<opaque_assertion_or_code>",
  "relayState": "<opaque>"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<opaque_or_jwt>",
    "sessionId": "sess_xxx",
    "subjectId": "sub_xxx",
    "tenantCode": "c000001",
    "policyVersion": "pv_20260421_001",
    "expiresIn": 3600
  }
}
```

## 5.2 `POST /api/v1/auth/refresh`

用途：

- 使用 refresh token 刷新 access token

请求体建议：

```json
{
  "deploymentId": "dep_xxx",
  "tenantCode": "c000001",
  "refreshToken": "<opaque>"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<opaque>",
    "sessionId": "sess_xxx",
    "policyVersion": "pv_20260421_001",
    "expiresIn": 3600
  }
}
```

## 5.3 `POST /api/v1/auth/logout`

用途：

- 注销当前 session，并加入 revocation list

请求体建议：

```json
{
  "deploymentId": "dep_xxx",
  "tenantCode": "c000001",
  "sessionId": "sess_xxx"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "revoked": true
  }
}
```

---

## 6. Policy 接口

## 6.1 `GET /api/v1/policy/bundles/latest`

用途：

- 获取某 tenant 当前 deployment 环境的最新 bundle 元信息

鉴权方式：

- App Runtime 使用 `deployment_key` 或平台签发的 runtime credential

请求参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `deploymentId` | 是 | 部署实例 |
| `tenantCode` | 是 | 租户 |
| `appCode` | 否 | 第一版可选，暂主要返回当前 deployment 环境 bundle |

请求头：

| Header | 必填 | 说明 |
|---|---|---|
| `If-None-Match` | 否 | 传入上一版 `bundleHash` 对应的 ETag；一致时返回 `304 Not Modified` |

响应建议：

```json
{
  "code": 0,
  "data": {
    "tenantCode": "c000001",
    "bundleVersion": "pv_prod_20260421100000_0001",
    "bundleHash": "sha256_xxx",
    "downloadUrl": "/api/v1/policy/bundles/pv_20260421_001/download",
    "generatedAt": "2026-04-21T10:00:00Z",
    "signature": "<signature>",
    "kid": "psk_20260421_xxx",
    "alg": "Ed25519",
    "signedAt": "2026-04-21T10:00:00Z"
  }
}
```

## 6.2 `GET /api/v1/policy/bundles/:bundleVersion/download`

用途：

- 下载完整 Policy Bundle

请求头：

| Header | 必填 | 说明 |
|---|---|---|
| `If-None-Match` | 否 | 传入上一版 `bundleHash` 对应的 ETag；一致时返回 `304 Not Modified` |

响应建议：

```json
{
  "code": 0,
  "data": {
    "bundleVersion": "pv_20260421_001",
    "tenantCode": "c000001",
    "bundleHash": "sha256_xxx",
    "bundle": {
      "applications": [],
      "manifestResources": [],
      "manifestActions": [],
      "subjects": [],
      "roles": [],
      "rolePermissions": [],
      "permissionTemplates": [],
      "templateRoles": [],
      "templateBindings": [],
      "templateOverrides": [],
      "roleScopes": [],
      "capabilities": []
    },
    "signature": "<signature>",
    "kid": "psk_20260421_xxx",
    "signedByKid": "psk_20260421_xxx",
    "alg": "Ed25519",
    "signedAt": "2026-04-21T10:00:00Z",
    "generatedAt": "2026-04-21T10:00:00Z"
  }
}
```

说明：

- bundle 采用全量 tenant + environment 级快照；同一租户的生产/测试 deployment 会命中不同 bundle target。
- 客户侧 SDK 必须自行校验 `bundleHash` 与 `signature`
- `bundleHash` 同步作为响应 `ETag`，下载方可用 `If-None-Match` 做增量拉取短路。
- runtime 便捷路径 `GET /api/v1/runtime/deployments/:deploymentCode/bundle` 支持 `version` / `bundleVersion` 查询参数；不传时返回 latest 全量 bundle。

## 6.3 `GET /api/v1/policy/bundles/current`

用途：

- 给已登录用户返回“当前 token 对应的 policy version 摘要”

鉴权方式：

- 用户 access token

响应建议：

```json
{
  "code": 0,
  "data": {
    "subjectId": "sub_xxx",
    "tenantCode": "c000001",
    "policyVersion": "pv_20260421_001",
    "capabilityHash": "caps_xxx"
  }
}
```

---

## 7. Revocation 接口

## 7.1 `GET /api/v1/revocations/latest`

用途：

- 获取最新 revocation 元信息

请求参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `deploymentId` | 是 | 部署实例 |
| `tenantCode` | 否 | 租户，若为空则按 deployment 级 |
| `sinceVersion` | 否 | 客户端当前版本 |

响应建议：

```json
{
  "code": 0,
  "data": {
    "revocationVersion": "rv_20260421_003",
    "downloadUrl": "/api/v1/revocations/rv_20260421_003/download",
    "generatedAt": "2026-04-21T10:05:00Z"
  }
}
```

## 7.2 `GET /api/v1/revocations/:revocationVersion/download`

用途：

- 下载 revocation list

响应建议：

```json
{
  "code": 0,
  "data": {
    "revocationVersion": "rv_20260421_003",
    "entries": [
      {
        "targetType": "session",
        "targetId": "sess_xxx",
        "reason": "logout",
        "revokedAt": "2026-04-21T10:04:00Z"
      }
    ],
    "signature": "<signature>"
  }
}
```

第一版支持的 `targetType`：

- `session`
- `bundle`
- `license`
- `deployment`

---

## 8. Runtime 接口

## 8.1 `POST /api/v1/runtime/heartbeat`

用途：

- 客户侧 runtime 周期上报心跳
- 客户侧 runtime 启动或升级后上报当前版本摘要
- 平台返回最新策略、吊销和 license 状态

鉴权方式：

- runtime credential

请求体建议：

```json
{
  "deploymentId": "dep_xxx",
  "tenantCode": "c000001",
  "appCode": "aims",
  "appVersion": "1.2.0",
  "manifestVersion": "1.2.0",
  "manifestHash": "sha256_xxx",
  "sdkVersion": "1.8.0",
  "currentBundleVersion": "pv_20260421_001",
  "currentRevocationVersion": "rv_20260421_001",
  "licenseFingerprint": "lic_xxx",
  "coarseMetrics": {
    "dau": 83,
    "storageGb": 125
  }
}
```

若 deployment 对应 `service_role='directory_runtime'`，允许额外上报：

```json
{
  "directoryContractVersion": "dir.v1",
  "directorySnapshotHash": "sha256_xxx",
  "directorySyncCursor": "cursor_20260423_001",
  "directoryUserCount": 1280,
  "directoryDepartmentCount": 42,
  "directoryProjectCount": 166,
  "directorySyncLagSeconds": 18,
  "directorySyncAt": "2026-04-23T10:10:00Z"
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "serverTime": "2026-04-21T10:10:00Z",
    "licenseStatus": "active",
    "graceDeadline": "2026-04-28T10:10:00Z",
    "versionStatus": "current",
    "latestBundleVersion": "pv_20260421_002",
    "latestRevocationVersion": "rv_20260421_003",
    "actions": [
      {
        "type": "download_bundle",
        "version": "pv_20260421_002"
      },
      {
        "type": "download_revocations",
        "version": "rv_20260421_003"
      }
    ]
  }
}
```

说明：

- `runtime/heartbeat` 是 deployment 级运行时报到与心跳接口，不是 manifest 注册接口。
- 业务应用启动时只上报 `appVersion / manifestVersion / manifestHash / sdkVersion`，不得创建新的 manifest registration。
- manifest 注册应由发布流程、管理员操作或专用 CLI/API 触发，并使用 app-scope 凭证治理。
- `directory_runtime` 通过同一 heartbeat 接口上报目录契约版本、同步游标、规模摘要与 lag；平台只接收摘要，不接收目录明细。

## 8.2 `GET /api/v1/runtime/license/status`

用途：

- 查询当前 deployment 的 license 状态
- 主要给管理后台和诊断工具使用

响应建议：

```json
{
  "code": 0,
  "data": {
    "deploymentId": "dep_xxx",
    "status": "active",
    "softExpiry": "2026-05-31T23:59:59Z",
    "hardExpiry": "2026-06-30T23:59:59Z",
    "graceDays": 7
  }
}
```

---

## 8.3 `POST /api/v1/runtime/subjects/sync`

用途：

- Console 启动时把本地 `directory_subject_exports` 最小投影同步到 Platform
- Platform 幂等 upsert 到 `tenant_subjects`
- 更新 deployment 的目录同步摘要字段

鉴权方式：

- runtime credential：`Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN`
- 请求必须携带 `tenantCode` 与 `deploymentId`，Platform 先校验 deployment 归属，再校验租户级 runtime token hash

请求体建议：

```json
{
  "tenantCode": "c000001",
  "deploymentId": "console-c000001",
  "cursor": "dirsync_20260427_001",
  "snapshotHash": "sha256_xxx",
  "items": [
    {
      "subjectType": "department",
      "subjectCode": "dept_root",
      "externalRef": "dept:root",
      "parentSubjectType": null,
      "parentSubjectCode": null,
      "status": "active",
      "snapshotHash": "sha256_item"
    },
    {
      "subjectType": "user",
      "subjectCode": "u_001",
      "externalRef": "uid:001",
      "parentSubjectType": "department",
      "parentSubjectCode": "dept_root",
      "status": "active",
      "snapshotHash": "sha256_item"
    }
  ],
  "memberships": [
    {
      "subjectType": "user",
      "subjectCode": "u_001",
      "containerSubjectType": "department",
      "containerSubjectCode": "committee_arch",
      "relationType": "member",
      "isPrimary": false,
      "status": "active"
    }
  ]
}
```

响应建议：

```json
{
  "code": 0,
  "data": {
    "tenantCode": "c000001",
    "deploymentId": "console-c000001",
    "receivedCount": 2,
    "acceptedCount": 2,
    "skippedCount": 0,
    "upsertedCount": 2
  }
}
```

说明：

- MVP 接受 `user / department / committee / job` 四类 subject；其中 `committee` 仅作为目录容器与同步事实，不作为应用授权主体展示。
- 请求不得包含姓名、邮箱、手机号等目录 PII。Platform 对 `user` 强制写入 `display_name = NULL`；`department/committee/job` 当前以 `subjectCode` 作为非敏感展示占位。
- `memberships` 用于表达用户与部门/委员会等容器的多归属关系；`tenant_subjects.parent_subject_id` 只保留单父级主树，不承载委员会成员关系。
- 该接口是 Console 启动期一次性同步入口；目标态的任务队列、周期 worker 与手动补偿接口后续补齐。

## 8.4 Runtime User Authorization Snapshot（当前实现兼容路径）

当前实现路径：

- `GET /api/platform/runtime/users/:uid/authorizations`
- `POST /api/platform/runtime/permissions/check`

查询/请求参数：

| 字段 | 必填 | 说明 |
|---|---|---|
| `tenantCode` | 是 | 租户编码 |
| `appCode` | 授权快照可选；权限检查必填 | 目标应用编码 |
| `activeRoleCode` | 否 | 当前选中的平台企业角色；未传或无效时服务端选择该用户可用企业角色列表中的第一个角色 |

响应语义：

- `availableRoles` 只返回当前用户可切换的平台企业角色；应用角色不返回给租户侧运行时。
- `activeRoleCode` 返回本次实际生效的企业角色。
- `roles`、`permissions`、`scopes` 只表示 `activeRoleCode` 对应企业角色在目标应用下展开后的授权结果，不再表示多角色并集。
- 应用入口列表也必须按 `activeRoleCode` 对应企业角色展开后的应用权限过滤，不使用用户所有角色并集。
- 员工自服务类 `baselinePermissions` 仍可作为角色外的基础授权进入应用侧快照；管理类权限必须来自显式角色。

---

## 9. Registry 接口

## 9.1 `GET /api/v1/registry/apps`

用途：

- 返回当前 tenant / deployment 可见的应用目录

鉴权方式：

- 用户 token 或 runtime credential

响应建议：

```json
{
  "code": 0,
  "data": {
    "applications": [
      {
        "appCode": "aims",
        "appName": "研发项目管理",
        "homeUrl": "https://hzy.wiztek.cn/aims/",
        "basePath": "/aims/",
        "apiBase": "/api/v1/aims",
        "version": "1.0.0",
        "capabilitiesRequired": []
      }
    ]
  }
}
```

## 9.2 `GET /api/v1/registry/apps/:appCode/manifest`

用途：

- 获取应用 manifest
- 返回的是当前已批准 manifest；不承担注册新 manifest 的职责

响应建议：

```json
{
  "code": 0,
  "data": {
    "appCode": "aims",
    "version": "1.0.0",
    "manifest": {
      "resources": [],
      "recommendedRoles": [],
      "supportedScopes": [],
      "capabilitiesRequired": []
    }
  }
}
```

## 9.3 Platform Ops System Role Governance（当前实现，非 Runtime 合同）

用途：

- 供 Platform Admin/Ops 定义全局标准角色母版
- 维护全局角色默认权限与默认 scope
- 检查 app manifest 中 `requires_grant=1` 的 action 是否被至少一个 active 全局角色覆盖

边界：

- 本组接口当前实现路径为 `/api/platform/ops/**`，并保留 `/api/platform/admin/**` 兼容映射。
- 本组接口属于平台治理后台接口，不是客户侧 runtime / SDK 对外合同；Console 与业务应用不得直接消费。
- 权限覆盖检查只做 warning，不阻断 release publish。
- manifest action 解析优先使用应用 latest released manifest，缺省时回退 latest manifest。

接口清单：

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/api/platform/ops/system-roles` | 查询全局角色列表 |
| `POST` | `/api/platform/ops/system-roles` | 创建全局角色，可同时写入默认权限 |
| `GET` | `/api/platform/ops/system-roles/:code` | 查询全局角色详情、默认权限、默认 scope、模板引用与租户物化引用 |
| `PATCH` | `/api/platform/ops/system-roles/:code` | 更新全局角色元数据，`roleCode` 不允许修改 |
| `PUT` | `/api/platform/ops/system-roles/:code/permissions` | 全量替换全局角色默认权限 |
| `GET` | `/api/platform/ops/system-roles/:code/scopes` | 查询全局角色默认 scope |
| `PUT` | `/api/platform/ops/system-roles/:code/scopes` | 全量替换全局角色默认 scope |
| `GET` | `/api/platform/ops/system-roles/coverage` | 检查 requires_grant action 的全局角色覆盖情况 |

`POST /api/platform/ops/system-roles` 请求体：

```json
{
  "roleCode": "console.directory_manager",
  "roleName": "Console 目录管理员",
  "scope": "tenant",
  "roleType": "system",
  "appCode": "console",
  "description": "管理 Console 目录运行时",
  "isRequired": false,
  "status": "active",
  "permissions": [
    {
      "appCode": "console",
      "resourceCode": "directory_users",
      "action": "manage"
    }
  ]
}
```

`PUT /api/platform/ops/system-roles/:code/permissions` 请求体：

```json
{
  "permissions": [
    {
      "appCode": "console",
      "resourceCode": "directory_users",
      "action": "read",
      "manifestActionId": 1001
    }
  ]
}
```

`PUT /api/platform/ops/system-roles/:code/scopes` 请求体：

```json
{
  "scopes": [
    {
      "appCode": "console",
      "resourceCode": "directory_users",
      "action": "read",
      "scopeType": "department",
      "scopeValue": "self_and_children",
      "status": "active"
    }
  ]
}
```

`GET /api/platform/ops/system-roles/coverage` 查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `appCode` | 否 | 限定应用 |
| `onlyMissing` | 否 | 默认 `true`；传 `false` 时返回全部 requires_grant action 的覆盖情况 |

---

## 9.4 Tenant Admin Role Materialization And Assignment（当前实现，非 Runtime 合同）

用途：

- 供租户 Dashboard 将 Platform Admin 定义的全局标准角色物化到当前租户
- 供租户 Dashboard 给用户、部门、岗位分配可授权角色
- 供租户 Dashboard 在权限变更后主动生成新的 policy bundle

边界：

- 本组接口当前实现路径为 `/api/platform/tenant-admin/**`。
- 本组接口属于租户管理后台接口，不是客户侧 runtime / SDK 对外合同；Console runtime 仍只消费 policy bundle 与最小 subject 投影。
- 租户上下文通过 `tenantCode` 查询参数或请求体传入；中间件也会兼容既有租户 cookie/header 解析。
- Dashboard 自定义角色后续仍沿用 `tenant_roles`、`tenant_role_permissions`、`tenant_role_scopes` 数据模型，本节先覆盖全局角色物化与主体赋权。
- 授权页不要求用户先执行显式“启用”。给主体授予平台企业角色时，可由授权接口按 `systemRoleCode` 自动完成租户角色物化。

接口清单：

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/api/platform/tenant-admin/system-roles` | 查询可授权的全局标准角色及其租户物化状态 |
| `GET` | `/api/platform/tenant-admin/system-roles/:code/diff` | 查询某全局角色与租户已物化角色之间的权限/scope 差异 |
| `POST` | `/api/platform/tenant-admin/system-roles/:code/enable` | 将全局角色物化到租户；未覆盖时会同步默认授权；UI 仅在策略差异场景显式调用 |
| `POST` | `/api/platform/tenant-admin/system-roles/:code/sync` | 与 `enable` 相同，用于显式同步已物化角色 |
| `GET` | `/api/platform/tenant-admin/subjects` | 查询租户主体列表与 active membership；授权页使用 `all=true` 拉取完整主体树 |
| `GET` | `/api/platform/tenant-admin/assignable-roles` | 查询租户内可分配角色 |
| `GET` | `/api/platform/tenant-admin/subject-roles` | 查询用户/部门/岗位的角色授权记录 |
| `POST` | `/api/platform/tenant-admin/subject-roles` | 给用户/部门/岗位授予角色 |
| `DELETE` | `/api/platform/tenant-admin/subject-roles/:id` | 撤销角色授权；实现为写入 `expired_at` |
| `POST` | `/api/platform/tenant-admin/bundles` | 为租户生成新的 policy bundle |

系统角色同步策略：

- 全局角色物化后会写入 `tenant_roles(source='system', source_role_code=<systemRoleCode>)`。
- 租户物化角色的 `role_type` 固定写为 `system`；平台企业角色自身的岗位分类仍保留在 `platform_system_roles.role_type`。
- 默认应用角色写入 `tenant_role_app_role_maps`；租户侧少量补充或例外权限/scope 仍写入 `tenant_role_permissions`、`tenant_role_scopes`。
- 当租户角色仍是系统来源且 `is_overridden=0` 时，`enable/sync` 会自动用全局默认授权覆盖同步。
- 当租户侧修改了系统来源角色的元数据、权限或 scope 后，接口会标记 `is_overridden=1`；后续同步默认返回 diff 与 `requiresConfirmation=true`，不会直接覆盖租户修改。
- 管理端确认覆盖时，调用 `enable/sync` 并传入 `force=true`；同步成功后会将 `is_overridden` 重置为 `0`。

`GET /api/platform/tenant-admin/system-roles` 查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `tenantCode` | 是 | 租户编码 |
| `appCode` | 否 | 限定应用，Dashboard 当前默认使用 `console` |
| `keyword` | 否 | 按角色编码/名称模糊搜索 |
| `status` | 否 | 默认 `active` |
| `enabled` | 否 | 兼容查询参数；`true` 仅看已物化，`false` 仅看未物化 |
| `page` / `pageSize` | 否 | 分页参数 |

`GET /api/platform/tenant-admin/subjects` 查询参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `tenantCode` | 是 | 租户编码 |
| `subjectType` | 否 | `user` / `department` / `committee` / `job` |
| `status` | 否 | 授权页默认使用 `active` |
| `keyword` | 否 | 按 `subjectCode` / `displayName` / `externalRef` 模糊搜索 |
| `all` | 否 | 传 `true` 时不分页，返回完整主体列表，供树形级联选择使用 |
| `page` / `pageSize` | 否 | `all=true` 时忽略 |

响应说明：

- `items` 返回 `tenant_subjects`。
- `memberships` 返回 `tenant_subject_memberships(status='active')`，用于表达委员会等多归属容器下的员工节点。

`POST /api/platform/tenant-admin/system-roles/:code/enable` 请求体：

```json
{
  "tenantCode": "C000001",
  "force": false
}
```

`POST /api/platform/tenant-admin/subject-roles` 请求体：

```json
{
  "tenantCode": "C000001",
  "subjectType": "user",
  "subjectId": 1,
  "systemRoleCode": "general_manager",
  "sourceType": "manual",
  "sourceId": null,
  "expiredAt": null
}
```

说明：

- `subjectType` 支持 `user`、`department`、`committee`、`job`；授权 UI 不展示 `committee`，角色授权仍应落到 `user`。
- `subjectId` 与 `subjectCode` 二选一；`roleId`、`roleCode`、`systemRoleCode` 至少提供一个。
- 仅提供 `systemRoleCode` 时，接口会先把平台企业角色自动物化为当前租户的 active assignable 角色，再写 `tenant_subject_roles`。
- `sourceType` 默认为 `manual`，后续可用于模板、导入或系统初始化来源追踪。

`POST /api/platform/tenant-admin/bundles` 请求体：

```json
{
  "tenantCode": "C000001",
  "environment": "prod",
  "platformBaseUrl": "https://platform.example.com",
  "expiresAt": null,
  "includePayload": false
}
```

---

## 10. 错误模型

第一版建议统一返回：

```json
{
  "code": 10001,
  "message": "bundle signature invalid",
  "details": {}
}
```

建议错误分类：

- `auth_invalid_token`
- `auth_session_revoked`
- `auth_deployment_disabled`
- `policy_bundle_not_found`
- `policy_bundle_signature_invalid`
- `policy_bundle_version_outdated`
- `revocation_not_found`
- `runtime_heartbeat_rejected`
- `license_expired`
- `license_revoked`

---

## 11. 鉴权方式

第一版建议区分两类调用：

### 11.1 用户态调用

例如：

- `/auth/logout`
- `/policy/bundles/current`
- `/registry/apps`

使用：

- 用户 access token

### 11.2 Runtime 调用

例如：

- `/policy/bundles/latest`
- `/policy/bundles/:version/download`
- `/revocations/latest`
- `/runtime/heartbeat`

使用：

- `deployment_key`
- 或平台签发的 runtime credential

第一版不建议让客户侧 runtime 复用普通用户 token 拉平台管理接口。
第一版也不允许 runtime 以启动流程替代发布期 manifest 注册。

---

## 12. 版本策略

### 12.1 URL 版本

第一版统一采用：

- `/api/v1/...`

路径治理约束：

- `/api/v1/...` 是唯一对外合同路径（SDK、console、业务应用、第三方集成统一按该路径接入）。
- `/api/platform/...` 属于历史实现路径，不属于对外合同；仅在迁移窗口内保留兼容。
- `/api/platform/internal/**` 是平台内部私有接口，不纳入本合同。
- `/api/v1/internal/**` 不在 v1 合同范围内。

### 12.2 向后兼容

建议：

- 核心对象字段尽量追加，不轻易删除
- `bundle` 与 `manifest` 内部结构允许新增字段
- 至少保证 1 年向后兼容

### 12.3 版本升级原则

以下情况可考虑升级到 `v2`：

- Token 模型发生不兼容变化
- Bundle 粒度从 tenant 级改成用户级或增量级
- Heartbeat 协议重大变化

### 12.4 实现收敛与兼容退役

- 平台实现应优先向合同收敛：新接口只在 `/api/v1/...` 增加，不再新增 `/api/platform/...` 对外接口。
- 迁移窗口内可保留 `/api/platform/...` 兼容映射，但必须加 `Deprecation`/`Sunset` 响应头并记录调用来源。
- 迁移完成后，`/api/platform/...` 仅保留内部/运维私有接口；对外调用统一使用 `/api/v1/...`。

---

## 13. 第一版边界

第一版建议只落这些接口：

- `POST /api/v1/auth/federation/callback`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/policy/bundles/latest`
- `GET /api/v1/policy/bundles/:bundleVersion/download`
- `GET /api/v1/revocations/latest`
- `GET /api/v1/revocations/:revocationVersion/download`
- `POST /api/v1/runtime/heartbeat`
- `GET /api/v1/runtime/license/status`
- `GET /api/v1/registry/apps`
- `GET /api/v1/registry/apps/:appCode/manifest`

第一版暂不做：

- 发布期 manifest 注册 / 审核 / 凭证治理接口（另文定义）
- 用户级 bundle 增量接口
- 双向长连接推送
- 跨 deployment 联邦接口
- 多 region API 网关策略
- 对外开放 `internal` 命名空间（禁止提供 `/api/v1/internal/**`）

---

## 14. 后续建议

基于本文，接下来最适合继续补两份文档：

1. 《Foundation SDK 契约》
   细化本地缓存、验签、错误码与重试策略

2. 《License 与 Capability 清单》
   细化 `grace period`、只读模式、功能降级规则

3. 《Directory Runtime 契约》
   细化客户侧组织目录服务的标准 API、同步语义与平台治理边界
