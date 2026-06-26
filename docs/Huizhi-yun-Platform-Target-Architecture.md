# 汇智云平台目标架构设计 v1.1

状态：Draft
日期：2026-04-22
定位：**目标架构**（Ideal / Target），作为后续模块设计、代码演进、产品规划的基准
区别：本文档与 `Huizhi-yun-Architecture.md` 不冲突。后者描述**现状**，本文档描述**理想态**。

---

## 0. 文档目的

本文档回答一个问题：**如果不背历史包袱，汇智云应该长成什么样。**

本文档**定义**：

- 平台的分层与边界
- 三类客户对应的两种交付模式
- 平台与业务应用、客户 IdP、基础设施之间的契约
- 可插拔与不可插拔的模块划分
- 关键架构决策及其理由

本文档**不定义**：

- 从现状迁移到目标的具体步骤（由独立迁移方案承担）
- 时间表、资源分配
- 具体 API 签名与完整 DDL

---

## 1. 产品定位与客户类型

汇智云是面向中小型软件产品 / SaaS 企业的一体化运营平台，覆盖产品规划、设计研发、交付运维、项目管理、文档知识资产、LTC 经营、资产与财务、组织协同等场景。
其核心不是“托管所有业务数据”，而是：

**统一控制面 + 客户自管数据面 / 运行时。**

> 2026-05-24 更新：Cloudflare 托管应用与客户侧 Data Runtime Agent 的部署 profile 已收敛到 ADR-014。默认企业 SaaS 主线从“客户自行托管全部业务应用”调整为“平台托管 Cloudflare 应用运行时 + 客户侧 Data Runtime Agent 自管数据面”；`self-hosted` 仍作为高安全企业版主线。

### 1.1 策略：统一内核 + 主部署 Profile

**产品内核只有一套；默认采用 Managed Cloud Agent，企业高安全场景采用 Self-Hosted Enterprise。**

| 客户类型 | 规模 | 核心诉求 | 交付模式 |
|---------|------|---------|---------|
| 小微团队 | 数十人内 | 快速上线、低运维 | **Managed Cloud Agent** |
| 中型研发团队 | 百人级 | 数据自主、平台仍有统一把手 | **Managed Cloud Agent** |
| 中大型团队 / 国企 | 千人级+ | 完全私有化、可审源码、可断网运行 | **Self-Hosted Enterprise** |

默认前两类客户统一采用以下拓扑：

- 平台托管 Control Plane + Identity Plane
- 平台托管 Cloudflare 业务应用运行时
- 租户侧部署 `hzy-data-runtime` Agent 自管数据面
- Hyperdrive 仅作为迁移期 direct-db profile
- D1 仅作为后续轻量/海外全托管 profile

### 1.2 计费模式

**按组织（公司）固定费用 + 能力包订阅**，**不按用户数计费**。

- 四档能力包：
  - `Starter`（基础）：协同办公、协同文档、项目管理
  - `Standard`（标准）：Starter + 资产管理、经营管理
  - `Advanced`（高级）：Standard + 高级审计、增强权限治理
  - `Enterprise`（企业 · 全站独立部署）：Advanced 全集 + 私有化交付与独立运行能力
- `Insights` 作为标准业务应用纳入档位（默认 Advanced 档包含，Starter / Standard 按需追加）
- `AI` 作为独立增值包，按需叠加
- `Enterprise` 同时作为独立交付模式，对应 Self-Hosted 拓扑（详见 §8.2）
- License 签入能力清单（`capabilities`），运行时据此开关 UI 与 API
- 用量粗聚合：客户侧本地聚合后上报（如 DAU、存储量），**不下探到个人**

此决策带来的架构收益：

- 平台**无需**做席位管理，只统计数量
- 平台**无需**追踪个人活跃度
- 计费系统只处理组织、能力包、续费和升级

---

## 2. 四层架构总览

```
┌──────────────────────────────────────────────────────────┐
│ Control Plane   控制面                                    │
│ 租户注册表、应用注册、资源模型、角色/模板、License、能力开关 │
│ 库：hzy_platform                                          │
├──────────────────────────────────────────────────────────┤
│ Identity Plane  平台身份与授权分发面                       │
│ 控制面身份、Runtime 信任、策略包/License/吊销签名、审计       │
│ 库：hzy_platform（与 Control 同库，逻辑分域）               │
├──────────────────────────────────────────────────────────┤
│ Workload Plane  业务面                                    │
│ aims / codocs / altoc / assets / finance / align 等业务应用 │
│ 以及 console（内置 directory/auth/messaging/audit/workflow runtime）等基础组件 │
│ 默认部署在客户侧                                            │
├──────────────────────────────────────────────────────────┤
│ Data Plane      数据面                                    │
│ MySQL / Redis / OSS / Git / 搜索 / 消息                   │
│ 默认部署在客户侧，Provider 化，可插拔                       │
└──────────────────────────────────────────────────────────┘

          ┌──────────────────────────────┐
          │ Tenancy / Billing Module     │
          │ 仅用于 Control-Plane SaaS 运营 │
          └──────────────────────────────┘
```

### 2.1 分层原则

