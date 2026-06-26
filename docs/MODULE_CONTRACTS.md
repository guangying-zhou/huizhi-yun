# 模块交互契约

> 本文档定义汇智云各模块间的 API 调用关系、共享标识和集成规则。
> 更新日期：2026-06-25

> 说明：本文档描述**当前有效契约与目标主路径**。新能力默认走 `platform` 策略治理、`console` 企业基础运行服务、Console Directory API、Console OIDC、Console service token 与 Foundation adapter；`account` 仅作为 legacy 目录/身份/项目注册表迁移源与兼容 facade。存量未迁移调用关系继续有效，但不得为新能力新增 `account` 权限治理、目录扩展或静态跨模块密钥依赖。详见 `Directory-Runtime-Contract.md`、`Account-Directory-Runtime-Refactor-Plan.md`、`Console-Directory-Runtime-Integration-Plan.md`、`Console-Functional-Design-v1.md`、`Console-SQL-DDL-Draft-v1.sql` 与 `Console-API-Contract-v1.md`。

## 核心原则

1. **禁止跨模块数据库直连** — 所有集成通过 HTTP API + 回调完成
2. **单一事实源** — 每类数据只有一个权威模块（见下表）
3. **稳定标识** — 跨模块引用使用业务键，不使用内部自增 ID
4. **统一服务认证** — 跨模块服务端 API 调用、回调、同步和写操作统一使用 Console 签发的 `token_use=service` JWT；业务应用通过 Console runtime/app identity 获取运行时配置与短期 token，本地 env 不新增跨模块 client secret，也不再依赖 app 级 `license.lic` bootstrap。目标模块验证 Console JWKS、`aud`、`scope`、`token_use=service` 和来源应用，不新增共享 webhook secret 或静态 API key。

## 数据归属

| 数据类型               | 权威模块   | 标识键         | 其他模块如何获取         |
| ---------------------- | ---------- | -------------- | ----------------------- |
| 用户、部门、角色、权限 | Console directory-runtime（新主路径）/ Account（legacy 兼容） | `uid`, `dept_code` | 新接入使用 Console Directory API / Foundation adapter；存量 legacy 可继续 Account REST API |
| 平台项目注册表         | Console directory-runtime（新主路径）/ Account（legacy 兼容） | `project_code` | 新接入使用 Console Directory API / Foundation adapter；存量 legacy 可继续 Account REST API |
| 文档内容与元数据       | Codocs     | `uuid`         | Codocs REST API         |
| 研发执行（迭代/任务）  | Aims       | `work_item_id` | Aims REST API           |
| 产品版本、版本特性与版本目标进度 | Aims | `product_code`, `version_code`, `version_id` | Aims service REST API |
| 客户/商机/合同/经营回款计划 | Altoc      | `code`         | Altoc REST API          |
| 发票/到账/核销/支出/项目财务核算/人力成本参数 | Finance | `code` | Finance REST API |
| 资产/采购/环境/产品主档 | Assets     | `asset_code`, `product_code` | Assets REST API         |
| 人员事实、任职、成本快照、项目贡献快照、个人绩效周期与确认结果 | People | `employee_uid`, `assignment_code`, `cycle_code` | People REST / service API |
| 轻量待办/通知/协同入口 | Console employee-portal | `uid`, `appCode`, `biz_id` | Console REST API / Foundation adapter |
| 深度组织协同/借调/协助 | Align（可选增强） | `request_code` | Align REST API          |
| 审批流程/实例/待办     | Workflow   | `instance_id`  | Workflow REST API       |

## 目标/新路径权威源

| 数据类型 | 目标权威模块 | 标识键 | 其他模块如何获取 |
| -------- | ------------ | ------ | ---------------- |
| 企业基础资料、系统参数、节假日/工作日历、集成配置、凭证引用 | Console（端口 3000） | `tenant_code`, `setting_key`, `calendar_code + year_month`, `integration_code`, `secret_ref` | Console REST API / Foundation adapter |
| 用户、部门、岗位、项目注册表、外部目录同步 | Console directory-runtime（已落地核心表与 API，持续迁移） | `uid`, `dept_code`, `project_code` | Console Directory API / Foundation adapter；新 adapter 不提供 Account fallback |
| 人员运营事实、任职、职级、月度人员成本、项目贡献快照和个人绩效周期 | People（端口 3007） | `employee_uid`, `assignment_code`, `cycle_code`, `contribution_code` | People REST / service API；来源事实保留 `source_app/source_biz_type/source_biz_id/source_refs` |
| 租户企业角色、主体授权、policy bundle | Platform（端口 3011） | `role_code`, `subject_code`, `bundle_version` | Platform Dashboard 治理；应用角色仅作为企业角色的权限聚合来源；Console / 企业应用运行时拉取签名 bundle 后本地鉴权 |
| 租户订阅、deployment、license、policy bundle、revocation | Platform（端口 3011） | `tenant_code`, `deployment_code`, `bundle_version` | Platform `/api/v1/runtime/**` / `/api/v1/policy/**` |
| 前端访问观测配置与摘要 | Observability Worker（Cloudflare） | `tenant_code`, `app_code` | Platform tenant-admin dashboard 通过 `/api/platform/tenant-admin/observability/**` 代理读取；明细存 Analytics Engine，摘要和配置存 D1 |

## Platform ↔ Console 运行时契约

已实现的 MVP 调用方向：

| 调用方 | 被调用方 | 方式 | 用途 |
| ------ | -------- | ---- | ---- |
| Console（PM2 / 私有单租户） | Platform | `GET /api/v1/runtime/tenants/{tenantCode}/profile` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 启动时按 `HZY_PLATFORM_TENANT_CODE` 拉取企业基础资料并写入本地 `org_profiles` |
| Console（PM2 / 私有单租户） | Platform | `GET /api/v1/runtime/deployments/{deploymentCode}/bundle` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 首次启动、缓存启动刷新、heartbeat `download_bundle` action 触发时拉取签名 policy bundle |
| Console（PM2 / 私有单租户） | Platform | `GET /api/platform/runtime/applications?tenantCode={tenantCode}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | `/api/user/applications` 可按需获取当前 deployment 环境的租户订阅应用入口；用户可见性由本地已验签 policy bundle 的角色授权过滤 |
| Console（PM2 / 私有单租户） | Platform | `POST /api/v1/runtime/subjects/sync` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 启动时重建 `directory_subject_exports`，并把最小 subject 投影同步到 `tenant_subjects`；同时同步 `directory_user_departments` 的多归属 membership 到 `tenant_subject_memberships`；不包含姓名、邮箱、手机等目录 PII |
| Console（PM2 / 私有单租户） | Platform | `POST /api/v1/runtime/heartbeat` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 上报 Console deployment 心跳、bundle 版本、auth-runtime 健康状态与签名 key 指纹 |
| Console（Cloudflare 共享） | Platform | `GET /api/platform/internal/console/tenants/{tenantCode}/bundle?environment={environment}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN` | 在携带统一内部 token 的 Tenant Gateway 请求上下文中按租户拉取签名 policy bundle；旧 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` 仅作兼容；不使用租户 Runtime Token 或 deployment license token |
| 企业应用（经 Foundation） | Console | `GET /api/v1/console/runtime/apps/{appCode}/config` | 启动时拉取 app runtime config，包括 Console API 端点、应用元数据、Workflow 地址和非 secret 运行参数；不直接读取 app license 派生启动配置 |

约束：

