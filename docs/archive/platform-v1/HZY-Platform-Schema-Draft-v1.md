# hzy_platform 第一版 Schema 草案

## 1. 文档目标

本文档用于定义 `hzy_platform` 第一版数据库 schema 草案。

这份草案服务于绿地建设方案中的 `Epic 1：hzy_platform 基础建设`，目标是先明确：

- 新平台主库需要承载哪些核心对象
- 哪些表是第一阶段必须有的
- 哪些能力可以后置，不进入 v1
- 数据库命名、分层和边界应该如何统一

本文档是新平台主库设计，不再以现有 `account` schema 为基础增量修改。

---

## 2. 设计目标

`hzy_platform` 第一版 schema 要同时支撑以下四类能力：

### 2.1 Identity Plane

- 最小主体目录
- 身份源映射
- token / session 相关最小锚点

### 2.2 Control Plane

- 应用注册
- manifest 管理
- 角色 / 模板 / scope
- app permission 下发

### 2.3 Runtime Control

- deployment
- license
- capability
- policy bundle
- revocation
- heartbeat

### 2.4 平台管理后台

- 授权配置
- 应用配置
- 基础审计

---

## 3. 设计原则

### 3.1 新库独立

`hzy_platform` 是新平台主库，不与现有 `hzy_account` 共用表。

### 3.2 单一控制面模型

平台控制面相关的核心对象统一进入 `hzy_platform`，不再把新平台能力继续塞进 `account`。

### 3.3 支持 SaaS，但不做过度复杂的 Pool/Silo

第一版保留 `tenant_code` 作为租户隔离主字段，并补充真正的租户主表 `tenants`。  
其中：

- `tenants.tenant_code` 是租户稳定编码
- 现阶段各业务表中的 `tenant_code` 直接作为租户稳定编码使用
- v1 不引入复杂的多数据库路由或租户表分片策略

### 3.4 先支撑协议，不先支撑全量运营

先确保：

- token / claims
- permission / scope
- manifest
- deployment / bundle / heartbeat

可以跑通。  
复杂 BI、计费、ABAC 规则引擎不进入 v1。

### 3.5 先动态解析，不先全量物化

第一版不把 `effective_user_roles / effective_user_permissions` 作为主链路前提。

---

## 4. 库级命名建议

建议数据库名：

- `hzy_platform`

建议采用统一命名风格：

- 表名：`snake_case` 复数
- 主键：`id`
- 时间字段：
  - `created_at`
  - `updated_at`
- 租户字段：
  - `tenant_code`

说明：

- `tenant_code = NULL` 表示系统级对象
- `tenant_code != NULL` 表示租户级对象
- `tenant_code` 在 v1 逻辑上对应 `tenants.tenant_code`

---

## 5. 表分组

第一版建议将表分成五组。

### Group A：Identity

- `tenants`
- `users`
- `subjects`
- `subject_identities`

### Group B：Authorization

- `roles`
- `user_roles`
- `resources`
- `role_permissions`
- `permission_templates`
- `template_roles`
- `template_bindings`
- `template_overrides`
- `role_scopes`

### Group C：App Registry

- `applications`
- `app_manifests`

### Group D：Runtime Control

- `deployments`
- `licenses`
- `license_capabilities`
- `policy_bundles`
- `revocation_snapshots`
- `deployment_heartbeats`

### Group E：Audit

- `authorization_audit_logs`

---

## 6. Group A：Identity

## 6.1 `tenants`

用途：

- 平台租户主表
- 支撑租户生命周期、租户级配置、deployment / license 归属

建议字段：

- `id`
- `tenant_code`
- `tenant_name`
- `display_name`
- `tenant_type`
- `primary_domain`
- `status`
- `default_auth_mode`
- `default_deployment_mode`
- `settings_json`
- `created_at`
- `updated_at`

约束建议：

- `tenant_code` 唯一

说明：

