# hzy_platform 第二版 Schema 设计

状态：Draft v2
日期：2026-04-22
取代：`archive/platform-v1/HZY-Platform-Schema-Draft-v1.md`（v1 在双域诊断后被定性为"单域错位"，本文档为重写而非增量）
前置：`archive/platform-analysis/HZY-Platform-Domain-Separation-Redesign.md`（根因）、`archive/platform-analysis/HZY-Platform-Schema-Critique-and-Fix.md`（字段级问题清单）

---

## 1. 文档定位

本文档定义 `hzy_platform` 第二版完整数据模型。相比 v1：

- **重塑整体形态**：引入 Platform / Boundary / Tenant 三域分层
- **落实 ADR**：特别是 ADR-001（deployment 信任根）、ADR-002（零 PII）、ADR-006（Tenancy 可剥离）、ADR-009（License + Bundle + Heartbeat）
- **消除漏洞**：NULL 唯一约束陷阱、授权主体二元制、订阅事实缺失、审计混合等
- **明确接壤面**：平台签给租户的契约对象（tenants / subscriptions / deployments / licenses / bundles）独立成域

---

## 2. 设计目标

| # | 目标 |
|---|------|
| G1 | 一份 DDL 同时支撑 Managed SaaS 与 Self-Hosted Enterprise |
| G2 | 平台控制面与租户身份面在 schema 上物理可分（Enterprise 交付时 platform_* 可剥离）|
| G3 | 应用终端用户零 PII；控制面用户（平台员工 + 租户管理员）可存必要 PII |
| G4 | 授权链唯一入口：`subject_id`（不再混用 uid/subject_id）|
| G5 | 订阅、部署、许可、策略包四层职责清晰，可按租户聚合、可按部署分发 |
| G6 | 所有唯一约束在 DB 层强制，不靠应用层 `WHERE NOT EXISTS` 维护 |
| G7 | 动态授权解析可行，且具备物化视图/缓存切换余地 |
| G8 | 组织目录明细不进入平台库；平台只治理目录运行时的契约、版本与健康摘要 |

---

## 3. 设计原则

| # | 原则 |
|---|------|
| P1 | 三域分层：`platform_*` / `boundary` / `tenant_*` |
| P2 | `platform_*` 表**不带** `tenant_code`；`tenant_*` 表 `tenant_code` **NOT NULL** |
| P3 | 系统内置对象（系统角色、模板、应用目录）属于平台域，不再用 `tenant_code=NULL` 表达 |
| P4 | `tenant_roles / tenant_permission_templates` 是平台模板的**复制副本**，租户可改不污染母版 |
| P5 | 授权主体统一为 `tenant_subjects.id`；用户主体直接用 `tenant_subjects(subject_type='user')` 表达 |
| P6 | 应用终端用户零 PII：`tenant_subjects(user)` 不存姓名/邮箱/手机/头像；控制面账户统一落 `platform_accounts` |
| P7 | 所有唯一键列均 NOT NULL，彻底杜绝 NULL 唯一陷阱 |
| P8 | deployment 是运行时身份锚点（kid/fingerprint 摘要 + heartbeat），license 是授权事实，bundle 是策略分发 |
| P9 | 高频表（heartbeats / audit）显式标注分区与保留期策略（DDL 里用注释给 DBA）|
| P10 | 组织目录服务属于客户侧受管运行时；平台只存 contract/version/sync 摘要，不存通讯录明细 |

---

## 4. 命名与约定

- 数据库：`hzy_platform`
- 表前缀：
  - `platform_*` — 平台域
  - `tenant_*` — 租户域
  - 其余（`tenants / tenant_account_memberships / subscriptions / deployments / licenses / policy_bundles / revocation_snapshots / deployment_heartbeats / tenant_runtime_credentials / license_capabilities / license_deployments / policy_bundle_targets / revocation_snapshot_targets`） — 边界域
- 主键：`id BIGINT UNSIGNED AUTO_INCREMENT`
- 时间列：`created_at / updated_at`
- 状态列：`status VARCHAR(32)`（ENUM 用字符串，便于演进）
- 软删除：v2 不引入 `deleted_at`；需要软删时用 `status='terminated'`
- 冗余列原则：**默认不冗余**；性能必须冗余时在表级注释写清楚

---

## 5. 顶层分层总览

```
┌─ Platform Domain（不带 tenant_code，汇智云自己的世界）────────┐
│  身份与访问 : platform_accounts / platform_sessions             │
│             platform_email_activation_tokens                    │
│             platform_roles / platform_role_permissions         │
│             platform_account_roles / platform_resources        │
│                                                                 │
│  产品目录   : platform_applications / platform_app_releases    │
│             platform_app_manifests / platform_app_manifest_resources
│             platform_app_manifest_resource_actions              │
│             platform_app_supported_scopes                       │
│             platform_capabilities / platform_plans              │
│             platform_plan_capabilities / platform_plan_apps     │
│                                                                 │
│  下发模板   : platform_system_roles                             │
│             platform_app_role_permissions                    │
│             platform_app_role_scopes                         │
│             platform_system_roles                           │
│             platform_system_app_role_maps                      │
│                                                                 │
│  商业运营   : platform_orders / platform_invoices               │
│             platform_payments                                   │
│             platform_tenant_lifecycle_events                    │
│             platform_tickets / platform_announcements           │
│             platform_feature_flags / platform_api_keys          │
│             platform_signing_keys / platform_webhooks           │
│                                                                 │
│  审计      : platform_audit_logs                                │
└─────────────────────────────────────────────────────────────────┘

┌─ Boundary Domain（平台签给租户的契约产物）──────────────────┐
│  tenants / tenant_account_memberships                         │
│  tenant_subscriptions / tenant_runtime_credentials             │
│  subscriptions                                                │
│  deployments                                                   │
│  licenses / license_capabilities / license_deployments        │
│  policy_bundles / policy_bundle_targets                       │
│  revocation_snapshots / revocation_snapshot_targets           │
│  deployment_heartbeats                                        │
└───────────────────────────────────────────────────────────────┘

┌─ Tenant Domain（tenant_code NOT NULL）──────────────────────┐
│  应用身份   : tenant_identity_providers                       │
│             tenant_subjects / tenant_subject_identities       │
│             tenant_sessions                                   │
│                                                               │
│  授权      : tenant_roles / tenant_role_permissions           │
│             tenant_subject_roles / tenant_account_roles       │
│             tenant_permission_templates                       │
│             tenant_template_roles                             │
│             tenant_template_bindings                          │
│             tenant_template_overrides                         │
│             tenant_role_scopes                                │
│                                                               │
│  审计      : tenant_audit_logs                                │
└───────────────────────────────────────────────────────────────┘
```