- PM2 / 私有单租户 Console 的 `HZY_PLATFORM_RUNTIME_TOKEN` 来自 platform 开通/订阅页面生成的 env artifact，platform 仅保存 hash。Cloudflare 共享 Console 不配置该 token。
- Console 的 `HZY_CONSOLE_VAULT_MASTER_KEY` 由 Platform 在生成 Console 部署 env artifact 时自动生成，并在 `deployment_bootstrap_secrets` 中按 deployment 持久复用；Console license 只签入 `vault.masterKeyFingerprint` 指纹，业务应用不持有该值。
- PM2 / 私有单租户 Console 的 `HZY_PLATFORM_LICENSE_TOKEN` 和所有 Console policy bundle 必须用 `HZY_PLATFORM_SIGNING_PUBKEY` 验签；Cloudflare 共享 Console 不配置 `HZY_PLATFORM_LICENSE_TOKEN`，按请求从 Platform 内部 bundle 接口获取并验签。Platform 不再向业务应用下发 app 级 `license.lic`。
- Console 只缓存运行时授权包，不持有 platform 私钥，也不修改 platform 授权治理数据。
- Console `/api/auth/permissions` 与服务端 `checkPermission/requirePermission` 只读取本地已验签 policy bundle，不再代理 Account 权限 API；授权快照返回 `availableRoles` 与 `activeRoleCode`，其中 `availableRoles` 只包含平台企业角色。普通运行默认按用户全部有效企业角色合并计算 `roles/resources` 与 `/api/user/applications` / AppRail / AppLauncher 应用可见性，`activeRoleCode` 仅作为展示/显式模拟提示；只有服务端显式允许的 `role_simulation` 才按指定企业角色收窄，且无效模拟角色不得回退到其他角色；bundle 缺失、过期、未激活时生产环境按失败关闭。
- Policy bundle 的 `applications` 投影包含 `appCode/appName/description/icon/homeUrl/callbackUrl/logoutUrl/basePath/apiBase/appType/runtimeMode/serviceRole/authMode/bundleEnabled/status`，并按 `environment` 生成，可支撑 Console 离线应用入口展示和 OIDC client 物化；bundle 还包含 Platform deployment settings 的 `consoleLogin`，供 Console 运行时消费上游员工登录配置。Cloudflare 共享 Console 的 `/api/user/applications` 只读取本地已验签 bundle，不再用租户 Runtime Token 调用 Platform runtime applications。
- Policy bundle v1 已下发 `subjectRoles.assignmentId`、`subjectMemberships` 与 `subjectRoleScopes`，Foundation 提供 `buildScopedAuthorizationGrantsFromPolicyBundle()` / `evaluatePolicyBundleScopedAuthorization()` 将用户 direct 角色、active 部门/职位 membership 继承角色和 assignment scope 转换为同一授权关系内的 grant 并调用范围 evaluator；Platform 提供 `buildDbAuthorizationGrants()` / `evaluateDbAuthorization()` / `DbGrantSource` 从 DB 形态构建同一授权单元并调用 `@hzy/authz-core`。现有 Console 与业务应用扁平 `checkPermission` 路径不得直接把 `subjectRoleScopes` 合并进全局 scope，业务 API 需要对象上下文时应显式调用 scoped helper。
- Cloudflare 共享 Console 启动时不执行 tenant profile sync、subject sync、heartbeat 或 license token 校验；这些租户级运行态动作只保留在 PM2 / 私有单租户 Console。
- `applications.homeUrl/callbackUrl` 的运行态值由 Platform 生成 bundle 时解析：`homeUrl` 使用当前环境的 `deployment_sites.public_url + deployments.base_path`，为空时才回退到 `platform_applications.home_url`；`callbackUrl` 优先使用应用默认 `callback_url`，为空时按最终 `homeUrl + /api/auth/oidc-callback` 自动生成。manifest 的 `entry.web` 只作为源码声明，不作为客户最终访问地址。
- Foundation 的业务应用 startup activation 默认关闭：Platform activation、bundle 刷新和 heartbeat 只由 Console 执行。Foundation `consoleRuntime.ts` 在业务应用启动时向 Console 拉取 app runtime config；legacy `/api/platform-activation/*` 仅保留为迁移期诊断入口。
- Foundation 默认通过 Console OIDC 接入企业侧 auth-runtime：前端 `useAuth` 消费 `hzy_*` token/session Cookie，服务端通过 Console JWKS 验证 access token 并注入 `event.context.consoleAuth`。`HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时才回退旧 CAS/Account bridge。
- Foundation 默认启用轻量 RUM client，向当前租户域 `/api/rum` 上报页面加载、Web Vital、同源 API 耗时与 JS 错误；tenant gateway 会转发到 Observability Worker。RUM 明细不进入业务数据库，不采集 Cookie、Authorization、请求体、用户输入或 URL query/hash。
- 企业应用之间的服务调用使用 Console service token：调用方通过 Foundation `requestServiceAccessToken()` 获取短期 `token_use=service` JWT。业务应用本地 env 不保存跨模块 client secret，也不再通过 `license.lic` bootstrap 换 token；特殊离线部署可显式配置 service client。目标应用验证 Console JWKS、`aud` 与 `scope`，不再使用 `HZY_ACCOUNT_API_KEY/HZY_ACCOUNT_API_SECRET` 作为跨应用服务凭证。
- 企业应用之间的服务端调用不得使用租户访问入口 `homeUrl`，也不得要求租户在 Console 中配置目标应用服务地址。`homeUrl` 只用于浏览器导航和应用入口展示；服务端跨应用调用通过 Foundation `resolveServiceAppBaseUrl(appCode)` 按应用码解析租户无关的共享应用 origin（Cloudflare 托管云默认 `https://<appCode>.huizhi.yun/<appCode>/`，本地开发默认端口表，可由运营级 `HZY_<APP>_SERVICE_BASE_URL` / `HZY_<APP>_ORIGIN` 覆盖）。租户与部署上下文通过 Tenant Gateway 注入的 `x-hzy-tenant`、`x-hzy-deployment`、`x-hzy-data-runtime-*` / `x-hzy-tenant-runtime-*` headers 传递。
- Console vault 凭证按 `integration / service / bootstrap / custody` 分类管理。Nuxt 业务模块不得直接依赖 `integration_credentials`、内部 credential id 或 `/vault/resolve`；外部集成能力必须通过 Foundation adapter 按 `integrationCode` 消费。`custody` 托管凭证默认只能授权 reveal，不能被程序化 resolve。
- Env 收敛规则：Console 是唯一直接消费 `HZY_PLATFORM_*` 与企业级集成 secret 的企业端基础运行模块；业务应用优先只保留自身数据库、应用身份和 base path，不再新增 app 级 `license.lic`。`HZY_CONSOLE_API_URL`、`HZY_WORKFLOW_API_URL`、`HZY_ACCOUNT_API_*`、`ALIYUN_OSS_*`、`GITLAB_*`、`WECOM_*` 等平台级配置不得在新业务模块中新增，迁移期存量项按 [`ENV_SIMPLIFICATION_PLAN.md`](ENV_SIMPLIFICATION_PLAN.md) 逐步清理。

### Console 统一员工入口展示契约

SSO 落地后，企业员工统一入口由 `console` 承接。入口展示契约如下：

- Console 前端通过 `/api/user/applications` 获取当前用户可见应用。
- `/api/user/applications` 的权威过滤依据是 Console 本地已验签 policy bundle 中的角色、模板、覆盖与 `applications` 投影。
- Console 可按需调用 Platform runtime applications 做实时应用入口刷新，但不得绕过本地授权过滤。
- 业务应用通过 Foundation 接入 Console OIDC；应用卡片跳转到 bundle 下发的 `homeUrl`，目标应用本地无 session 时再发起 OIDC authorize redirect。
- Console 只做应用级可见性过滤；业务应用必须继续做自身页面级和资源级权限校验。

详细方案见 `Console-Unified-Employee-Portal-Plan.md`。

## API 调用矩阵

说明：矩阵中的 `Account` 列/行仅代表迁移期 legacy 兼容路径；新服务端调用应优先使用 Console service token、Console Directory API、Foundation adapter 和目标应用 service API。

```
             Account  Codocs  Aims  Altoc  Assets  Finance  Workflow  Align
Account        —        ×      ×      ×      ×       ×        ×         ×
Codocs         ✓        —      ×      ×      ×       ×        ✓         ×
Aims           ✓        ✓*     —      ✓**    ✓       ✓        ✓         ✓*****
Altoc          ✓        ✓      ×      —      ×       ✓        ✓***      ×
Assets         ✓        ×      ✓      ✓****  —       ✓        ✓***      ×
Finance        ✓        ×      ✓      ✓      ✓       —        ✓         ×
Workflow       ✓        ×      ×      ×      ×       ×        —         ×
Align          ✓        ✓****** ✓***** ✓******* ×      ×        ✓         —
Insights       ✓        ×      ×      ×      ×       ×        ×         ×

✓  = 已实现    ✓* = iframe 嵌入    ✓** = 计划中（API 桥接）
✓*** = 计划中  ✓**** = 计划中（客户/合同引用）
✓***** = 计划中（项目/任务协同关联）    ✓****** = 计划中（纪要/公告文档引用）
✓******* = 计划中（客户/合同上下文引用）
```

## Account API 契约（迁移期）

**Base URL**: `{HZY_ACCOUNT_API_URL}/api/v1`
**认证**: `Authorization: Bearer {api_key}:{api_secret}`

定位：

- 当前已实现目录读取与部分登录/审计能力仍由 Account 提供。
- 目标架构下，新增目录能力优先落到 `console.directory-runtime`。
- Foundation 的新目录 adapter 只支持 `console` provider，不提供 Account fallback；未迁移的旧 `/api/account/**` 兼容路由可继续直连 Account。
- Console 自身已不再要求 `HZY_ACCOUNT_API_*` 配置；登录审计写入本地 `auth_login_events`，启动资源同步也不再上报 Account。

尚未迁移的 legacy 模块通过以下环境变量配置：
- `HZY_ACCOUNT_API_URL` — 不含 `/api/v1` 后缀
- `HZY_ACCOUNT_API_KEY` / `HZY_ACCOUNT_API_SECRET` — 在 Account 管理后台创建

常用端点：
- `GET /users` — 用户列表
- `GET /users/{uid}` — 用户详情
- `GET /departments` — 部门树
- `GET /projects` — 项目注册表

详细接口定义：`account/docs/ACCOUNT_API_SPEC.md` 或 `http://localhost:3000/openapi.json`

## Workflow API 契约