| # | 原则 |
|---|------|
| P1 | 控制面与业务面分离：业务应用不自建平台级 IAM |
| P2 | 部署级运行信任根 = 部署实例级唯一；应用用户 access token 由 Console OIDC issuer 签发，部署上下文通过 `deployment_id` / `deployment_code` 等 claim 与策略包表达 |
| P3 | 平台不存应用终端用户 PII；控制面用户（平台员工 + 租户管理员）可存必要 PII |
| P4 | 客户 IdP 是应用用户身份源，`console` 做应用侧 federation 与 OIDC 签发；`platform` 做控制面身份与授权签名 |
| P5 | 默认客户自管业务运行时与数据面，平台不托管业务数据 |
| P6 | Tenancy / Billing 只服务 Control-Plane SaaS，企业版可剥离 |
| P7 | 同一份代码，靠部署拓扑和 capability 区分，不靠产品分叉 |
| P8 | 基础设施 provider 化（Git / OSS / MQ / 搜索均不写死） |
| P9 | `foundation` 是共享代码层，`console` 是客户侧有状态基础运行服务，并承载企业端 `directory / auth / messaging / audit` 等基础 runtime |

---

## 3. Control Plane

### 3.1 职责

- 租户（tenant）注册表与元数据
- 控制面账户（平台员工 + 租户管理员）与租户成员关系
- 部署实例注册（`deployments`）
- 应用注册（applications）与资源目录（resources）
- 角色定义（roles）、权限模板（permission_templates）、范围规则（role_scopes）
- 最小授权主体目录（subjects）
- License 验签、能力分发、策略版本管理
- 应用 manifest 管理

### 3.2 不做的事

- **不存**应用终端用户 PII（姓名、邮箱、手机、头像）
- **不存**业务数据、业务文件、Git 仓库内容
- **不承载**客户全量组织目录明细（用户、部门、项目注册表）
- **不参与**业务接口的每次在线鉴权
- **不直接解释**业务关系（`member / owner / participant`）

### 3.3 最小授权主体目录

平台不能完全没有“用户/部门/岗位主体”，否则角色模板和范围授权无法运营。
因此平台保留最小主体目录，但这套目录只服务**应用身份与业务授权**，仍然不存 PII。

平台只存：

- `subject_id`
- `subject_type`（`user / department / committee / job`）
- `tenant_code`
- `subject_code`
- `external_ref`
- `parent_subject_id` 可选
- `status`

`subject_sync` 导入约束：

- 只允许导入 `subject_type / subject_code / external_ref / status`。
- `display_name` 在同步链路中只允许空值或脱敏代号，禁止写入真实姓名等 PII。

平台**不存**：

- 姓名
- 邮箱
- 手机
- 照片
- 详细通讯录资料

控制面账户是例外：

- 平台员工与租户管理员都是平台控制面的直接使用者
- 允许在 `platform_accounts` 中存放必要登录资料（用户名、邮箱、显示名等）
- 租户归属落在 `tenant_account_memberships`
- `/dashboard` 权限授予落在 `tenant_account_roles`

### 3.4 关键数据

- Platform Domain：
  `platform_accounts`、`platform_sessions`、`platform_applications`、`platform_app_releases`、`platform_app_manifests`、`platform_app_manifest_resources`、`platform_app_manifest_resource_actions`、`platform_app_roles`、`platform_system_roles`、`platform_plans`、`platform_capabilities`、`platform_signing_keys`
- Boundary Domain：
  `tenants`、`tenant_account_memberships`、`tenant_subscriptions`、`subscriptions`、`deployments`、`licenses`、`policy_bundles`、`revocation_snapshots`、`deployment_heartbeats`、`tenant_runtime_credentials`
- Tenant Domain：
  `tenant_subjects`、`tenant_identity_providers`、`tenant_sessions`、`tenant_roles`、`tenant_account_roles`、`tenant_permission_templates`、`tenant_template_bindings`、`tenant_template_overrides`、`tenant_role_scopes`
- 运营补充：
  `tenant_onboarding_steps`、`deployment_connectivity_checks`、`platform_app_manifest_registrations`、`revocation_entries`

---

## 4. Identity Plane

### 4.1 职责

- 控制面账户登录与 session（平台员工、租户管理员）
- Runtime 信任与 tenant runtime token 治理
- Platform signing key 管理
- 策略包签名与分发
- license / revocation 签名与分发
- 最小授权主体目录治理
- 平台授权解析与 bundle 生成
- 控制面审计、bundle / heartbeat / runtime 审计

不负责：

- 企业应用用户的本地登录会话、refresh token、OIDC client secret
- CAS / 企业微信 / 钉钉 / LDAP 等上游登录回调的长期承载
- 业务应用的逐请求在线鉴权

这些应用用户认证能力由客户侧 `console.auth-runtime` 承接。

### 4.2 信任链

默认模式下，信任链拆成两段：

1. 应用用户在客户侧上游 IdP 登录（LDAP / AD / CAS / OIDC / 企业微信 / 钉钉等）。
2. `console.auth-runtime` 完成 federation、身份映射、本地 session 与 OIDC token 签发。
3. 业务应用通过 Foundation adapter 验证 Console JWT。
4. Platform Identity Plane 生成并签名 policy bundle / license / revocation。
5. 客户侧业务应用结合 Console JWT、本地缓存的策略包和业务关系做最终授权。

也就是说：