- v1 要有真正的租户主表，不再只靠散落在业务表中的 `tenant_code`

## 6.2 `users`

用途：

- 平台用户主表
- 承载用户账号、资料、状态、来源和最近登录信息

建议字段：

- `id`
- `tenant_code`
- `uid`
- `username`
- `display_name`
- `email`
- `mobile`
- `avatar_url`
- `status`
- `source_type`
- `last_login_at`
- `created_at`
- `updated_at`

约束建议：

- `(tenant_code, uid)` 唯一
- `(tenant_code, email)` 可选唯一

说明：

- `users` 解决“这个用户是谁”
- `subjects` 解决“这个主体如何参与授权计算”

## 6.3 `subjects`

用途：

- 平台最小主体目录
- 支撑模板绑定、身份映射、授权运营
- 统一承载 `user / department / job` 三类授权主体

建议字段：

- `id`
- `tenant_code`
- `user_id`
- `subject_type`
  - `user`
  - `department`
  - `job`
- `subject_code`
- `display_name`
- `external_ref`
- `parent_subject_id`
- `status`
- `created_at`
- `updated_at`

约束建议：

- `(tenant_code, subject_type, subject_code)` 唯一

说明：

- v1 只要求最小目录，不接管完整 HR 主数据
- 当 `subject_type = user` 时，应关联到 `users.id`

## 6.4 `subject_identities`

用途：

- 记录主体与上游身份源的映射

建议字段：

- `id`
- `tenant_code`
- `subject_id`
- `provider_type`
  - `cas`
  - `wecom`
  - `gitlab_oidc`
  - `oidc`
  - `saml`
  - `ldap`
- `provider_subject_key`
- `provider_metadata`
- `status`
- `created_at`
- `updated_at`

约束建议：

- `(provider_type, provider_subject_key)` 唯一

说明：

- v1 先不单独建复杂 session 表
- session / token 锚点可在 Identity Plane 服务层先通过 token claims 与 revocation 处理

---

## 7. Group B：Authorization

## 7.1 `roles`

用途：

- 平台角色定义

建议字段：

- `id`
- `tenant_code`
- `role_code`
- `role_name`
- `role_type`
  - `system`
  - `base`
  - `job`
  - `app`
- `app_code`
- `description`
- `parent_id`
- `is_system`
- `is_assignable`
- `status`
- `created_at`
- `updated_at`

说明：

- `parent_id` 在 v1 可保留，但只弱化用于分组/兼容，不作为主要运行时继承依赖

## 7.2 `user_roles`

用途：

- 记录直接角色授予

建议字段：

- `id`
- `tenant_code`
- `uid`
- `role_id`
- `source_type`
  - `legacy`
  - `manual`
  - `job`
- `source_id`
- `granted_by`
- `granted_at`
- `expired_at`

说明：

- v1 不把模板展开结果物化写回此表

## 7.3 `resources`

用途：

- 平台资源定义

建议字段：

- `id`
- `tenant_code`
- `app_code`
- `resource_code`
- `resource_name`
- `description`
- `sort_order`
- `status`
- `created_at`
- `updated_at`

约束建议：

- `(tenant_code, app_code, resource_code)` 唯一

## 7.4 `role_permissions`

用途：

- 角色与资源动作关系

建议字段：

- `id`
- `tenant_code`
- `role_id`
- `resource_id`
- `action`
  - `view`
  - `edit`
  - `admin`
- `created_at`

约束建议：

- `(role_id, resource_id, action)` 唯一

## 7.5 `permission_templates`

用途：

- 模板本体

建议字段：

- `id`
- `tenant_code`
- `template_code`
- `template_name`
- `template_type`
  - `job`
  - `duty`
  - `ops`
  - `custom`
- `description`
- `status`
- `sort_order`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

## 7.6 `template_roles`

用途：

- 模板挂角色

建议字段：

- `id`
- `tenant_code`
- `template_id`
- `role_id`
- `sort_order`
- `created_at`