---

## 6. Platform Domain

### 6.1 身份与访问

#### 6.1.1 `platform_accounts`

控制面账户（汇智云团队成员 + 租户管理员）。这里的 PII 是合理的——这是控制面的**使用者**，不是被控面的**对象**。

主体边界：
- `staff`：平台员工主体，只允许进入 `/admin` 与 ops API。
- `tenant_admin`：租户管理员主体，只允许进入 `/dashboard` 与 tenant-admin / console API。
- 两类主体可以共享表结构和部分基础数据，但不能共享登录入口、会话 cookie 或接口权限。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT UNSIGNED PK | |
| uid | VARCHAR(64) UK | 稳定标识 |
| account_type | VARCHAR(32) | `staff / tenant_admin` |
| username | VARCHAR(128) | 登录名 |
| email | VARCHAR(255) UK | 控制面账户邮箱 |
| email_verified_at | DATETIME NULL | 邮箱链接激活完成时间 |
| display_name | VARCHAR(255) | |
| password_hash | VARCHAR(255) NULL | 自建密码登录时使用 |
| oidc_sub | VARCHAR(255) NULL | 未来接自家 IdP 用 |
| mfa_enabled | TINYINT(1) DEFAULT 0 | |
| status | VARCHAR(32) | pending_activation/active/suspended/terminated |
| last_login_at | DATETIME NULL | |
| created_at / updated_at | DATETIME | |

#### 6.1.2 `platform_sessions`

控制面会话表。`/admin` 与 `/dashboard` 共享表结构，但会话按 `session_scope` 强隔离，不允许互相复用。

关键字段：`session_uuid / account_id / session_scope / tenant_code / idp_type / issued_at / expires_at / status`。

约定：
- `session_scope='platform_admin'` 只能绑定 `platform_accounts.account_type='staff'`，cookie 为 `hzy_platform_admin_session`。
- `session_scope='tenant_admin'` 只能绑定 `platform_accounts.account_type='tenant_admin'`，cookie 为 `hzy_tenant_dashboard_session`。
- 历史 `hzy_platform_session` 仅作兼容清理，不再作为新登录态写入。

#### 6.1.3 `platform_email_activation_tokens`

邮箱密码注册的激活链接令牌表。明文 token 只进入邮件链接，数据库仅保存 `sha256(token)`。

关键字段：`account_id / email / token_hash / expires_at / consumed_at / status`。

#### 6.1.4 `platform_resources`

平台后台的功能资源（租户管理 / 应用市场 / 订阅 / 账单 / 审计 / 公告 / 灰度）。

| 字段 | 说明 |
|---|---|
| id / resource_code UK | |
| resource_name / description | |
| parent_id NULL | 支持两级菜单分组 |
| sort_order / status | |

#### 6.1.4 `platform_roles`

平台员工后台内置角色。示例：

- `super_admin`（超级管理员，不可分配）
- `ops_admin`（平台运营）
- `billing_viewer`（财务只读）
- `support_agent`（客服）
- `sre`（运维）
- `product_readonly`（产品只读）

字段：`id / role_code UK / role_name / description / is_builtin / is_assignable / status`。

**注意**：这张表和 `platform_system_roles` 完全不同——这里是给汇智云员工用的，那里是下发给租户的模板；租户管理员不使用 `platform_roles`，而是走 `tenant_account_roles`。

#### 6.1.5 `platform_role_permissions`

`platform_roles × platform_resources × action`。

#### 6.1.6 `platform_account_roles`

平台员工 → 角色。

### 6.2 产品目录

#### 6.2.1 `platform_applications`

产品目录里的应用。上浮自 v1 `applications`，去掉 `tenant_code`。

| 字段 | 说明 |
|---|---|
| id / app_code UK | |
| app_name / description / icon / home_url / callback_url / logout_url / repo_url | `repo_url` 用于 Platform 按 GitLab release/tag 拉取对应 commit 的 `app.manifest.json` |
| app_type | internal / external / third_party |
| runtime_mode | customer-hosted / managed / hybrid |
| service_role | business_app / directory_runtime / workflow_runtime / supporting_service |
| auth_mode | oidc / legacy / mixed |
| bundle_enabled | 是否参与 bundle 分发 |
| sort_order | 应用展示顺序；越小越靠前，写入 runtime applications 与 policy bundle，供 Console / Foundation 应用入口排序 |
| latest_manifest_id NULL | 指向当前生效 manifest |
| latest_registration_id NULL | 最近一次 manifest 注册记录 |
| latest_release_id NULL | 最新 released 应用版本 |
| last_manifest_registered_at / last_manifest_review_status | 最近注册与审核结果摘要 |
| repo_url | Platform 按 GitLab release/tag 拉取 `app.manifest.json` 的仓库地址 |
| status | |