- 登录源在客户侧
- 应用用户 IdP 在客户侧 `console`
- 授权治理与策略签名锚点在 `platform`
- 运行时校验在客户侧

补充说明：

- 上述链路描述的是**租户应用用户**登录业务应用。
- `/dashboard` 的租户管理员不是租户应用用户，而是平台控制面账户
- `/admin` 与 `/dashboard` 位于同一 platform 模块以共享租户、应用、授权等数据，但主体必须拆分：`/admin` 使用 `platform_accounts.account_type='staff'` + `session_scope='platform_admin'`，`/dashboard` 使用 `platform_accounts.account_type='tenant_admin'` + `session_scope='tenant_admin'`
- 租户管理员登录走 `platform_accounts + platform_sessions`，并通过 `tenant_account_memberships` 进入指定租户上下文；平台员工 session 不允许直接作为 dashboard 主体使用

### 4.3 Token 结构

业务应用用户 token 由 `console.auth-runtime` 签发。MVP 结构：

```json
{
  "iss": "<console_issuer>",
  "sub": "user:<uid>",
  "aud": "<app_code>",
  "tenant": "<tenant_code>",
  "deployment": "<deployment_code>",
  "sid": "<session_id>",
  "policy_ver": "<bundle_version>",
  "caps": "<capability_hash>",
  "hzy": {
    "uid": "<uid>",
    "subjectType": "user",
    "subjectCode": "<uid>",
    "directorySnapshot": "<snapshot_hash>"
  },
  "iat": 1745000000,
  "exp": 1745003600
}
```

- `iss` 是 Console OIDC issuer
- `sub` 在 MVP 中为 `user:<uid>`，与 policy bundle `subjects.subjectCode` 对齐
- `policy_ver` 指向当前生效策略包版本
- `caps` 是 capability 摘要，不是完整权限清单
- token 不携带真实姓名、邮箱、手机号、部门名、角色明细和 scope 明细

Platform 控制面 session 与 runtime token 是另一条链路，不作为业务应用用户 OIDC token。

### 4.4 策略包（Signed Policy Bundle）

仅靠 `caps hash` 不足以支撑本地离线鉴权，因此必须引入**签名策略包**。

策略包至少包含：

- `bundle_version`
- 角色与模板定义
- 角色权限
- 范围规则
- 应用 manifest 摘要
- capability 清单
- 签名信息

分发方式：

- 平台生成并签名
- 客户侧应用 / SDK 拉取并缓存
- 本地只验证与执行，不自行改写

### 4.5 SSO 方向

**客户 IdP 是应用用户身份源，Console 是应用侧 federation 中继与统一 OIDC 签发方。**

- 登录路径：客户浏览器 → 客户 IdP → Console auth-runtime → Console OIDC token
- 平台**不维护**应用终端用户密码
- Platform **不保存**应用用户 session、refresh token、OIDC client secret
- 企业版中，Platform Control Plane / Identity Plane 也在客户侧部署，但应用用户 IdP 仍由 Console auth-runtime 承接

控制面登录不受此限制：

- 平台员工与租户管理员可以直接作为控制面账户注册/登录平台
- 后续可再选择是否把控制面登录也接入平台自有 IdP / 外部 OIDC

---

## 5. Tenancy / Billing 模块（仅 Control-Plane SaaS 使用）

### 5.1 职责

- 多租户注册
- 套餐、订阅、License 签发与续费
- 自助注册、试用发放
- 账单、财务对账
- 粗粒度用量汇总

### 5.2 剥离约束（强制）

1. 其他模块**不得**直接 `import tenancy`
2. 需要订阅信息时，通过请求上下文注入（`ctx.capabilities`），**不直查 tenancy 表**
3. 企业版交付物**不包含** `tenancy/` 目录
4. 企业版启动时固定 `tenant_code = 'default'`

这些约束通过 **CI 静态检查 + Lint 规则**落地。

### 5.3 约束说明

Tenancy / Billing 的存在只为了让汇智云能运营多个客户，
它**不**参与：

- 业务数据库托管
- 业务文件托管
- 业务请求级鉴权

---

## 6. 业务应用接入规范

业务应用（`aims` / `codocs` / `altoc` / `assets` / `align` 等）全部是**底座上的 app**，通过统一协议接入。`workflow` 当前是独立审批服务，目标并入 `console.workflow-runtime`，仅保留未来独立部署边界。

### 6.1 App 接入协议

每个业务应用必须：

1. **向 Control Plane 注册应用清单（manifest）**
2. **通过 Foundation SDK 验证 Console OIDC Token 与 Platform 策略包**
3. **实现业务关系求值器**（响应 `member / owner / participant` 等 scope 查询）
4. **独立数据库**（每 app 一个库，API 集成，禁止跨库直连）
5. **默认支持客户侧部署**

### 6.2 应用清单示例

```json
{
  "app_code": "aims",
  "app_name": "研发项目管理",
  "version": "1.0.0",
  "resources": [
    { "code": "projects", "actions": ["view", "edit", "admin"] },
    { "code": "tasks",    "actions": ["view", "edit"] }
  ],
  "recommended_roles": ["aims:member", "aims:pm", "aims:admin"],
  "supported_scopes": ["all", "self", "department", "member", "owner"],
  "capabilities_required": []
}
```