## 7.7 `template_bindings`

用途：

- 模板绑定对象

建议字段：

- `id`
- `tenant_code`
- `template_id`
- `subject_type`
  - `user`
  - `department`
  - `job`
- `subject_id`
- `priority`
- `status`
- `start_at`
- `end_at`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

说明：

- v1 直接支持岗位默认、部门补充、用户例外

## 7.8 `template_overrides`

用途：

- 模板展开结果上的例外调整

建议字段：

- `id`
- `tenant_code`
- `subject_type`
- `subject_id`
- `role_id`
- `override_type`
  - `grant`
  - `exclude`
- `source_template_id`
- `reason`
- `status`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

说明：

- v1 只做角色级覆盖，不做 permission/scope 级覆盖

## 7.9 `role_scopes`

用途：

- 角色在资源动作上的范围规则

绑定粒度建议固定为：

`(role_id, resource_id, action)`

建议字段：

- `id`
- `tenant_code`
- `role_id`
- `resource_id`
- `action`
- `scope_type`
  - `all`
  - `org`
  - `relation`
  - `attribute`
- `scope_value`
- `status`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

v1 建议先支持：

- `all`
- `self`
- `department`

说明：

- `project_member` 这类 scope 可保留在模型上，但由 app runtime resolver 解释

---

## 8. Group C：App Registry

## 8.1 `applications`

用途：

- 应用注册表

建议字段：

- `id`
- `tenant_code`
- `app_code`
- `app_name`
- `description`
- `icon`
- `home_url`
- `callback_url`
- `logout_url`
- `app_secret`
- `app_type`
- `runtime_mode`
- `auth_mode`
- `bundle_enabled`
- `status`
- `created_at`
- `updated_at`

说明：

- 这里的 `runtime_mode` 是应用运行模式元数据，不等于 deployment mode

## 8.2 `app_manifests`

用途：

- 存储应用 manifest 历史版本

建议字段：

- `id`
- `tenant_code`
- `app_code`
- `version`
- `manifest_hash`
- `manifest_json`
- `status`
- `created_at`

说明：

- v1 要求 `AIMS`、后续 `Codocs` 都通过 manifest 方式接入

---

## 9. Group D：Runtime Control

## 9.1 `deployments`

用途：

- 平台控制的部署单元

建议字段：

- `id`
- `tenant_code`
- `deployment_code`
- `deployment_name`
- `deployment_mode`
  - `managed-control-plane`
  - `self-hosted-enterprise`
- `status`
  - `active`
  - `paused`
  - `disabled`
- `license_status`
- `last_heartbeat_at`
- `created_at`
- `updated_at`

## 9.2 `licenses`

用途：

- 部署许可证

建议字段：

- `id`
- `tenant_code`
- `deployment_id`
- `license_code`
- `plan_code`
- `status`
  - `active`
  - `grace`
  - `restricted`
  - `expired`
  - `revoked`
- `issued_at`
- `expires_at`
- `grace_until`
- `payload_hash`
- `created_at`
- `updated_at`

## 9.3 `license_capabilities`

用途：

- license 开通能力清单

建议字段：

- `id`
- `tenant_code`
- `license_id`
- `capability_code`
- `capability_value`
- `created_at`

## 9.4 `policy_bundles`

用途：

- runtime bundle 元数据

建议字段：

- `id`
- `tenant_code`
- `deployment_id`
- `bundle_version`
- `bundle_hash`
- `bundle_uri`
- `schema_version`
- `issued_at`
- `expires_at`
- `status`
- `created_at`

## 9.5 `revocation_snapshots`

用途：

- revocation 快照元数据

建议字段：

- `id`
- `tenant_code`
- `deployment_id`
- `snapshot_version`
- `snapshot_hash`
- `snapshot_uri`
- `issued_at`
- `status`
- `created_at`

## 9.6 `deployment_heartbeats`