补充：`service_role='directory_runtime'` 时，表示这是客户侧部署、受平台治理的组织目录服务。平台只管理其 manifest、版本、契约检查、License 与心跳摘要，不承接用户/部门/项目明细数据。

#### 6.2.2 `platform_app_manifests`

应用 manifest 的内容版本档案。

`(app_code, manifest_seq)` 唯一，`(app_code, manifest_hash)` 用于内容去重。manifest 文件不再声明 `version` / `displayVersion`；应用版本由 `platform_app_releases.release_version` 表达。

补充：manifest 注册历史与审核轨迹落到 `platform_app_manifest_registrations`，`source_type` 默认 `release_pipeline`（发布期注册），运行时启动不再以 `app_runtime` 触发注册。

#### 6.2.3 `platform_app_releases`

应用版本主表。`release_version` 等于 GitLab release/tag，`source_commit_sha` 记录读取 manifest 的 commit，`manifest_id` 指向内容版本。

状态机：`draft / permissions_pending / ready / released / deprecated`。订阅计划默认只解析最新 `released` 版本。

#### 6.2.4 `platform_app_manifest_resources`

从 manifest 抽取的资源快照。`platform_app_resources` 聚合表废弃，manifest 版本级资源快照成为唯一权威源。

`(manifest_id, resource_code)` 唯一。

#### 6.2.5 `platform_app_manifest_resource_actions`

从 manifest 抽取的资源动作快照。

关键字段：

- `manifest_id / app_code / resource_code / action`
- `action_code`：生成列，`CONCAT(app_code, '.', resource_code, '.', action)`
- `requires_grant`：是否需要权限覆盖检测；默认 `1`

`platform_app_role_permissions.manifest_action_id`、`tenant_role_permissions.source_manifest_action_id` 等字段用于追溯权限来源。

#### 6.2.6 `platform_app_supported_scopes`

manifest 声明 app 能解释的 scope 类型（如 `relation:project_member`）。

`(app_code, scope_type, scope_value)` 唯一。

用途：`tenant_role_scopes` 写入 `relation` 类 scope 时校验此表存在对应声明。

#### 6.2.7 `platform_capabilities`

能力定义主表。`license_capabilities.capability_code` 必须引用此表存在的 code。

#### 6.2.8 `platform_plans`

套餐。示例：`starter / pro / enterprise`。

| 字段 | 说明 |
|---|---|
| id / plan_code UK | |
| plan_name / plan_tier | |
| price_model | fixed / quote / free |
| base_price / currency / billing_cycle | |
| status / description | |

#### 6.2.7 `platform_plan_capabilities`

套餐包含能力。`(plan_id, capability_code)` 唯一。

#### 6.2.8 `platform_plan_apps`

套餐包含的应用。`(plan_id, app_code)` 唯一。

### 6.3 系统模板（下发给租户）

平台预置的角色/模板定义，租户创建或订阅 app 时由 lifecycle 编排器复制到租户副本。

#### 6.3.1 `platform_system_roles`

应用全局角色母版。示例：`console.viewer / console.directory_manager / console.security_admin / console.admin`。

| 字段 | 说明 |
|---|---|
| id / role_code UK | |
| role_name / role_type | `role_type` 固定为 `system`，不再用作 base/job/app 分类 |
| app_code | 所属应用；新建/编辑必须指定，NULL 仅兼容历史数据 |
| description | |
| is_required | 租户创建必带 |
| status | |
| policy_revision / policy_hash / policy_updated_at | 系统角色默认权限与 scope 的稳定指纹，用于租户侧快速判断是否需要同步 |

#### 6.3.2 `platform_app_role_permissions`

系统角色的默认权限。`(system_role_id, app_code, resource_code, action)` 唯一。

#### 6.3.3 `platform_app_role_scopes`

系统角色的默认 scope。

#### 6.3.4 `platform_system_roles`

系统模板（如 `tpl:rd_staff / tpl:aims_pm / tpl:codocs_editor`）。

#### 6.3.5 `platform_system_app_role_maps`

模板包含的角色。`(system_template_id, system_role_code)` 唯一。

### 6.4 商业与运营

#### 6.4.1 `platform_orders`

订单。租户 × 套餐 × 数量 × 金额 × 状态。

| 字段 | 说明 |
|---|---|
| id / order_no UK | |
| tenant_code | 指向 `tenants.tenant_code`（跨域引用，保持弱 FK）|
| plan_code | 指向 `platform_plans.plan_code` |
| quantity / unit_price / total_amount / currency | |
| status | pending / paid / refunded / cancelled |
| placed_at / paid_at / effective_from / effective_until | |
| created_by_account_id | |

v1 可以只挂最关键字段，发票/收款分表不强求。

#### 6.4.2 `platform_invoices` / `platform_payments`

发票与收款。v1 可预留最小字段。

#### 6.4.3 `platform_tenant_lifecycle_events`

租户生命周期事件流水：`signup_request / activated / plan_upgraded / plan_downgraded / suspended / terminated / migrated`。

#### 6.4.4 `platform_tickets`

工单最小字段：`ticket_no / tenant_code / title / category / priority / status / reporter_contact / assignee_account_id / created_at / updated_at / closed_at`。

#### 6.4.5 `platform_announcements`

