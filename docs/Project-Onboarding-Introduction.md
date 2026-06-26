# 汇智云项目介绍与新人入门

本文面向即将加入汇智云开发工作的成员，用于在较短时间内建立对项目目标、架构边界、模块职责、部署模式、当前进度和后续工作的整体认识。

建议先读本文，再按参与方向阅读根目录 `CLAUDE.md`、对应模块的 `CLAUDE.md`、`docs/MODULE_CONTRACTS.md` 和本文末尾列出的专题文档。

## 1. 项目定位

汇智云（huizhi-yun）是面向中小型企业，尤其是软件企业的企业作业与管理云平台。它不是多个独立工具的简单集合，而是以统一身份、统一目录、统一权限、统一审批、统一入口和统一运行时配置为底座，把研发项目、协作文档、经营管理、财务、资产、代码分析等企业核心作业串成一个可追溯的平台。

一句话目标：

> 用一套平台内核覆盖企业的研发、知识、经营、财务、资产和协同流程，并让平台具备 SaaS 化交付、客户自管数据面和企业私有化部署能力。

项目当前处在“已有业务模块 + 新平台控制面 + 新客户侧运行时”并行演进阶段。存量上，`account`、`codocs`、`insights` 等模块已经承担了可用能力；目标上，`platform` 与 `console` 正在把租户治理、订阅、部署、License、策略包、企业目录、认证运行时、凭证保险箱和统一员工入口收敛成新的平台形态。

## 2. 产品目标

### 2.1 面向用户

目标客户主要是 20 到 500 人规模的软件企业、IT 服务商、系统集成商和方案型交付团队。典型痛点包括：

- 项目管理、文档、CRM、财务、审批和代码数据分散在多个工具里。
- 组织目录、项目、客户、合同、文档和任务之间缺少稳定关联。
- 经营、交付、成本、回款、人员投入无法形成闭环。
- AI、自动化和数据分析很难嵌入真实作业流程。

### 2.2 核心产品目标

- 覆盖企业核心作业流程：研发项目、协作文档、经营管理、经营财务、资产资源、代码分析、审批和轻量协同。
- 管理工作成果和过程证据：项目、任务、文档、合同、回款、发票、资产、审批、代码活动都能追踪来源和状态。
- 降低跨系统切换成本：通过统一入口、统一认证、统一导航和跨模块业务键减少重复录入。
- 支持 SaaS 商业化：平台方统一治理租户、应用、订阅、部署和能力包；企业保留自身数据面控制权。
- 支持私有化：高安全客户可以部署 `platform-core`、`console`、业务应用和数据面到客户侧环境。

## 3. 架构分层

汇智云按四个逻辑平面组织：

```text
Control Plane / Identity Plane
  platform：租户、订阅、应用注册、部署、License、policy bundle、revocation、控制面账号

Tenant Runtime Plane
  console：企业资料、系统参数、集成配置、credential-vault、directory-runtime、auth-runtime、员工入口
  workflow：当前独立审批引擎，目标逐步收敛为 console.workflow-runtime
  collab：实时协作运行时，默认由 console 内嵌管理，也保留 standalone 模式

Business Workload Plane
  codocs / aims / altoc / finance / assets / align / insights 等业务应用

Data Plane
  每个应用独立数据库、Redis、OSS、GitLab、客户侧 Data Runtime Agent 或自托管数据面
```

`foundation` 是共享代码层，不是业务模块，也不是平台控制面。它以 `@hzy/foundation` Nuxt Layer 的形式为企业端基础模块和业务应用提供认证、目录、审批、布局、组件、运行时配置和集成适配能力。

## 4. 架构设计原则

### 4.1 控制面、运行时和业务面分离

`platform` 负责平台治理，不负责企业业务数据；`console` 负责客户侧基础运行时，不负责租户订阅和 License 治理；业务应用只负责自身业务对象，不自建平台级 IAM。

### 4.2 单一事实源

每类数据只允许有一个权威来源：

