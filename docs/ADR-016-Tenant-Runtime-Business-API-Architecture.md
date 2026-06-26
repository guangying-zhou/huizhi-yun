# ADR-016: Tenant Runtime 业务 API 架构

状态：Accepted  
日期：2026-06-01  
决策范围：Platform 之外的业务应用数据面、现有 `hzy-data-runtime` 演进路径、REST/OpenAPI 业务 API 合同、Nuxt server 职责收敛、客户侧自托管运行时

## 1. 背景

ADR-014 已确定默认企业 SaaS 交付主线为 `managed-cloud-agent`：平台托管应用运行时，客户侧 Agent 贴近客户数据库。现有 `hzy-data-runtime` 已经以 Go 单二进制形式提供 Finance、Workflow、WebDev adapter，并承担客户侧数据库访问。

随着目标进一步明确为“平台提供页面，客户自行托管数据与服务”，仅把 Agent 理解为“远程数据库访问执行器”会带来两个问题：

1. Nuxt 应用 server 侧和 Agent 侧容易形成两套业务逻辑。
2. 平台与客户侧的边界仍然偏数据库访问，而不是稳定业务服务合同。

因此需要把现有 `data-runtime` 的抽象上移为 `tenant-runtime`：客户侧统一业务后端运行时。平台侧 Console / 业务应用主要提供 UI、认证桥接、运行时发现和薄代理；客户侧 runtime 承载业务 API、数据库、对象存储、外部集成、后台任务和 schema migration。

## 2. 决策

将现有 `hzy-data-runtime` 演进为 `tenant-runtime`。`tenant-runtime` 是客户侧统一运行时系统，内部按应用 adapter 隔离，对外暴露 REST/OpenAPI 业务 API。

目标形态：

```text
Platform
  - 租户、订阅、部署、应用版本、policy bundle、runtime enrollment、健康检查
  - 不访问客户业务数据库

Console / Business UI Apps
  - Nuxt 页面、组件、路由、前端状态
  - 登录回调、session/cookie、runtime endpoint 解析、薄代理/BFF
  - 不直接访问业务数据库

tenant-runtime
  - Go 单二进制或 Docker 镜像
  - 按 app adapter 承载业务 API
  - 访问客户侧 MySQL / OSS / Redis / GitLab / 企业微信 / 钉钉等资源
  - 执行 schema migration、后台任务、审计与健康检查
```

`tenant-runtime` 不是 SQL over REST 代理，不提供通用 `/query`。平台 UI 与客户侧 runtime 的接口以 OpenAPI 固化，使用 HTTP JSON 作为第一版主协议。

## 3. 范围

### 3.1 第一阶段纳入范围

第一阶段只处理平台之外、且适合沉入客户侧业务运行时的模块：

| 模块 | 第一阶段目标 |
| --- | --- |
| Finance | 以现有 Go adapter 为样板，完成纯 runtime 主路径 |
| Workflow | 以现有 Go adapter 为样板，完成实例、任务、管理配置 runtime 主路径 |
| WebDev | 保持 data-runtime 元数据 adapter 方向，统一命名和合同 |
| Assets | 新增 tenant-runtime adapter，迁移资产台账、采购、分配、报表等 API |
| Altoc | 新增 tenant-runtime adapter，迁移客户、商机、报价、合同、回款等 API |
| Aims | 新增 tenant-runtime adapter，迁移项目、需求、任务、迭代、工时等 API |
| Codocs | 新增 tenant-runtime adapter，迁移文档元数据、分享、评审、版本和协作上下文 API |
| Collab | 不做独立 adapter；通过 Codocs adapter 获取文档上下文、权限和版本写入 |
| Foundation | 提供统一 tenant-runtime client、代理、错误归一化和 dev fallback |
| Tenant Gateway / 部署脚本 | 注入 runtime endpoint、token、tenant/deployment 上下文 |

### 3.2 明确不纳入第一阶段

以下事项不在本 ADR 第一阶段实施范围内：