说明：

- `manifest` 负责声明资源能力与接入契约
- `recommended_roles` 只是建议，不是 app 自己定义角色分配
- 角色与模板的最终治理权仍在 Control Plane

### 6.3 应用类型

- **平台自带**（`aims` / `codocs` / …）：随平台发行
- **客户侧基础运行服务**（`console`，目标内置 `directory / auth / messaging / audit` 等基础 runtime）：Starter 默认包含，属于 Workload Plane supporting services，不按可选业务应用计价
- **可选应用**：按 License capability 开关是否可用
- **第三方应用**（未来）：通过 manifest + OAuth 接入

---

## 7. Foundation 与 console 的职责（逻辑拆成 Layer + SDK + Base Runtime）

Foundation 继续承载共享层，但在逻辑上拆成两部分：

1. **Frontend Layer**
2. **Platform SDK**

代码可以暂时仍放同一仓库、同一模块树中，
但契约上必须做到：

- SDK 不依赖 Nuxt 页面运行时
- 非 Nuxt 服务也能消费平台鉴权能力

### 7.1 承载内容

**前端（Layer）**：

- UI 组件、布局、composables
- 权限判断 composable（`usePermissions`）
- 菜单过滤、路由守卫

**后端（Platform SDK）**：

- Token 验证工具
- Policy bundle 拉取与缓存
- Control Plane API 客户端
- 权限解析器
- 业务关系求值器接口（定义契约，由 app 实现）
- 通用 `notify` / `audit` 工具

### 7.2 约束

- Foundation **不**承载业务规则
- Foundation **不**直接解释 `member / owner / participant` 等业务关系
- Foundation 只定义接口契约、缓存策略和通用鉴权逻辑

### 7.3 组织目录与授权边界

在默认的 Managed Control Plane 模式下，目录与授权不是一套服务完成，而是拆成两条权威链：

- `console.directory-runtime` 负责“人和组织长什么样”
- `platform` 负责“这些主体对哪些应用拥有什么权限”
- 业务应用在本地同时消费目录信息和授权结果，但两者来源不同

说明：`directory-runtime` 是逻辑域与 API 契约，不要求长期独立部署成 `account` 服务。现有 `account` 是历史实现与迁移源；目标是把目录、外部目录同步、本地 auth runtime 与目录管理面收敛进 `console`，由 `foundation` 提供兼容 adapter。

目录服务定位：`console` 承接汇智云应用侧的企业目录主数据能力。它可以直接维护目录，也可以从 LDAP / AD、企业微信、钉钉、表格导入等外部源同步目录；业务应用只面向 `Console Directory API`，不直接依赖具体上游目录系统。

这意味着：

- 对没有 LDAP / AD 的团队，`console` 可以作为企业目录主数据源。
- 对已有 LDAP / AD、企业微信、钉钉的团队，`console` 作为目录适配、同步、字段映射和冲突处理层。
- 对业务应用，目录依赖稳定在 `Console Directory API` 与 Foundation adapter 上，上游目录源替换不影响应用代码。

| 组件 | 负责 | 不负责 | 对业务应用输出 |
|---|---|---|---|
| `console.directory-runtime` | 用户、部门、岗位、项目注册表、外部目录同步、目录管理页面、目录字段映射与冲突处理 | 平台订阅、License、角色模板、策略签名、跨应用授权裁决 | 用户资料、部门树、成员关系、项目注册表、目录身份映射 |
| `account`（过渡） | legacy Account API、历史目录数据迁移源、兼容 facade | 新增平台治理、新增目录能力的长期承载 | 与现有 `HZY_ACCOUNT_API_*` 兼容的目录读取接口 |
| `platform` | 租户订阅、应用部署、角色/权限/模板/scope、subject 绑定、policy bundle、revocation、license、directory-runtime 治理 | 高峰目录查询、通讯录明细托管、业务项目主数据 | token claims、policy bundle、license、deployment/runtime 治理状态 |
| 业务应用 | 本地业务规则、业务关系求值、业务数据存储、UI 权限落地 | 目录主数据维护、平台角色模型治理 | 最终业务页面和接口行为 |

权威源约定：

- `real_name / display_name / email / mobile / dept_name / project_name` 等展示型字段，以 `console.directory-runtime` 为权威源；过渡期可由 `account` 提供兼容读取
- `role / permission / scope / capability / subscription / license` 等授权型字段，以 `platform` 为权威源
- 业务应用不得把目录字段反写为平台授权字段，也不得把平台角色结果当成通讯录来源

典型运行链路：

1. 租户管理员在平台控制台完成应用开通、角色模板配置和授权下发。
2. 租户管理员在 `console` 的 directory 管理页面维护目录源接入、同步策略、字段映射和异常处理；过渡期可继续使用 `account` 管理页面。
3. 业务应用登录后，本地基于平台下发的 token / policy bundle 做鉴权。
4. 业务应用在需要显示人员、部门、项目归属时，再通过 Foundation 访问 `console.directory-runtime`；过渡期 adapter 可 fallback 到 `account`。

设计约束：

- 应用不得在每个业务请求上实时回查平台做在线鉴权，正常路径应以本地 token 校验和 policy bundle 为主。
- 应用不得跨库直连 `console` 或 `account` 的目录内部表，只能消费标准目录 API。
- 平台只治理 `console.directory-runtime` 的版本、契约和健康状态，不托管目录明细。