| 数据域 | 当前权威源 | 目标权威源 |
| --- | --- | --- |
| 租户、订阅、部署、License、policy bundle | `platform` 建设中 | `platform` |
| 企业基础资料、系统参数、集成配置、凭证引用 | `console` 建设中 | `console` |
| 用户、部门、岗位、项目注册表 | `account` 迁移期 | `console.directory-runtime` |
| 审批定义、实例、待办 | `workflow` 迁移期 | `console.workflow-runtime` 或保留可拆运行时边界 |
| 员工统一入口、应用中心、轻量待办/通知 | `console` 建设中 | `console.employee-portal` |
| 文档正文与文档元数据 | `codocs` | `codocs` |
| 研发执行数据 | `aims` | `aims` |
| 客户、商机、合同、回款计划 | `altoc` | `altoc` |
| 发票、到账、核销、支出、项目财务核算 | `finance` | `finance` |
| 资产、资源、环境、成本归因 | `assets` | `assets` |
| 代码效能分析 | `insights` | `insights` |

### 4.3 禁止跨模块数据库直连

模块之间只能通过 HTTP API、Foundation 代理、服务端回调或后续 Data Runtime Agent 业务 API 集成。不得在业务代码里跨库 JOIN 或直接读写其他模块数据库。

### 4.4 跨模块只保存稳定业务键

跨模块引用必须使用稳定标识，避免把其他模块内部自增 ID 变成事实依赖：

- 用户：`uid`
- 部门：`dept_code`
- 平台项目注册表：`project_code`
- 文档：`uuid` / `document_id`
- 审批实例：`instance_id`
- 业务对象：各模块自己的 `code`、`uuid` 或 `biz_id`

### 4.5 服务调用使用 Console service token

跨模块服务端 API 调用、回调、同步和写操作目标是统一使用 Console 签发的短期 `token_use=service` JWT。调用方通过 Foundation 的 service token helper 获取 token，目标模块验证 Console JWKS、`aud`、`scope`、`token_use=service` 和来源应用。

迁移期仍存在 `HZY_ACCOUNT_API_KEY/SECRET` 等 legacy bridge 配置，但不应为新能力新增静态 API key、共享 webhook secret 或绕过 Console 的自定义服务凭证。

### 4.6 Foundation 优先复用

企业端 Nuxt 模块默认继承 `@hzy/foundation`，新增认证、目录读取、审批、应用入口、共享布局、集成配置等能力时，先查 `docs/FOUNDATION_CAPABILITIES.md`。通用能力应反哺 Foundation，而不是在单个模块内 fork。

### 4.7 配置与凭证收敛到 Console

企业微信、钉钉、GitLab、OSS、AI Provider 等企业级集成配置应进入 Console 的 `integration-config + credential-vault`。业务应用按 `integrationCode` 通过 Foundation adapter 消费，不直接保存平台级 secret 到本地 env。

### 4.8 统一域名和应用路径

目标企业端访问模型是一个租户一个工作空间域名，应用挂载在 path 下：

```text
https://wiztek.huizhi.yun/          -> Console / Portal
https://wiztek.huizhi.yun/aims/     -> Aims
https://wiztek.huizhi.yun/codocs/   -> Codocs
https://wiztek.huizhi.yun/finance/  -> Finance
```

`appCode` 是稳定应用身份，`basePath/homeUrl/callbackUrl` 由 Platform 根据部署站点和 policy bundle 生成，业务应用不得手写固定域名或固定回调地址。

## 5. 平台组成

### 5.1 平台与基础运行模块

