# hzy_platform 第一版 API 草案

## 1. 文档目标

本文档用于定义 `hzy_platform` 第一版 API 草案。

目标是为以下四类消费者提供统一接口契约：

- 平台管理后台
- `platform-sdk`
- `platform-adapter-nuxt`
- 首个接入应用 `AIMS`

本文档聚焦平台最小内核，不追求一次性覆盖完整运营后台。

---

## 2. API 设计原则

### 2.1 分层明确

第一版 API 按四类用途分层：

1. `Identity API`
2. `Authorization API`
3. `Registry API`
4. `Runtime Control API`

### 2.2 对上游身份源解耦

平台内部 API 不直接暴露 `CAS`、`企业微信`、`GitLab OIDC` 的差异语义。  
上游身份差异由 Identity Plane 连接器处理。

### 2.3 对下游应用 OIDC-first

下游应用原则上通过平台 token / claims / bundle 消费平台身份与授权结果。  
第一版文档先定义平台内部控制面接口，不展开完整 OIDC 标准端点细节。

### 2.4 先跑通最小闭环

第一版优先支持：

- 平台主体与身份映射管理
- 角色 / 模板 / scope 管理
- 应用注册与 manifest
- bundle / revocation / heartbeat
- 权限查询与检查

### 2.5 动态解析优先

第一版运行时默认走动态授权解析，不以 `effective_user_*` 物化表为前提。

---

## 3. API 顶层分组

建议统一前缀：

- 管理后台 API：`/api/platform/admin/...`
- runtime / sdk API：`/api/platform/runtime/...`
- 内部服务 API：`/api/platform/internal/...`

说明：

- `admin` 面向平台管理后台和平台内部运营动作
- `runtime` 面向客户侧 runtime、`platform-sdk`、`platform-adapter-nuxt`
- `internal` 面向 Identity Plane / Control Plane 内部服务调用

---

## 4. Identity API

## 4.1 查询租户列表

`GET /api/platform/admin/tenants`

用途：

- 平台后台查询租户主实体

请求参数：

- `status`
- `keyword`
- `page`
- `pageSize`

## 4.1.1 创建租户

`POST /api/platform/admin/tenants`

用途：

- 平台后台创建租户主实体

请求体：

```json
{
  "tenantName": "Acme Corporation",
  "displayName": "Acme",
  "tenantType": "enterprise",
  "primaryDomain": "acme.example.com",
  "status": "active",
  "defaultAuthMode": "oidc",
  "defaultDeploymentMode": "managed-control-plane"
}
```

说明：

- `tenantCode` 由服务端自动按顺序生成，格式为 `C000001`、`C000002`，请求体不再传入该字段

## 4.1.2 更新租户

`PATCH /api/platform/admin/tenants/:id`

用途：

- 平台后台更新租户元数据

说明：

- `tenantCode` 作为稳定编码，v1 不允许通过该接口修改

## 4.2 查询用户列表

`GET /api/platform/admin/users`

用途：

- 平台后台查询租户下用户主实体

请求参数：

- `tenantCode`
- `status`
- `keyword`
- `page`
- `pageSize`

## 4.2.1 创建用户

`POST /api/platform/admin/users`

用途：

- 在指定租户下创建用户主实体

请求体：

```json
{
  "tenantCode": "acme",
  "uid": "u_1001",
  "username": "zhangsan",
  "displayName": "张三",
  "email": "zhangsan@example.com",
  "mobile": "13800000000",
  "avatarUrl": "https://example.com/avatar.png",
  "status": "active",
  "sourceType": "manual"
}
```

## 4.2.2 更新用户

`PATCH /api/platform/admin/users/:id`

用途：

- 更新用户基础资料和状态

说明：

- `tenantCode` 和 `uid` 在 v1 中视为稳定标识，不通过该接口修改

## 4.3 查询主体列表

`GET /api/platform/admin/subjects`

用途：

- 平台后台查询用户 / 部门 / 岗位主体

请求参数：

- `tenantCode`
- `subjectType`
- `status`
- `keyword`
- `page`
- `pageSize`

返回结构：

```json
{
  "items": [
    {
      "id": 1,
      "tenantCode": "acme",
      "subjectType": "user",
      "subjectCode": "u_1001",
      "displayName": "张三",
      "externalRef": "gitlab:123",
      "parentSubjectId": null,
      "status": "active"
    }
  ],
  "total": 1
}
```

## 4.4 创建或同步主体

`POST /api/platform/admin/subjects`

用途：

- 平台后台手工录入主体
- Identity Plane 同步最小主体目录

请求体：

```json
{
  "tenantCode": "acme",
  "subjectType": "user",
  "subjectCode": "u_1001",
  "displayName": "张三",
  "externalRef": "gitlab:123",
  "parentSubjectId": null,
  "status": "active"
}
```