### 7.4 `console`（客户侧基础运行服务）

`console` 是 Starter 默认包含的客户侧基础运行服务。

详细设计见：

- `docs/Console-Functional-Design-v1.md`
- `docs/Console-SQL-DDL-Draft-v1.sql`
- `docs/Console-API-Contract-v1.md`
- `docs/Console-Bootstrap-and-Rotation-Sequence-v1.md`
- `docs/Console-Vault-Credential-Management-Plan.md`

它不是业务应用，也不是 `@hzy/foundation` 这类共享代码层，而是**有状态的本地 supporting service**。除目录主数据外，`console` 也承担企业应用侧的基础服务中枢职责，把认证会话、消息通道、日志审计等通用能力沉到客户侧运行时。

负责：

- `org-profile`：企业基础信息、业务域/区域等低频主数据
- `system-settings`：系统参数、基础字典、环境级配置
- `credential-vault`：密文存储、`secret_ref` 解析、版本与轮换、受控 reveal、程序化 resolve；统一管理 `integration / service / bootstrap / custody` 四类凭证
- `integration-config`：GitLab / AI / 企业微信 / OIDC 等外部集成配置与凭证引用
- `directory-runtime`：用户、部门、岗位、项目注册表、外部目录同步、目录字段映射、目录冲突处理
- `auth-runtime`：本地登录、外部 IdP 回调、session、`/auth/me`、logout、登录审计
- `messaging-runtime`：企业消息通道、通知投递与发送日志，首选企业微信，后续可接钉钉、邮件、短信等 provider
- `audit-runtime`：登录审计、管理操作审计、基础服务访问日志与跨应用审计归集索引
- `account-compat`：过渡期兼容既有 Account API，支撑业务应用平滑迁移

不负责：

- 平台身份、授权、License、bundle、revocation（→ `platform`）
- AI 网关、GitLab 文档同步等独立 supporting service 实现
- 各业务模块的通知触发规则、业务事件生成与业务审计明细；`console` 只提供公共消息通道、投递日志和审计归集能力
- 任意业务对象主数据（项目执行、合同、资产、文档正文等）

边界约束：

- `foundation` 继续保持为无状态共享代码层，不新增数据库或持久化状态
- `console` 可以有自己的本地数据库与 secret backend
- 业务应用优先通过 Foundation adapter 或本地 service client 访问 `console`
- 若租户购买 `Assets`，可在资产视角增强凭证资产治理；但 `console` 不能依赖 `Assets`
- `custody` 托管凭证仅用于集中保管、授权展示和审计，默认不进入业务应用的程序化 `resolve` 链路

---

## 8. 主部署模式的拓扑

### 8.1 Managed Cloud Agent（默认，平台托管应用 + 客户自管数据面）

```
[客户侧]
    ├── 客户 IdP（LDAP / CAS / OIDC，可选）
    ├── hzy-data-runtime Agent（console / finance / assets / aims / codocs / workflow data adapters）
    ├── MySQL / Redis / OSS / Git / 搜索
    └── Cloudflare Tunnel / direct HTTPS / 后续 platform relay

                ↕ Agent API / Federation / Policy Sync / License / Heartbeat

[汇智云托管]
    ├── Control Plane
    ├── Identity Plane
    ├── Tenant Gateway Worker
    ├── Console Worker
    ├── 业务应用 Workers（aims / codocs / altoc / assets / ...）
    └── Tenancy / Billing
```

关键特征：

- 平台托管控制面，不托管业务数据
- 默认由平台侧托管 Cloudflare 业务应用运行时
- 默认由客户侧 Data Runtime Agent 访问租户 workload 数据面，包括 Console supporting runtime 与业务应用的数据资源
- 平台掌握控制面登录、授权、License、应用注册、策略下发；应用用户登录由租户 `console.auth-runtime` 承接
- 正常运行不要求业务请求每次回源平台
- Platform 数据库不走 Agent，详见 ADR-014

### 8.2 Self-Hosted Enterprise

```
[客户侧（全栈）]
    ├── Control Plane
    ├── Identity Plane
    ├── console（内置 directory / auth / messaging / audit 等基础 runtime）
    ├── 全部业务应用
    ├── MySQL / Redis / OSS / Git / 搜索
    └── （无 Tenancy / Billing）
```

关键特征：

- 客户拥有完整部署
- `deployment_id` 仍作为本部署信任根
- 可断网运行
- 仅在 License 续签、升级包分发等场景与汇智云连接

### 8.3 主模式对比

| 维度 | Managed Cloud Agent | Self-Hosted Enterprise |
|------|---------------------|------------------------|
| Control Plane | 平台 | 客户 |
| Identity Plane | 平台 | 客户 |
| `console`（内置基础 runtime） | 平台侧 Cloudflare Worker，必要时可独立部署 | 客户 |
| 业务应用 | 平台侧 Cloudflare Workers | 客户 |
| Data Runtime Agent | 客户，覆盖租户 workload 数据面但不覆盖 Platform 数据库 | 可选，通常不需要 |
| 数据库 / OSS / Git | 客户 | 客户 |
| 平台运营模块 | 有 | 无 |
| 应用用户 Token 签发方 | Console runtime | 客户侧 `console` |
| Platform 策略签名方 | 平台 | 客户侧 Platform |