公告。字段：`title / content / audience (all / plan:* / tenant_code) / severity / published_at / expired_at / status`。

#### 6.4.6 `platform_feature_flags`

灰度定义。

#### 6.4.7 `platform_feature_flag_assignments`

灰度分配。`scope_type in (global / plan / tenant / deployment)`。

#### 6.4.8 `platform_api_keys`

平台集成凭证。字段：`key_prefix / key_hash / owner_account_id / name / scopes_json / status / expires_at / last_used_at`。

#### 6.4.9 `platform_webhooks`

平台对外事件推送订阅。

### 6.5 审计

#### 6.5.1 `platform_audit_logs`

平台控制台对租户/配置的操作审计。与租户内授权审计严格分表。

| 字段 | 说明 |
|---|---|
| id | |
| operator_account_id | 平台员工 |
| target_type | tenant / subscription / deployment / license / plan / application / system_role / feature_flag |
| target_id | |
| target_tenant_code NULL | 冗余，便于按租户聚合 |
| action | create / update / delete / grant / revoke / suspend / activate |
| before_json / after_json | |
| source | admin_ui / cli / api / system |
| ip / user_agent | |
| created_at | |

高频索引：`(target_tenant_code, created_at)`、`(operator_account_id, created_at)`、`(target_type, target_id, created_at)`。

---

## 7. Boundary Domain

平台签给租户的契约产物，以及控制面账户与租户之间的归属关系。大多数对象由平台创建；少量对象（如租户管理员认领租户）可由控制面账户驱动。

### 7.1 `tenants`

| 字段 | 说明 |
|---|---|
| id / tenant_code UK | `tenant_code` 服务端顺序生成（`C000001`...）|
| tenant_name / display_name | 客户公司名——注意这里是**法人名**，不是用户 PII |
| tenant_type | enterprise / team / personal |
| primary_domain | |
| status | pending / active / suspended / terminated |
| default_auth_mode / default_deployment_mode | |
| owner_contact_email | 主联系邮箱（商务或初始引导用）|
| activated_at / suspended_at / terminated_at | |
| settings_json / created_at / updated_at | |

### 7.1.1 `tenant_account_memberships`

控制面账户与租户的关系表。租户管理员先成为这里的成员，才有资格登录 `/dashboard` 管理该租户。

| 字段 | 说明 |
|---|---|
| id / tenant_code / account_id | `(tenant_code, account_id)` 唯一 |
| status | invited / active / suspended / revoked |
| is_owner | 是否为租户 owner |
| invited_by_account_id | 邀请人（控制面账户）|
| invited_at / joined_at / last_accessed_at | |
| created_at / updated_at | |

说明：

- `account_id` / `invited_by_account_id` 跨 boundary → platform 域，不设 FK，应用层校验。
- 该表既支持平台邀请式开通，也支持租户管理员自助注册后认领/创建租户。

### 7.2 `subscriptions`

租户 × 应用的订阅事实。平台运营后台的订阅管理只操作这张表。

| 字段 | 说明 |
|---|---|
| id / subscription_no UK | |
| tenant_code | |
| app_code | |
| plan_code | |
| status | pending / active / grace / suspended / terminated |
| source | self_service / ops_grant / trial |
| started_at / ended_at | |
| current_order_id NULL | |
| created_by_account_id | 平台员工 id |
| created_at / updated_at | |

约束：`(tenant_code, app_code, status='active')` 只有一条（用 UK `(tenant_code, app_code)` + 非历史版本约束落地；历史订阅用 `status='terminated'` 存量）。

### 7.3 `deployments`

运行时实例。每个租户可按 `environment` 维护多套 active deployment，例如 `prod` 与 `test` 共用同一租户数据，但连接不同 Platform 域名、站点入口和 OIDC 参数。deployment 既可以是业务应用，也可以是客户侧受平台治理的 supporting service（如 `directory_runtime`）。

| 字段 | 说明 |
|---|---|
| id / deployment_code UK | |
| tenant_code / app_code / subscription_id | |
| deployment_name | |
| deployment_mode | managed-control-plane / self-hosted-enterprise |
| environment | prod / test / staging / dev |
| region | |
| status | active / paused / disabled / terminated |
| license_status | active / grace / expired / revoked |
| current_kid | 当前签发 JWT 用的 kid |
| reported_app_version / reported_manifest_version | runtime 最近一次上报的版本摘要 |
| reported_manifest_hash / reported_sdk_version | |
| reported_directory_contract_version | 目录契约版本（仅目录服务使用） |
| reported_directory_snapshot_hash | 目录快照摘要（仅目录服务使用） |
| reported_directory_sync_cursor | 目录增量同步游标（仅目录服务使用） |
| reported_directory_user_count / reported_directory_department_count / reported_directory_project_count | 目录规模摘要（仅目录服务使用） |
| reported_directory_sync_lag_seconds | 目录同步延迟摘要（仅目录服务使用） |
| last_reported_at / version_status | 版本报到时间与兼容状态 |
| last_directory_sync_at | 最近一次目录成功同步时间（仅目录服务使用） |
| directory_contract_status / directory_sync_status | 目录契约兼容性与同步健康摘要 |
| last_heartbeat_at | |
| created_at / updated_at | |

唯一：`(tenant_code, app_code, environment)` 活跃态只有一条。

说明：

- 当 deployment 对应普通业务应用时，以上 `reported_directory_*` / `directory_*` 字段保持空或 `n/a`。
- 当 deployment 对应 `directory_runtime` 时，平台只看这些摘要字段和探活结果，不存目录明细数据。

