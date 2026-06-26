# Console 功能设计 v1

状态：Draft  
日期：2026-04-23  
定位：目标设计，作为 `Huizhi-yun-Platform-Target-Architecture.md` 与 `Console-SQL-DDL-Draft-v1.sql` 的配套文档

---

## 0. 文档目标

本文档定义客户侧基础运行服务 `console` 的第一版功能边界，回答五个问题：

- `console` 到底是什么，不是什么
- 它和 `foundation`、`platform`、`directory-runtime`、`assets` 的边界如何划分
- 第一版应该提供哪些核心功能
- 业务应用通过什么方式消费这些能力
- 本地库 `hzy_console` 需要哪些核心表

本文档只定义：

- 角色定位与参与方
- 功能域划分
- 管理能力与 API 分组
- DDL 级数据模型边界

本文档不展开：

- 具体 UI 视觉设计
- 具体 KMS / Vault 厂商选型
- 各外部集成的协议细节
- SDK 代码实现细节

---

## 1. 定位

`console` 是**客户侧部署、平台治理、Starter 默认包含**的基础运行服务。

它的职责是：

- 承接企业低频基础资料与基础字典
- 承接系统参数与环境级配置
- 承接外部集成配置与凭证引用
- 承接本地 `credential-vault` 能力
- 承接客户侧 `directory-runtime` 与 `auth-runtime` 的目标运行域
- 承接企业员工统一入口、应用中心、轻量待办/通知/协同入口与基础工作台
- 为本地业务应用与 supporting services 提供稳定的基础配置读取入口

它**不是**：

- 业务应用
- 共享代码层（不是 `@hzy/foundation`）
- 平台控制面
- 可选购买的 `Assets` 业务模块

一句话：

**平台治理 console，业务应用消费 console，企业基础配置、目录明细与秘密仍留在客户侧。**

---

## 2. 参与方

### 2.1 Platform

负责：

- `console` 的 manifest / deployment / license / heartbeat 治理
- 判断契约版本、连通性与健康状态
- 下发 Starter 必带能力的运行时治理约束

不负责：

- 保存企业基础配置明细
- 保存企业 secret 明文或可恢复密文
- 为业务应用直接提供高频配置查询

### 2.2 Console

负责：

- `org-profile`
- `system-settings`
- `integration-config`
- `credential-vault`
- 本地 service credential 发放与轮换

### 2.3 Foundation Adapter

负责：

- 为 Nuxt 业务应用封装 `console` 的读取客户端
- 提供统一缓存、重试、鉴权 header 注入
- 避免各业务模块重复实现基础配置访问逻辑

### 2.4 Business Applications

如 `aims / codocs / altoc / align / workflow / assets`。

只通过标准 API 读取：

- 企业基础资料
- 系统参数与字典
- 外部集成的非 secret 配置
- 必要的本地服务凭证

不得：

- 直连 `console` 数据库
- 自己存第三方平台 key
- 绕过 `console` 自行维护企业基础配置副本

### 2.5 Assets（可选增强）

`Assets` 若被购买，可以：

- 以资产视角展示凭证资产治理信息
- 做责任人、成本、供应商、盘点、审计视图增强

但 `console` **不能依赖** `Assets` 才能运行。

---

## 3. 设计原则

| # | 原则 |
|---|------|
| B1 | `console` 是 Starter 必带基础运行服务，不按业务应用思维设计 |
| B2 | 低频基础配置留在客户侧，平台只看摘要与健康状态 |
| B3 | `foundation` 只做代码层；有状态能力必须落到 `console` |
| B4 | 配置与秘密分离：业务配置不存明文 secret；关系表内部通过 `secret_id` 引用本地 vault，vault 对外保持 `secret_ref` |
| B5 | reveal 与 resolve 分离：给人看明文与给程序取 secret 是两种动作 |
| B6 | 外部集成配置统一收口到 `integration-config`，避免业务模块各自存一份 |
| B7 | 业务主数据不进入 `console`，避免新的“大杂烩底座” |
| B8 | 第一版优先支持客户侧 `.env / Docker/K8s Secret / DB 加密密文`；vault 对外标识统一为 `secret_ref`，关系表内部通过 `secret_id` 绑定 |
| B9 | 第一版本地库按“一个 `console` 实例对应一个企业环境”设计，`tenant_code` 只在 `org_profiles` 中保存，且由 `singleton_key=1 + UNIQUE + CHECK` 在数据库层强制单行 |
| B10 | 第一版不允许集成/服务凭证直接引用外部 secret 系统；必须先在本地 `vault_secrets` 建档再引用 |
| B11 | 第一版不支持同一对象下并行生效凭证（同一 integration 或同一 service client 同时只允许一个 current） |
| B12 | `directory-runtime` 是 console 内的逻辑域；`account` 只作为迁移期目录事实源、兼容 facade 和 fallback |