| 模块 | 类型 | 职责 | 状态 |
| --- | --- | --- | --- |
| `platform` | 控制面 / 身份治理面 | 租户、订阅、应用注册、manifest、部署、License、policy bundle、runtime heartbeat、平台 admin/dashboard | 开发中，多个控制面与授权治理 Epic 已完成或接近完成 |
| `console` | 客户侧基础运行服务 | 企业资料、系统参数、目录运行时、认证运行时、凭证保险箱、集成配置、员工入口、默认内嵌 Collab Runtime | 基础运行服务已落地并持续建设 |
| `foundation` | 共享 Nuxt Layer | Console OIDC、目录 adapter、Workflow 代理、service token、共享布局/组件、RUM、集成配置 adapter | 已就绪并持续演进 |
| `workflow` | 审批运行时 | 流程定义、JSON Schema 表单、条件路由、审批实例、待办、终态回调 | 开发中，目标可收敛到 Console workflow-runtime |
| `collab` | 实时协作运行时 | WebSocket/Yjs/presence/协作快照，默认 Console embedded，可 standalone | 开发中 |
| `account` | 迁移期目录与身份兼容 | legacy 用户、部门、权限、项目注册表、LDAP、CAS、企业微信、API Key、审计 | 已上线，作为 Console directory-runtime 迁移源与兼容 facade |

### 5.2 业务应用

| 模块 | 端口 | 职责 | 状态 |
| --- | --- | --- | --- |
| `codocs` | 3001 | 协作文档、知识库、Milkdown、Yjs 实时协作、OSS、文档审批、GitLab 同步 | 已上线 |
| `aims` | 3002 | 研发项目全生命周期，PIVR，迭代、任务、缺陷、工时、GitLab 集成 | MVP/Beta 开发中 |
| `altoc` | 3003 | LTC 经营管理，客户、线索、商机、报价、合同、回款、招投标、AI 辅助分析 | MVP 一期基本完成 / 开发中 |
| `assets` | 3004 | 实物资产、资源资产、环境与交付视图、采购到处置、成本归因 | 设计中，脚手架已建 |
| `finance` | 3006 | 发票、到账、核销、支出、费用审批、付款申请、项目核算、绩效金额财务口径 | v0.1-v0.3 MVP 实现中 |
| `align` | 3008 | 未来深度组织协同：跨部门协助、人员借调、HR/财务轻流程、协同 SLA | 脚手架已创建，第一阶段暂缓 |
| `insights` | 3009 | Git/SVN 代码贡献、质量监测、团队效能、报表；Nuxt + Python FastAPI | 已上线，历史迁移模块，尚未接入 Foundation |

## 6. 关键模块边界

### 6.1 Platform 与 Console

`platform` 管“平台如何开通和治理”，`console` 管“企业内部如何运行”。

`platform` 负责：

- 租户、订阅、能力包、License、revocation。
- 应用注册、版本、manifest、资源动作、角色模板和 policy bundle。
- 部署站点、应用运行实例、runtime token、heartbeat、connectivity checks。
- 平台运营管理台 `/admin` 和租户管理员面 `/dashboard`。

`console` 负责：

- 企业资料、系统参数、字典、集成配置、credential-vault。
- 企业用户登录、OIDC 签发、JWKS、session、refresh/logout。
- 企业目录、用户、部门、岗位、项目注册表。
- 员工统一入口、应用中心、轻量待办/通知。
- 本地 service client 和短期 service token。

### 6.2 Account 迁移定位

`account` 现在仍是用户、部门、角色、权限、项目注册表和部分登录/审计能力的事实源。目标路径是把目录能力迁到 `console.directory-runtime`，把授权治理迁到 `platform`，`account` 保留为迁移期兼容 facade 或迁移源。

新增目录能力不要继续落在 `account`；新模块应优先使用 Foundation 的 `useDirectory`、`/api/directory/**` 和 Console Directory API。

### 6.3 Workflow 迁移定位

`workflow` 当前是独立通用审批引擎，业务模块通过 Foundation 的 `/api/workflow-proxy/**` 和 `useWorkflow` 接入。它只负责流程流转，不保存业务对象终态。审批完成后，通过 Console service token 回调业务模块，由业务模块更新自身状态。

目标上，审批能力可逐步成为 `console.workflow-runtime`，但独立部署边界仍可保留。

### 6.4 Altoc 与 Aims 的桥接