### 7.4 deployment 密钥治理摘要

deployment 签名密钥只存在客户侧 `console`，platform-core 不持有 deployment 公钥/私钥。
平台仅在 `deployments` 表保留治理摘要：

| 字段 | 说明 |
|---|---|
| current_kid | 当前 deployment 侧 key id |
| current_pubkey_fingerprint | 当前 deployment 公钥指纹摘要（sha256 前缀） |
| last_kid_reported_at | 最近一次上报 kid 的时间 |
| last_key_rotated_at | runtime 声明的最近轮换时间 |

平台根签名密钥单独存 `platform_signing_keys`，用于签 bundle/license/revocation。

### 7.5 `licenses`

| 字段 | 说明 |
|---|---|
| id / license_code UK | |
| subscription_id | |
| tenant_code（冗余）| |
| plan_code（冗余）| |
| status | active / grace / restricted / expired / revoked |
| issued_at / expires_at / grace_until | |
| payload_hash / signed_token | |
| created_at / updated_at | |

### 7.6 `license_capabilities`

`(license_id, capability_code)` 唯一。`capability_code` FK → `platform_capabilities.capability_code`。

### 7.7 `license_deployments`

license 与 deployment 的下发关系。模型支持一份 license 对应多个 deployment；多环境交付时默认每个环境独立签发 Console license，避免测试环境覆盖生产 deploymentCode。

`(license_id, deployment_id)` 唯一。

### 7.8 `policy_bundles`

**按租户 + environment 生成**。同一租户的生产与测试 bundle 分别绑定各自环境下的 active deployments，Console 按自己的 deploymentCode 拉取对应环境的 bundle。

| 字段 | 说明 |
|---|---|
| id | |
| tenant_code | |
| environment | prod / test / staging / dev |
| bundle_version | `YYYY.MM.DD.N` |
| bundle_hash | |
| bundle_uri | |
| schema_version | |
| issued_at / expires_at | |
| status | active / superseded / revoked |

唯一：`(tenant_code, bundle_version)`；bundleVersion 带环境前缀，例如 `pv_test_YYYYMMDDhhmmss_0001`。

### 7.9 `policy_bundle_targets`

bundle → deployments 分发关系。

### 7.10 `revocation_snapshots` / `revocation_snapshot_targets`

同 bundle 的设计：按租户生成，按 deployment 分发。

### 7.11 `deployment_heartbeats`

高频表。

字段：`id / deployment_id / runtime_id / app_version / manifest_version / manifest_hash / bundle_version / revocation_version / sdk_version / directory_contract_version / directory_snapshot_hash / directory_sync_cursor / directory_user_count / directory_department_count / directory_project_count / directory_sync_lag_seconds / directory_sync_at / license_status_seen / heartbeat_at / payload_json / created_at`。

DDL 注释里建议：`PARTITION BY RANGE (TO_DAYS(heartbeat_at))`；保留 30 天；聚合到 `deployment_heartbeat_daily`（v2 不建此表）。

补充：即使是 `directory_runtime` 的 heartbeat，平台也只接收规模、游标、延迟、快照 hash 等摘要，不接用户、部门、项目明细。

---

## 8. Tenant Domain

所有表 `tenant_code NOT NULL`，索引以 `tenant_code` 打头。

### 8.1 身份

#### 8.1.1 `tenant_identity_providers`

租户接入的 IdP 配置。

| 字段 | 说明 |
|---|---|
| id / tenant_code | |
| provider_code | 租户内唯一标识，如 `cas-main` |
| provider_type | cas / wecom / oidc / saml / ldap / gitlab_oidc |
| config_json | IdP 配置（endpoints / client_id / secret_ref 等）|
| status | |

#### 8.1.2 `tenant_subjects`

授权主体目录：用户 / 部门 / 岗位统一表达。

| 字段 | 说明 |
|---|---|
| id / tenant_code | |
| subject_type | user / department / committee / job |
| subject_code | 租户内稳定编码；对 user 就是 uid；对 department 是 dept_code |
| display_name | 对 department/committee/job 是业务标签；对 user 建议留空或等于 uid |
| external_ref | 上游系统引用 |
| parent_subject_id NULL | 仅同 type 内构树（部门树/岗位树）|
| status | |

唯一：`(tenant_code, subject_type, subject_code)`。

说明：

- `subject_type='user'` 的记录同时承担应用用户主体与授权主体的角色，不再单独维护 `tenant_users`。
- 应用终端用户的零 PII 约束仍然成立：姓名、邮箱、手机、头像等目录明细不进入平台库。
- `committee` 只作为目录容器与同步事实，不作为应用授权主体展示。
- `parent_subject_id` 只表达单父级主树，不表达用户同时归属多个部门/委员会的关系。

#### 8.1.3 `tenant_subject_memberships`

主体与容器主体的多归属关系，用于表达用户属于多个部门、委员会或虚拟组织。

| 字段 | 说明 |
|---|---|
| id / tenant_code | |
| source | runtime / manual |
| subject_id | FK `tenant_subjects.id`，通常为 user |
| container_subject_id | FK `tenant_subjects.id`，通常为 department/committee/job |
| relation_type | member / manager / leader / observer |
| is_primary | 是否主归属 |
| status | active / inactive |

唯一：`(tenant_code, source, subject_id, container_subject_id, relation_type)`。

约定：Console runtime 同步的多归属关系写入本表；active `member/manager/leader` 且容器为 `department/job` 的 membership 会参与 Platform 在线授权快照、DB grant adapter、Policy Bundle v1 导出和 Foundation bundle adapter，用于继承部门/职位主体上的角色与模板绑定。`committee` 当前只作为目录容器和展示事实，不作为运行时授权继承主体。