---

## 4. 功能域

### 4.1 `org-profile`

负责：

- 组织显示名、简称、法定主体信息
- 默认语言、时区、货币等基础运行参数
- 低频组织维度主数据：业务域、区域
- 低频站点级展示资料：Logo、官网、联系人

典型使用方：

- `Altoc` 读取企业显示资料
- `Assets` 读取业务域 / 区域基础视图
- `Codocs` / `Aims` 读取默认语言、时区、品牌资料

不负责：

- 高频用户/部门/岗位目录查询（由 `directory-runtime` 域负责）
- 项目注册表维护（由 `directory-runtime` 域负责）
- 客户/合同/资产/文档等业务主数据

### 4.2 `system-settings`

负责：

- 系统参数目录与参数值
- 基础字典目录与字典项
- 环境级配置（非 secret）
- 可本地覆盖的运行参数

第一版建议承接：

- 业务域 / 区域之外的通用字典
- 页面展示相关低频配置
- 默认阈值、开关、文本模板引用

不负责：

- License capability
- 平台角色模板
- 任意明文 secret 或第三方集成凭证
- 业务模块自己的复杂业务规则参数

已承接的内置参数（节选）：

- `workflow.apiUrl`（`runtime`）：审批流服务基础地址，供业务应用经 license bootstrap / runtime settings 解析。
- `feedback.reporter.enabled`（`ui`，boolean，默认启用）：是否在各应用页面展示反馈浮动按钮（IssueReporter）。Foundation 经 `GET /api/runtime/feedback-reporter` 用 `system_settings:view` service grant 解析；启用时业务应用右下角展示反馈入口，采集缺陷/建议/咨询并上报 WebDev Issue 收件箱。
- `feedback.notify.wecomUsers`（`ui`，string，默认空）：收到反馈后通知的企业微信号，支持多个、逗号分隔。Foundation 转发反馈到 WebDev intake 后读取该参数，经共享 `sendNotification()` WeCom 渠道（`wecom.default` 集成 / notification-runtime）向这些人推送提醒；留空则不通知，发送失败不影响用户提交。

约束：

- `system-settings` 只存非 secret 参数
- 若某项配置需要凭证，只能在 `integration-config` / `service credential` 凭证表中保存 vault 外键（`secret_id`）；对外可暴露 `secret_ref`，实际 secret 仍归 `credential-vault`

### 4.3 `integration-config`

负责：

- GitLab / AI / 企业微信 / OIDC / OSS 等外部集成配置
- endpoint / client_id / app_id / tenant_id 等非 secret 配置
- 配置与 secret 的绑定关系
- 连通性检查与最近结果摘要

约束：

- 第一版所有集成凭证必须引用本地 `vault_secrets`
- 第一版每个 `integration` 仅维护单条 `primary` 凭证链，不支持并行生效凭证
- 同一 `integration` 同时只允许一条 `status='active'` 的凭证记录；`current_credential_id` 指向该记录由服务写入流程保证
- `integration_credentials` 是 Console 内部凭证绑定模型；Nuxt 业务模块不得直接使用该模型，必须通过 Foundation adapter 按 `integrationCode` 消费集成能力

典型例子：

- GitLab base URL + 绑定到本地 vault 的 bot token
- AI provider base URL + model policy + 绑定到本地 vault 的 API key
- 企业微信 corpId + 绑定到本地 vault 的 secret
- OIDC client_id + issuer metadata + 绑定到本地 vault 的 client secret