用途：

- runtime 心跳上报

建议字段：

- `id`
- `tenant_code`
- `deployment_id`
- `runtime_id`
- `bundle_version`
- `sdk_version`
- `license_status_seen`
- `heartbeat_at`
- `payload_json`
- `created_at`

---

## 10. Group E：Audit

## 10.1 `authorization_audit_logs`

用途：

- 授权与关键配置变更审计

建议字段：

- `id`
- `tenant_code`
- `operator_uid`
- `target_type`
- `target_id`
- `action`
- `before_json`
- `after_json`
- `source`
- `created_at`

说明：

- v1 只要求基础审计，不做复杂查询聚合模型

---

## 11. v1 明确不做的表

以下表不进入 v1：

### 11.1 `effective_user_roles`

原因：

- v1 先走动态解析 + 缓存

### 11.2 `effective_user_permissions`

原因：

- 先保证协议可跑通，再考虑物化优化

### 11.3 复杂 ABAC / DSL 规则表

原因：

- 范围过大
- 首批 app 并不需要

### 11.4 完整 session 中心表

原因：

- v1 先让 Identity Plane 可用
- 不先把全部会话治理做重

### 11.5 计费 / 结算 / 订阅明细表

原因：

- 不属于当前最小平台内核

---

## 12. v1 最小闭环必需表

如果只落最小闭环，建议至少先有以下表：

- `subjects`
- `tenants`
- `users`
- `subject_identities`
- `roles`
- `resources`
- `role_permissions`
- `permission_templates`
- `template_roles`
- `template_bindings`
- `template_overrides`
- `role_scopes`
- `applications`
- `app_manifests`
- `deployments`
- `licenses`
- `license_capabilities`
- `policy_bundles`
- `revocation_snapshots`
- `deployment_heartbeats`

这批表已经足以支撑：

- `platform-sdk`
- `platform-adapter-nuxt`
- `AIMS` 首条链路

---

## 13. 推荐实施顺序

建议按以下顺序落表：

### Batch A：Identity + Registry 基础

- `tenants`
- `users`
- `subjects`
- `subject_identities`
- `applications`
- `app_manifests`

### Batch B：Authorization 核心

- `roles`
- `resources`
- `role_permissions`
- `permission_templates`
- `template_roles`
- `template_bindings`
- `template_overrides`
- `role_scopes`

### Batch C：Runtime Control

- `deployments`
- `licenses`
- `license_capabilities`
- `policy_bundles`
- `revocation_snapshots`
- `deployment_heartbeats`

### Batch D：Audit

- `authorization_audit_logs`

---

## 14. 与现有文档的关系

本草案是新平台 schema 设计，和之前两类文档的关系如下：

### 14.1 与 `Platform-Incremental-Schema-Plan.md`

区别：

- `Platform-Incremental-Schema-Plan.md` 是“继续在 account 增量落平台模型”的方案
- 本文档是“新建 hzy_platform 主库”的方案

当前阶段，以本文档为准。

### 14.2 与 Batch 1~5 SQL Migration 草案

区别：

- Batch 1~5 是旧方向下的迁移草案
- 本文档是绿地方案下的新库 schema 草案

当前阶段，Batch 1~5 可作为字段设计参考，但不再作为实施主路径。

---

## 15. 下一步建议

基于本 schema 草案，建议继续输出两份材料：

1. `hzy_platform` 第一版 SQL DDL 草案  
2. `hzy_platform` 第一版 API 草案

---

## 16. 结论

`hzy_platform` 第一版 schema 应以“平台最小内核”为目标，而不是一上来就做成完整运营平台。

第一版最重要的是先具备：

- 身份映射
- 角色/模板/scope
- app registry / manifest
- deployment / license / bundle / heartbeat

只要这几块先搭稳，`platform-sdk`、`platform-adapter-nuxt` 和 `AIMS` 首个接入链路就有了清晰的数据底座。