- **Platform**：Platform 是控制面，不进入 tenant-runtime。
- **Account 完整迁移**：Account 作为 legacy facade / 迁移源继续保留。目录能力目标仍按既有计划迁入 Console Directory Runtime，不为 Account 新建完整 tenant-runtime adapter。
- **Insights 深度采集迁移**：Insights 的 Python FastAPI、Git/SVN 采集、聚合脚本和历史数据处理量大，作为独立专项。第一阶段最多只定义 future adapter 预留，不迁移深度采集链路。
- **Console vault/OIDC 后端迁移**：Console 的 vault、OIDC signing key、refresh token、auth client、service client 等启动闭环能力后移。第一阶段 Console 仍可直连自身 DB。
- **通用 SQL 代理**：不提供 `/query`、SQL over HTTP 或任意数据库转发。
- **重写所有 UI**：Nuxt 前端页面不因 runtime 迁移重写。

## 4. 与现有 data-runtime 的关系

`tenant-runtime` 不是推翻现有实现，而是对 `hzy-data-runtime` 的定位升级。

| 维度 | 现有 `data-runtime` | 目标 `tenant-runtime` |
| --- | --- | --- |
| 心智模型 | 客户侧数据访问 Agent | 客户侧业务后端运行时 |
| 主要目标 | 让 Worker 访问客户数据库 | 让平台 UI 调用客户侧业务 API |
| API 粒度 | 部分数据查询/写入 adapter | 完整业务 API contract |
| 业务逻辑位置 | Nuxt server 与 Agent 分散 | 业务后端逻辑逐步沉到 runtime |
| Nuxt server 职责 | API + 业务逻辑 + DB fallback | auth bridge + proxy/BFF + dev fallback |
| 合同形式 | 手写 HTTP endpoint | OpenAPI + contract tests |
| 覆盖范围 | Finance / Workflow / WebDev 试点 | Platform 之外的主业务数据面 |

迁移期可以保留包名、目录名和安装器兼容，例如继续发布 `hzy-data-runtime`，同时在文档、API 和平台 UI 中逐步采用 `tenant-runtime` 术语。正式改名应作为单独版本迁移处理，避免在业务迁移早期引入部署噪音。

## 5. 目标架构

### 5.1 调用链路

```text
Browser
  -> Tenant Gateway
     -> 解析租户域名 / 自定义域名
     -> 注入签名 tenant context
  -> Console / Business UI Worker
     -> 校验用户登录
     -> 解析 tenant-runtime endpoint
     -> 获取用户 token 或 service token
     -> 转发业务 API
  -> tenant-runtime
     -> 校验 token / tenant / deployment / appCode / scope
     -> 调用 app adapter
     -> 访问客户侧 DB / OSS / Redis / 外部系统
```

### 5.2 运行时内部结构

```text
tenant-runtime/
  cmd/tenant-runtime/
  internal/core/
    auth/
    audit/
    config/
    http/
    jobs/
    migrations/
    openapi/
    secrets/
  internal/apps/
    finance/
    workflow/
    webdev/
    assets/
    altoc/
    aims/
    codocs/
    insights/        # 第一阶段仅预留，不迁移深度采集
  openapi/
    finance.yaml
    workflow.yaml
    assets.yaml
    altoc.yaml
    aims.yaml
    codocs.yaml
    webdev.yaml
```

内部可以一个进程加载多个 app adapter，也必须允许后续按高负载客户拆成多个进程：

```text
tenant-runtime-finance
tenant-runtime-codocs
tenant-runtime-workflow
```

对平台而言，标准客户默认仍是一个 runtime endpoint。

## 6. API 合同

`tenant-runtime` 的基础 API：

```text
GET /runtime/health
GET /runtime/enrollment
GET /runtime/capabilities
GET /runtime/schema/status?app={appCode}
POST /runtime/schema/dry-run
POST /runtime/schema/migrate
GET /runtime/openapi.json?app={appCode}
```

业务 API 使用 app namespace：