不负责：

- GitLab 文档同步逻辑本身
- AI 网关推理逻辑本身
- 通知发送逻辑本身

### 4.4 `credential-vault`

负责：

- secret 元数据管理
- 可恢复密文或外部 secret backend 引用
- 版本管理与轮换链路
- `secret_ref` 解析
- 受控 reveal
- 程序化 resolve
- 访问审计

建议区分两种动作：

- `reveal`
  给人看明文或一次性复制；高敏、强审计、可审批
- `resolve`
  给程序取 secret；默认内部服务动作，不回显给前端

`secret_ref` 约定建议：

- 当前版本：`hzybase://vault/{secret_code}`
- 指定版本：`hzybase://vault/{secret_code}@v{version_no}`

凭证按 `vault_secrets.usage_type` 分为四类：

| usage_type | 类型 | 说明 |
|---|---|---|
| `integration` | 集成凭证 | GitLab、OSS、企业微信、AI Provider、云厂商 AKSK 等系统运行要使用的外部 Key |
| `service` | 服务凭证 | Aims / Codocs / Workflow / Assets 等本地服务访问 Console 或 supporting service 的凭证 |
| `bootstrap` | 启动凭证 | 写入 `license.lic` 的最小 access key，用于应用启动时换取短期 service token |
| `custody` | 托管凭证 | 仅用于集中保管、授权展示和审计的客户第三方 Key，默认不允许程序化 resolve |

其中：

- `integration / service / bootstrap` 属于 runtime credentials，服务于平台和业务应用运行。
- `custody` 属于托管保管凭证，不进入默认应用零配置运行链路，只允许经授权 reveal。

第一版约束：

- `backend_secret_ref` 仅允许指向本地运行环境可解析的 `.env / Docker Secret / K8s Secret`
- 不允许把外部 vault 产品直接作为 `integration` / `service credential` 的旁路引用源
- `usage_type='custody'` 的 secret 默认禁止 `/vault/resolve`，只能通过受控 reveal 查看明文

### 4.5 本地 Service Credential

`console` 第一版应顺带承接本地服务凭证发放与轮换，服务对象包括：

- 业务应用访问 `console`
- supporting service 访问 `directory-runtime`
- 本地服务之间的受控调用

这部分能力逻辑上归在 `credential-vault` 域内，但单独建模为：

- `service client`
- `service client credential`
- `service client grants`

约束：

- 第一版所有服务凭证必须引用本地 `vault_secrets`
- 第一版同一 `service client` 同时只允许一个 current credential
- 同一 `service client` 同时只允许一条 `status='active'` 的凭证记录；`current_credential_id` 指向该记录由服务写入流程保证

它的价值是：

- 避免每个模块自己发 API key
- 避免凭证模型继续留在 `account`
- 为后续本地 supporting services 统一 credential 体系

### 4.6 `directory-runtime`

目标形态下，`directory-runtime` 是 `console` 内的逻辑域，而不是企业端长期必选的独立 `account` 服务。

负责：

- 用户目录、部门树、岗位/汇报线等目录主数据。
- 项目注册表与基础归属关系。
- LDAP / HR / 企业微信 / 钉钉 / OIDC 等上游目录源同步。
- 面向业务应用的稳定目录读取 API。
- 面向 platform `subject_sync` 的最小 subject 投影。

不负责：

- platform 角色模板、应用授权、License、policy bundle。
- 业务应用的业务主数据。
- 把姓名、邮箱、手机等 PII 推送到 platform。

迁移期策略：

- 先由 console mirror / fallback account，保证现有应用不中断。
- Foundation 新增 directory adapter，业务应用不直接感知 account/console 切换。
- 稳定后 account 仅保留兼容 facade 或下线。

### 4.7 `auth-runtime`

`auth-runtime` 与 `directory-runtime` 同属 console 的客户侧基础运行域。

负责：

- 企业本地登录会话。
- CAS / OIDC / 企业微信等登录回调。
- 外部身份到本地 `uid` 的解析。

不负责：

- platform 控制台账号登录。
- platform 授权裁决与 bundle 签发。

### 4.8 `employee-portal`