#### 8.1.4 `tenant_subject_identities`

上游登录身份 → user subject 的映射。

| 字段 | 说明 |
|---|---|
| id / tenant_code / subject_id | |
| provider_id | FK `tenant_identity_providers.id` |
| provider_subject_key | 上游唯一 key |
| provider_metadata_json | 非 PII 元数据（如最后同步时间）|
| status | |

唯一：`(tenant_code, provider_id, provider_subject_key)`。

约定：第一版 `subject_id` 只指向 `tenant_subjects.subject_type='user'`。

#### 8.1.5 `tenant_sessions`

租户应用用户会话。**仅服务 deployment-scoped 业务访问，不用于 `/dashboard` 控制台登录。**

| 字段 | 说明 |
|---|---|
| id / session_uuid UK | |
| tenant_code / subject_id | |
| deployment_id | 会话隶属的部署（信任根）|
| idp_type | 冗余，便于审计 |
| issued_at / expires_at / refreshed_at | |
| status | active / refreshed / expired / revoked |

约定：`subject_id` 只允许指向 `tenant_subjects.subject_type='user'`。

### 8.2 授权

#### 8.2.1 `tenant_roles`

**所有**租户角色（包括从平台模板复制下发的系统角色）。

| 字段 | 说明 |
|---|---|
| id / tenant_code / role_code | `(tenant_code, role_code)` 唯一 |
| role_name / role_type | system_base / system_job / system_app / tenant_custom |
| app_code NULL | 属于某 app 时填 |
| description | |
| parent_id NULL | 仅弱化用于分组 |
| source | system / custom |
| source_role_code NULL | system 来源时指向 `platform_system_roles.role_code` |
| source_policy_hash | 最近一次启用/同步时对应的系统角色默认授权指纹 |
| effective_policy_hash | 当前租户角色实际权限与 scope 的稳定指纹 |
| policy_revision / policy_updated_at | 租户角色授权指纹变化版本与时间 |
| is_overridden | 租户是否在副本上改过权限 |
| is_assignable / status | |
| created_at / updated_at | |

#### 8.2.2 `tenant_role_permissions`

`(role_id, app_code, resource_code, action)` 唯一。

**注**：权限来源通过 `source_manifest_action_id` 追溯到 `platform_app_manifest_resource_actions`；租户域到平台域不设物理 FK，应用层校验。

#### 8.2.3 `tenant_subject_roles`

应用授权主体的角色授予（替代 v1 的 `user_roles`）。

| 字段 | 说明 |
|---|---|
| id / tenant_code | |
| subject_id | FK `tenant_subjects.id` |
| role_id | FK `tenant_roles.id` |
| source_type | manual / template / lifecycle / external |
| source_id | 对应 template_binding / lifecycle_event |
| assignment_kind | position / duty / temporary / inherited / privileged |
| reason / approved_by_uid | 授权原因与审批人，审批链路未接入时可为空 |
| granted_by_uid / granted_at / starts_at / expired_at | `starts_at` 为空表示立即生效 |
| status | active / suspended / revoked；只有 active 且已到开始时间、未过期的授予参与授权 |

唯一：`(tenant_code, subject_id, role_id, source_type, source_id)`。

#### 8.2.4 `tenant_account_roles`

控制面账户在某租户下的控制台角色授予。它与 `tenant_subject_roles` 平行存在，前者给 `/dashboard`，后者给业务应用授权。

| 字段 | 说明 |
|---|---|
| id / tenant_code / account_id | `account_id` 通过 `tenant_account_memberships` 约束必须先入租户 |
| role_id | FK `tenant_roles.id` |
| source_type | manual / invite / bootstrap / lifecycle |
| source_id | 对应 invite / bootstrap token / lifecycle event |
| granted_by_account_id / granted_at / starts_at / expired_at | `starts_at` 为空表示立即生效 |
| status | active / suspended / revoked；只有 active 且已到开始时间、未过期的授予参与 dashboard 授权 |

约束：

- `tenant_account_roles` 仅用于 dashboard 控制面账户授权；Console 模块权限统一引用 `app_code='console'` 的应用角色，旧 `tenant_console` 命名空间不再新增。
- 运行时业务授权仍只看 `tenant_subject_roles`。

#### 8.2.5 `tenant_permission_templates`

同 role 一样：既可能是系统模板副本，也可能是租户自定义。

字段：`id / tenant_code / template_code / template_name / template_type / description / source / source_template_code / is_system_copy / sort_order / status / created_by / updated_by / created_at / updated_at`。

#### 8.2.6 `tenant_template_roles`

模板包含的角色。`(template_id, role_id)` 唯一。

#### 8.2.7 `tenant_template_bindings`

模板绑定到 subject。索引 `(tenant_code, subject_type, subject_id, status)`。

#### 8.2.8 `tenant_template_overrides`

模板结果上的例外。

#### 8.2.9 `tenant_role_scopes`

范围规则。`(role_id, app_code, resource_code, action, scope_type, scope_value)` 唯一。

写入时校验：当 `scope_type='relation'`，必须在 `platform_app_supported_scopes` 存在对应声明。

#### 8.2.10 `tenant_subject_role_scopes`

授权关系级范围规则，用于把某次 `tenant_subject_roles` 授予进一步限制到部门、项目、客户、对象关系或环境等数据范围。