```text
/v1/finance/*
/v1/workflow/*
/v1/webdev/*
/v1/assets/*
/v1/altoc/*
/v1/aims/*
/v1/codocs/*
```

设计要求：

- 每个 app 提供 OpenAPI 文档。
- 错误响应统一为 `{ error: { code, message, details? } }`。
- 分页、排序、过滤、幂等键和审计字段使用统一规范。
- 写操作必须明确业务动作，不暴露表结构。
- 大批量页面数据应提供聚合接口，避免 UI 页面触发大量远程细粒度请求。

## 7. 认证与授权

`tenant-runtime` 接受两类调用：

| Token 类型 | 用途 |
| --- | --- |
| 用户 token | 浏览器用户发起的业务读写 |
| service token | 应用间调用、后台任务、Workflow 回调、系统同步 |

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
- `tenant` / `deployment` 与当前 runtime enrollment 匹配。
- `appCode` 已启用。
- `scope` 覆盖请求 API。
- token 未过期。

第一阶段不把 Console vault/OIDC signing key 管理迁入 `tenant-runtime`。Console 仍负责 auth-runtime / OIDC，runtime 只消费可信 token 与 JWKS。

## 8. Nuxt 应用职责变化

业务 Nuxt 应用的 `server/api/**` 从业务后端逐步降级为薄层：

```text
当前：
server/api -> 权限 -> 业务逻辑 -> DB/OSS/外部集成

目标：
server/api -> session/auth bridge -> tenant-runtime proxy -> normalize response
```

允许保留的 Nuxt server 能力：

- OIDC 登录回调、cookie/session 维护。
- runtime endpoint 解析。
- tenant-runtime proxy。
- SSR 必需的轻量 BFF。
- 本地开发 mock / runtime fixture；direct DB fallback 仅限尚未显式关闭 fallback 的迁移期模块。
- 特殊文件上传流式转发。

应迁出到 tenant-runtime 的能力：

- 业务查询。
- 业务写入与事务。
- schema migration。
- 客户侧 OSS / Redis / GitLab / 企业微信 / 钉钉凭证消费。
- 后台任务。
- Workflow 终态回调落库。
- 审计写入。

## 9. 数据与存储边界

每个 app adapter 只能访问本 app 数据库或明确归属的客户侧资源：

```text
apps/finance  -> hzy_finance
apps/assets   -> hzy_assets
apps/altoc    -> hzy_altoc
apps/aims     -> hzy_aims
apps/codocs   -> hzy_codocs + Codocs OSS
apps/workflow -> hzy_workflow
```

跨模块调用通过内部 service contract，不做跨库 join。允许 app adapter 在同一个 runtime 进程内通过内部 client 调用其他 adapter，但必须保留 API 边界、scope 校验和审计记录。

Collab 没有独立业务数据库。它访问的是 Codocs 文档库中的 `documents`、`document_shares`、`document_versions` 等上下文。迁移后由 Codocs adapter 提供协作上下文 API：

```text
GET  /v1/codocs/collaboration/documents/{uuid}/context
POST /v1/codocs/documents/{uuid}/versions
```

Collab 继续负责 WebSocket/Yjs、presence、Redis 和 OSS 快照写入；数据库上下文和版本写入通过 Codocs runtime contract。

## 10. 部署模式

第一阶段支持：

| 模式 | 说明 |
| --- | --- |
| Cloudflare managed UI + tenant-runtime | 平台主推，UI 托管，客户侧 runtime 管业务数据 |
| PM2/self-hosted UI + tenant-runtime | 国内固定 IP / 企业内网场景，应用和 runtime 均可在客户服务器 |
| 本地开发 runtime/mock | 开发者本机优先连接共享或本地 tenant-runtime；必要时使用 mock/fixture 调试 |

建议新增或收敛配置：

```text
HZY_DATA_ACCESS_MODE=tenant-runtime|direct-db|fallback
HZY_TENANT_RUNTIME_URL=
HZY_TENANT_RUNTIME_AUDIENCE=data-runtime
HZY_TENANT_RUNTIME_TOKEN=
```