**Base URL**: Console 运行时参数 `workflow.apiUrl` 对应服务的 `/api/v1`
**认证**: 业务前端经 Foundation `/api/workflow-proxy/**` 转发用户请求；服务端同步与回调使用 Console service token。
**业务应用 → Workflow**: Foundation proxy 必须先在本应用内验证浏览器用户身份，再以本应用 runtime service client 请求 `audience=workflow`、`scope=workflow:proxy` 的短期 token 调用 Workflow，并通过 `x-hzy-actor-uid` 传递已验证用户 UID。Workflow 只在服务令牌校验通过且包含 `workflow:proxy` 时接受该代理用户头。
**Workflow → data-runtime**: Workflow 服务端访问 data-runtime 时使用 Console service token，`audience` 必须与 data-runtime 的 `HZY_DATA_RUNTIME_JWT_AUDIENCE` / `HZY_TENANT_RUNTIME_AUDIENCE` 一致。若 audience 为 `data-runtime`，scope 使用 `data-runtime:workflow:read` / `data-runtime:workflow:write`；若 audience 为 `tenant-runtime`，scope 使用 `tenant-runtime:workflow:read` / `tenant-runtime:workflow:write`。data-runtime 将这些 audience-scoped scope 映射为内部 `workflow.read` / `workflow.write` 语义。

### 业务模块接入流程

1. **启动时同步动作定义**：`POST /action-defs/sync`
   ```json
   {
     "appCode": "aims",
     "actions": [{
       "resourceCode": "projects",
       "actionCode": "initiation",
       "name": "项目立项",
       "embedUrlPattern": "{app_base_url}/embed/{resource}/{biz_id}"
     }]
   }
   ```

2. **发起审批**：`POST /instances/prepare` → `POST /instances`

3. **接收回调**：Workflow 审批完成后携带 Console service token 回调业务模块；业务模块校验 `token_use=service`、`aud`、`scope=workflow:callback` 与来源应用 `workflow`

所有 Workflow 调用通过 Foundation 代理（`/api/workflow-proxy/`），自动注入 `request_app_code`。

详细接入指南：`foundation/docs/Workflow-Integration-Guide.md`

## Data Runtime 管理契约

**Base URL**: Console 运行时参数 `dataRuntime.runtimeApiUrl` 对应租户 data-runtime 服务根地址；Cloudflare / Tenant Gateway 可通过 `x-hzy-data-runtime-url` 或 `x-hzy-tenant-runtime-url` 注入当前租户运行时地址。业务应用只有在 `x-hzy-gateway-token` 与 `HZY_CLOUDFLARE_INTERNAL_TOKEN`（兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`）匹配时才可信任这些注入头。
**OSS 包地址**: Console 运行时参数 `dataRuntime.packageBaseUrl`，默认 `https://downloads.huizhi.yun/packages/hzy-data-runtime`。Console 读取 `{baseUrl}/latest/manifest.json` 获取最新版本、构建/发布时间和平台包信息；manifest 不可用时回退 `{baseUrl}/latest/version.txt`。
**服务认证**: 更新操作使用 Console service token，默认 `audience=data-runtime`、`scope=data-runtime:runtime:update`；配置为新 tenant-runtime audience 时使用 `audience=tenant-runtime`、`scope=tenant-runtime:runtime:update`。data-runtime 将 audience-scoped scope 映射为内部 `runtime.update` 语义，并要求来源应用为 `console`。静态 runtime token 只作为显式离线/兼容部署兜底。

核心端点：

- `GET /runtime/healthz` — Console 管理页探活主路径，返回 `status/version/commit/builtAt/tenant/deployment/apps`。
- `GET /runtime/health` — 兼容探活路径，响应结构同 `/runtime/healthz`。
- `POST /runtime/update` — 触发租户端更新，要求 Console service token。请求体包含 `{ "targetVersion": "vX.Y.Z", "baseUrl": "https://..." }`。Linux systemd 安装下，data-runtime 返回 `queued` 并写入 `/etc/hzy-data-runtime/update-request.env`，由 root-owned update request service 异步下载、校验、替换二进制并按配置重启服务；root/CLI 场景可直接返回 `running`。
- `GET /runtime/update/status` — 查询最近一次 API 触发更新的运行状态、失败原因或更新结果，要求 Console service token。

## Console 统一消息中心契约

**Base URL**: Console API 根地址。业务应用通过 Foundation 本地 `/api/notifications/**` 代理当前用户请求；服务端发布通过 Foundation `publishNotification()` helper 调用 Console。
**用户认证**: 当前用户 Console access token 或 Console 本地 session。
**服务认证**: 调用方通过 Console OAuth2 `client_credentials` 获取 `audience=notifications`、`scope=notifications:publish` 的 service token。

核心端点：

- `GET /api/v1/console/notifications` — 当前用户消息列表，支持 `status/category/sourceAppCode/limit/cursor`。
- `GET /api/v1/console/notifications/summary` — 当前用户未读数、类别聚合和最近消息。
- `POST /api/v1/console/notifications/{notificationId}/read` — 标记当前用户单条消息已读。
- `POST /api/v1/console/notifications/read-all` — 批量标记当前用户消息已读。
- `POST /api/v1/console/notifications/{notificationId}/archive` — 归档当前用户单条消息。
- `POST /api/v1/console/notifications/publish` — service-only，业务应用或 Workflow 发布站内消息。

发布请求：

```json
{
  "sourceAppCode": "workflow",
  "eventType": "workflow.notification",
  "category": "approval",
  "severity": "info",
  "title": "您有新的审批待办",
  "summary": "项目立项 - 部门负责人审批，请审批",
  "actionUrl": "https://example.com/workflow/tasks/123",
  "bizType": "workflow",
  "bizId": "123",
  "idempotencyKey": "workflow:task:123:created",
  "recipients": ["zhangsan", "lisi"],
  "channels": ["in_app"]
}
```

Console 只保存站内消息与阅读/归档状态；外部通道继续走 Notification Runtime。消息详情页仍由来源应用负责，Console 只保存入口链接和摘要。

## Notification Runtime 契约

**Base URL**: Console 运行时参数 `notification.runtimeApiUrl` 对应服务根地址。
**认证**: 调用方通过 Console OAuth2 `client_credentials` 获取 `audience=notification-runtime`、`scope=notification-runtime:send` 的 service token。

当前一期只支持企业微信通知：

- `GET /runtime/health` — 运行状态、版本、租户/部署信息。
- `GET /runtime/capabilities` — 当前支持的 channel 与 message type。
- `POST /v1/notifications/send` — 发送通知。

发送请求：

```json
{
  "channel": "wecom",
  "integrationCode": "wecom.default",
  "touser": "zhangsan|lisi",
  "title": "审批待处理",
  "description": "你有一个新的审批任务",
  "url": "https://example.com/workflow/tasks/1",
  "btntxt": "查看详情"
}
```

企业微信 `corpid`、`agentid`、`corpsecret` 由 Console `wecom.default` Integration/Vault 管理；Cloudflare 业务应用不得直接保存或调用企业微信 API。

## Codocs API 契约

**Base URL**: `{CODOCS_API_URL}/api/v1` 或 `/api/documents`
**认证**: Cookie 转发

- `POST /api/documents` — 创建文档
- `GET /api/documents/{uuid}` — 获取文档
- `POST /api/v1/documents/{uuid}/preview-access` — service-only，AIMS 在 iframe 预览前为已校验项目成员写入短期只读预览关系

详细接口定义：`codocs/docs/CODOCS_API_SPEC.md`

## Altoc ↔ Aims 桥接契约（契约有效，首轮 service 端点与编排入口已落地）

采用**双数据库桥接模型**，不合并数据库：

| Altoc 实体      | Aims 字段         | 方向        |
| --------------- | ----------------- | ----------- |
| 商机 opp_id     | aims_projects.opp_id | Altoc → Aims |
| 合同 contract_id | aims_projects.contract_id | Altoc → Aims |
| 回款节点        | milestones.payment_term_id | Altoc → Aims |
| 客户 customer_code | aims_projects.customer_code | Altoc → Aims |

原则：Altoc 管经营/财务视角，Aims 管交付执行视角。里程碑 PIVR 阶段映射到合同回款节点。

当前状态：业务契约已接受。Phase 1 已落地 Altoc 合同生效交付编排入口、Aims 合同项目桥接、付款条款里程碑同步、Altoc 回款计划可开票 service endpoint、Altoc 发起 Finance 开票申请、Finance submit 审批提交、Altoc 合同 Finance 摘要展示，以及 Finance 核销后回传 Altoc 回款计划摘要的 service endpoint；Aims 验收完成后可自动按 `payment_term_id` 推进 Altoc 回款计划，Finance 核销完成后可自动刷新经营侧已收 / 未收 / 状态。实现时不得合并数据库或复制对方主档。

## 客户合同交付与回款闭环契约（Phase 0 冻结）