### 8.4 离线与心跳机制

为了保证平台仍有“把手”，同时不让客户业务强依赖平台在线，采用：

- **License**：离线可验证
- **Signed Policy Bundle**：本地可验证
- **Heartbeat**：周期同步策略版本、吊销列表、License 状态
- **Grace Period**：断联后短时间内继续运行

默认约束：

- 断联不影响短期业务运行
- 超过 `grace_days` 必须完成一次成功同步
- 吊销列表在下一次联网时刷新

---

## 9. License 与能力开关

### 9.1 License 文件

- **离线可验证**：客户侧内置公钥，平台持有私钥
- **签入字段**：`deployment_id` / `deployment_mode` / `capabilities` / `soft_expiry` / `hard_expiry` / `grace_days`
- **分发方式**：
  - Managed Control Plane：平台生成并下发
  - Enterprise：后台导入或离线交付

### 9.2 典型 capability 列表

```
self_registration      自助注册
billing                计费
advanced_identity_federation 多 IdP / 高级 federation
ai_gateway             AI 网关
advanced_audit         高级审计
gitlab_sync            GitLab 同步
ldap_directory         LDAP 同步
app_marketplace        应用市场
```

### 9.3 过期策略

| 阶段 | 行为 |
|------|------|
| 软过期前 30 天 | UI 横幅提示续费 |
| 软过期 → 宽限期 | 降级警告，功能正常 |
| 宽限期满 → 硬过期 | 只读模式 |
| 硬过期 | 停用（identity 仍能登录，但功能全关） |

**吊销**：CRL 机制，下一次联网时更新。离线超过 `grace_days` 必须联网一次。

---

## 10. 关键数据模型

仅列出当前主线 schema 的关键对象簇，完整 DDL 以 `docs/HZY-Platform-SQL-DDL-Draft-v2.sql` 为准（已并入 v2.4 应用版本、订阅计划与 manifest action 快照约束）。

### 10.1 Platform Domain

```sql
platform_accounts
  id / uid / account_type / username / email / status

platform_sessions
  id / account_id / session_scope / tenant_code / issued_at / expires_at / status

platform_applications
  id / app_code / app_name / runtime_mode / service_role / auth_mode / repo_url / latest_manifest_id / latest_release_id

platform_app_manifests
  id / app_code / manifest_seq / manifest_hash / manifest_json / status

platform_app_releases
  id / app_code / release_version / source_tag / source_commit_sha / manifest_id / status / released_at

platform_app_manifest_resources / platform_app_manifest_resource_actions
  manifest 版本级资源与动作快照，action_code 由 app_code.resource_code.action 生成

platform_app_roles / platform_system_roles
  平台下发给租户的标准角色和模板母版

platform_plans / platform_capabilities
  套餐与能力定义主表
```

### 10.2 Boundary Domain

```sql
tenants
  id / tenant_code / tenant_name / status / default_auth_mode / onboarding_stage

tenant_account_memberships
  tenant_code / account_id / status / is_owner / invited_at / joined_at

tenant_subscriptions
  tenant_code / plan_id / status / active_unique_key / started_at / ended_at

subscriptions
  id / subscription_no / tenant_code / app_code / plan_code / target_release_id / status

deployments
  id / deployment_code / tenant_code / app_code / subscription_id
  deployment_mode / current_kid / current_pubkey_fingerprint / last_kid_reported_at / last_key_rotated_at
  connectivity_status / runtime_endpoint
  directory_contract_status / directory_sync_status / last_directory_sync_at
  reported_directory_contract_version / reported_directory_snapshot_hash

licenses
  id / license_code / subscription_id / tenant_code / plan_code / status
```

补充：

- 目标形态下，组织目录逻辑域表现为 `console` manifest 内的 `directory-runtime` capability；`service_role='directory_runtime'` 仅用于历史独立目录服务的兼容表示。
- 平台只保存其版本、契约兼容性、同步延迟、规模摘要与快照 hash，不保存目录明细。

### 10.3 Tenant Domain

```sql
tenant_subjects
  id / tenant_code / subject_type / subject_code / external_ref / parent_subject_id

tenant_sessions
  id / session_uuid / tenant_code / subject_id / deployment_id / issued_at / expires_at / status
  deployment-scoped app session

tenant_roles
  id / tenant_code / role_code / role_type / app_code / source / source_role_code

tenant_account_roles
  tenant_code / account_id / role_id / source_type / granted_at / expired_at

tenant_permission_templates
  id / tenant_code / template_code / template_type / source / source_template_code

tenant_template_bindings / tenant_template_overrides / tenant_role_scopes
  租户内模板绑定、例外覆盖、范围规则
```

### 10.4 Runtime Distribution

```sql
policy_bundles
  tenant_code / bundle_version / bundle_hash / bundle_uri / bundle_payload_json / signature

revocation_snapshots
  tenant_code / snapshot_version / snapshot_hash / snapshot_uri / entries_json / signature

revocation_entries
  tenant_code / deployment_id / target_type / target_id / source / revoked_at
```

### 10.5 运营补充