Altoc 管经营，Aims 管交付，不合并数据库：

- Altoc：客户、商机、报价、合同、回款计划。
- Aims：项目、PIVR 阶段、里程碑、迭代、任务、交付物。
- 桥接字段：`opp_id`、`contract_id`、`customer_code`、`payment_term_id`。

典型链路是“商机/合同 -> 项目/里程碑 -> 交付/验收 -> 回款/财务摘要”。

## 7. 部署模式

### 7.1 当前现状

当前开发和部分生产形态仍接近“多模块独立运行”：

- 根目录是 `pnpm-workspace`，各模块目录也有独立 `.git` 仓库。
- 每个模块通常有独立 Nuxt/Nitro 服务、独立端口、独立数据库。
- 开发时从模块目录或根目录 `pnpm --filter <module> dev` 启动。
- `account` 当前承接目录与部分身份能力。
- `workflow` 当前独立承接审批。
- `console` 正在建设为客户侧基础运行服务。
- `collab` 默认目标是由 Console embedded 启动，standalone 作为扩容或隔离模式。

常用命令：

```bash
pnpm install
pnpm --filter platform dev
pnpm --filter console dev
pnpm --filter aims dev
pnpm --filter codocs dev
pnpm --filter workflow dev
pnpm -r lint
pnpm -r typecheck
```

Codocs 构建需要更高内存：

```bash
NODE_OPTIONS='--max-old-space-size=4096' nuxt build --dotenv .env
```

### 7.2 目标默认 SaaS：managed-cloud-agent

默认企业 SaaS 主线是平台方托管应用运行时，客户自管数据面：

```text
Browser
  -> Tenant Gateway Worker
  -> Console / Business App Worker
  -> hzy-data-runtime Agent
  -> 客户侧 MySQL / OSS / Git / 其他数据资源
```

特点：

- `platform` 托管在平台侧，负责租户、订阅、部署、策略包、应用治理。
- Console 和业务应用可部署到 Cloudflare Workers，由 Tenant Gateway 按租户域名与 path 分发。
- 客户侧部署 `hzy-data-runtime` Agent，贴近客户数据库和对象存储。
- Agent 暴露按应用命名空间划分的业务 API，不暴露通用 SQL `/query`。
- Platform 不进入业务请求热路径，只做配置发布、签名、审计、部署和健康治理。

### 7.3 企业私有化：self-hosted

高安全、国企、断网或强合规客户可以使用 Self-Hosted Enterprise：

- `platform-core`、`console`、业务应用、数据库、对象存储、Git、协作服务全部部署在客户环境。
- SaaS 运营域不进入私有化交付物。
- 平台治理模型保持一致，只是部署拓扑变化。
- 所有业务数据、目录数据、基础配置和运行时日志留在客户侧。

### 7.4 过渡和后续 Profile

| Profile | 定位 | 数据访问路径 |
| --- | --- | --- |
| `managed-cloud-agent` | 默认企业 SaaS | Worker -> Data Runtime Agent -> 客户数据库 |
| `self-hosted` | 高安全企业版 | 客户侧应用直连客户侧数据面 |
| `managed-cloud-direct-db` | 早期验证和迁移期 | Worker -> Hyperdrive -> 客户 MySQL |
| `managed-cloud-d1` | 后续轻量/海外全托管 | Worker -> D1 |

## 8. 代码仓库结构与 clone 顺序

本项目采用“多仓库放在同一个 pnpm workspace 下”的组织方式。它看起来像一个 monorepo，但每个主要模块目录都有自己的 `.git` 仓库；根目录主要承担工作区、文档、部署脚本和共享约束的作用。

推荐初始化方式是先把 `foundation` 仓库 clone 成工作区根目录 `huizhi-yun`，再进入该目录 clone 其他模块仓库：