本节是 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` Phase 0 的跨模块执行合同，用于约束首条端到端闭环：“Altoc 合同 → Aims 交付项目 → Finance 开票/到账/核销 → Assets 交付视图”。

### 事实源与稳定业务键

| 业务对象 | 唯一事实源 | 稳定业务键 | 消费模块 | 约束 |
| --- | --- | --- | --- | --- |
| 客户 | Altoc `customer` | `customer_code` (`customer.code`) | Aims / Finance / Assets / Console | 其他模块只保存编码和名称快照 |
| 商机 | Altoc `opportunity` | `opp_id`，后续补 `opportunity_code` | Aims / Finance | Aims 只引用，不推进销售阶段 |
| 合同 | Altoc `contract` | `contract_code` (`contract.code`)，兼容 `contract_id` | Aims / Finance / Assets | 其他模块不复制合同主档 |
| 合同行项目归属 | Altoc `contract_project_line_rel` | `project_code + contract_line_code` | Finance / Aims / Assets | `contract_project_link.line_codes_json` 仅是兼容快照 / 回退，不是首选真值 |
| 付款条款 | Altoc `contract_payment_term` | `payment_term_id` | Aims / Finance | Aims 里程碑只映射，不修改条款 |
| 回款计划 | Altoc `receivable_plan` | `receivable_plan_code` (`receivable_plan.code`) | Finance / Console | Finance 通过摘要或回调触发经营侧状态刷新 |
| 交付项目 | Aims `aims_projects` | `project_code` | Altoc / Finance / Assets | Altoc 不维护项目执行状态 |
| PIVR 里程碑 | Aims `milestones` | `project_code + milestone_id`，映射 `payment_term_id` | Altoc / Finance | Aims 是里程碑状态事实源 |
| 项目文档 / 交付物 | Aims `project_documents` / `deliverables`，正文在 Codocs | `document_uuid` / `codocs_uuid` | Altoc / Assets / Finance | 其他模块只保存文档 UUID 和标题快照 |
| 开票申请 | Finance `invoice_request` | `invoice_request_code` (`invoice_request.code`) | Altoc / Workflow | Altoc 可发起，不生成发票事实 |
| 正式发票 | Finance `finance_invoice` | `invoice_code` (`finance_invoice.code`) | Altoc / Aims | Finance 是发票事实源 |
| 到账记录 | Finance `finance_receipt` | `receipt_code` (`finance_receipt.code`) | Altoc / Aims | Finance 是到账事实源 |
| 收款核销 | Finance `finance_reconciliation` | `reconciliation_code` | Altoc / Aims | Finance 是核销事实源 |
| 合同财务摘要 | Finance `finance_contract_summary` | `contract_code` | Altoc / Aims / Console | 摘要可读，计算事实仍在 Finance |
| 交付视图 / 环境 / 资产 | Assets `asset_delivery_views` / `asset_environments` / `customer_delivery_assets` / `customer_delivery_asset_environment_rel` / `asset_items` | `delivery_code` / `environment_code` / `delivery_asset_code` / `asset_code` | Aims / Altoc / Finance | Assets 不维护合同、项目、财务主档；`customer_delivery_assets.environment_code` 仅是主环境兼容快照，完整事实以关系表为准 |
| 审批实例 | Workflow `flow_instances` | `instance_no` + `app_code/resource_code/biz_id/action_code` | 全业务模块 | Workflow 只保存审批流转事实，不保存业务终态 |

### Goal 2 交付环境身份链路

对象主责关系：

```mermaid
flowchart LR
  AltocPlan["Altoc contract_delivery_asset_plan<br/>source_plan_code"]
  AssetsAsset["Assets customer_delivery_assets<br/>delivery_asset_code"]
  AssetsRel["Assets customer_delivery_asset_environment_rel"]
  AssetsEnv["Assets asset_environments<br/>environment_code"]
  AimsRel["Aims project_environments<br/>project_id + environment_code"]
  AltocCoverage["Altoc service_agreement_coverage"]

  AltocPlan -->|创建或同步正式资产| AssetsAsset
  AssetsAsset --> AssetsRel
  AssetsEnv --> AssetsRel
  AimsRel -->|只保存执行关系和版本快照| AssetsEnv
  AssetsRel -->|正式对象回写| AltocCoverage
  AltocPlan -->|pending source_plan_code| AltocCoverage
```

标准实施时序：

```mermaid
sequenceDiagram
  participant Altoc
  participant Assets
  participant Aims

  Altoc->>Assets: create customer_delivery_asset from source_plan_code
  Assets-->>Altoc: delivery_asset_code
  Aims->>Assets: environments/upsert with idempotency key
  Assets-->>Aims: environment_code
  Aims->>Aims: upsert project_environments as pending sync
  Aims->>Assets: bind delivery_asset_code to environment_code
  Aims->>Assets: lifecycle:sync when online or accepted
  Aims->>Aims: mark project_environments synced or failed
  Assets->>Altoc: status:sync sourcePlanCode + deliveryAssetCode + environmentCode + projectCode + occurredAt
  Altoc->>Altoc: resolve pending service_agreement_coverage