| 字段 | 说明 |
|---|---|
| id / tenant_code | |
| assignment_id | FK `tenant_subject_roles(id, tenant_code)`，绑定到具体授予关系 |
| app_code / resource_code / action | 为空表示适用于该授权关系下全部权限；非空时只约束指定资源动作 |
| scope_dimension / scope_predicate / scope_value | 范围维度、谓词和值，例如 `department/self_tree`、`project/member` |
| scope_group | 同一 group 内同维度按 OR、跨维度按 AND；不同 group 后续由 evaluator 解释 |
| scope_mode | inherit / intersect / replace，默认 intersect |
| status | active / suspended / revoked；只有 active 行导出给授权计算 |

该表当前由 Policy Bundle v1 作为 `subjectRoleScopes` 导出，并由 Platform `buildDbAuthorizationGrants()` / `evaluateDbAuthorization()` DB grant helper 与 Foundation policy-bundle grant adapter 解释；旧扁平 `checkPermission` 不直接消费它，避免脱离同一授权单元后错误合并范围。Policy Bundle v2 仍需把该同一授权单元结构物化为正式离线契约。

#### 8.2.11 `tenant_role_conflict_rules`

租户级角色职责冲突规则，用于在 `tenant_subject_roles` 授权写入前提醒或阻止长期同时持有互斥职责。

| 字段 | 说明 |
|---|---|
| id / tenant_code / rule_code | `(tenant_code, rule_code)` 唯一 |
| rule_name / description | 展示名称与管理员说明 |
| conflict_type | 默认 `segregation_of_duties`，后续可扩展职责冲突类型 |
| enforcement | `warning` 表示允许授予但提示，`enforce` 表示阻断授予 |
| left_role_code / right_role_code | 可选企业角色编码约束；为空时仅按权限三元组匹配 |
| left_app_code / left_resource_code / left_action | 左侧权限三元组；三列同时为空时表示左侧只按角色编码匹配 |
| right_app_code / right_resource_code / right_action | 右侧权限三元组；三列同时为空时表示右侧只按角色编码匹配 |
| condition_json | 预留复杂条件，例如金额阈值、环境、例外窗口或实例级策略引用 |
| status | 只有 active 规则参与授权写入前评估 |
| created_by_uid / created_at / updated_at | |

当前 Platform 授权写入路径会把该表中的 active 规则与内置静态规则合并；相同 `rule_code` 的租户规则会覆盖内置规则。该表不直接替代业务实例级自审批控制，后者仍由 Finance、Workflow、Webdev 等业务路径在实例上下文中执行。

### 8.3 审计

#### 8.3.1 `tenant_audit_logs`

租户内授权与关键操作审计。

| 字段 | 说明 |
|---|---|
| id / tenant_code | |
| operator_account_id | `/dashboard` 控制台操作者（控制面账户） |
| operator_subject_id / operator_uid | 应用侧主体或同步链路操作者 |
| target_type | role / template / binding / override / scope / user / subject |
| target_id | |
| action | create / update / delete / bind / unbind |
| before_json / after_json | |
| source | tenant_console_ui / api / system / sync |
| ip / user_agent | |
| created_at | |

---

## 9. 跨域关系图

```
platform_accounts ──┬──→ platform_account_roles ──→ platform_roles
                    │                                   └─→ platform_role_permissions ──→ platform_resources
                    ├──→ platform_sessions
                    ├──→ tenant_account_memberships ──→ tenants
                    │             └──→ tenant_account_roles ──→ tenant_roles ──→ tenant_role_permissions
                    │                                                    └─→ tenant_role_scopes
                    └──→ platform_audit_logs ──(target_tenant_code)──→ tenants
                                                                         ├── subscriptions ──→ platform_plans
                                                                         │        │               └─→ platform_plan_apps → platform_applications
                                                                         │        └→ platform_orders
                                                                         │
                                                                         └── deployments (key summary only)
                                                                                    │
                                                                                    ├── licenses ──→ license_capabilities → platform_capabilities
                                                                                    │
                                                                                    ├── policy_bundle_targets ←── policy_bundles (by tenant)
                                                                                    │
                                                                                    ├── revocation_snapshot_targets ←── revocation_snapshots (by tenant)
                                                                                    │
                                                                                    └── deployment_heartbeats

platform_system_roles ─────copy on lifecycle─────→ tenant_roles
platform_system_roles ─copy on lifecycle─────→ tenant_permission_templates

tenant_subjects (subject_type='user') ──→ tenant_subject_identities → tenant_identity_providers
                       │
                       ├──→ tenant_subject_roles ──→ tenant_roles ──→ tenant_role_permissions
                       │                                └─→ tenant_role_scopes
                       │
                       ├──→ tenant_template_bindings ──→ tenant_permission_templates
                       │                                      └─→ tenant_template_roles
                       │
                       ├──→ tenant_template_overrides
                       │
                       └──→ tenant_sessions (deployment-scoped)
```

---

## 10. v2 相对 v1 的主要变更