```bash
# 1. 先用 foundation 仓库创建工作区根目录
git clone https://gitlab.wiztek.cn/huizhi-yun/foundation.git huizhi-yun
cd huizhi-yun

# 2. 在 huizhi-yun 内按同名目录 clone 其他仓库
git clone https://gitlab.wiztek.cn/huizhi-yun/platform.git platform
git clone https://gitlab.wiztek.cn/huizhi-yun/console.git console
git clone https://gitlab.wiztek.cn/huizhi-yun/account.git account
git clone https://gitlab.wiztek.cn/huizhi-yun/workflow.git workflow
git clone https://gitlab.wiztek.cn/huizhi-yun/collab.git collab

git clone https://gitlab.wiztek.cn/huizhi-yun/codocs.git codocs
git clone https://gitlab.wiztek.cn/huizhi-yun/aims.git aims
git clone https://gitlab.wiztek.cn/huizhi-yun/altoc.git altoc
git clone https://gitlab.wiztek.cn/huizhi-yun/finance.git finance
git clone https://gitlab.wiztek.cn/huizhi-yun/assets.git assets
git clone https://gitlab.wiztek.cn/huizhi-yun/align.git align
git clone https://gitlab.wiztek.cn/huizhi-yun/insights.git insights

# 3. 安装 workspace 依赖
pnpm install
```

目标目录结构：

```text
huizhi-yun/
├── CLAUDE.md
├── package.json
├── pnpm-workspace.yaml
├── docs/
├── deploy/
├── foundation/       # @hzy/foundation Nuxt Layer 与共享能力
├── platform/         # 平台控制面 / Identity Plane
├── console/          # 客户侧基础运行服务
├── account/          # 迁移期目录与身份底座
├── workflow/         # 迁移期审批运行时
├── collab/           # 实时协作运行时
├── codocs/           # 协作文档
├── aims/             # 研发项目
├── altoc/            # 经营管理
├── finance/          # 经营财务
├── assets/           # 资产资源
├── align/            # 深度组织协同
└── insights/         # 代码仓库分析
```

注意事项：

- 不要把这些模块当作 Git submodule；当前工作方式是多个普通 Git 仓库并排放在同一个 workspace 下。
- 根目录命令如 `pnpm --filter aims dev`、`pnpm -r typecheck` 负责跨包编排，不代表所有模块共享一个 Git 提交。
- 修改某个模块代码时，需要在对应模块仓库内查看 `git status`、提交和推送；修改根目录文档、workspace 配置或部署脚本时，在工作区根仓库提交。
- `foundation` 是最先 clone 的原因是它提供根目录工作区约束、共享层代码和公共文档语境；其他模块通过 `pnpm-workspace.yaml` 和 `extends: ['../foundation']` 接入。
- 新成员拉取完仓库后，优先确认各目录的 `CLAUDE.md` 存在，并用 `pnpm install` 安装依赖，再按参与模块启动开发服务。

## 9. 当前实施状态

### 9.1 已经比较稳定的能力

- 根目录项目规范、模块级 `CLAUDE.md`、模块契约文档已建立。
- `foundation` 已提供认证、目录、审批、布局、应用入口、service token、运行时配置和集成适配的一批共享能力。
- `account` 已提供存量用户、部门、项目注册表、CAS/LDAP/企业微信等目录身份能力。
- `codocs` 已提供协作文档、实时协作、版本、审批、OSS、GitLab 同步等能力。
- `insights` 已提供代码分析和研发效能能力，但仍是历史迁移架构。
- `platform` 已形成控制面 schema、manifest、policy bundle、角色权限治理、Dashboard 授权和 Console 本地 bundle 消费等多个关键链路。

### 9.2 正在推进的核心迁移

- 把目录能力从 `account` 收敛到 `console.directory-runtime`。
- 把业务应用登录默认切到 Console OIDC。
- 把跨模块服务凭证从静态 API key 收敛到 Console service token。
- 把企业级集成凭证从业务 env 收敛到 Console integration + vault。
- 把应用运行时配置从本地散落 env 收敛到 Console runtime config 和 Platform policy bundle。
- 把统一员工入口从 `align` 收敛到 `console.employee-portal`。
- 把部署模式从自有服务器 + PM2 逐步演进到统一域名、Tenant Gateway、Cloudflare Workers 和 Data Runtime Agent。