```

### Service API 合同

以下 endpoint 是跨模块 service API 合同基线。标记为“待实现”的端点不得绕过 Console service token 或引入共享 secret；若先复用已有用户侧 API，必须补 service token 校验、scope 校验和幂等规则。状态截至 2026-06-22。

| 调用方 | 被调用方 | Endpoint / 事件 | 认证 | 幂等键 | 状态 |
| --- | --- | --- | --- | --- | --- |
| Altoc UI / Workflow / service | Altoc | `POST /api/v1/service/contracts/{contractCode}/activate-delivery` | 用户需 `contract:edit` 权限；service 调用 Console service token，`aud=altoc`，`scope=altoc:write altoc:contract:edit` | `altoc:contract:{contract_code}:activate-delivery:v1` | Phase 1 已实现 Nuxt 编排入口：先创建 Altoc 履约启动作业，激活合同并生成回款计划；仅当启动计划包含项目步骤时按 `project_plans` 调用 Aims 创建 / 复用多个项目和同步里程碑，并回写步骤状态 |
| Altoc | Aims | `POST /api/v1/service/projects/from-contract` | Console service token，`aud=aims`，`scope=aims:write`，来源 `altoc` | `altoc:contract:{contract_code}:project-link:{plan_key}:v1` | Phase 1 已实现；Aims BFF 在转发 tenant-runtime 前校验入站 service token；按 `project_code` / `planKey` 幂等创建或复用项目，支持一合同多项目 |
| Altoc / Aims | Aims | `GET /api/v1/service/projects/by-contract/{contractCode}` | Console service token，`aud=aims`，`scope=aims:read` | 读接口不要求；使用 `x-hzy-request-id` 追踪 | Phase 1 已实现；兼容旧单项目读取，P1 项目选择必须使用 `eligible-for-contract` 或 Altoc `project_plans` |
| Altoc / Aims | Aims | `GET /api/v1/service/projects/eligible-for-contract?contract_code=&customer_code=&search=` | Console service token，`aud=aims`，`scope=aims:read` | 读接口不要求；使用 `x-hzy-request-id` 追踪 | P1 已实现：返回同客户、未归档、未绑定合同或已绑定当前合同的项目候选，用于 Altoc 关联已有项目 |
| Altoc / Aims | Aims | `POST /api/v1/service/projects/{projectCode}/payment-milestones:sync` | Console service token，`aud=aims`，`scope=aims:write` | `altoc:contract:{contract_code}:payment-terms:{plan_key}:v1` | Phase 1 已实现；Aims BFF 在转发 tenant-runtime 前校验入站 service token；按 `project_code + payment_term_id` 或 `project_code + template_key` upsert，支持 Altoc `paymentTerms[]` 与 `billingSchedules[]` |
| Finance / Aims / Altoc | Altoc | `GET /api/v1/service/projects/{projectCode}/contract-lines` | Console service token，`aud=altoc`，`scope=altoc:read`，来源按调用方 | 读接口不要求；使用 `project_code` 作为跨应用键 | 新增：Altoc 按 `contract_project_line_rel` 返回 `contract_code`、`contract_line_code`、`relation_type`、`allocation_method/allocation_ratio/allocated_amount/planned_workdays`；包含 planned/active/closed 项目以支持历史成本归集，仅当结构化关系尚未回填时才回退 `line_codes_json` |
| Aims | Altoc | `POST /api/v1/service/receivable-plans/{receivablePlanCode}/mark-billable` 或 `POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable` | Console service token，`aud=altoc`，`scope=altoc:write altoc:receivable:mark-billable`，来源 `aims` | `aims:milestone:{project_code}:{milestone_id}:accepted:v1` | Phase 1 已实现；Aims `review-approve` 先使用显式 `receivablePlanCode`，否则使用 runtime 返回的 `paymentTermId` 自动触发 |
| Altoc | Finance | Altoc `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 编排 Finance `POST /api/v1/finance/invoice-requests` | Console service token，`aud=finance`，`scope=finance:write`，来源 `altoc` | `altoc:receivable:{receivable_plan_code}:invoice-request:v1` | Phase 1 已实现：Altoc UI 入口调用本地编排器，runtime 校验回款计划并组装 payload，Finance 按来源业务键幂等创建，Altoc runtime 写回款计划审计 |
| Altoc / Finance / Workflow | Finance | Finance `POST /api/v1/finance/invoice-requests/{code}/submit` + workflow callback endpoint | Console service token，`aud=finance`，`scope=finance:write`；Workflow 回调用 `aud=finance`，`scope=workflow:callback`，来源应用必须为 `workflow` | `altoc:receivable:{receivable_plan_code}:invoice-request:v1:submit:v1` / `workflow:{instance_no}:finance:invoice-request:{code}` | Phase 1 已实现提交链路：Altoc 发起后自动调用 Finance submit，Finance 优先创建 Workflow 审批实例，不可用时写本地 fallback；Workflow callback payload 会携带 `approval_actor_uids` / `non_self_approval_actor_uids`，Finance runtime 对开票申请、费用报销、项目支出和付款申请的 approved/rejected 结果要求存在非申请人的审批人证据 |
| Altoc | Finance | `GET /api/v1/finance/contracts/{contractCode}/summary` / `GET /api/v1/finance/contracts/summaries` | Console service token，`aud=finance`，`scope=finance:read`，来源 `altoc` | 读接口不要求；摘要版本用 `calculated_at` | Phase 1 已实现：Altoc 合同列表和合同详情发票页读取并展示 Finance 开票、到账、核销、未核销摘要 |
| Finance | Altoc | `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync`（事件 `finance.contract.summary.updated` 作为后续总线语义） | Console service token，`aud=altoc`，`scope=altoc:write altoc:contract:finance-summary:sync`，来源 `finance` | `finance:reconciliation:{reconciliation_code}:altoc-summary:v1` 或 `finance:contract:{contract_code}:summary:{calculated_at}` | Phase 1 已实现服务端闭环：Finance `POST /api/v1/finance/reconciliation` 编排 runtime 创建核销和摘要返回，再调用 Altoc service endpoint 刷新回款计划已收 / 未收 / 状态；Altoc 同步失败不回滚 Finance 核销，响应附带同步错误供重放 |
| Aims / Altoc | Assets | `POST /api/v1/service/deliveries/upsert` | Console service token，`aud=assets`，`scope=assets:write`，来源 `aims` 或 `altoc` | `contract:{contract_code}:project:{project_code}:delivery-view:v1` | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；按 `delivery_code` 或 `contract_code + project_code` 幂等 upsert，返回交付资产包 |
| Aims / Assets | Assets | `POST /api/v1/service/deliveries/{deliveryCode}/documents` | Console service token，`aud=assets`，`scope=assets:write` | `delivery:{delivery_code}:document:{document_uuid}` | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；保存 Codocs UUID，支持 `artifact_type` 九类交付成果，并把 Aims `milestone_id/milestone_code` 等上下文写入 `asset_documents.source_context` |
| Altoc / Aims / Finance | Assets | `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；按客户 / 合同 / 项目返回交付视图、产品、环境、文档包 |
| Altoc | Assets | `POST /api/v1/service/customer-delivery-assets/plans` | Console service token，`aud=assets`，`scope=assets:write`，来源 `altoc` | `altoc:contract:{contract_code}:customer-delivery-assets:v1` | P1 已实现：按 Altoc 合同计划资产 upsert Assets `customer_delivery_assets` 主档，`project_code` 可为空，返回 `delivery_asset_code` 供 Altoc 回填 |
| Altoc / Aims / Finance | Assets | `GET /api/v1/service/customer-delivery-assets/by-customer?customer_code=&contract_code=&project_code=` / `GET /api/v1/service/customer-delivery-assets/by-contract/{contractCode}` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | P1 已实现：按客户、合同或项目读取客户交付资产主档 |
| Aims / Altoc | Assets | `POST /api/v1/service/environments/upsert` | Console service token，`aud=assets`，`scope=assets:write`，来源 `aims` 或 `altoc` | `environment:{customer_code}:{source_project_code}:{idempotency_key}` | Goal 2 新增：Assets 生成 / 复用正式 `environment_code`；显式 code 只能引用已有环境，幂等键重试返回同一对象，不按名称模糊复用 |
| Aims / Altoc | Assets | `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments:bind` / `GET /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments` / `GET /api/v1/service/environments/{environmentCode}/customer-delivery-assets` | Console service token，`aud=assets`，读 `scope=assets:read`、写 `scope=assets:write` | `delivery-asset:{delivery_asset_code}:environment:{environment_code}:{relation_type}` | Goal 2 新增：正式交付资产与正式环境的多对多部署关系；设置主环境时同步旧 `customer_delivery_assets.environment_code` 快照 |
| Aims / Altoc | Assets | `POST /api/v1/service/environments/{environmentCode}/lifecycle:sync` / `POST /api/v1/service/references:resolve` | Console service token，`aud=assets`，读 `scope=assets:read`、写 `scope=assets:write` | `environment:{environment_code}:status:{status}` | Goal 2 新增：同步环境 planning/active/frozen/retired 生命周期并批量解析正式对象和资产-环境 pair |
| Aims / Assets / Altoc | Aims | `GET /api/v1/service/projects/{projectCode}/environments` / `POST /api/v1/service/projects/{projectCode}/environments` / `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:status` / `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:assets-sync` | Console service token，`aud=aims`，读 `scope=aims:read`、写 `scope=aims:write` | `aims:project:{project_code}:environment:{environment_code}:{delivery_asset_code}` | Goal 2 新增：Aims 保存项目对正式环境的执行关系、版本快照和 Assets 同步状态；Aims 不生成正式 `environment_code` |
| Altoc / Aims | Assets | `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/activate` | Console service token，`aud=assets`，`scope=assets:write` | `customer-delivery-asset:{delivery_asset_code}:status:{status}` | P1 已实现：推进客户交付资产 delivered/online/accepted 等状态；Assets BFF 会尽力回调 Altoc 状态同步，回调失败不回滚 Assets 状态，响应附带同步错误便于重放 |
| Assets | Altoc | `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/status:sync` | Console service token，`aud=altoc`，`scope=altoc:contract:delivery-asset-status:sync`，来源 `assets` | `customer-delivery-asset:{delivery_asset_code}:status:{status}` | P1 已实现并在 Goal 2 扩展：Altoc BFF 先用 Assets `references:resolve` 校验正式 `delivery_asset_code`、`environment_code` 和资产-环境 pair；`sourcePlanCode` 只用于定位 Altoc 计划，计划 code 不得写入正式资产字段。Altoc 更新 `contract_delivery_asset_plan` 状态、正式资产编码和正式环境编码；`accepted` 会推进关联履约义务、把绑定结算计划置为可结算，并把 pending 服务覆盖解析为正式资产或资产+环境覆盖 |
| Altoc / Assets / Aims / Finance | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/coverages` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages/{coverageCode}:resolve|suspend|end|confirm-legacy` | Console service token，`aud=altoc`，读 `scope=altoc:read`、写 `scope=altoc:contract:edit` | `altoc:service-agreement:{service_agreement_code}:coverage:{coverage_code}` | Goal 2 新增：`service_agreement_coverage` 是正式覆盖事实源，区分 `source_plan_code`、`delivery_asset_code`、`environment_code` 和 `legacy_reference`；新读优先 coverage，旧 `service_agreement_asset` 只作未迁移回退 |
| Altoc / Assets / Aims / Finance | Altoc | `GET /api/v1/service/service-agreement-coverages/by-environment/{environmentCode}` / `GET /api/v1/service/service-agreement-coverages/by-delivery-asset/{deliveryAssetCode}` | Console service token，`aud=altoc`，`scope=altoc:read` | 读接口不要求 | Goal 2 新增：按正式环境或正式交付资产反查服务协议覆盖 |
| Finance | Assets | `GET /api/v1/service/projects/{projectCode}/cost-summary?period_month=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；输出资产采购、资源订阅、环境投入和月度归集成本分解，供 Finance 项目核算写入 `project_cost_allocation` |
| Aims / Altoc / Finance / Assets | Workflow | `POST /api/v1/action-defs/sync` | Console service token，`aud=workflow`，`scope=workflow:proxy` 或 app service grant | `workflow:action-defs:{app_code}:{manifest_hash}` | 通用能力已有；Assets Phase 2 已新增采购、领用、分配、退回、报废 action manifest |
| Workflow | Assets | `POST /api/v1/purchase-orders/{id}/workflow:sync` / `POST /api/v1/assignments/{id}/workflow:sync` | Console service token，`aud=assets`，`scope=workflow:callback` 或 `assets:write` 代理 | `workflow:{instance_no}:assets:{resource}:{id}:{status}` | Phase 2 已实现 runtime 同步入口；资产操作默认 pending，审批通过后才联动资产主档 |

### 事件口径

Phase 1 先以 service API + 幂等键 + 审计日志落地，不强制引入全局事件总线；后续如果进入事件汇总或消息队列，事件名和载荷语义保持不变。