SSO 落地后，`console` 同时承担企业员工统一入口。

负责：

- 企业工作台首页。
- 我的应用与应用中心。
- 当前用户可见应用过滤。
- 最近访问、常用应用、置顶应用等轻量入口偏好。
- 我的待办、通知摘要、公告摘要等跨应用入口聚合。
- 轻量事项入口与简单提醒。
- 个人资料与统一登出入口。

不负责：

- 平台级应用台账、订阅、license、deployment、policy bundle 签发。
- 业务应用页面承载和业务主数据存储。
- 深度组织协同业务对象的完整生命周期，例如协助单、人员借调、HR/财务轻流程台账。
- 把所有业务应用 iframe 到一个页面。
- 替代业务应用自身页面级和资源级权限校验。

应用列表来源：

- 优先读取本地已验签 policy bundle 的 `applications` 投影。
- 需要实时刷新时，可通过运行时 token 调用 platform runtime applications。
- 前端默认通过 `/api/user/applications` 获取当前用户可见应用。

详细方案见 `docs/Console-Unified-Employee-Portal-Plan.md`。

`align` 不再承担全平台统一入口职责。当前阶段轻量办公协同入口归入 `employee-portal`；当协同事项演进出完整状态机、SLA、借调履约、HR/财务台账等深度业务域时，再作为独立 `align` 应用启用或拆分。

---

## 5. 第一版管理面能力

建议以本地管理端或企业管理入口嵌入的方式提供以下菜单：

1. 概览
- 契约版本
- 最近 heartbeat / 健康状态
- 到期凭证数
- 集成连通性异常数

2. 企业资料
- 基础资料
- 业务域
- 区域与行政区划映射

3. 系统参数
- 参数目录
- 参数值
- 基础字典

4. 集成中心
- GitLab
- AI Provider
- 企业微信
- OIDC / SSO
- 存储 / OSS
- 连通性检查历史

5. 凭证库
- 凭证台账
- 版本与轮换
- reveal 记录
- resolve / 使用审计

6. 服务凭证
- 本地 service client
- client secret 轮换
- 访问授权（resource/action/scope）
- 最近使用情况

---

## 6. API 分组建议

详细接口见：

- `docs/Console-API-Contract-v1.md`

Base URL 建议：

- 本地侧：`http://console/api/v1/console`
- 业务模块通过 Foundation 代理后可表现为：`/api/base/**`

### 6.1 Meta

- `GET /api/v1/console/meta`
- 返回契约版本、tenantCode、settingsHash、integrationHash、vaultHealth

### 6.2 Tenant Profile

- `GET /api/v1/console/profile`
- `PATCH /api/v1/console/profile`
- `GET /api/v1/console/business-domains`
- `POST /api/v1/console/business-domains`
- `GET /api/v1/console/regions`
- `POST /api/v1/console/regions`

### 6.3 System Settings

- `GET /api/v1/console/settings/catalog`
- `GET /api/v1/console/settings/values`
- `PUT /api/v1/console/settings/values/:settingKey`
- `GET /api/v1/console/dictionaries`
- `PUT /api/v1/console/dictionaries/:dictionaryCode`

### 6.4 Integration Config

- `GET /api/v1/console/integrations`
- `GET /api/v1/console/integrations/:integrationCode`
- `POST /api/v1/console/integrations`
- `PATCH /api/v1/console/integrations/:integrationCode`
- `POST /api/v1/console/integrations/:integrationCode/check`
- `POST /api/v1/console/integrations/:integrationCode/rotate`
- `POST /api/v1/console/notification-runtime/wecom-check`
- `POST /api/v1/console/notification-runtime/wecom-test`：测试发送企业微信消息，并向当前操作者写入统一消息中心结果通知

### 6.5 Credential Vault

- `GET /api/v1/console/vault/secrets`
- `POST /api/v1/console/vault/secrets`
- `POST /api/v1/console/vault/secrets/:secretCode/versions`
- `POST /api/v1/console/vault/secrets/:secretCode/rotate`
- `POST /api/v1/console/vault/secrets/:secretCode/reveal`
- `POST /api/v1/console/vault/resolve`

### 6.6 Service Clients