兼容期仍可接受旧变量：

```text
HZY_DATA_RUNTIME_URL
HZY_DATA_RUNTIME_TOKEN
HZY_DATA_RUNTIME_AUDIENCE
```

## 11. 迁移顺序

### 阶段 0：架构与基础设施

- 固化本 ADR。
- 在文档中明确 `data-runtime` 到 `tenant-runtime` 的术语关系。
- 在 Foundation 增加统一 `tenantRuntimeClient`，兼容现有 `dataRuntimeClient`。
- 定义统一错误、分页、OpenAPI、contract test 规范，详见 [`Tenant-Runtime-API-Contract-v1.md`](./Tenant-Runtime-API-Contract-v1.md)。

### 阶段 1：Finance / Workflow 样板

- Finance：补齐所有主路径 API 的 runtime 转发。
- Workflow：补齐实例、任务、管理配置、action-defs 同步的 runtime 主路径。
- Nuxt 侧 direct DB 降级为 dev/fallback。
- 建立 runtime API 与现有 Nuxt API 的一致性回归。

阶段 1 的代码落点：

- Foundation `tenantRuntimeClient` 是 Finance / Workflow runtime 调用的统一入口。
- Finance / Workflow 继续保留 `maybeCall*DataRuntime` 旧函数名，内部委托到 `tenantRuntimeClient`，避免一次性修改所有业务路由。
- 新配置默认使用统一 `HZY_TENANT_RUNTIME_URL`、`HZY_TENANT_RUNTIME_TOKEN`、`HZY_TENANT_RUNTIME_AUDIENCE`；`HZY_<APP>_TENANT_RUNTIME_URL` / `HZY_<APP>_TENANT_RUNTIME_TOKEN` 仅作为应用级覆盖。兼容期继续接受 `HZY_DATA_RUNTIME_URL`、`HZY_DATA_RUNTIME_TOKEN`、`HZY_DATA_RUNTIME_AUDIENCE` 以及 `HZY_<APP>_DATA_RUNTIME_URL` / `HZY_<APP>_DATA_RUNTIME_TOKEN`。
- 迁移早期模块可用 `HZY_DATA_ACCESS_MODE=direct-db` 强制走现有 DB 路径；已进入阶段 2 主路径收敛的 Assets / Altoc / Aims 不再允许通过该模式回退应用侧直连 DB。`tenant-runtime` / `fallback` 在配置 endpoint 时优先走 runtime；未显式设置时仍按 `managed-cloud-agent + endpoint` 启用 runtime。

### 阶段 2：Assets / Altoc / Aims

- Assets：迁移 repository 与主要 API，作为“普通 CRUD + 报表 + Workflow”样板。
- Altoc：迁移客户、线索、商机、报价、合同、回款。
- Aims：迁移项目、需求、任务、迭代、工时、审批状态回写。

阶段 2 的代码落点：

- Foundation 提供 `tenantRuntimeProxy`，用于把现有 Nuxt `/api/v1/**` 路由按模块转发到 `/v1/{appCode}/**` tenant-runtime 路由。Assets / Altoc / Aims 试点按后续实施决议关闭 Nuxt direct DB fallback；旧 handler 仅作为迁移期代码保留，不应被生产主路径调用。
- Assets 先作为完整 CRUD 样板，允许其 `/api/v1/**` 主路径转发。
- Altoc 先覆盖 dashboard、config、customers、leads、opportunities、quotes、contracts、payments、audit-logs；未迁移的附件、文档、投标和团队写入路径不得回退直连数据库，应先补 tenant-runtime adapter 或显式返回 runtime 不可用。
- Aims 先覆盖 workspace、projects、portfolios、milestones、work-items、requirements、deliverables、timesheet/users、approvals、favorites、admin/projects；Codocs 纯代理 BFF 可留在 Nuxt server，任何需要 Aims 数据库的 Codocs/GitLab/复杂动作路径不得回退直连数据库，应先补 tenant-runtime adapter 或显式返回 runtime 不可用。
- Assets / Altoc / Aims 的 middleware 默认使用统一 `HZY_TENANT_RUNTIME_URL`（兼容 `HZY_DATA_RUNTIME_URL`）；`HZY_ASSETS_TENANT_RUNTIME_URL`、`HZY_ALTOC_TENANT_RUNTIME_URL`、`HZY_AIMS_TENANT_RUNTIME_URL` 仅作为应用级覆盖，用于灰度、拆分 runtime 或临时排障。