| 事件名 | 事实源 | 触发条件 | 消费方 | 关键载荷 |
| --- | --- | --- | --- | --- |
| `altoc.contract.effective` | Altoc | 合同状态变为 `effective` | Aims / Assets / Workflow | `customer_code`, `contract_code`, `contract_id`, `opp_id`, `payment_terms[]` |
| `aims.project.linked_to_contract` | Aims | 项目创建或绑定合同 | Altoc / Assets / Finance | `project_code`, `customer_code`, `contract_code`, `opp_id`, `contract_id` |
| `aims.milestone.accepted` | Aims | 绑定 `payment_term_id` 的验收里程碑完成 | Altoc / Finance | `project_code`, `milestone_id`, `payment_term_id`, `receivable_plan_code?`, `accepted_at` |
| `altoc.receivable.billable` | Altoc | 回款计划进入可开票状态 | Finance / Console | `receivable_plan_code`, `contract_code`, `amount`, `planned_invoice_date` |
| `finance.invoice_request.approved` | Finance | 开票申请审批通过 | Altoc / Console | `invoice_request_code`, `contract_code`, `receivable_plan_code`, `requested_amount` |
| `finance.invoice.issued` | Finance | 正式发票生成 | Altoc | `invoice_code`, `invoice_no`, `contract_code`, `receivable_plan_code`, `invoice_amount` |
| `finance.receipt.confirmed` | Finance | 到账确认 | Altoc | `receipt_code`, `contract_code`, `receivable_plan_code`, `received_amount` |
| `finance.reconciliation.completed` | Finance | 核销完成 | Altoc / Aims | `reconciliation_code`, `contract_code`, `receivable_plan_code`, `reconciled_amount` |
| `finance.contract.summary.updated` | Finance | 合同摘要重算 | Altoc / Aims / Console | `contract_code`, `invoice_amount`, `received_amount`, `reconciled_amount`, `risk_status`, `calculated_at` |
| `assets.delivery_view.upserted` | Assets | 客户交付视图创建或更新 | Aims / Altoc / Console | `delivery_code`, `customer_code`, `contract_code`, `project_code`, `status` |
| `assets.delivery_document.linked` | Assets | 交付视图关联 Codocs 文档 | Aims / Altoc / Console | `delivery_code`, `document_uuid`, `artifact_type`, `project_code`, `contract_code`, `milestone_id` |
| `assets.customer_delivery_asset.status_changed` | Assets | 客户交付资产进入 delivered / online / accepted 等状态 | Altoc / Aims / Finance | `delivery_asset_code`, `customer_code`, `contract_code`, `contract_line_code`, `status`, `accepted_at` |
| `assets.environment.upserted` | Assets | 正式客户环境创建或复用 | Aims / Altoc / Finance | `environment_code`, `customer_code`, `contract_code`, `source_project_code`, `status` |
| `assets.delivery_asset_environment.bound` | Assets | 正式交付资产与正式环境关系创建或更新 | Aims / Altoc / Finance | `delivery_asset_code`, `environment_code`, `relation_type`, `deployment_status`, `is_primary`, `source_project_code` |
| `aims.project_environment.status_changed` | Aims | 项目推进部署、上线、验收或交接 | Assets / Altoc / Finance | `project_code`, `environment_code`, `delivery_asset_code`, `delivery_status`, `assets_sync_status` |
| `altoc.service_agreement_coverage.resolved` | Altoc | 服务覆盖从计划或旧引用解析为正式对象 | Assets / Aims / Finance | `service_agreement_code`, `coverage_code`, `target_type`, `source_plan_code`, `delivery_asset_code`, `environment_code`, `resolution_status` |
| `assets.project_cost.summary.ready` | Assets | 项目资产成本摘要可供 Finance 同步 | Finance | `project_code`, `period_month`, `asset_purchase_amount`, `resource_subscription_amount`, `environment_investment_amount` |

### 幂等与审计要求

- 所有跨模块写操作必须带 `Idempotency-Key` header；没有 header 时，被调用方应拒绝 service-only 写操作或按请求体派生同等幂等键。
- 幂等键格式：`<source_app>:<source_object_type>:<source_object_key>:<action>:v<major>`；涉及目标对象时追加 `:<target_object_key>`。
- 被调用方必须记录 `source_app`、`source_biz_type`、`source_biz_code`、`idempotency_key`、`request_id`、`actor_uid`、`service_client_id`、`created_at`；若现有业务表没有字段，先写入审计日志或后续补专门 bridge log 表。
- 幂等冲突返回已创建对象的稳定业务键，不重复创建业务对象。
- Workflow 回调必须带 `instance_no`、`app_code`、`resource_code`、`action_code`、`biz_id`、`status`、`completed_at`、`idempotencyKey`。

Phase 1 实现说明：Altoc 合同生效编排按 `contract_code` 派生幂等键并转发下游 service 调用，Aims 项目创建按 `project_code` / `planKey` 幂等，Aims 里程碑同步按 `project_code + payment_term_id` 或 `project_code + template_key` upsert，Altoc 回款计划推进按业务状态幂等，Finance 开票申请按 `source_app + source_biz_type + source_biz_code` 幂等，Altoc 回款计划开票申请把幂等键写入 Altoc `audit_log`，Finance 核销后按核销单号或合同摘要版本派生幂等键回传 Altoc 经营侧摘要，Assets 客户交付资产状态按 `delivery_asset_code + status` 派生幂等键回传 Altoc 计划资产、义务和结算状态。专门 idempotency/bridge log 表和事件总线化进入后续硬化。

## People ↔ Aims / Finance / Workflow 项目绩效契约（Phase 3）

People 是人员运营事实、任职、M/P 职级设置、月度人员成本快照、项目贡献快照和个人绩效主流程事实源；Console Directory 是登录用户、部门、项目注册表和访问控制事实源，Console 系统参数提供 M/P 职级序列数量。生产切换期允许从 Console Directory 初始化 People 员工事实；正常运营期，入职、调岗、离职等 HR 事实应先落 People，再按服务契约投影到 Console Directory。People 不复制 Aims 任务/工时明细、Codocs 文档正文或 Finance 财务核算结果；Finance 提供人力成本计算参数、项目财务指标和绩效金额/提成奖金财务口径快照，供 People 成本快照和绩效周期引用。项目成本核算主路径由 Finance 读取 Aims 月度工时与 People 职级设置后自行计算标准人力成本，不依赖 People 绩效周期或贡献快照。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| People BFF | People data-runtime | `POST /v1/people/service/directory-users:sync` | Console service token，`aud=people`，`scope=people:write`，来源 `console` | `employee_uid` upsert 员工事实；`ASN-DIR-{employee_uid}` upsert 当前目录导入任职；保留 Console Directory 原始引用 | 已落地；用于 Console → People 初始化导入，不作为长期双向同步主路径 |
| People BFF | Console Directory | `POST /api/v1/console/service/directory/users/{uid}/disable` | Console service token，`aud=console_directory`，`scope=console_directory:write`，来源 `people` | `people:employee:{employee_uid}:disable-console-directory-user:v1`；Console 将 `directory_users.status` 置为 `inactive` 并撤销本地 session / refresh token | 已落地；People 员工状态设为 `left` / `inactive` 或任职调整“离职”后同步停用 Console 登录账号 |
| People BFF | Console Settings | `GET /api/v1/console/settings/values?keys=people.rankSeries.managementCount,people.rankSeries.professionalCount` | Console service token，`aud=system_settings`，`scope=system_settings:view` | 读接口不要求；返回管理序列和专业序列职级数，默认 M5 / P10 | 已落地；People 职级设置页据此生成 M/P 页签和职级行，不提供自由新增职级 |
| Finance BFF / 工时核算方 | Console Work Calendar | `GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM` | Console service token，`aud=system_settings`，`scope=system_settings:view` | 读接口不要求；返回 `workdayCount`、`standardHoursPerDay`、`standardWorkHours` 和来源 | 新增；Console 是月标准工时事实源，Finance 项目人力成本分摊应使用 `project_hours / standardWorkHours`，不再用员工当月已填报总工时作为分母 |
| Aims BFF / 周报页面 | Console Work Calendar | `GET /api/v1/console/work-calendars/{calendarCode}/days?yearMonth=YYYY-MM` + `GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM` | Console service token，`aud=system_settings`，`scope=system_settings:view` | 读接口不要求；返回日级 `dayType`、`isWorkday`、`holidayName` 和月度 `standardHoursPerDay`，用于项目周报日历区分工作日、休息日、法定假日和调休工作日 | 新增；Aims 项目周报日历按可视月份缓存日级工作日历，并在选中周日期范围后显示当周工作日天数和标准工时，100% 投入按当周标准工时折算 |
| People BFF | Finance | `GET /api/v1/finance/service/people-cost-parameters?effective_date=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `people` | 读接口不要求；返回有效的人力成本参数 code、基本工资、福利费率、管理分摊系数和固定资源分摊 | 已落地；Finance BFF 在转发 tenant-runtime 前校验入站 service token；People 生成成本快照前读取，不从 Console 系统参数取值 |
| People BFF | People data-runtime | `POST /v1/people/service/cost-snapshots:generate` | Console service token，`aud=people`，`scope=people:write` | 按 `employee_uid + period_month` upsert 月度成本快照；`standard_rate_code` 追溯命中的 M/P 职级设置，`source_refs` 追溯 Finance 参数 code | 已落地；用于从职级设置 + Finance 参数生成月度成本快照 |
| Finance BFF | Aims | `GET /v1/aims/projects?current_user=&search=&page=&pageSize=` | Tenant-runtime service token，`scope=aims.read`；当前用户通过 `current_user` 控制可见性 | 读接口不要求；Finance 只保存/展示 `project_code` 等稳定业务键和财务摘要，不复制 Aims 项目主档 | 已落地；Finance 项目核算页以 Aims 项目清单为底表，合并 Finance `project_finance_summary` |
| Finance BFF | Aims data-runtime | `GET /v1/aims/admin/projects?search=` + `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=` | Tenant-runtime service token，`scope=aims.read`，来源 `finance` | 读接口不要求；按 `project_code + period_month` 读取项目当月工时，分摊比例由项目工时 / Console 月标准工时计算 | 已落地；Finance `POST /api/v1/finance/project-accounting/sync-people-costs` 使用该链路 |
| People BFF | Aims data-runtime | `GET /v1/aims/admin/projects?search=` + `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=` | Tenant-runtime service token，`scope=aims.read`，来源 `people`；需 Console seed v1.24 授权 People runtime 读取 Aims | 读接口不要求；按 People 绩效周期 `project_code + period_start + period_end` 汇集 Aims 工时事实 | 已落地；People 绩效周期详情页“汇集贡献”解析 Aims 项目并聚合工时，随后写入 People 贡献快照 |
| Aims | People | `POST /v1/people/service/contributions:sync` | Console service token，`aud=people`，`scope=people:write`，来源 `aims` | `cycle_code + employee_uid + source_app + source_biz_type + source_biz_id`；必须保留 `source_refs` | People adapter 已落地；Aims `POST /api/v1/projects/{projectId}/people-contributions/sync` 已接入 |
| People BFF | People data-runtime | `POST /v1/people/service/performance-cycles/{cycleCode}:confirm` / `:close` | Console service token，`aud=people`，`scope=people:write` | 确认要求已有贡献快照；确认时固化周期 `confirmed_at` 和贡献快照 `confirmed_at`；关闭只允许已确认周期 | 已落地；People 绩效周期详情页提供“确认周期 / 关闭周期” |
| Finance BFF | People data-runtime | `GET /v1/people/service/standard-costs:resolve?employee_uids=&effective_date=` | Tenant-runtime service token，`scope=people.read`，来源 `finance` | 读接口不要求；返回员工有效职级、任职快照和匹配的 M/P 职级设置，不返回项目成本分摊金额 | 已落地；Finance 项目核算按标准成本实时计算 |
| Finance / 兼容方 | People | `GET /v1/people/service/employees/{employeeUid}/cost-snapshot?period_month=` | Console service token，`aud=people`，`scope=people:read` | 读接口不要求；历史成本按月度快照固化 | 已在 data-runtime People adapter 落地；用于成本留档或兼容查询，不作为 Finance 项目核算主路径 |
| Finance / 兼容方 | People | `GET /v1/people/service/projects/{projectCode}/people-costs?period_month=` | Console service token，`aud=people`，`scope=people:read` | 读接口不要求；返回成本快照 + 绩效贡献快照聚合 | People adapter 已落地；保留兼容，不作为 Finance 项目核算主路径 |
| People BFF | Finance | `GET /api/v1/finance/service/performance-amounts?cycle_code=&period_start=&period_end=&employee_uid=&project_code=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `people` | 读接口不要求；返回 Finance `employee_finance_performance` 稳定 code、金额、计算状态、项目贡献范围和 `cycle_code` 透传引用 | 已落地；Finance BFF 在转发 tenant-runtime 前校验入站 service token；People 绩效周期详情读取展示 Finance 金额快照，不作为 Finance 写 People 绩效终态 |
| People | Workflow | `POST /api/v1/action-defs/sync` | Console service token，`aud=workflow`，`scope=workflow:proxy` 或 app service grant | `workflow:action-defs:people:{manifest_hash}` | Nuxt 启动插件已声明动作 |
| Workflow | People | `POST /v1/people/service/workflow/callback` | Console service token，`aud=people`，`scope=workflow:callback` 或 `people:write` 代理 | `workflow:{instance_no}:people:{resource}:{id}:{status}` | 已在 data-runtime People adapter 落地 |