- `GET /api/v1/console/service-clients`
- `POST /api/v1/console/service-clients`
- `POST /api/v1/console/service-clients/:clientCode/rotate`
- `GET /api/v1/console/service-clients/:clientCode/grants`
- `PUT /api/v1/console/service-clients/:clientCode/grants`

---

## 7. 数据模型映射

| 功能域 | 主表 |
|---|---|
| `org-profile` | `org_profiles`, `org_business_domains`, `regions`, `region_divisions` |
| `system-settings` | `setting_catalogs`, `setting_values`, `dictionaries`, `dictionary_items` |
| `credential-vault` | `vault_secrets`, `vault_secret_versions`, `vault_access_logs` |
| `integration-config` | `integrations`, `integration_credentials`, `integration_check_logs` |
| `service credential` | `service_clients`, `service_client_credentials`, `service_client_grants` |
| `directory-runtime` | `directory_users`, `directory_departments`, `directory_user_departments`, `directory_projects`, `directory_project_members`, `directory_identities`, `directory_subject_exports`, `directory_sync_jobs`, `directory_sync_events` |
| `auth-runtime` | `local_sessions`, `auth_login_events`, `local_presence_heartbeats` |
| 通用操作审计 | `operation_logs` |

---

## 8. 平台治理建议

`console` 在平台模型中建议表现为：

- `platform_applications.service_role = 'base_runtime'`
- 有自己的 `platform_app_manifests`
- 通过 `subscriptions + deployments` 进入企业
- 通过 `deployment_connectivity_checks` 做连通性检查
- 通过 `deployment_heartbeats` 上报运行摘要

建议 heartbeat 摘要至少包含：

- `baseContractVersion`
- `profileHash`
- `settingsHash`
- `integrationHash`
- `vaultSecretCount`
- `rotationDueCount`
- `integrationHealthyCount`
- `integrationFailedCount`
- `directoryContractVersion`
- `directorySnapshotHash`
- `directorySyncLagSeconds`
- `directoryUserCount / directoryDepartmentCount / directoryProjectCount`

平台不应获取：

- secret 明文
- 可恢复密文
- reveal 内容
- 具体第三方 token

---

## 9. 与其他模块的边界

| 组件 | 负责 | 不负责 |
|---|---|---|
| `console` | 企业基础资料、系统参数、外部集成配置、凭证保险箱、本地 service credential、`directory-runtime`、`auth-runtime` | 平台授权、业务主数据、具体集成业务逻辑 |
| `directory-runtime`（console 内逻辑域） | 用户/部门/岗位/项目注册表、目录同步、最小 subject 投影 | 系统参数、集成配置、凭证保险箱、平台授权 |
| `account`（迁移期） | 现有目录事实源、兼容 API、fallback | 新增平台治理能力、长期必选运行时职责 |
| `platform` | 订阅、license、deployment、bundle、runtime 治理 | 客户侧基础配置明细、secret 内容 |
| `foundation` | 共享代码层、adapter、缓存、统一调用封装 | 数据库存储、secret 持久化 |
| `assets` | 凭证资产台账与治理增强（可选） | 基础 secret 存储、解析、发放、运行时依赖 |

---

## 10. 第一版非目标

第一版 `console` 不承担：

- 独立 IdM 产品级能力（复杂 HR 主数据治理、跨集团主数据合并等）
- AI 网关推理代理
- GitLab 文档同步或 MR 编排
- 企业微信消息发送
- 全量企业 KMS / HSM 产品能力
- 平台控制面账户体系
- 强依赖 `Assets` 才能运行的凭证治理流程

---

## 11. 配套 DDL

配套 SQL 草案：

- `docs/Console-SQL-DDL-Draft-v1.sql`
- `docs/Console-Vault-Credential-Management-Plan.md`

建议后续与以下文档联动推进：

- `docs/Huizhi-yun-Platform-Target-Architecture.md`
- `docs/Directory-Runtime-Contract.md`
- `docs/Account-Directory-Runtime-Refactor-Plan.md`
- `docs/Console-API-Contract-v1.md`
- `docs/Console-Bootstrap-and-Rotation-Sequence-v1.md`