```sql
tenant_onboarding_steps
  tenant_code / step_code / step_status / step_payload_json / blocker_reason

deployment_connectivity_checks
  deployment_id / check_type / trigger_source / status / request_payload_json / response_payload_json

platform_app_manifest_registrations
  app_code / submitted_version / registration_status / review_status / result_manifest_id

tenant_runtime_credentials
  tenant_code / credential_mode / runtime_token_hash / runtime_token_last4 / status / revoked_at
```

---

## 11. 架构决策记录（ADR）

| ID | 决策 | 理由 |
|----|------|------|
| **ADR-001** | Runtime 信任根 = 部署实例级唯一；Console OIDC token 使用 Console issuer | 支持企业版、本地验证与客户侧应用用户 IdP |
| **ADR-002** | 平台不存应用终端用户 PII；控制面用户可存必要 PII | 既保证授权运营，又控制合规负担 |
| **ADR-003** | 客户 IdP 是应用用户身份源，Console 做应用侧 federation 与 OIDC 签发；Platform 做控制面身份与授权签名 | 尊重客户 IT 现状，同时保持应用用户会话在客户侧 |
| **ADR-004** | 默认模式 = Control-Plane SaaS，客户自管业务运行时与数据库 | 兼顾销售把手与客户数据主权 |
| **ADR-005** | Enterprise 是 Control Plane + Identity Plane 的本地化部署 | 保持产品内核统一 |
| **ADR-006** | Tenancy / Billing 仅服务平台运营，可剥离 | 降低企业版复杂度 |
| **ADR-007** | 按组织固定计费，不按用户数 | 平台无需追踪席位 |
| **ADR-008** | Foundation 逻辑拆成 Layer + SDK | 支持 Nuxt 与非 Nuxt 运行时 |
| **ADR-009** | License + Signed Policy Bundle + Heartbeat | 平衡平台控制力与客户侧离线运行 |
| **ADR-010** | 业务应用通过 manifest 向 Control Plane 注册 | 建立 app 与平台的标准契约 |
| **ADR-011** | 权限冲突仲裁：`exclude > grant`，用户例外 > 部门 > 岗位 | 见《冲突仲裁规范》 |
| **ADR-012** | 基础设施 provider 化（Git / OSS / MQ / 搜索） | 支持客户自选基础设施 |
| **ADR-013** | `foundation` 保持无状态共享代码层，Starter 必带基础状态服务独立为 `console`，并由 `console` 承载 directory / auth / messaging / audit 等企业侧基础 runtime | 避免把 Nuxt Layer 演化成新的有状态平台底座，同时减少企业端必选服务数量 |
| **ADR-014** | `managed-cloud-agent` 成为默认企业 SaaS 数据面模式；Hyperdrive 仅作过渡；Platform 数据库不纳入 Agent 覆盖范围 | 支持一套 Cloudflare 应用服务多租户，同时避免客户数据库公网暴露和 Hyperdrive 配额成为长期瓶颈；详见 `docs/ADR-014-Managed-Cloud-Agent-and-Deployment-Profiles.md` |

---

## 12. 现状 → 目标的演进方向

**仅标注大方向，具体迁移方案独立立项。**

### 现状观察

- 早期 `account` 模块曾事实上承担 Control Plane、Identity Plane、部分业务管理；当前已降级为 legacy 目录/身份/项目注册表迁移源与兼容 facade
- `platform` 已成为控制面主路径，承接租户、订阅、部署、License、策略包、应用治理和运行时心跳
- `console` 已成为客户侧基础运行服务主路径，承接企业配置、目录、认证、凭证保险箱、集成配置、员工入口和本地授权消费
- `foundation` 仍承担部分 SDK / adapter 职责（Console OIDC、Directory adapter、Workflow proxy、service token、集成配置 adapter 等）

### 演进大方向（不含时间表）

1. `account` 保持 legacy facade / 迁移源定位，不再新增平台治理、目录扩展和跨模块服务认证主路径
2. 提取 `tenancy/` 为独立目录，只保留平台运营能力
3. Schema：`companies` → `tenants`，并收敛为 `platform_* / boundary / tenant_*` 三域；补齐 `subscriptions` / `tenant_runtime_credentials` / `policy_bundles` / `revocation_snapshots`，deployment 密钥仅保留治理摘要字段
4. Token 收敛：应用用户 access token 使用 Console OIDC issuer；服务端调用使用 Console `token_use=service` JWT；部署级信任根、策略包与运行时 token 使用 deployment context 表达
5. 业务应用逐步通过 manifest 注册，替代硬编码
6. Foundation 逻辑拆出 SDK 契约，统一平台 API 调用入口
7. SSO 改造：从“LDAP 拉数据入库到独立 account”改为“console 内置 directory/auth runtime + federation + platform 最小主体目录”
8. 引入策略包签名、同步与心跳机制

### 明确不在本文档范围

- 迁移的时间节点
- 数据迁移脚本
- 双轨运行与回滚开关
- 现网租户的切换方案

---

## 13. 开放问题

以下问题尚未拍板，留待后续专题讨论：