关键约束：

- `people_employees.employee_uid` 必须能映射 Console Directory `uid`；People 保存员工、岗位、职级、入离职和成本口径快照，但不替代 Console 登录身份、认证和权限。
- Console → People 导入只用于生产初始化或目录校准；不得把 Console 手工目录维护作为 People 正常人事流程的长期事实源。
- People → Console 投影必须由已审批或管理员确认的人事事件触发，禁止跨模块直连 Console 数据库或使用静态 webhook secret；离职投影首版已落地为 People 调用 Console service endpoint 停用账号。
- Aims 是项目清单和项目执行事实源；Finance 项目核算页不得通过手工项目编码维护项目清单，只能读取 Aims 项目并合并 Finance 财务摘要。
- `people_standard_cost_rates` 是项目人力成本测算前置主数据，当前只维护 M/P 职级工资和绩效工资范围；基本工资、福利费率、管理分摊系数和固定资源分摊由 Finance `finance_people_cost_parameter` 维护。
- People 职级设置页按 Console 系统参数 `people.rankSeries.managementCount` / `people.rankSeries.professionalCount` 生成 M/P 序列行，默认 M1-M5 / P1-P10；超出序列数量的历史规则不作为页面新增入口展示。
- People 月标准成本公式为：基本工资 + 职级工资 + 绩效工资中位数 + 福利成本 + 管理分摊 + 资源分摊；公式参数来自 Finance，不放入 Console 系统参数。
- `people_cost_snapshots` 是 People 成本留档能力，由标准成本规则或实际成本导入按月固化，不随员工当前事实变更自动改写历史月份；Finance 项目核算主路径不读取该表。
- `people_contribution_snapshots` 是 Aims 输出或 People BFF 从 Aims API 汇集后的个人绩效周期快照，不允许 People 直连 Aims 数据库补算；Finance 项目成本核算不依赖该表。
- Console Work Calendar 是平台月标准工时和日级工作/休息日事实源，节假日和调休按年导入并允许手工修正，月度 `standardWorkHours = workdayCount * standardHoursPerDay`。
- Finance 同步标准人力成本时按 `project_code + period_month + employee_uid` 生成稳定分摊编码，月标准成本由 Finance 参数 + People 职级设置实时计算，分摊比例为员工本项目当月工时 / Console 月标准工时，写入 `project_cost_allocation(allocation_type=labor)` 后重算项目财务汇总。
- 没有 People 员工职级、M/P 职级设置、Finance 人力成本参数或 Aims 工时时，Finance 只能标识“人力成本未就绪”，不得把项目毛利展示为完整成本核算结果。
- 个人绩效周期创建、评分、确认、申诉和归档归 People；Finance 的 `employee_finance_*` 与 `performance_*` 对象只表达财务贡献归因、提成/奖金/绩效金额快照和计算依据。
- Finance 不写 People 个人绩效终态；People 读取 Finance 金额快照时只保存稳定业务键和必要摘要，不复制 Finance 财务明细。
- People 文档只保存 Codocs `document_uuid`，不保存正文。

## Altoc / Assets / Aims / Codocs / Finance 运维服务契约（Phase 4）