| 变更点 | v1 | v2 |
|---|---|---|
| 系统级对象表达 | `tenant_code=NULL` | 上浮到 `platform_*` 表，不存在 NULL |
| 授权主体 | uid + subject_id 并存 | 只有 `subject_id`；`user_roles → tenant_subject_roles` |
| 应用终端用户 PII | 带 email/mobile/avatar | 删除；仅留 uid+status |
| applications | 租户级/系统级混合 | 全平台级 `platform_applications`；租户通过 `subscriptions` 订阅 |
| 订阅事实 | 无 | 新增 `subscriptions` 表 |
| 签名密钥 | 无 | 新增 `platform_signing_keys`；deployment 密钥只保留摘要字段 |
| session | 无 | 新增 `platform_sessions` + `tenant_sessions` |
| capability | 字符串散落 | 新增 `platform_capabilities` 注册表 |
| 套餐 | 无 | 新增 `platform_plans` |
| 平台员工 | 混在 `users` 里 | 独立 `platform_accounts` |
| 租户管理员 | 复用租户应用用户 | 独立控制面账户 + `tenant_account_memberships` + `tenant_account_roles` |
| 组织目录 | 倾向让平台/Account 直接承载全量目录 | 平台仅保留最小主体目录；客户侧目录服务作为受管 runtime 接入 |
| policy_bundle 维度 | 按 deployment | 按 tenant + `policy_bundle_targets` 分发 |
| revocation | 同上 | 同上 |
| 审计 | 只有 `authorization_audit_logs` | `platform_audit_logs` + `tenant_audit_logs` |
| deployment | 不带 app_code，无信任根字段 | 带 `app_code / subscription_id / current_kid / current_pubkey_fingerprint` |
| subject_identities 唯一 | 跨租户全局 | 按 `(tenant_code, provider_id, provider_subject_key)` |
| 系统角色/模板下发 | 引用系统级 seed | 租户创建时复制到 `tenant_roles / tenant_permission_templates` |

---

## 11. v2 最小闭环（第一阶段可落地子集）

若时间紧，第一阶段可只建这批表，后续再补商业运营表：

**Platform**
- `platform_accounts / platform_sessions`
- `platform_roles / platform_role_permissions / platform_account_roles / platform_resources`
- `platform_applications / platform_app_releases / platform_app_manifests`
- `platform_app_manifest_resources / platform_app_manifest_resource_actions / platform_app_supported_scopes`
- `platform_capabilities / platform_plans / platform_plan_capabilities / platform_plan_apps`
- `platform_system_roles / platform_app_role_permissions / platform_app_role_scopes`
- `platform_system_roles / platform_system_app_role_maps`
- `platform_audit_logs`

**Boundary**
- `tenants`
- `tenant_account_memberships`
- `tenant_subscriptions / tenant_runtime_credentials`
- `subscriptions`
- `deployments`
- `licenses / license_capabilities / license_deployments`
- `policy_bundles / policy_bundle_targets`
- `revocation_snapshots / revocation_snapshot_targets`
- `deployment_heartbeats`

**Tenant**
- `tenant_identity_providers / tenant_subjects / tenant_subject_identities / tenant_sessions`
- `tenant_roles / tenant_role_permissions / tenant_subject_roles / tenant_account_roles`
- `tenant_permission_templates / tenant_template_roles / tenant_template_bindings / tenant_template_overrides`
- `tenant_role_scopes`
- `tenant_audit_logs`

**可延后到第二阶段**
- `platform_orders / platform_invoices / platform_payments`
- `platform_tenant_lifecycle_events`
- `platform_tickets / platform_announcements / platform_feature_flags / platform_feature_flag_assignments`
- `platform_api_keys / platform_webhooks`

---

## 12. 后续扩展预留

- 多区域：`deployments.region` 已预留；后续加 `region_configs` 表
- 跨租户身份联邦：保留 ADR 已知不做，待独立专题
- 策略包增量下发：bundle 版本号+差异包；v2 schema 不改，只加新列
- ABAC 规则引擎：留待独立表，暂不进 v2

---

## 13. 对现有文档的影响

本文档产出后需同步更新：

- `HZY-Platform-SQL-DDL-Draft-v2.sql`（配套 DDL，已在本次同步产出）
- `HZY-Platform-Seed-Draft-v2.sql`（seed 需按新结构重写）
- `HZY-Platform-API-Draft-v2.md`（API 按 `/ops` `/tenant-admin` `/runtime` `/internal` 重分）
- `Implementation-Backlog.md`：Epic 1 的 `[x]` 退回 `[~]`，新增 Epic 1B「平台域建设」
- `Huizhi-yun-Platform-Target-Architecture.md`：附录 A 命名对照表需补 `platform_accounts / subscriptions / platform_signing_keys` 等新概念

---

## 14. 开放决策

以下问题请评审确认后锁定：

1. `tenant_subject_identities` 与 `tenant_sessions` 是否在应用层强制 `subject_type='user'`？
   建议：是；DB 不做复杂 CHECK，应用层在写入时保证。
2. 控制面账户 `platform_accounts.password_hash` v1 是否启用？
   建议：启用，后续再接自家 IdP。
3. `platform_system_roles` 更新后如何推送到已存在租户？
   建议：v2 DDL 只建表；升级动作通过应用层 `ops` 接口触发，审计落 `platform_audit_logs`。
4. 是否在 v2.x 放开“同租户同 app 多 active deployment”？
   建议：当前不放开，维持每租户每应用一套 active deployment；`license_deployments` 结构先保留扩展能力。
5. Enterprise 交付时的物理剥离策略？
   建议：导出租户域 + 该租户相关的 boundary 行；platform_* 不进交付。

---

## 15. 结论

v2 把 schema 从"一个超级租户的数据库"改成"平台 + 租户"的清晰双域模型，并补齐了平台运营能力。这个模型能同时支撑：

- Managed Control Plane 的运营工作（订单、工单、灰度、审计）
- Self-Hosted Enterprise 的本地运行（tenant_* + boundary 子集，platform_* 可剥离）
- 业务应用的统一授权接入（subject → role → permission → scope + 签名 bundle）
- 客户侧目录服务的受管接入（平台治理契约、版本、健康；目录明细仍留在客户侧）

配套 DDL 见 `HZY-Platform-SQL-DDL-Draft-v2.sql`。