## 4.5 查询主体身份映射

`GET /api/platform/admin/subjects/:id/identities`

用途：

- 查看某主体绑定的上游身份源

## 4.6 新增主体身份映射

`POST /api/platform/admin/subject-identities`

请求体：

```json
{
  "tenantCode": "acme",
  "subjectId": 1,
  "providerType": "gitlab_oidc",
  "providerSubjectKey": "gitlab:123",
  "providerMetadata": {
    "username": "zhangsan"
  },
  "status": "active"
}
```

## 4.7 通过上游身份解析主体

`POST /api/platform/internal/identity/resolve-subject`

用途：

- Identity Plane 在用户登录后，将上游身份映射到租户、用户和平台主体

请求体：

```json
{
  "providerType": "gitlab_oidc",
  "providerSubjectKey": "gitlab:123"
}
```

返回结构：

```json
{
  "tenant": {
    "tenantCode": "acme",
    "tenantName": "Acme"
  },
  "user": {
    "id": 101,
    "uid": "u_1001",
    "displayName": "张三",
    "email": "zhangsan@example.com"
  },
  "subject": {
    "id": 1,
    "tenantCode": "acme",
    "subjectType": "user",
    "subjectCode": "u_1001",
    "displayName": "张三"
  }
}
```

---

## 5. Authorization API

## 5.1 角色管理

### 5.1.1 查询角色列表

`GET /api/platform/admin/roles`

请求参数：

- `tenantCode`
- `roleType`
- `appCode`
- `status`
- `keyword`

### 5.1.2 创建角色

`POST /api/platform/admin/roles`

请求体：

```json
{
  "tenantCode": "acme",
  "roleCode": "aims:member",
  "roleName": "AIMS 普通成员",
  "roleType": "app",
  "appCode": "aims",
  "description": "AIMS 普通功能角色",
  "isAssignable": true,
  "status": "active"
}
```

### 5.1.3 更新角色

`PATCH /api/platform/admin/roles/:id`

### 5.1.4 配置角色权限

`PUT /api/platform/admin/roles/:id/permissions`

请求体：

```json
{
  "permissions": [
    {
      "resourceCode": "projects",
      "action": "view"
    },
    {
      "resourceCode": "projects",
      "action": "edit"
    }
  ]
}
```

### 5.1.5 配置角色 scope

`PUT /api/platform/admin/roles/:id/scopes`

请求体：

```json
{
  "scopes": [
    {
      "resourceCode": "projects",
      "action": "view",
      "scopeType": "relation",
      "scopeValue": "project_member"
    },
    {
      "resourceCode": "projects",
      "action": "edit",
      "scopeType": "relation",
      "scopeValue": "project_member"
    }
  ]
}
```

说明：

- 第一版 UI 可先只开放 `all / self / department`
- 模型允许 `relation:*`，由 app runtime resolver 解释

## 5.2 模板管理

### 5.2.1 查询模板列表

`GET /api/platform/admin/templates`

### 5.2.2 创建模板

`POST /api/platform/admin/templates`

请求体：

```json
{
  "tenantCode": "acme",
  "templateCode": "tpl:rd_staff",
  "templateName": "研发员工模板",
  "templateType": "job",
  "description": "研发岗位默认模板",
  "status": "active"
}
```

### 5.2.3 配置模板角色

`PUT /api/platform/admin/templates/:id/roles`

请求体：

```json
{
  "roles": [
    { "roleCode": "internal_user", "sortOrder": 10 },
    { "roleCode": "job:developer", "sortOrder": 20 },
    { "roleCode": "aims:member", "sortOrder": 30 }
  ]
}
```

## 5.3 模板绑定与覆盖

### 5.3.1 查询模板绑定

`GET /api/platform/admin/template-bindings`

过滤参数：

- `tenantCode`
- `subjectType`
- `subjectId`
- `templateId`
- `status`

### 5.3.2 新增模板绑定

`POST /api/platform/admin/template-bindings`

请求体：

```json
{
  "tenantCode": "acme",
  "templateId": 10,
  "subjectType": "job",
  "subjectId": 100,
  "priority": 100,
  "status": "active"
}
```

### 5.3.3 新增模板覆盖

`POST /api/platform/admin/template-overrides`

请求体：

```json
{
  "tenantCode": "acme",
  "subjectType": "user",
  "subjectId": 1,
  "roleId": 20,
  "overrideType": "exclude",
  "sourceTemplateId": 10,
  "reason": "该用户暂不使用 codocs",
  "status": "active"
}
```

## 5.4 用户有效授权查询

### 5.4.1 查询用户有效授权

`GET /api/platform/runtime/users/:uid/authorizations`

用途：

- `platform-sdk`
- `platform-adapter-nuxt`
- 应用服务端首屏授权加载