### 9.3 仍需重点实现的功能

| 方向 | 后续重点 |
| --- | --- |
| Platform | 租户开通闭环、应用发布/版本治理、deployment site、runtime health、Cloudflare 资源编排、policy bundle 自动刷新和可观测性治理 |
| Console | directory-runtime 完整迁移、auth-runtime 完整 OIDC 能力、credential-vault 使用面、integration 管理、员工入口、轻量待办/通知 |
| Foundation | Console Directory / Integration / Service Token adapter 稳定化，legacy bridge 收口，业务模块统一接入模板 |
| Data Runtime Agent | Agent 业务 API、Cloudflare Tunnel 接入、schema status/dry-run/migrate、审计、健康检查、版本兼容 |
| Workflow | 审批配置 UI、回调 service token 校验、与 Console runtime 的收敛边界 |
| Aims | PIVR 项目闭环、权限与审批联调、GitLab 和 Codocs 集成、Altoc 桥接 |
| Altoc | Aims 桥接二期、合同/回款/Finance 摘要、AI 辅助经营分析、审批联调 |
| Finance | v0.1 台账与核销、v0.2 审批、v0.3 项目核算与绩效金额财务口径 |
| Assets | 资产统一模型、采购/分配/退回/处置审批、项目/客户/部门成本归因 |
| Codocs | 新平台 token 兼容接入、Collab Runtime 云化路径、Durable Objects POC |
| Insights | Foundation / Console OIDC 收敛、Git 集成凭证迁入 Console |

## 10. 新成员阅读路径

### 10.1 必读

1. 根目录 `CLAUDE.md`：项目总纲、模块列表、通用规范和开发命令。
2. `docs/MODULE_CONTRACTS.md`：模块间 API 契约、稳定标识、数据归属和服务认证。
3. `docs/FOUNDATION_CAPABILITIES.md`：Foundation 已有能力，避免重复实现。
4. 参与模块的 `CLAUDE.md`：模块职责、状态、数据库、接口和边界。

### 10.2 平台 / 运行时方向

建议重点阅读：

- `docs/Huizhi-yun-Platform-Target-Architecture.md`
- `docs/Huizhi-yun-SaaS-Product-Shape-and-Implementation-Path.md`
- `docs/ADR-014-Managed-Cloud-Agent-and-Deployment-Profiles.md`
- `docs/Unified-Domain-Deployment-Plan.md`
- `docs/Console-Functional-Design-v1.md`
- `docs/Console-API-Contract-v1.md`
- `docs/Console-Bootstrap-and-Rotation-Sequence-v1.md`

适合切入任务：

- Platform Dashboard 的部署、健康检查、bundle 生成和 Cloudflare 编排。
- Console directory/auth/vault/integration/runtime API 的补齐。
- Foundation adapter 与业务模块接入模板。
- Data Runtime Agent 的契约设计和 POC。

### 10.3 业务应用方向

建议重点阅读：

- `aims/CLAUDE.md`
- `altoc/CLAUDE.md`
- `finance/CLAUDE.md`
- `assets/CLAUDE.md`
- `codocs/CLAUDE.md`
- `foundation/docs/Workflow-Integration-Guide.md`
- `docs/MODULE_CONTRACTS.md`

适合切入任务：

- Aims / Altoc 的经营交付桥接。
- Finance 与 Altoc/Aims 的财务事实和摘要回传。
- Assets 与项目、合同、部门的成本归因。
- 业务模块审批接入和回调校验。
- 业务模块迁移到 Console OIDC、Directory API、service token 和 integration adapter。

## 11. 开发约定

