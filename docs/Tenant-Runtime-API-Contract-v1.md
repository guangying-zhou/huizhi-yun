# Tenant Runtime API Contract v1

状态：Draft  
日期：2026-06-01  
关联 ADR：[`ADR-016: Tenant Runtime 业务 API 架构`](./ADR-016-Tenant-Runtime-Business-API-Architecture.md)

2026-09-21 可选策略合同：`GET/PUT /v1/console/verified-policy` 已有代码及隔离
HTTP/MySQL 验证，默认关闭。复用 `console:policy-bundle:read|write`，严格 Console
JWT、显式部署绑定及实时 grant/credential 检查；新持久表与旧 opaque 存储隔离。
PUT `{envelope,expectedEtag}` 执行事务 CAS/防回退，相同内容重放不刷新接纳时间。
GET 返回当前持久回执（可含过期/撤销策略），不代表授权通过；消费者必须复验
签名、当前有效期和 active 状态。尚未启用 Enterprise source 或目标环境切换。
Console GET 首次缺行返回 `404 policy_snapshot_missing`；缺表/配置/损坏为 503，
不能把任意 404/503 当作空水位。Enterprise 读口缺行仍为 503。Console 显式新后端
已按此接线，未切换运行环境，详见同一合同第 9 节。
完整字段、配置、兼容及错误码见 [策略验证合同](./Console-Enterprise-Policy-Verification-Contract.md#7-runtime-持久化与接口批次代码验证完成环境未启用)。

2026-09-25 可选 P1：`POST /v1/console/auth/service-tokens/exchange` 仅接受 `console.runtime` 的完整服务 JWT 和新 `console:service-token:exchange` 精确 scope，拒绝 key assertion/bootstrap 及请求体自选来源、租户、部署。仅用于携带 secret 的 `client_credentials`；Runtime 在同一事务检查客户端当前密钥、grant 和来源部署，比较 Console 已验证策略摘要与本地存储的 version/hash，签名并写成功审计，提交后才返回令牌。摘要不作为授权事实。默认关闭；无密钥 Gateway 路径保留现有合同。

2026-09-22 Console 稳态服务身份（R1）：`POST /v1/console/auth/service-tokens/issue` 除 Platform 启动令牌外，
还接受 Console 部署密钥断言（`typ: hzy-console-assertion+jwt`）。只在该路由生效；Runtime 要求
Console 部署的已验证信封为 `valid/grace`、公钥在信封 `serviceKeys` 中，并一次性消费 `jti`
（可选表 `console_service_assertion_replay`）。错误码 `console_assertion_invalid`（401）、
`console_assertion_replayed`（401）、`console_assertion_policy_inactive`（403）、
`console_assertion_not_migrated`（503）。详见策略验证合同 §15。

2026-09-22 续签状态（阶段 B，需先执行 `Console-SQL-Migration-verified-policy-renewal-state.sql`）：
`PUT /v1/console/verified-policy/renewal` 请求体为 `{state,expectedEtag}`，`state` 取
`ok|platform_unavailable|refused|invalid`（`refused/invalid` 对同一 ETag 粘性，只有接纳新信封才重置），要求精确 capability `console:policy-bundle:write` 和 Console 来源；
`expectedEtag` 必须等于当前快照，否则返回 409；没有快照返回 `404 policy_snapshot_missing`；
表未迁移返回 `503 policy_renewal_not_migrated`。尝试时间由 Runtime 取，只会向后推进，
不接受调用方传入。成功写入信封会自动把状态置为 `ok`。
`GET /v1/console/verified-policy` 和 `GET /v1/enterprise/console-policy` 的 `data` 新增
`renewal: {state, attemptedAt} | null`；未迁移或没有状态时为 null。续签状态不属于签名回执，
也不单独构成授权结论。判定规则见 docs/Console-Enterprise-Policy-Verification-Contract.md 第 14 节。

后续只读候选 `GET /v1/enterprise/console-policy` 已注册，默认额外关闭。
要求 Enterprise 自身精确读 grant 与部署、Console 存储部署显式绑定、签名覆盖
两个部署及当前有效 active 状态；不开放写入。Host gate 接线但未启用，见上述合同 §8。

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
| `GET` | `/runtime/schema/status?app={appCode}` | 指定 adapter schema 状态；Console 对照随二进制发布的 manifest 检查表、列、索引和命名约束 |
| `GET` | `/runtime/schema/status?app=console&mode=cutover` | Console 生产切换就绪检查；需精确 `console.schema.read`，并核验 Runtime DB 非 root、非 `%` host、无全局或超范围 schema 权限；只有 `status=ready` 且 `blockers=[]` 才可切流 |
| `POST` | `/runtime/update` | Console 触发精确版本更新，需 `runtime.update` scope；body 只允许 `targetVersion: X.Y.Z`，特权路径/来源/force 字段拒绝；统一返回持久 `operationId + queued`，由 external root oneshot 执行 |
| `GET` | `/runtime/update/status` | 查询持久 journal 中最近一次更新的状态、phase、前后版本/SHA 和脱敏错误码，需 `runtime.update` scope；跨重启保留，未知终态返回 `partial_or_unknown` |

`GET /runtime/enrollment` 是 Agent 本机只读状态，不承担首次注册。首次注册使用 Platform
`POST /api/v1/runtime/enroll` 的一次性 code 兑换流程。返回状态额外包含 `runtimeCode`
和 `deploymentBindings`；JWT 模式按请求的 `appCode` 校验对应应用 deployment binding，
未配置该应用 binding 时才兼容使用 Runtime 默认 deployment。

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

Aims 项目治理首期使用业务命令端点，不向新版本/审阅表暴露通用 CRUD：

| 方法 | 路径 | 关键约束 |
| --- | --- | --- |
| `GET/PUT` | `/v1/aims/admin/weekly-reporting-settings` | 仅 `weekly_reports:configure`；配置带单调版本 |
| `GET/POST` | `/v1/aims/projects/{projectId}/manager-delegations` | GET 需项目读取或当前项目总监；POST 仅当前项目总监，代理必须为 active 项目成员且任期不重叠 |
| `POST` | `/v1/aims/projects/{projectId}/manager-delegations/{id}:revoke` | 仅当前项目总监；追加撤销事实，不删除任命 |
| `POST` | `/v1/aims/weekly-reporting-periods/{periodKey}:generate` | `periodKey=YYYY-Www`；仅当前项目总监或配置管理员；rollout disabled 时失败关闭，截止后冻结义务 |

这些浏览器/BFF 路径仍由 Aims tenant-runtime token 保护。`current_user` 与项目治理权限标志必须由已验证 BFF 会话重建；客户端同名 query 参数一律删除。

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
- Runtime 可以短时缓存远端 JWKS，但当格式有效的 JWT 引用缓存中不存在的 `kid` 时，必须绕过常规缓存主动刷新一次再判定无效；强制刷新需要全局冷却，避免任意 `kid` 形成无界外部请求。Console 签名密钥轮换后不得要求等待缓存 TTL 或重启 Agent 才能验证新 Token。
- `aud` 为 `tenant-runtime`。
- `tenant` / `deployment` 与 runtime enrollment 匹配。
- `appCode` 已启用。
- `scope` 覆盖请求 API；同一个 token 可携带空格分隔的多 scope。
- 迁移期通用 runtime 路由仍可用应用级传输 scope（如 `altoc.read` / `altoc.write`，或 audience 前缀后的 `tenant-runtime:altoc:read|write`）完成入口认证；高价值领域命令应同时携带并执行资源/动作 capability（如 `altoc:lead:edit` / `altoc:lead:convert`），adapter 不得只依赖传输 scope 作为业务授权边界。
- token 未过期。

迁移期兼容当前 `aud=data-runtime` 的旧部署；新增接口应优先使用 `tenant-runtime` 命名。

runtime 在认证完成后，必须删除 query/body 中由调用方伪造的运行时上下文字段，再向 adapter 注入受信的 `hzy_runtime_tenant_code`、`hzy_runtime_deployment_code`、`hzy_runtime_source_app`、`hzy_runtime_service_client_id` 和 `hzy_runtime_request_id`。这些字段只供 data-runtime 内部领域命令使用，不是公共请求参数；adapter 的 integration operation、receipt、审计或租户边界不得读取浏览器 body 中的 `tenantCode/deploymentCode/sourceApp/serviceClientId` 作为事实。

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
x-hzy-tenant-runtime-audience
```

共享托管路径不传递长期 Runtime token。业务 Worker 必须使用已验证的 tenant/deployment/environment/app 运行时身份向 Console 申请短期 service token，再以 `Authorization: Bearer ...` 访问 Runtime。只有显式启用的离线/专属兼容 registry 才可以提供 `x-hzy-tenant-runtime-token`。

迁移期兼容旧头：

```text
x-hzy-data-runtime-url
x-hzy-data-runtime-token
x-hzy-data-runtime-audience
```

业务应用只能在 `x-hzy-gateway-token` 与自身配置的 `HZY_CLOUDFLARE_INTERNAL_TOKEN`（迁移期兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`）匹配时信任上述发现头；不得仅凭 `x-hzy-gateway=tenant-gateway` 接受租户、部署、runtime URL 或兼容 token。

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
GET    /v1/codocs/documents/search                 # retired: 503 scoped_document_service_contract_required
POST   /v1/codocs/documents/batch-summary          # retired: 503 scoped_document_service_contract_required
GET    /v1/codocs/documents/check-name
GET    /v1/codocs/documents/trash
GET    /v1/codocs/documents/{uuid}
PATCH  /v1/codocs/documents/{uuid}
PUT    /v1/codocs/documents/{uuid}
DELETE /v1/codocs/documents/{uuid}
POST   /v1/codocs/documents/{uuid}/restore
GET    /v1/codocs/documents/{uuid}/shares
POST   /v1/codocs/documents/{uuid}/shares
POST   /v1/codocs/documents/{uuid}/relations/preview-access  # currently fail-closed
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
PATCH  /v1/codocs/folders/{id}/open
GET    /v1/codocs/open-department-documents
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

`GET /v1/codocs/documents` 与 `GET /v1/codocs/documents/trash` 是用户态读取合同：runtime 只接受经 Foundation 签名并由 tenant-runtime 验证后注入的 actor，不接受浏览器传入的 actor 字段；缺失或未受信 actor 必须失败关闭。返回集只能包含 actor 拥有的文档、直接 `document_shares`、有效且 `can_read=1` 的 `document_relations`（`project_preview_access` 仍受 12 小时有效期限制），以及 Codocs BFF 已通过部门读取校验后传递的同部门 `department` 文档。`owner`、`project_code` 等客户端过滤条件只能收窄上述集合，不能授予访问；项目成员资格不得由该通用列表端点推断。

`POST /v1/codocs/documents/{uuid}/relations/preview-access` 当前明确失败关闭，不得依据请求体的 `actorUid`、`sourceApp` 或 `sourceProjectCode` 新建 `project_preview_access` 关系。恢复该能力前，必须消费 Foundation 验证的 AIMS→Codocs service-command：命令需绑定 source/target app、租户/部署、目标用户、文档 UUID、项目归属 assertion、过期时间与幂等键；并且 Codocs service API 必须只接受 AIMS 的专用 capability。

`GET /v1/codocs/folders` 同样是用户态 ACL 读取：必须有 Foundation 签名 actor；通用入口仅返回 actor 自己的 `private` 文件夹，或 Codocs BFF 已核验的精确部门 `department` 文件夹。请求中的 `owner_uid`、`dept_code`、`project_code` 都只能收窄集合；`project`、`publish`、`slide` 文件夹在其来源域范围断言合同落地前不得由此端点返回。部门目录开放状态写入还要求 BFF 在部门经理校验后传递精确管理部门标记，runtime 会重新比对目标目录部门。

`POST /v1/codocs/folders` 是专用目录创建合同，不使用 generic resource insert。它必须要求 Foundation 签名 actor，并且当前只接受 `private` 与 `department`：私有目录的 `owner_uid` 始终由受信 actor 覆写，请求体中的 owner、部门和项目字段不能改变归属；部门目录必须携带 Codocs BFF 在完成部门负责人校验后写入的精确受信管理部门标记，runtime 会再次要求请求体 `dept_code` 与该标记一致。创建子目录时，runtime 必须重新读取父目录并按目录类型校验规范命名空间：`private` 由类型与精确 `owner_uid` 组成，`department` 由类型与精确 `dept_code` 组成；存量部门父目录中仅记录创建人的 `owner_uid` 不参与部门命名空间判断。不同 owner 或不同部门仍必须拒绝，禁止用猜测的 `parent_id` 跨范围挂载。`project`、`slide` 与 `publish` 目录在各自来源范围合同落地前继续返回 `503`。

`GET /v1/codocs/open-department-documents` 是登录用户读取部门开放文档的专用合同。它仍要求 Foundation 签名 actor，但不要求 actor 属于目标部门；runtime 只返回 `is_open=1` 的部门目录、这些目录在同一 `dept_code` 下的后代目录，以及其中 `status=1`、未发布且非周报的部门文档。可选 `uuid` 只能进一步收窄文档结果。该合同不得复用或放宽普通目录/文档 ACL，异常的跨部门父子目录关系也不得扩大可见范围。

`PATCH /v1/codocs/folders/{id}/open` 只接受 Codocs BFF 在完成当前用户部门负责人校验后写入的精确受信管理部门标记。runtime 必须要求签名 actor，并在写入前重新读取目标目录的 `folder_type` 与 `dept_code`；仅当它是同一部门目录时才允许修改 `is_open`。

所有其他 `folders/{id}` detail、普通 update/delete 路径当前必须拒绝，不能回落到 generic resource adapter；后者没有足以表达 private owner、department manager 与 project source-domain scope 的对象谓词。恢复时须为各操作建立专用 runtime 合同并分别绑定 owner/部门管理/签名项目范围。

Review、publish-request 与 review-action 同样不得使用 generic resource fallback：专用读取路径必须按文档 ACL、发起人和本地参与事实投影；创建、状态迁移、取消、workflow instance 绑定与 action 写入须由专用命令合同验证 actor、目标文档写权限、合法状态迁移及可信 workflow 来源。

`GET /v1/codocs/collaboration/documents/{uuid}/context` 与两个版本写入口只消费 tenant-runtime 覆写后的 `current_user`，不得信任 query/body 的 `actorUid`、`editorUid` 或 actor name。版本写入在同一事务内锁定 documents 父行、校验 owner 或精确 `document_shares.permission=write`（readonly/删除文档失败关闭）、读取 `MAX(version_num)` 后追加 `document_versions`；不得把 ACL、父行锁或版本号计算移出该事务。

所有 Codocs 文档写入均以该受信 actor 执行 owner/write-share 校验；请求体的 `serverAuthorized` / `server_authorized` 不是服务端权限凭据，必须在进入 adapter 前剥离，且不得形成任何 ACL 绕过。

`POST /v1/codocs/documents` 创建文档时，documents 行与 owner 的 `created_by_me` relation 必须在同一数据库事务中写入；relation 写入或提交失败时必须回滚 documents 行，不能返回一个缺少 owner relation 的成功文档。

`GET /documents/{uuid}/shares` 只对受信 document owner 返回共享对象及留言；版本列表只对通过文档读取 ACL 的受信 actor 返回，版本删除须重新通过 owner/write-share 写入 ACL。阅读回执只记录受信 actor 本人的直接 share，不能接受 body 的 `uid` 代写。

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

批注读取要求可信 actor 对目标文档拥有 owner、直接 share、有效 read relation 或已由 BFF 校验的同部门读取范围；批注创建、状态变更、回复和回复删除要求 owner 或精确 write share。运行时以注入 actor 写入 author/resolved/deleted 字段，并校验 annotation/reply 与路径 `uuid` 的归属；BFF 不接受或转发浏览器传入的 author、resolver，路径外 ID 或 `serverAuthorized` 类字段均不得越权。

批注的全部读写还必须带 Foundation 签名 actor delegation；无签名 actor 在文档或批注 SQL 前失败关闭。BFF 读取要求登录及 `documents:view`，创建、状态变更、回复与删除要求登录及 `documents:edit`。

Issue 列表、详情、待办聚合、创建、更新、删除和评论均要求 Foundation 签名并经 tenant-runtime 验证的 user actor delegation；无 actor、无 delegation、非空 actor purpose 或无精确 `codocs_trusted_issue_project_code` 标记均在 SQL 前失败关闭。BFF 必须先以已验证会话 uid 从 Console Directory 读取项目、该 uid 的 managed/joined 项目关系和项目部门链，再用 Foundation scoped authorization 在同一 grant 中判定 `codocs/projects:view|edit`；目录或授权不可用返回 503，不能退回扁平 `projects:view|edit`。所有浏览器入口均必须传目标 `project_code`：list/pending/detail/comment 使用 `view`，create/update/delete 使用 `edit`。BFF 清洗浏览器自报的 actor、项目和 marker，只在上述判定成功后将精确项目写入 request-target HMAC 覆盖的 marker。

Runtime 的 list/count 固定 `project_code = marker`，detail/update/delete/comment 固定 `issue id + marker`，不得先按 ID 探查所属项目；comment 使用 parent-bound `INSERT … SELECT`，delete 0 affected 返回 404。创建者和评论作者只能取受信 actor。create 与变更 `document_uuid` 必须在同一事务确认其为 marker 项目的 active `project|git-project` 文档，跨项目、私有、失效或不存在的 UUID 不得写入 Issue。列表 page size 上限为 100。Issue 本身不读取 Git/OSS；不得将 repository ACL 虚构为 Issue 合同。

`/v1/codocs/document-access/**` 是策略和审计敏感面：检查、策略读取/更新及审计读取都要求受签名 actor delegation；BFF 分别要求 `documents:view`（检查）和 `documents:admin`（策略/审计）。调用方 body 的 `actorUid`、项目、部门、角色数组不是受信属性，runtime 必须剥离它们；当前只使用受签名 actor 与其受信部门代码匹配 user/dept grant，项目/角色 grant 在 Foundation/Console 提供绑定 data-scope delegation 前必须失败关闭。过期的 grant 不参与判定。

评审审批动作、归档、盖章、收发文、Workflow 回调等存在复杂事务或跨系统副作用的路径，当前不得使用通用 CRUD 凑合实现。补齐专用 runtime contract 前，Codocs Nuxt handler 必须显式返回 503。

### 9.3.1 组织资产管理员发布与查看记录

```text
POST /v1/codocs/company-assets/quick-publish/prepare
POST /v1/codocs/company-assets/quick-publish/complete
POST /v1/codocs/company-assets/access-records
GET  /v1/codocs/company-assets/access-records
GET  /v1/codocs/company-assets/access-records/export
```

仅接受 Foundation 签名并验证的用户 actor delegation、Codocs 来源及 BFF 授权后生成的受签名操作 marker。快速发布使用 `codocs_trusted_company_quick_publish=1`，查看记录使用 `codocs_trusted_company_asset_access_action=record|list|export`；浏览器提供的 actor/marker 无效。管理员权限分别由 BFF 的 `admin:admin + company:publish`、`admin:admin + company:admin` 校验，导出额外要求显式 `company:export`。

prepare 接收 `operationId/targetPrefix/documentUuids`，按数据库中有效部门文档生成持久化计划；complete 接收同一操作编号和 OSS 条件写入证据，事务创建只读发布副本与保存结果。不修改源文档，不调用 Workflow 或通知。相同命令重试幂等，不同 actor 或命令复用编号返回 409。`reviews/by-oss-path` 的公司资产查询由 BFF 管理员鉴权后附加 `codocs_trusted_company_publish_history=1`，完成的快速发布可投影为直接发布记录，不伪造审批事件。

查看记录 record 只接收 BFF 成功准备正文或 PDF 数据后生成的 `path/eventId`，用户与时间由 runtime 注入。PDF 元数据响应不重复计数，画布翻页/缩放复用已加载数据。list/export 以精确 OSS 路径与可选 UTC 日期过滤；CSV 由 BFF 格式化，runtime 导出上限 50,000 条，超限 413。此审计无法证明用户阅读完成，也不补历史记录。

新增表为 `company_asset_quick_publish_operations` 和 `company_asset_access_records`，必须先迁移表并更新 runtime，再部署 Codocs；查看记录写入失败会阻止预览返回。详见 [Codocs 上线说明](../codocs/docs/Company-Asset-Admin-Publishing.md)。

### 9.3.2 已发布资产短链接

```text
POST /v1/codocs/published-asset-links          query: path + codocs_trusted_published_asset_link_action=create
GET  /v1/codocs/published-asset-links/{token}  query: codocs_trusted_published_asset_link_action=resolve
```

仅接受 Foundation 已验证的签名用户 actor delegation、Codocs 来源和对应可信操作 marker，使用既有 `codocs.write/read` runtime scope。BFF 生成前校验原预览的公司/部门阅读权限及 OSS 对象存在；解析后按实际目标路径重新鉴权，短码不授予额外阅读权限。响应 `{success:true,data:{token,path}}`，无任意 URL 目标、无正文、无通知副作用。

`published_asset_links` 位于当前租户 Codocs 数据库，token 为精确 OSS 路径 SHA-256 前 12 字节的 base64url（16 位、大小写敏感）。创建幂等重放不修改已有路径/创建人，碰撞 409，不覆盖；解析 GET 只读，未找到 404，损坏目标 409。仅接受规范已发布 company/departments 命名空间，兼容无 UUID 的历史资产。路径移动、归档或删除不会自动重定向旧链接。

上线必须先执行 [短链接表迁移](../codocs/docs/migrations/20260910_published_asset_links.sql)，再更新 runtime 和 Codocs。查看记录 CSV 的姓名由 Codocs BFF 经 Foundation 查询 Console 当前目录补齐，Runtime 审计仍只保存稳定 viewer UID。

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

### 9.6 WebDev 元数据运行时身份边界

`/v1/webdev/**` 是 WebDev 控制台的 metadata API，不是通用 service proxy。除下列精确 bridge 外，所有读取、job 创建/更新、Issue 读取/创建/更新/领取、事件和设置路径都必须携带绑定完整 HTTP request target 的 HMAC actor delegation。runtime 在进入 adapter 前必须验证签名，重建 `current_user` 与 tenant/deployment/source context，并忽略浏览器 query/body 自报的 actor、`createdBy`、Issue `reporterUid/reporterName`、事件 `actor` 和 tenant；缺签名、service client subject 伪装成用户、或带专用 purpose 的 delegation 均返回 `403`。

Issue 的 tenant 只来自运行时验证后注入的 tenant context；列表、详情（含 events）、创建、更新、领取、事件和设置都必须使用该 tenant 过滤，不得采用 query/body `tenant`。WebDev PoC 的 jobs/projects/agents schema 尚未承载 tenant 列，不能声称 runtime 已提供它们的数据库 tenant row filter；这些对象仍由 WebDev BFF 的已验证应用权限与项目边界控制，新增 schema 前不得伪造此能力。

唯一 actorless 例外是已验证 WebDev service endpoint 的固定 bridge：

- `POST /v1/webdev/service/issues/intake`：WebDev 已验证上游 Console service token、来源应用和租户后，把服务端会话派生的上报投影写入 runtime。
- `GET /v1/webdev/service/issues/mine`：同一已验证 service bridge 对当前会话派生 reporter 做受限查询。
- intake 自动领取仅可继续调用 `GET /v1/webdev/service/issues/settings`、`GET/PATCH /v1/webdev/service/issues/{id}`、`POST /v1/webdev/service/issues/{id}/claim` 与 `POST /v1/webdev/service/jobs`；它们不是一般 WebDev service API。

这两个路径不能把 runtime service client subject 当作用户 actor，且不能扩展为宽泛 `/v1/webdev/service/**` allowlist。普通 WebDev BFF 调 runtime 时使用当前 Console 用户与 runtime bearer 的 HMAC；service intake/mine 则只可从已验证的 WebDev service endpoint 到达。

## 10. Finance / Altoc 通知目标对象范围

### 10.1 Finance 开票申请与到账记录

| 方法 | 路径 | 对象范围 |
| --- | --- | --- |
| `GET` | `/v1/finance/invoice-requests`、`/v1/finance/invoice-requests/{code}` | 当前 `issuance_responsible_uid`，或受信全局访问 |
| `GET` | `/v1/finance/receipts`、`/v1/finance/receipts/{code}` | 当前 `reconciliation_responsible_uid`，或受信全局访问 |
| `POST` | `/v1/finance/invoice-requests/{code}/issue` | 独立 `invoices:issue` action + 当前开票责任；受信全局访问可旁路责任关系 |
| `PATCH/PUT` | `/v1/finance/receipts/{code}` | 独立 `receipts:confirm` action + 当前核销责任；受信全局访问可旁路责任关系 |
| `POST` | `/v1/finance/reconciliation` | 独立 `reconciliation:confirm` action + 当前到账核销责任；受信全局访问可旁路责任关系 |

Finance action URL 固定为 `/finance/invoices/requests/{code}`、`/finance/receipts/{code}`。BFF 将当前授权解析为 `all/relation/none` 并以可信 runtime 字段传递；`relation` 只匹配数据库当前直接责任人，责任转移后旧责任人立即失效。浏览器不能通过 query/body 伪造 actor、access 或 notification relation；通知可见关系不授予写权限。manifest 只声明既有 `tenant:global` 与 `subject:self` 范围，不自动授予任何权限。

Finance 普通用户读取、通用资源详情、通用写入和项目/费用/绩效范围操作必须携带与完整 HTTP request target 绑定的 runtime actor delegation。Finance BFF 可把 Console/Foundation 已求值的 `current_user_*_access`、项目或部门范围放入该受签名 request target；runtime 只在 HMAC 验证成功后保留这些字段并重建 actor，缺 delegation 在任何 SQL/mutation 前失败关闭。`/v1/finance/service/**`、Workflow callback 和 Finance scheduled notification 专用合同是明确 actorless service/worker 路径：runtime 删除浏览器伪造的 Finance actor/scope 字段，不能将 service client subject 当作用户 actor。due-notification 的 scan/ack/closure-ack 是其中更窄的封闭 worker 合同：只接受 `sub=client:finance.runtime`、`data-runtime:finance:notifications_due:execute`、匹配 enrollment 的 tenant/deployment 与 `finance-due-notification-worker` request-target HMAC；static、`finance.write` 或通用 service caller 均在 adapter/SQL 前拒绝，且 body 只允许 route 指定字段。

### 10.2 Altoc 应收计划对象范围

Altoc 用户态应收接口：

| 方法 | 路径 | 对象范围 |
| --- | --- | --- |
| `GET` | `/v1/altoc/payments` | 计划 owner、合同 owner、合同部门，或当前精确 `collection_responsible_uid`；显式 admin/all 可旁路 |
| `GET` | `/v1/altoc/payments/{code}` | 与列表相同，`code` 同时是通知 descriptor 与 action URL 使用的稳定业务键 |
| `PUT/PATCH` | `/v1/altoc/payments/{id-or-code}` | 仅原计划 owner、合同 owner、合同部门或显式 admin/all；催收责任关系不单独授权写入 |
| `POST` | `/v1/altoc/payments/{id-or-code}/confirm` | 需要 `receivable:confirm`，并继续执行原 owner/合同写入对象范围 |

`POST /v1/altoc/notification-details/authorize` 不复用上述普通读取 OR 范围。它只在 descriptor 精确为 `{resource:'receivable_plan',id:code}`、subject 仍为当前 `collection_responsible_uid` 且计划仍可催收时返回允许；计划 owner、合同 owner、部门与 admin 均不是通知详情关系 fallback。所有用户态范围均从当前请求身份与当前数据库事实求值，不缓存责任人关系。

## 11. Contract Test

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

## 12. 版本与 Capability

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

### 12.1 Aims / Altoc dead-letter actionable source lifecycle

Aims 与 Altoc 使用完全对称的 source-owned runtime 合同：

- `POST /v1/{app}/integration-operations:pending-dead-letter-actionables`
- `POST /v1/{app}/integration-operations/{operationId}:dead-letter-actionable-published`
- `POST /v1/{app}/integration-operations:pending-dead-letter-closures`
- `POST /v1/{app}/integration-operations/{operationId}:dead-letter-closure-acknowledged`

发布扫描只返回绑定 tenant/deployment/source 的安全 generation 投影，不返回 operation key、idempotency key、command/hash、raw error/response、token 或 URL。发布确认必须精确回写 Console `notificationId` 和实际 `recipientUids`；generation、source operation version、actionable key、object version、notification 和规范化收件人共同参与幂等 CAS。

Replay 在同一事务产生 `cancelled` closure；`RecordSuccessWithMutation` 以及 failure decision 的幂等成功在同一事务产生 `resolved` closure。closure 未确认前，同一 operation 的新 dead-letter generation 不得发布。通知详情验证只返回 `authorized/reasonCode/resource/id`，并要求当前 generation、notification、recipient、tenant/deployment/source 与 operation 状态完全匹配。

完整 DTO 和字段上限见 Aims / Altoc 各自的 `Dead-Letter-Actionable-Runtime-Contract-v1.md`。

## 13. 禁止事项

- 不提供 SQL over REST。
- 不把数据库 password 下发给平台 UI 或业务 Worker。
- 不在错误响应中返回 SQL、secret、token。
- 不让一个 app adapter 直接跨库 join 另一个 app 的表。
- 不把 Console vault/OIDC 启动闭环迁入第一阶段 runtime。


### ADR-018 AA-04：既有Aims审批回调的统一事务模式

`POST /v1/aims/service/workflow/callback` 保持既有请求/响应，只有Runtime服务器配置 `enterprise.enableMilestoneReceivable=true` 且子类型为 `milestones/milestone_completion` 才分流。false继续旧adapter；true但Enterprise关闭或服务缺失返回503。协调模式重验严格Aims服务JWT、当前租户及legacy Aims deployment、`sub/client=aims.runtime`、当前credential/grant和精确 `altoc:receivable:mark-billable`；原 `aims.write` 入口要求仍保留。仅允许固定Runtime audience的组合token，不转发Workflow或Altoc audience token。

审批事实仍从已认证Workflow→Aims BFF边界进入，浏览器不能提交可信授权。Aims审批、Altoc可开票变更、目标receipt、源ACK在同一Registry双域事务内提交，成功提交后响应operationStatus为succeeded；同键重放保留历史身份。详细开关、调用方及验证范围见[AA-04专项](./Unified-Enterprise-Altoc-Aims-Expansion.md)。此模式尚未在线上启用。