请求参数：

- `tenantCode`
- `appCode` 可选
- `includeSources` 可选

返回结构建议固定为：

```json
{
  "uid": "u_1001",
  "tenantCode": "acme",
  "roles": [
    {
      "roleCode": "aims:member",
      "roleType": "app",
      "appCode": "aims",
      "source": {
        "type": "template",
        "id": "tpl:rd_staff"
      }
    }
  ],
  "permissions": [
    {
      "appCode": "aims",
      "resourceCode": "projects",
      "action": "view"
    }
  ],
  "scopes": [
    {
      "appCode": "aims",
      "resourceCode": "projects",
      "action": "view",
      "scopeType": "relation",
      "scopeValue": "project_member"
    }
  ],
  "sources": [
    {
      "type": "template_binding",
      "id": 10
    }
  ]
}
```

说明：

- 这条接口是 `foundation` 新链路的核心读接口

### 5.4.2 权限检查

`POST /api/platform/runtime/permissions/check`

用途：

- 平台侧快速检查某用户对某权限点是否具备资格
- 不负责具体业务对象关系判断

请求体：

```json
{
  "tenantCode": "acme",
  "uid": "u_1001",
  "appCode": "aims",
  "resourceCode": "projects",
  "action": "edit"
}
```

返回结构：

```json
{
  "allowed": true,
  "matchedAction": "edit",
  "roles": ["aims:member"],
  "scopes": [
    {
      "scopeType": "relation",
      "scopeValue": "project_member"
    }
  ]
}
```

说明：

- 动作继承在平台服务层统一处理，例如 `admin -> edit -> view`
- app 仍需自行解释 `project_member` 等关系型 scope

### 5.4.3 解析授权快照

`POST /api/platform/internal/authorizations/resolve`

用途：

- Identity / Authorization 服务内部按规则展开用户最终授权
- 可作为 `GET /users/:uid/authorizations` 的内部实现入口

---

## 6. Registry API

## 6.1 应用管理

### 6.1.1 查询应用列表

`GET /api/platform/admin/applications`

### 6.1.2 创建应用

`POST /api/platform/admin/applications`

请求体：

```json
{
  "tenantCode": "acme",
  "appCode": "aims",
  "appName": "AIMS",
  "appType": "internal",
  "runtimeMode": "customer-hosted",
  "authMode": "oidc",
  "bundleEnabled": true,
  "status": "active"
}
```

### 6.1.3 更新应用

`PATCH /api/platform/admin/applications/:id`

## 6.2 Manifest 管理

### 6.2.1 上传 manifest

`POST /api/platform/admin/applications/:appCode/manifests`

请求体：

```json
{
  "tenantCode": "acme",
  "version": "1.0.0",
  "manifestJson": {
    "appCode": "aims",
    "resources": [],
    "recommendedRoles": []
  }
}
```

### 6.2.2 查询应用最新 manifest

`GET /api/platform/runtime/applications/:appCode/manifest`

用途：

- runtime / sdk 获取某应用最新 manifest

返回结构：

```json
{
  "appCode": "aims",
  "version": "1.0.0",
  "manifestHash": "sha256:xxx",
  "manifestJson": {}
}
```

### 6.2.3 查询应用目录

`GET /api/platform/runtime/applications`

用途：

- runtime / 平台工作台拉应用目录

---

## 7. Runtime Control API

## 7.1 deployment 管理

### 7.1.1 查询 deployment 列表

`GET /api/platform/admin/deployments`

### 7.1.2 创建 deployment

`POST /api/platform/admin/deployments`

请求体：

```json
{
  "tenantCode": "acme",
  "deploymentCode": "dep_acme_prod",
  "deploymentName": "Acme 生产部署",
  "deploymentMode": "managed-control-plane",
  "status": "active"
}
```

## 7.2 license 管理

### 7.2.1 查询 license

`GET /api/platform/admin/licenses`

### 7.2.2 下发或更新 license

`POST /api/platform/admin/licenses`

请求体：

```json
{
  "tenantCode": "acme",
  "deploymentId": 1,
  "licenseCode": "lic_xxx",
  "planCode": "enterprise",
  "status": "active",
  "issuedAt": "2026-04-22T00:00:00Z",
  "expiresAt": "2027-04-22T00:00:00Z",
  "graceUntil": "2027-05-22T00:00:00Z",
  "capabilities": [
    {
      "capabilityCode": "aims_enabled",
      "capabilityValue": "true"
    }
  ]
}
```

## 7.3 policy bundle

### 7.3.1 查询 bundle 元信息

`GET /api/platform/runtime/deployments/:deploymentCode/bundle-meta`

返回结构：