阶段 2 runtime 侧代码落点：

- 暂不重命名 `data-runtime` 目录、Go module 和安装器；兼容窗口内继续发布 `hzy-data-runtime`，在文档和配置中把它视为 tenant-runtime 的当前实现基座。正式目录/包名迁移应单独规划。
- 新增 `internal/apps/compat` 通用 adapter，用于承载 Assets / Altoc / Aims 的列表、详情、创建、更新、删除、dashboard count 等迁移期通用业务 API。
- 新增 `assets`、`people`、`altoc`、`aims`、`codocs` runtime adapter，并在 `/runtime/health`、`/runtime/enrollment`、`/runtime/schema/status?app=...` 和 `/v1/{app}/...` 路由中注册。
- 新 adapter 默认关闭，通过 `HZY_ASSETS_AGENT_ENABLED`、`HZY_PEOPLE_AGENT_ENABLED`、`HZY_ALTOC_AGENT_ENABLED`、`HZY_AIMS_AGENT_ENABLED`、`HZY_CODOCS_AGENT_ENABLED` 显式开启；数据库名默认分别为 `hzy_assets`、`hzy_people`、`hzy_altoc`、`hzy_aims`、`hzy_codocs`，可通过 `HZY_<APP>_DB_*` 覆盖。业务应用侧只需要配置统一 `HZY_TENANT_RUNTIME_URL`，除非某个应用需要独立 runtime endpoint。
- 迁移期返回现有 Nuxt API 兼容 envelope，避免打开代理后立即要求前端同步改造到最终 OpenAPI v1 envelope。后续模块专用 adapter 应逐步替换通用 CRUD 行为，尤其是审批、状态流转、导入、同步等有业务副作用的动作。

### 阶段 3：Codocs / Collab

- Codocs：迁移文档元数据、分享、文件柜/部门柜、资讯中心、问题、批注、评审基础表、发布申请、版本记录。
- Collab：移除对 Codocs DB 的直连，改为调用 Codocs runtime 协作上下文 API。
- OSS 配置继续按 Console integration/vault 的后续方案演进；第一阶段可保留现有配置注入。

阶段 3 首个代码落点：

- `data-runtime/internal/apps/codocs` 新增 Codocs adapter，注册到 `/runtime/health`、`/runtime/enrollment`、`/runtime/schema/status?app=codocs` 和 `/v1/codocs/**`。当前覆盖文档/目录/分享/版本、文件柜/部门柜、资讯中心、问题、批注、部门分享、评审模板/发布申请的迁移期业务 API，以及协作上下文和版本写入 API。
- Codocs 协作 token 签发改为通过 tenant-runtime 获取文档上下文和分享权限；未配置 tenant-runtime 时显式返回 503，不再在该路径回退应用侧直连 DB。
- Collab runtime 移除 `COLLAB_DB_*` / `mysql2` 依赖；文档加载、权限复核和版本写入统一调用 Codocs runtime。Collab 仍保留 Redis、WebSocket/Yjs 和 OSS 快照持久化职责。
- Codocs direct DB 主路径关闭方式：`server/middleware/tenant-runtime.ts` 对已覆盖的旧 `/api/**` 路径做 runtime 转发；文档创建、文档详情、v1 内容/摘要/URL、资讯正文、文件柜上传/下载/预览等需要 OSS 的 BFF 只保留非 DB 逻辑，元数据走 runtime；`x-bookmark-fetcher` 保留 X 抓取、文章解析和 OSS 上传职责，书签和资讯条目 DB 写入改走 runtime；其他包含 Workflow 副作用、GitLab 同步、导入导出、通知编排或复杂事务的旧 handler，在补专用 runtime contract 前显式返回 503，不再回退应用侧直连 DB。