- 每个模块数据库独立，schema 文件放在模块 `docs/` 目录，变更数据库必须同步 schema。
- 接口文档和模块契约要随 API 行为变化同步更新。
- Nuxt 模块优先使用 Nuxt UI V4 和 Foundation 组件。
- TypeScript 严格模式，ESLint 统一不加尾逗号、1tbs 大括号风格。
- 业务应用不要新增平台级 env secret；企业级外部集成应进入 Console integration + vault。
- 业务应用不要新增长期依赖 `account` 的目录扩展；新目录读取走 Console Directory。
- 审批只由 Workflow / Console workflow-runtime 承接，业务模块负责自身业务状态。
- 不要把其他模块主档复制进本模块作为事实源；只保存业务键和必要快照。

## 12. 两位新成员的建议分工

如果两位新成员同时加入，建议一人偏平台运行时，一人偏业务闭环，避免初期都挤在同一上下文里。

| 角色 | 重点模块 | 第一阶段目标 |
| --- | --- | --- |
| 成员 A：平台 / 运行时方向 | `platform`、`console`、`foundation`、`collab`、部署文档 | 跑通 Console OIDC、runtime config、policy bundle、service token 和统一域名部署的最小闭环 |
| 成员 B：业务应用 / 集成方向 | `aims`、`altoc`、`finance`、`assets`、`codocs`、`workflow` | 跑通经营到交付、交付到财务、审批回调、文档引用和稳定业务键集成 |

第一周建议成果：

- 能独立启动至少一个基础模块和一个业务模块。
- 能说明当前事实源和目标事实源的区别。
- 能在不跨库 JOIN 的前提下设计一次跨模块数据读取。
- 能判断某个新需求应落在 `platform`、`console`、`foundation` 还是业务模块。
- 能完成一处小型改动并同步相关 schema/API/设计文档。

## 13. 概念速查

| 概念 | 含义 |
| --- | --- |
| `platform` | 平台控制面和身份治理面，管理租户、订阅、应用、部署、License、policy bundle |
| `console` | 客户侧基础运行服务，管理企业目录、认证、配置、凭证、员工入口和运行时能力 |
| `foundation` | Nuxt 共享层，为企业端应用提供认证、目录、审批、布局、服务 token 和集成 adapter |
| `policy bundle` | Platform 生成并签名的运行时授权包，Console 和业务应用本地消费 |
| `license.lic` | 应用启动身份和授权材料，迁移期也用于 service token bootstrap |
| `directory-runtime` | Console 目标承载的用户、部门、岗位、项目注册表能力 |
| `auth-runtime` | Console 目标承载的企业用户登录、OIDC、JWT/JWKS、session 能力 |
| `service token` | Console 签发的短期服务端调用 JWT，用于跨模块服务调用和回调 |
| `Data Runtime Agent` | 客户侧轻量数据面服务，向 Cloudflare 应用提供业务 API，不是 SQL 代理 |
| `managed-cloud-agent` | 默认 SaaS 部署 profile：平台托管应用运行时，客户侧 Agent 管数据面 |
| `self-hosted` | 企业私有化 profile：平台核心、Console、业务应用和数据面都在客户侧 |

## 14. 参考文档

- `CLAUDE.md`
- `docs/MODULE_CONTRACTS.md`
- `docs/FOUNDATION_CAPABILITIES.md`
- `docs/Huizhi-yun-Architecture.md`
- `docs/Huizhi-yun-Platform-Target-Architecture.md`
- `docs/Huizhi-yun-SaaS-Product-Shape-and-Implementation-Path.md`
- `docs/ADR-014-Managed-Cloud-Agent-and-Deployment-Profiles.md`
- `docs/Unified-Domain-Deployment-Plan.md`
- `docs/Console-Functional-Design-v1.md`
- `docs/Console-API-Contract-v1.md`
- `docs/Console-Directory-Runtime-Integration-Plan.md`
- `docs/Account-Directory-Runtime-Refactor-Plan.md`
- `docs/Console-Unified-Employee-Portal-Plan.md`
- `docs/Implementation-Backlog.md`