```json
{
  "deploymentCode": "dep_acme_prod",
  "bundleVersion": "2026.04.22.1",
  "bundleHash": "sha256:xxx",
  "bundleUri": "https://...",
  "schemaVersion": "v1",
  "issuedAt": "2026-04-22T00:00:00Z",
  "expiresAt": "2026-04-29T00:00:00Z",
  "status": "active"
}
```

### 7.3.2 下载 bundle

`GET /api/platform/runtime/deployments/:deploymentCode/bundle`

说明：

- 第一版可以返回 JSON 或签名后的 bundle 文件流

## 7.4 revocation

### 7.4.1 查询 revocation 元信息

`GET /api/platform/runtime/deployments/:deploymentCode/revocation-meta`

### 7.4.2 下载 revocation 快照

`GET /api/platform/runtime/deployments/:deploymentCode/revocations`

## 7.5 heartbeat

### 7.5.1 上报 heartbeat

`POST /api/platform/runtime/deployments/:deploymentCode/heartbeat`

请求体：

```json
{
  "runtimeId": "aims-node-01",
  "bundleVersion": "2026.04.22.1",
  "sdkVersion": "0.1.0",
  "licenseStatusSeen": "active",
  "heartbeatAt": "2026-04-22T10:00:00Z",
  "payload": {
    "appCode": "aims",
    "region": "cn-north"
  }
}
```

返回结构：

```json
{
  "deploymentStatus": "active",
  "licenseStatus": "active",
  "nextSuggestedHeartbeatAt": "2026-04-22T10:05:00Z"
}
```

### 7.5.2 查询运行状态

`GET /api/platform/runtime/deployments/:deploymentCode/status`

用途：

- 调试或平台工作台查看部署健康度

---

## 8. Audit API

## 8.1 查询授权审计日志

`GET /api/platform/admin/audit/authorizations`

请求参数：

- `tenantCode`
- `operatorUid`
- `targetType`
- `targetId`
- `action`
- `dateFrom`
- `dateTo`
- `page`
- `pageSize`

说明：

- 第一版只做基础查询，不做复杂分析报表接口

---

## 9. AIMS 第一版必需接口子集

如果只为了先让 `AIMS` 接上新平台，第一版最小必需接口如下：

- `POST /api/platform/internal/identity/resolve-subject`
- `GET /api/platform/admin/tenants`
- `GET /api/platform/admin/users`
- `GET /api/platform/runtime/users/:uid/authorizations`
- `POST /api/platform/runtime/permissions/check`
- `GET /api/platform/runtime/applications/:appCode/manifest`
- `GET /api/platform/runtime/deployments/:deploymentCode/bundle-meta`
- `GET /api/platform/runtime/deployments/:deploymentCode/revocation-meta`
- `POST /api/platform/runtime/deployments/:deploymentCode/heartbeat`

说明：

- 这组接口已经足以支撑 `platform-sdk`、`platform-adapter-nuxt` 和 `AIMS` 首条接入链路

---

## 10. 返回格式约定

第一版建议统一以下返回约定。

### 10.1 成功返回

```json
{
  "success": true,
  "data": {}
}
```

### 10.2 失败返回

```json
{
  "success": false,
  "error": {
    "code": "AUTHORIZATION_DENIED",
    "message": "Permission denied"
  }
}
```

### 10.3 常见错误码

- `UNAUTHORIZED`
- `FORBIDDEN`
- `SUBJECT_NOT_FOUND`
- `ROLE_NOT_FOUND`
- `RESOURCE_NOT_FOUND`
- `APPLICATION_NOT_FOUND`
- `DEPLOYMENT_NOT_FOUND`
- `LICENSE_RESTRICTED`
- `BUNDLE_NOT_FOUND`
- `REVOCATION_NOT_FOUND`
- `VALIDATION_ERROR`

---

## 11. 第一版明确不做的 API

第一版不进入范围的 API：

- 完整用户自助中心 API
- 完整 OIDC 标准端点实现文档
- 复杂 session 管理 API
- 计费 / 订单 / 结算 API
- 用户级 bundle 增量下发 API
- 复杂 ABAC 策略配置 API

---

## 12. 建议实施顺序

建议按以下顺序实现：

1. `Identity API`
   先跑通主体解析
2. `Authorization API`
   先跑通有效授权查询和权限检查
3. `Registry API`
   先跑通 `AIMS` manifest
4. `Runtime Control API`
   先跑通 bundle / revocation / heartbeat
5. `Audit API`
   最后补基础审计查询

---

## 13. 结论

`hzy_platform` 第一版 API 不应一开始就追求“大而全”，而应先围绕：

- 身份锚点
- 授权查询
- 应用注册
- runtime 控制

形成最小闭环。

只要这条 API 主链先稳定下来，后续 `platform-sdk`、`platform-adapter-nuxt`、`AIMS` 接入和平台后台治理都能围绕同一套契约推进。