### 阶段 4：Console 非敏感运行能力

- 只评估 Console 的非敏感 supporting runtime API，例如 system-settings、directory-runtime 只读投影、runtime health。
- 不迁移 vault、OIDC signing key、refresh token、auth client 等启动闭环核心表。

### 阶段 5：清理 direct DB 主路径

- 对已完成模块关闭生产 `direct-db`。
- 保留未完成模块的本地 dev/mock 与应急策略；已关闭 direct DB 入口的模块不恢复应用侧直连 DB。
- 删除 Cloudflare Hyperdrive 新租户主路径。

## 12. 工作量预估

在不处理 Account 完整迁移、不迁移 Insights 深度采集、Console vault/OIDC 后移的前提下：

| 范围 | 时间 | Codex token 粗估 |
| --- | ---: | ---: |
| 基础合同、Foundation client、OpenAPI 规范 | 1-2 周 | 0.8M-1.2M |
| Finance + Workflow 样板收敛 | 1-2 周 | 0.8M-1.3M |
| Assets + Altoc | 2-3 周 | 1.4M-2.2M |
| Aims | 1.5-2.5 周 | 1.0M-1.8M |
| Codocs + Collab 上下文改造 | 2-3 周 | 1.4M-2.2M |
| 部署脚本、验收、文档、回归 | 1-2 周 | 0.6M-1.0M |
| **合计** | **6-9 周** | **5M-8M** |

这是按已有代码基础和 AI 辅助迁移估算；若要求同时完成全量自动化测试、生产灰度工具、运维 UI 和多数据库 provider，时间需要上调。

## 13. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Nuxt server 与 runtime 双逻辑长期并存 | 每个模块定义“runtime 主路径完成”验收线，完成后生产禁用 direct DB |
| 远程 API 粒度过细导致页面慢 | 按页面设计聚合 API，禁止 UI 触发 N+1 runtime 请求 |
| Runtime 版本与 UI 版本不兼容 | `/runtime/capabilities`、OpenAPI version、兼容窗口、部署前检查 |
| 客户侧 runtime offline | UI 显示明确运行时不可用，Platform Dashboard 纳入健康检查 |
| Schema 不匹配 | runtime 提供 schema status / dry-run / migrate，部署前阻断 |
| Console auth/vault 闭环复杂 | 第一阶段不迁移 Console vault/OIDC，只消费 Console 签发 token |
| Insights 迁移牵连采集链路 | 第一阶段排除深度采集，单独立项 |

## 14. 验收标准

一个模块完成 tenant-runtime 迁移，需要满足：

- 该模块所有生产 API 主路径通过 tenant-runtime。
- OpenAPI 文档与实现一致。
- Nuxt server 不再直接访问该模块生产 DB。
- 本地开发可通过 `direct-db` 或 `fallback` 模式运行。
- runtime schema status 覆盖该模块核心表。
- UI 关键页面通过 runtime 模式回归。
- 写操作具备幂等、审计和统一错误码。
- 部署检查能阻止 runtime 版本、schema 版本或 capability 不匹配。

## 15. 不做事项

- 不迁移 Platform 数据库。
- 不做 Account 完整 tenant-runtime adapter。
- 不迁移 Insights 深度采集、聚合脚本和 Python 后端全链路。
- 不迁移 Console vault/OIDC signing key/refresh token/auth client 主链路。
- 不提供 SQL over REST。
- 不要求第一阶段删除所有历史 direct DB handler 代码；对已切到 tenant-runtime 的模块，应用侧 direct DB 入口必须关闭为防误用桩，生产主路径不得依赖 direct DB。