- **策略包粒度**：按 tenant、按 app，还是按用户差异增量下发？
- **心跳失败策略**：宽限期结束后是只读、部分可用，还是只允许管理员登录？
- **跨部署实例身份联邦**：两个私有化客户的员工如何互认？
- **业务应用的灰度发布**：Control Plane 如何支持 app 多版本共存？
- **API 版本管理**：Control Plane 的 API 如何保证 1–2 年向后兼容？
- **基础设施 provider 抽象接口**：Git / OSS / 搜索的统一接口形态
- **审计日志归集**：分散在各 app 的审计如何统一检索？
- **AI 网关的归属**：继续放 `account`，还是提升为独立 Control Plane 服务？

---

## 14. 配套文档清单

本文档是顶层骨架。配套文档按独立节奏产出：

| 文档 | 状态 | 定位 |
|------|------|------|
| `docs/HZY-Platform-Schema-Draft-v2.md` | Draft v2 | 当前三域 schema 主设计 |
| `docs/HZY-Platform-SQL-DDL-Draft-v2.sql` | Draft v2 + v2.1 | 当前主线 DDL |
| `docs/Console-Functional-Design-v1.md` | Draft | `console` 功能边界与子域设计 |
| `docs/Console-SQL-DDL-Draft-v1.sql` | Draft | `hzy_console` 本地库 DDL 草案 |
| `docs/Console-API-Contract-v1.md` | Draft | `console` 本地管理面与服务间接口契约 |
| `docs/Console-Bootstrap-and-Rotation-Sequence-v1.md` | Draft | `console` 初始化、轮换与 reveal/resolve 时序 |
| `docs/Console-Vault-Credential-Management-Plan.md` | Draft | `console` vault 凭证分类、零配置运行链路与实施计划 |
| `docs/Console-Auth-Runtime-IdP-Implementation-Plan.md` | Draft | `console` 升级为 auth-runtime / OIDC IdP 的实施计划 |
| `docs/Console-Workflow-Runtime-Integration-Plan.md` | Draft | `workflow` 并入 `console.workflow-runtime` 实施方案 |
| `docs/HZY-Platform-Schema-Addendum-v2.1.md` | Draft v2.1 | 当前增量模型补遗 |
| `docs/Control-Plane-API-Contract.md` | Draft | Runtime / SDK 核心接口契约 |
| `docs/App-Manifest-Spec.md` | Draft | 应用 manifest 结构与约束 |
| `docs/License-and-Capability-Catalog.md` | Draft | 能力与 license 目录 |
| `docs/Identity-Plane-Design.md` | Draft | Federation / token / bundle / revocation 设计 |
| `docs/OIDC-First-Auth-Strategy.md` | Draft | 对上兼容、对下 OIDC-first 的协议策略 |
| `docs/HZY-Platform-ERD-v2.md` | Draft | 当前主线 DDL 对应 ER 图 |
| `docs/archive/platform-analysis/*` | Archive | v2 重写前的历史根因分析与决策背景 |

---

## 附录 A：名词对照

| 新术语 | 现有术语 | 说明 |
|-------|---------|------|
| Tenant | Company | 租户 = 公司，改名统一国际化表达 |
| Platform Account | — | 控制面账户，包含平台员工与租户管理员，对应 `platform_accounts` |
| Control Plane | `account` 中的历史平台职责 | 目标落点是 `hzy_platform` 的 platform + boundary 域与平台控制台 |
| Platform Identity Plane | `account` 历史平台身份职责 + Foundation bridge | 目标落点是控制面 session、runtime token、bundle / license / revocation 签名与治理；应用用户 IdP 落到 `console.auth-runtime` |
| Application Registry | 旧单域 `applications` / `app_manifests` | 当前拆为 `platform_applications` + `platform_app_releases` + `platform_app_manifests` + manifest resource/action 快照 |
| Subscription | — | 租户启用应用的订阅事实，对应 `subscriptions` |
| Deployment | — | 一次运行时实例部署，对应 `deployments` |
| Deployment Key Fingerprint | — | deployment 密钥治理摘要（`current_kid` + `current_pubkey_fingerprint`），不在平台持有 deployment 公私钥 |
| Platform Signing Key | — | 平台根签名密钥，对应 `platform_signing_keys`，用于签 bundle/license/revocation |
| Tenant Runtime Credential | — | 租户级 runtime 调用凭证当前态，对应 `tenant_runtime_credentials` |
| Capability | — | License 签入的能力开关，对应 `platform_capabilities` / `license_capabilities` |
| Subject | — | 平台侧最小授权主体，对应 `tenant_subjects` |
| Policy Bundle | — | 平台签名下发的租户级策略包，对应 `policy_bundles` |
| Revocation Entry | — | revocation 源数据，对应 `revocation_entries` |

---

## 附录 B：反例（本架构**不**支持什么）

明确列出不支持的模式，避免后续返工：

- ❌ 业务应用自建平台级用户目录和权限体系
- ❌ 业务应用跨库直连（如 aims 直接查 codocs 的 MySQL）
- ❌ 任一业务模块硬依赖 `tenancy`
- ❌ Token 里塞用户 PII（姓名、邮箱）
- ❌ 把业务应用平台云托管当成当前标准交付模式
- ❌ 平台托管客户业务数据库、文件和 Git 内容作为默认模式
- ❌ 通过不同代码分支维护 Managed / Enterprise
- ❌ 客户侧应用每次请求都回源平台鉴权
- ❌ Foundation 承载业务规则（如解释 codocs 的协作关系）