Phase 4 不新增独立运维应用，按现有事实源拆分：Altoc 管客户成功经营事实和服务工单入口，Assets 管客户系统 / 交付实例，Aims 管工单执行和缺陷 / 需求回流，Codocs 管运维知识正文，Finance 管维保收入和服务成本。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| Altoc | Assets | `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | Phase 2 已落地；Assets BFF 在转发 tenant-runtime 前校验入站 service token；可作为客户系统 / 交付实例视图首版来源 |
| Altoc | Aims | `POST /api/v1/service/service-tickets/{ticketCode}/work-item` | Console service token，`aud=aims`，`scope=aims:write` | `altoc:service-ticket:{ticketCode}:aims-work-item:v1` | P4.2 已落地：Aims BFF 在转发 tenant-runtime 前校验入站 service token；按 `work_items.template_key=altoc:service_ticket:{ticketCode}` 幂等创建 / 复用工作项 |
| Aims | Altoc | `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` | Console service token，`aud=altoc`，`scope=altoc:write altoc:service_ticket:delivery-result:sync` | `aims:work-item:{workItemKey}:ticket-result:v1` | P4.2 已落地：回写工单状态、Aims 引用、解决 / 关闭时间和文档 UUID |
| Altoc / Aims / Finance | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations` / `GET /api/v1/service/service-agreements/{serviceAgreementCode}/default-project?allow_missing=true` | Console service token，`aud=altoc`，`scope=altoc:read`，来源按调用方 | 读接口不要求；使用 `service_agreement.code` 和 Aims `project_code` 作为跨应用键 | 新增：Altoc 通过 `service_agreement_project_rel` 维护服务协议到 Aims 项目的结构化关系；默认项目严格按当前有效 active/default 关系解析，多默认时报错，`allow_missing=true` 仅允许无默认时返回空 |
| Altoc | Altoc | `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/default` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/{projectCode}:end` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/{projectCode}:suspend` | 用户需 `contract:edit` 或 service token `aud=altoc`，`scope=altoc:write altoc:contract:edit` | `altoc:service-agreement:{serviceAgreementCode}:project:{projectCode}:{action}:v1` | 新增：服务协议项目关系由 Altoc data-runtime 事务写入；设置默认项会先清理同协议当前 active/planned 默认关系，保证当前默认解析唯一 |
| Altoc | Codocs | `POST /api/v1/service/ops-knowledge/link` | Console service token，`aud=codocs`，`scope=codocs:documents:write`，来源 `altoc` | `altoc:ticket:{ticketCode}:ops-knowledge:{documentUuid}` | P4.4 已落地：Codocs BFF 在转发 tenant-runtime 前校验入站 service token；Codocs runtime 通过 `document_relations` 关联文档 UUID 与客户、合同、项目、交付实例和服务工单上下文 |
| Finance | Altoc | `GET /api/v1/service/customers/{customerCode}/maintenance-summary` | Console service token，`aud=altoc`，`scope=altoc:read`，来源 `finance` | 读接口不要求 | P4.1 已落地：读取维保合同、SLA 权益、最近工单和续约机会摘要；Altoc BFF 在转发 tenant-runtime 前校验入站 service token |
| Altoc / Finance | Finance | `GET /api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary?contract_codes=&project_codes=&period_month=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `altoc` 或 `finance` | 读接口不要求；Altoc 编排器会用维保合同范围传入合同 / 项目编码 | P4.4 已落地：汇总维保开票、到账、核销、服务成本、毛利和期间趋势；Finance BFF 在转发 tenant-runtime 前校验入站 service token |

关键约束：

- `service_ticket.code` 是工单主业务键；回流到 Aims 后只保存 `aims_work_item_key` / `aims_project_code` 引用，不复制工作项正文。
- 服务协议到 Aims 项目的事实源是 Altoc `service_agreement_project_rel`，只保存 Aims 稳定业务键 `project_code`；Aims 继续负责项目、任务和工时执行事实，Altoc 不保存 Aims 本地主键。
- Altoc 服务工单派发 Aims 工作项时，项目解析顺序固定为：显式 `projectCode`、工单已绑定 `aims_project_code`、服务协议默认项目、旧版合同唯一候选项目兜底；若服务协议存在多个当前默认项目或旧版合同候选无法唯一确定，派发必须失败并暴露数据修复信号。
- Aims 使用 `work_items.template_key=altoc:service_ticket:{ticketCode}` 记录来源幂等键；若 Altoc 未指定里程碑，Aims 会创建 / 复用 `template_key=service_ops` 的项目里程碑作为工单执行容器。
- SLA 响应 / 解决时限由 Altoc 根据 `service_entitlement` 和工单状态计算，Aims 只回写执行状态和结果。
- 运维知识正文只保存在 Codocs；Altoc / Assets 仅保存 `document_uuid` 和客户、系统、产品版本上下文，Codocs 用 `document_relations` 建索引关系，不复制业务主档。
- 维保收入以 Finance 财务事实为准；Altoc 提供维保合同、服务期和续约经营上下文。Altoc 客户页读取 Finance 摘要时只传维保合同关联的 `contract_codes/project_codes`。

## Aims ↔ Assets 产品版本契约（有效）

定位：

- Assets 是产品主档事实源，稳定业务键为 `product_code`；`product_assets.current_version` / `target_version` 仅是台账展示快照。
- Aims 是产品版本事实源，维护 `product_versions`、`product_version_features`、`work_items.version_id` / `feature_id` 与版本进度聚合。
- Aims 的项目↔产品关联事实源为 `aims_project_products`。Assets 的 `product_assets.project_code` 仅用于历史台账和一次性初始导入，不作为在线关联事实源。

Service API：

| 调用方 | 被调用方 | 端点 | 认证 | 用途 |
| ------ | -------- | ---- | ---- | ---- |
| Aims / Altoc | Assets | `GET /api/v1/service/products?keyword=&codes=` | Console service token，`audience=assets`，`scope=assets:read`，来源应用 `aims` 或 `altoc` | Aims 项目关联产品、Altoc 合同行绑定软件产品时查询产品主档精简信息 |
| Aims | Assets | `POST /api/v1/service/products/resolve-codes` | Console service token，`audience=assets`，`scope=assets:read`，来源应用 `aims` | 按产品编码批量解析产品名称/状态 |
| Assets | Aims | `GET /api/v1/service/products/:productCode/versions` | Console service token，`audience=aims`，`scope=aims:read`，来源应用 `assets` 或后续白名单应用 | 产品详情页只读展示版本、公开特性、进度和关联项目 |

Cloudflare 多租户部署下，上述服务调用的 base URL 由 Foundation 按 appCode 解析共享应用 origin，不读取 Console runtime `applications.homeUrl` / `applications.apiBase`。`applications.homeUrl` 可以是 `https://<tenant>.huizhi.yun/<app>/` 这类租户入口，仅用于用户导航；`applications.apiBase` 是应用逻辑 API root，不作为服务端跨应用 origin 配置。

Console grant 种子：`docs/Console-SQL-Seed-v1.15-aims-assets-version-grants.sql`、`docs/Console-SQL-Seed-v1.32-assets-service-api-grants.sql`、`docs/Console-SQL-Seed-v1.33-altoc-aims-codocs-service-grants.sql`。

## WebDev Issue 上报契约（阶段2，实现中）

业务应用（codocs/finance/workflow 等）向 WebDev Issue 收件箱上报问题：

- **链路**：业务应用前端 Foundation 报告组件 → 业务应用本地 `POST /api/webdev-report/issues`（Foundation 共享路由，派生当前用户身份）→ `requestServiceAccessToken({ audience: 'webdev', scope: 'webdev:issue:write' })` → `POST {webdev}/api/webdev/issues/intake`。业务应用前端不直连 WebDev、不持有 WebDev 凭证。
- **WebDev intake 校验**：Console JWKS + `aud=webdev` + `token_use=service` + `scope=webdev:issue:write` + 来源 `hzy.appCode` ∈ 允许上报应用集合（`HZY_WEBDEV_REPORT_ALLOWED_APPS`）。`app_code`/`tenant`/`reporter_uid` 只信任服务端派生，不接受客户端覆盖。
- **落库**：WebDev → Data Runtime `/v1/webdev/issues*`（`hzy_webdev.webdev_issues`）。命中自动领取规则（severity=高 且 bug 且 app ∈ 白名单）时创建 Dev Agent 任务，幂等键 `clientRequestId=issue-<id>`。
- **「我已提报」**：`GET /api/webdev-report/issues` → WebDev `/api/webdev/issues/mine`，按当前用户 + 层级过滤。
- **自动领取规则**：存于 `webdev_issue_settings`（按租户），WebDev 项目设置页维护，intake 评估命中后建任务；未配置时回退 `HZY_WEBDEV_AUTO_CLAIM_APPS` 等 env 默认值。
- **状态通知**：Issue 领取与状态流转（verifying/resolved/closed）经 Foundation `publishNotification`（audience=notifications）通知反馈人；WebDev 需 `notifications:publish` grant。
- 设计详见 `webdev/docs/WebDev-Issue-Inbox-Design.md`。Console 需为业务应用 service-client 配置 `webdev:issue:write` grant、为 WebDev 配置 `notifications:publish` grant（阶段 0）。

## Foundation 代理层

Foundation 作为 Nuxt Layer 提供服务端代理：

- `server/utils/accountApi.ts` — Account API 封装（legacy directory bridge）
- `server/utils/webdevReport.ts` — 业务应用 → WebDev Issue 上报/查询代理（service token）
- `server/utils/directoryApi.ts` — Console Directory API adapter；新接入模块通过 Console runtime config 只读 Console，不提供 Account fallback
- `server/utils/syncApprovalActions.ts` — 启动时同步审批动作
- `server/utils/serviceOidc.ts` — Console service token 获取，供跨模块服务调用、同步和回调使用
- `server/utils/platformBundleAuthorization.ts` — 业务应用授权消费层；普通权限快照和 scoped authorization 均调用 Console runtime，生产不读取业务应用本地 policy bundle，也不在 Console 不可用时降级为本地旧 bundle
- `server/api/workflow-proxy/[...path].ts` — Workflow API 透明代理

业务模块前端通过 Foundation 的 composables（`useAccount`、`useWorkflow`）访问平台服务，不直接调用。

授权事实源边界：Platform 负责 manifest、角色授权关系、scope 和签名 bundle；Console 负责拉取、验签、缓存、模拟会话、权限快照和 scoped grant 解析；Foundation 负责把 Console 授权结果适配给业务应用。业务应用不得直接调用 `readCachedPlatformBundle()` 或自行解析 policy bundle。

## Align 协同边界（新增）

`Align` 调整为未来可选的深度组织协同业务模块，不再承担全平台统一员工入口。轻量待办、通知、公告摘要、最近访问、常用入口和简单事项入口优先归入 `console.employee-portal`。

- 新路径以 `Console directory-runtime` 作为用户、部门、角色、项目注册表事实源；未迁移模块可继续通过 `Account` legacy facade 读取
- `Workflow` 仍然是审批实例与待办的唯一事实源
- `Align` 只在轻量协同超出 Console 边界后承接完整协同业务对象，例如跨部门协助单、人员借调、HR/轻财务流程对象
- `Align` 若引用项目、合同、文档，只保存业务键，不复制主档
