# Tenant Runtime API Contract v1

状态：Draft  
日期：2026-06-01  
关联 ADR：[`ADR-016: Tenant Runtime 业务 API 架构`](./ADR-016-Tenant-Runtime-Business-API-Architecture.md)

## 1. 目标

本文定义 `tenant-runtime` 第一版业务 API 合同规范，用于约束 Platform 之外的业务应用从 Nuxt server 直连数据库迁移到客户侧 runtime 的接口形态。

`tenant-runtime` 是业务 API runtime，不是 SQL over REST 代理。所有应用 adapter 只能暴露稳定业务接口，不暴露表名、SQL、数据库连接信息或通用查询能力。

## 2. 基础约定

### 2.1 Base URL

平台侧通过 Tenant Gateway、Console runtime config 或本地 env 解析 runtime endpoint：

```text
https://{tenant-runtime-endpoint}
```

本地开发可使用：

```text
http://127.0.0.1:18080
```

### 2.2 Namespace

运行时基础接口：

```text
/runtime/*
```

基础运行时管理接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/runtime/health` | 运行状态、版本、租户、部署和 adapter 健康信息 |
| `GET` | `/runtime/healthz` | `/runtime/health` 的兼容别名 |
| `GET` | `/runtime/enrollment` | 当前 enrollment 与启用 adapter 信息 |
| `GET` | `/runtime/schema/status?app={appCode}` | 指定 adapter schema 状态 |
| `POST` | `/runtime/update` | Console 触发租户端运行时更新，需 `runtime.update` scope；systemd 安装下通常返回 `queued`，由 root update request service 执行 |
| `GET` | `/runtime/update/status` | 查询最近一次 API 触发更新的状态和结果，需 `runtime.update` scope |

业务接口按应用分组：

```text
/v1/{appCode}/*
```

示例：

```text
/v1/finance/dashboard/summary
/v1/workflow/tasks/pending
/v1/assets/dashboard/overview
/v1/codocs/documents/{uuid}
```

### 2.3 HTTP 方法

| 方法 | 用途 |
| --- | --- |
| `GET` | 查询、列表、详情、运行时状态 |
| `POST` | 创建资源、提交业务动作、非幂等动作 |
| `PATCH` | 局部更新资源 |
| `PUT` | 全量替换或幂等 upsert，需在 OpenAPI 中明确 |
| `DELETE` | 删除或撤销，优先软删除 |

业务动作不要强行伪装成资源 CRUD。可以使用清晰动作路径：

```text
POST /v1/workflow/tasks/{id}/approve
POST /v1/finance/reconciliation/{code}/void
POST /v1/assets/purchase-orders/{id}/submit
```

## 3. 认证

请求必须携带 Bearer token：

```http
Authorization: Bearer <token>
```

Token 至少包含：

```text
iss
aud=tenant-runtime
tenant
deployment
appCode
scope
sub
token_use=user|service
exp
```

runtime 必须校验：

- JWKS 来源可信。
- `aud` 为 `tenant-runtime`。
- `tenant` / `deployment` 与 runtime enrollment 匹配。
- `appCode` 已启用。
- `scope` 覆盖请求 API；同一个 token 可携带空格分隔的多 scope。
- 迁移期通用 runtime 路由仍可用应用级传输 scope（如 `altoc.read` / `altoc.write`，或 audience 前缀后的 `tenant-runtime:altoc:read|write`）完成入口认证；高价值领域命令应同时携带并执行资源/动作 capability（如 `altoc:lead:edit` / `altoc:lead:convert`），adapter 不得只依赖传输 scope 作为业务授权边界。
- token 未过期。

迁移期兼容当前 `aud=data-runtime` 的旧部署；新增接口应优先使用 `tenant-runtime` 命名。

## 4. 标准请求头

| Header | 用途 |
| --- | --- |
| `Authorization` | Bearer token |
| `x-request-id` | 请求链路 ID；调用方没有时 runtime 可生成 |
| `x-hzy-tenant` | 租户标识，必须与 token/enrollment 匹配 |
| `x-hzy-deployment` | deployment 标识，必须与 token/enrollment 匹配 |
| `x-hzy-actor-uid` | 触发当前操作的用户 UID；服务 token 转发用户操作时必须传递 |
| `Idempotency-Key` | 写操作幂等键；需要幂等的 API 必须支持 |

Tenant Gateway 内部可注入以下运行时发现头：

```text
x-hzy-gateway: tenant-gateway
x-hzy-gateway-token: <HZY_CLOUDFLARE_INTERNAL_TOKEN>
x-hzy-tenant-runtime-url
x-hzy-tenant-runtime-token
x-hzy-tenant-runtime-audience
```

迁移期兼容旧头：

```text
x-hzy-data-runtime-url
x-hzy-data-runtime-token
x-hzy-data-runtime-audience
```

业务应用只能在 `x-hzy-gateway-token` 与自身配置的 `HZY_CLOUDFLARE_INTERNAL_TOKEN`（迁移期兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`）匹配时信任上述发现头；不得仅凭 `x-hzy-gateway=tenant-gateway` 接受租户、部署、runtime URL 或 runtime token。

## 5. 响应格式

### 5.1 单对象

```json
{
  "data": {
    "code": "INV-001"
  }
}
```

### 5.2 列表分页

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 20,
  "summary": {}
}
```

分页参数统一为：

| Query | 默认值 | 说明 |
| --- | ---: | --- |
| `page` | `1` | 从 1 开始 |
| `pageSize` | `20` | 默认上限 100，特殊接口需说明 |
| `sort` | 无 | 排序字段，必须白名单 |
| `order` | `asc` | `asc` 或 `desc` |

过滤参数使用业务字段，不暴露 SQL 片段。模糊查询统一使用 `keyword`。

### 5.3 空列表

空列表必须返回空数组和数字分页元数据：

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

## 6. 错误格式

所有错误统一为：

```json
{
  "error": {
    "code": "permission_denied",
    "message": "Permission denied",
    "details": {}
  }
}
```

常用错误码：

| HTTP | `error.code` | 说明 |
| ---: | --- | --- |
| 400 | `invalid_request` | 参数非法 |
| 401 | `unauthorized` | 缺少或无法验证 token |
| 403 | `permission_denied` | scope / policy 不足 |
| 404 | `not_found` | 资源不存在 |
| 409 | `conflict` | 状态冲突、重复提交、幂等冲突 |
| 422 | `validation_failed` | 业务校验失败 |
| 428 | `schema_mismatch` | runtime schema 不满足当前 API |
| 500 | `internal_error` | runtime 内部错误 |
| 502 | `upstream_unavailable` | 外部系统不可用 |
| 503 | `runtime_unavailable` | runtime 未就绪或依赖不可用 |

错误响应不得包含数据库连接串、SQL、Authorization header、secret、token 或用户输入明文。

## 7. 幂等与事务

以下写操作必须支持 `Idempotency-Key`：

- 创建审批实例。
- 创建财务单据。
- 创建采购单 / 资产分配单。
- 外部回调落库。
- 任何用户可能重复点击提交的业务动作。

幂等记录至少绑定：

```text
tenant
deployment
appCode
subject/service client
operation
idempotencyKey
requestHash
responseHash/status
createdAt
expiresAt
```

跨表写入必须由 runtime 在本地事务内完成；平台 UI / Nuxt proxy 不负责拼接远程事务。

## 8. OpenAPI 要求

每个 app adapter 必须提供 OpenAPI 文档：

```text
GET /runtime/openapi.json?app={appCode}
```

OpenAPI 必须包含：

- app code、API version、runtime minimum version。
- 每个 endpoint 的 `operationId`。
- scope 要求。
- 请求/响应 schema。
- 标准错误响应引用。
- 分页参数引用。
- 幂等键要求。

推荐文件位置：

```text
tenant-runtime/openapi/{appCode}.yaml
```

当前仓库迁移期可先放在：

```text
data-runtime/openapi/{appCode}.yaml
```

## 9. Codocs Runtime 合同

Codocs 阶段 3 收口后，Nuxt server 只保留认证桥接、OSS 内容读写、通知/Workflow 编排和响应兼容。所有 Codocs 元数据、目录、分享、版本、文件柜、资讯、问题、批注等数据库读写必须由 tenant-runtime 提供；Nuxt server 不允许回退直连 Codocs DB。

### 9.1 文档、目录、分享、版本

```text
GET    /v1/codocs/documents
POST   /v1/codocs/documents
GET    /v1/codocs/documents/stats/my
GET    /v1/codocs/documents/search
POST   /v1/codocs/documents/batch-summary
GET    /v1/codocs/documents/check-name
GET    /v1/codocs/documents/trash
GET    /v1/codocs/documents/{uuid}
PATCH  /v1/codocs/documents/{uuid}
PUT    /v1/codocs/documents/{uuid}
DELETE /v1/codocs/documents/{uuid}
POST   /v1/codocs/documents/{uuid}/restore
GET    /v1/codocs/documents/{uuid}/shares
POST   /v1/codocs/documents/{uuid}/shares
POST   /v1/codocs/documents/{uuid}/relations/preview-access
PATCH  /v1/codocs/documents/{uuid}/shares/{shareId}
DELETE /v1/codocs/documents/{uuid}/shares/{shareId}
POST   /v1/codocs/documents/{uuid}/read
GET    /v1/codocs/documents/{uuid}/versions
POST   /v1/codocs/documents/{uuid}/versions
DELETE /v1/codocs/documents/{uuid}/versions/{versionId}
GET    /v1/codocs/folders
POST   /v1/codocs/folders
PATCH  /v1/codocs/folders/{id}
DELETE /v1/codocs/folders/{id}
GET    /v1/codocs/dept-shares
POST   /v1/codocs/dept-shares
GET    /v1/codocs/dept-shares/{id}
PATCH  /v1/codocs/dept-shares/{id}
DELETE /v1/codocs/dept-shares/{id}
GET    /v1/codocs/collaboration/documents/{uuid}/context
POST   /v1/codocs/collaboration/versions
```

工作日志、个人周报和项目周报不另设专用 runtime 路径，当前统一复用 `/v1/codocs/documents` 元数据合同，并通过 `oss_path` 约定区分内容存储位置。

`GET /v1/codocs/documents/stats/my` 使用 `current_user` / `actorUid` 统计当前用户拥有的有效文档数量、容量、全站占比和按 `doc_type` 汇总，供 Codocs 首页/侧栏统计卡片使用。

### 9.2 文件柜和部门柜

```text
GET    /v1/codocs/cabinet
POST   /v1/codocs/cabinet
GET    /v1/codocs/cabinet/{uuid}
PATCH  /v1/codocs/cabinet/{uuid}
DELETE /v1/codocs/cabinet/{uuid}
GET    /v1/codocs/cabinet/folders
POST   /v1/codocs/cabinet/folders
GET    /v1/codocs/cabinet/folders/{id}
PATCH  /v1/codocs/cabinet/folders/{id}
DELETE /v1/codocs/cabinet/folders/{id}
GET    /v1/codocs/dept-cabinet
POST   /v1/codocs/dept-cabinet
GET    /v1/codocs/dept-cabinet/{uuid}
PATCH  /v1/codocs/dept-cabinet/{uuid}
DELETE /v1/codocs/dept-cabinet/{uuid}
GET    /v1/codocs/dept-cabinet/folders
POST   /v1/codocs/dept-cabinet/folders
GET    /v1/codocs/dept-cabinet/folders/{id}
PATCH  /v1/codocs/dept-cabinet/folders/{id}
DELETE /v1/codocs/dept-cabinet/folders/{id}
```

文件内容上传、下载、在线预览、PPTX/HTML 转换和转文档动作仍由 Codocs Nuxt BFF 负责 OSS 处理；BFF 只能通过上述 runtime API 读写文件元数据。

### 9.3 问题、批注和评审基础表

```text
GET    /v1/codocs/issues
POST   /v1/codocs/issues
GET    /v1/codocs/issues/pending-count
GET    /v1/codocs/issues/{id}
PATCH  /v1/codocs/issues/{id}
DELETE /v1/codocs/issues/{id}
POST   /v1/codocs/issues/{id}/comments
GET    /v1/codocs/documents/{uuid}/annotations
POST   /v1/codocs/documents/{uuid}/annotations
PATCH  /v1/codocs/documents/{uuid}/annotations/{id}
POST   /v1/codocs/documents/{uuid}/annotations/{id}/replies
DELETE /v1/codocs/documents/{uuid}/annotations/{id}/replies/{replyId}
GET    /v1/codocs/reviews
GET    /v1/codocs/reviews/{id}
GET    /v1/codocs/reviews/templates
POST   /v1/codocs/reviews/templates
GET    /v1/codocs/reviews/templates/{id}
PATCH  /v1/codocs/reviews/templates/{id}
DELETE /v1/codocs/reviews/templates/{id}
GET    /v1/codocs/reviews/publish-requests
POST   /v1/codocs/reviews/publish-requests
GET    /v1/codocs/reviews/publish-requests/{id}
PATCH  /v1/codocs/reviews/publish-requests/{id}
DELETE /v1/codocs/reviews/publish-requests/{id}
```

评审审批动作、归档、盖章、收发文、Workflow 回调等存在复杂事务或跨系统副作用的路径，当前不得使用通用 CRUD 凑合实现。补齐专用 runtime contract 前，Codocs Nuxt handler 必须显式返回 503。

### 9.4 资讯中心

```text
GET    /v1/codocs/info/list
GET    /v1/codocs/info/items/{id}
DELETE /v1/codocs/info/items/{id}
GET    /v1/codocs/info/bookmarks
PUT    /v1/codocs/info/bookmarks/actions
PATCH  /v1/codocs/info/bookmarks/actions
POST   /v1/codocs/info/bookmarks/import
POST   /v1/codocs/info/bookmarks/processing
POST   /v1/codocs/info/items
```

资讯中心的数据库读写由 runtime 负责：

- `info_items` 列表、详情元数据、阅读人员与阅读数更新。
- 删除资讯条目并将关联 `info_bookmarks.status` 恢复为 `pending`。
- 书签管理列表，以及批量置为 `ignored` / `processing`。
- `x-bookmark-fetcher` 采集结果导入、processing 书签读取，以及处理完成后的 `info_items` 创建和书签 `processed` 状态更新。

Markdown 正文读取、图片 URL 适配、OSS 删除、推荐通知和触发 `x-bookmark-fetcher` 处理任务仍由 Codocs Nuxt BFF 编排，不得在 Nuxt BFF 中直连 Codocs DB。`x-bookmark-fetcher` 可处理 X 抓取、外部文章解析、Markdown/图片上传到 OSS，但资讯数据库读写必须通过上述 runtime API。

### 9.5 显式关闭的旧入口

以下历史入口不得回退 Codocs Nuxt 本地 DB；没有专用 runtime 合同前应返回 503：

- `/api/reviews/**` 中的评审动作、Workflow 回调、收发文、归档和盖章。
- `/api/project-docs/**` GitLab 同步、冲突处理和版本回写。
- `/api/company-assets/**`、`/api/dept-assets/**` 导入导出。
- `/api/admin/images/**`、`/api/admin/cleanup-orphan-docs` 图片元数据和清理任务。
- `/api/upload/image`、`/api/ai/abstract`、`/api/dingtalk/sync-reports` 等依赖旧 DB 落库或复杂副作用的入口。

## 10. Contract Test

每个已迁移 app 至少需要三类 contract test：

1. **OpenAPI schema test**：接口实现返回值符合 OpenAPI schema。
2. **Compatibility test**：同一 fixture 下，旧 Nuxt API 与 tenant-runtime API 返回业务等价结果。
3. **Error contract test**：认证失败、权限不足、schema mismatch、参数非法返回标准错误格式。

测试命名建议：

```text
contract:{appCode}:runtime
contract:{appCode}:compat
```

完成迁移后，生产构建或部署检查必须能阻止以下情况：

- OpenAPI 缺失。
- runtime capability 缺失。
- schema status 不满足 API 要求。
- UI app 版本与 runtime 版本超出兼容窗口。

## 11. 版本与 Capability

`GET /runtime/capabilities` 返回 runtime 当前能力：

```json
{
  "runtimeVersion": "0.3.0",
  "tenant": "wiztek",
  "deployment": "wiztek-console",
  "apps": {
    "finance": {
      "enabled": true,
      "apiVersion": "v1",
      "openapiHash": "sha256:...",
      "schemaStatus": "ok",
      "capabilities": ["finance.dashboard.read"]
    }
  }
}
```

UI app 调用 runtime 前，应检查当前页面依赖的 capability 是否存在；部署流程应在发布前执行同样检查。

## 12. 禁止事项

- 不提供 SQL over REST。
- 不把数据库 password 下发给平台 UI 或业务 Worker。
- 不在错误响应中返回 SQL、secret、token。
- 不让一个 app adapter 直接跨库 join 另一个 app 的表。
- 不把 Console vault/OIDC 启动闭环迁入第一阶段 runtime。
