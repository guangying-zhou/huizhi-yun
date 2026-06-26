# Platform Incremental Schema Plan

## 1. 文档目标

本文档用于定义：在第一阶段不拆库、不迁 `hzy_platform` 的前提下，如何在现有 `account` 体系中增量落平台控制面所需的数据模型。

本方案的目标不是一次性完成“理想 schema”，而是形成一个可执行的、低风险的、能支撑第一阶段平台协议与应用接入的增量建模计划。

本文档重点回答以下问题：

- 哪些表必须第一阶段就新增
- 哪些表可以先扩字段，不必重做
- 哪些能力先依赖逻辑计算，不急于物化
- 表结构应该按什么顺序演进，才能最小化对现网的影响

---

## 2. 总体策略

第一阶段采用“增量建模、兼容现网、协议先行”的原则。

具体策略如下：

### 2.1 不拆库

第一阶段不新建 `hzy_platform` 主库。  
新增平台控制面模型，先落在现有 `account` 体系中。

### 2.2 不推倒旧表

现有表优先保留，按以下方式处理：

- 能扩字段就扩字段
- 能新增关系表就不改旧语义
- 能兼容旧接口就不立刻废弃旧接口

### 2.3 不先做全量物化

第一阶段优先支持：

- 动态展开
- 查询时组合
- Redis 短缓存

不把 `effective_user_roles / effective_user_permissions` 作为主链路前提。

### 2.4 先支撑协议，再支撑运营

第一阶段优先支撑：

- Identity Plane
- Control Plane API
- Foundation SDK
- `AIMS` / `Codocs` 接入

运营后台类能力，如高级审计、批量治理、复杂分析，放到后续阶段逐步补齐。

---

## 3. 第一阶段需要承接的能力

为了支撑已经确定的平台协议，第一阶段 schema 至少要承接以下能力：

### 3.1 身份与最小主体目录

- 用户主体
- 部门主体
- 岗位主体或岗位映射
- 主体与外部身份源映射

### 3.2 平台授权模型

- 角色
- 权限模板
- 模板绑定
- 模板覆盖
- 角色 scope

### 3.3 应用与资源模型

- 应用注册
- app manifest 元数据
- 资源清单
- 资源与角色映射

### 3.4 Control Plane 运行时模型

- deployment
- license
- capability
- policy bundle
- revocation
- heartbeat

### 3.5 审计与追踪

- 授权来源
- 配置变更审计
- runtime 心跳与 bundle 使用追踪

---

## 4. 现有表处理策略

第一阶段建议对现有 `account` 数据模型做如下处理。

### 4.1 `roles`

保留现有表，增量扩展字段，不推翻现有角色数据。

建议新增字段：

- `role_type`
- `app_code`
- `is_assignable`
- `company_code` 补齐约束检查
- `status`

第一阶段目标：

- 支撑 `system / base / job / app` 四类角色
- 支撑按应用筛选角色
- 支撑只读模板内角色与可分配角色区分

### 4.2 `user_roles`

保留现有表，不将模板展开结果直接回写为主链路。

建议增量字段：

- `source_type`
- `source_id`
- `granted_by`
- `granted_at`
- `expired_at` 可选

第一阶段用途：

- 承载人工直授
- 承载历史迁移数据
- 记录岗位映射产生的直接角色

不建议第一阶段承载：

- 模板展开的完整结果

### 4.3 `resources`

保留现有表，但应补齐和 manifest 同步所需字段。

建议新增或补齐：

- `app_code`
- `resource_code`
- `action`
- `description`
- `sort_order`
- `status`

第一阶段目标：

- 支撑 app manifest 驱动的资源同步
- 支撑 SDK 查询资源权限

### 4.4 `applications`

保留现有表，补齐平台控制面需要的元数据。

建议新增或补齐：

- `app_code`
- `manifest_version`
- `manifest_hash`
- `runtime_mode`
- `status`

第一阶段目标：

- 支撑应用注册
- 支撑 manifest 版本追踪
- 支撑 bundle 构建时纳入 app 信息

---

## 5. 第一阶段建议新增的核心表

以下表建议在第一阶段直接新增。

## 5.1 `permission_templates`

用于定义模板本体。

建议核心字段：

- `id`
- `company_code`
- `template_code`
- `template_name`
- `template_type`
- `description`
- `status`
- `created_by`
- `created_at`
- `updated_at`

用途：

- 研发员工模板
- 项目经理模板
- 文档编辑模板

### 5.2 `template_roles`

用于定义模板包含哪些角色。

建议核心字段：

- `id`
- `company_code`
- `template_id`
- `role_id`
- `sort_order`

用途：

- 把模板和真实角色解耦
- 支撑模板展开预览

### 5.3 `template_bindings`

用于定义模板绑定到谁。

建议核心字段：

- `id`
- `company_code`
- `template_id`
- `subject_type`
- `subject_id`
- `priority`
- `status`
- `created_by`
- `created_at`

其中 `subject_type` 第一阶段建议支持：

- `user`
- `department`
- `job`

用途：

- 岗位默认模板
- 部门补充模板
- 用户例外模板

### 5.4 `template_overrides`

用于表达模板结果上的例外调整。

建议核心字段：

- `id`
- `company_code`
- `subject_type`
- `subject_id`
- `role_id`
- `override_type`
- `reason`
- `status`
- `created_by`
- `created_at`

其中 `override_type` 建议支持：

- `grant`
- `exclude`

用途：

- 模板基础上额外加角色
- 模板基础上显式排除角色

### 5.5 `role_scopes`

用于表达某角色在某资源动作上的范围规则。

第一阶段明确采用以下绑定粒度：

`(role_id, resource_id, action)`

建议核心字段：

- `id`
- `company_code`
- `role_id`
- `resource_id`
- `action`
- `scope_type`
- `scope_value`
- `status`

第一阶段范围建议只支撑：

- `all`
- `self`
- `department`

应用自己可在 runtime 中再解释扩展关系。

### 5.6 `subjects`

用于承接最小主体目录。

建议核心字段：

- `id`
- `company_code`
- `subject_type`
- `subject_code`
- `display_name`
- `external_ref`
- `parent_subject_id`
- `status`

第一阶段建议支持：

- `user`
- `department`
- `job`

注意：

- 第一阶段可以接受存最小必要展示字段
- 不要求一次性把完整 HR 主数据迁入平台

### 5.7 `subject_identities`

用于表达主体与外部身份源之间的映射。

建议核心字段：

- `id`
- `company_code`
- `subject_id`
- `provider_type`
- `provider_subject_key`
- `provider_metadata`
- `status`

用途：

- CAS 用户映射
- 企业微信用户映射
- GitLab OIDC 用户映射
- 通用 OIDC subject 映射

### 5.8 `deployments`

用于表达平台控制的客户部署单元。

建议核心字段：

- `id`
- `company_code`
- `deployment_code`
- `deployment_name`
- `deployment_mode`
- `status`
- `license_status`
- `last_heartbeat_at`
- `created_at`

第一阶段建议 `deployment_mode` 支持：

- `managed-control-plane`
- `self-hosted-enterprise`

### 5.9 `licenses`

用于表达部署许可证与能力边界。

建议核心字段：

- `id`
- `company_code`
- `deployment_id`
- `license_code`
- `plan_code`
- `status`
- `issued_at`
- `expires_at`
- `grace_until`
- `payload_hash`

### 5.10 `license_capabilities`

用于表达某 license 开通了哪些 capability。

建议核心字段：

- `id`
- `company_code`
- `license_id`
- `capability_code`
- `capability_value`

### 5.11 `app_manifests`

用于持久化 app manifest 元数据。

建议核心字段：

- `id`
- `company_code`
- `app_code`
- `version`
- `manifest_hash`
- `manifest_json`
- `status`
- `created_at`

用途：

- 追踪 app manifest 历史版本
- 提供 Control Plane API 与 bundle 构建输入

### 5.12 `policy_bundles`

用于持久化面向 runtime 下发的 bundle 元数据。

建议核心字段：

- `id`
- `company_code`
- `deployment_id`
- `bundle_version`
- `bundle_hash`
- `bundle_uri`
- `schema_version`
- `issued_at`
- `expires_at`
- `status`

用途：

- 标记当前生效 bundle
- 支撑 SDK 拉取最新 bundle

### 5.13 `revocation_snapshots`

用于记录 revocation 列表版本。

建议核心字段：

- `id`
- `company_code`
- `deployment_id`
- `snapshot_version`
- `snapshot_hash`
- `snapshot_uri`
- `issued_at`
- `status`

### 5.14 `deployment_heartbeats`

用于记录 runtime 心跳。

建议核心字段：

- `id`
- `company_code`
- `deployment_id`
- `runtime_id`
- `bundle_version`
- `sdk_version`
- `license_status_seen`
- `heartbeat_at`
- `payload_json`

用途：

- 追踪 runtime 是否在线
- 追踪运行中使用的 bundle 版本

### 5.15 `authorization_audit_logs`

用于记录授权配置与关键运行时变更。

建议核心字段：

- `id`
- `company_code`
- `event_type`
- `subject_type`
- `subject_id`
- `target_type`
- `target_id`
- `payload_json`
- `operator_id`
- `created_at`

---

## 6. 第一阶段不建议立即新增的表

以下能力不是第一阶段主链路前提，建议延后。

### 6.1 `effective_user_roles`

不作为第一阶段主链路表。  
优先采用动态展开 + 缓存。

### 6.2 `effective_user_permissions`

同样不作为第一阶段必备。  
先靠角色、模板、scope 动态解析。

### 6.3 复杂属性策略表

如 ABAC 条件表达式、动态规则 DSL 等，不进入第一阶段范围。

### 6.4 全量 session 中心化表重构

第一阶段只要求 Identity Plane 可用，不要求彻底重写所有旧 session 体系。

---

## 7. 推荐实施顺序

为了降低现网风险，建议按以下顺序落表。

### Step 1：先补角色与资源表扩展字段

先改：

- `roles`
- `user_roles`
- `resources`
- `applications`

原因：

- 影响范围最可控
- 可立即服务角色分类、资源同步、来源追踪

### Step 2：再补授权模型新增表

新增：

- `permission_templates`
- `template_roles`
- `template_bindings`
- `template_overrides`
- `role_scopes`

原因：

- 先把平台权限模型搭起来
- 为 `AIMS` 和 `Codocs` 提供角色与 scope 依据

### Step 3：再补主体目录与身份映射

新增：

- `subjects`
- `subject_identities`

原因：

- 为模板绑定和上游身份源映射提供稳定支点

### Step 4：再补部署与 license 模型

新增：

- `deployments`
- `licenses`
- `license_capabilities`

原因：

- 为 Control Plane SaaS 和 Enterprise 模式提供统一部署语义

### Step 5：再补 manifest / bundle / revocation / heartbeat

新增：

- `app_manifests`
- `policy_bundles`
- `revocation_snapshots`
- `deployment_heartbeats`

原因：

- 这是 Identity Plane、SDK、runtime 的协议支撑层

### Step 6：最后补审计与后台治理能力

新增：

- `authorization_audit_logs`

原因：

- 它重要，但不是协议跑通的最小前提

---

## 8. 与 API 的对应关系

schema 设计必须服务已经确定的 API 契约。

### 8.1 Control Plane API 依赖

以下接口依赖新增 schema：

- 登录/刷新依赖 `subjects`、`subject_identities`
- policy 拉取依赖 `policy_bundles`
- revocation 拉取依赖 `revocation_snapshots`
- heartbeat 上报依赖 `deployments`、`deployment_heartbeats`
- license 状态依赖 `licenses`、`license_capabilities`
- manifest 查询依赖 `app_manifests`

### 8.2 Authorization API 依赖

用户授权查询与权限判断依赖：

- `roles`
- `user_roles`
- `permission_templates`
- `template_roles`
- `template_bindings`
- `template_overrides`
- `role_scopes`
- `resources`

### 8.3 Foundation SDK 依赖

SDK 最小运行依赖：

- bundle 元数据
- revocation 快照
- app manifest 元数据
- 角色/资源/scope 展开结果

---

## 9. 与 AIMS / Codocs 的关系

### 9.1 对 AIMS 的支撑

`AIMS` 第一阶段重点依赖：

- app resources
- app roles
- role scopes
- bundle
- token claims

因此，`role_scopes`、`app_manifests`、`policy_bundles` 是其首批关键依赖。

### 9.2 对 Codocs 的支撑

`Codocs` 第一阶段重点依赖：

- 平台 token
- app manifest
- 基础 app permission

因此，`subject_identities`、`app_manifests`、`policy_bundles`、`deployments` 是其首批关键依赖。

---

## 10. 迁移与回填建议

### 10.1 角色分类回填

现有角色需要分批补齐：

- `role_type`
- `app_code`
- `is_assignable`

建议先对现有角色做字典映射，再批量回填，不要直接人工逐条修。

### 10.2 历史授权来源回填

对历史 `user_roles` 建议统一先回填：

- `source_type = legacy`

后续新授权再分别使用：

- `manual`
- `job`
- 其他明确来源

### 10.3 资源回填

现有资源建议补齐：

- `app_code`
- `resource_code`
- `action`

并逐步与 app manifest 保持一致。

### 10.4 主体目录初始化

`subjects` 第一阶段不要求完全替代现有用户/部门主数据。  
建议采用：

- 从现有用户表初始化 user subjects
- 从现有部门表初始化 department subjects
- 从角色字典或配置初始化 job subjects

---

## 11. 风险与控制

### 11.1 一次性加太多表但没有运行时消费

风险：模型复杂但无人使用。  
控制：按 API、SDK、AIMS、Codocs 的依赖顺序落表。

### 11.2 过早物化有效权限

风险：重算链路复杂，调试困难。  
控制：第一阶段坚持动态展开 + 缓存。

### 11.3 主体目录设计过重

风险：被拖进 HR/组织管理系统重构。  
控制：只做最小主体目录，不接管完整主数据。

### 11.4 license / deployment 设计过轻

风险：后续 Control Plane SaaS 无法真正落地。  
控制：第一阶段即纳入部署、license、heartbeat 基础模型。

---

## 12. 建议的首批实施清单

如果只启动第一轮 schema 实施，建议范围控制为：

### Batch 1

- `roles` 扩字段
- `user_roles` 扩字段
- `resources` 扩字段
- `applications` 扩字段

### Batch 2

- `permission_templates`
- `template_roles`
- `template_bindings`
- `template_overrides`
- `role_scopes`

### Batch 3

- `subjects`
- `subject_identities`

### Batch 4

- `deployments`
- `licenses`
- `license_capabilities`
- `app_manifests`
- `policy_bundles`
- `revocation_snapshots`
- `deployment_heartbeats`

把这四批跑通后，第一阶段平台协议、SDK 与应用接入就有了稳定的数据底座。

---

## 13. 结论

第一阶段的 schema 目标，不是把未来平台所有理想模型一次性落完，而是先在现有 `account` 体系内搭出一层足以支撑：

- 平台 token 与身份映射
- 角色/模板/scope 权限模型
- app manifest 与资源同步
- deployment / license / bundle / heartbeat runtime 模型

只要这层底座搭稳，就可以在不拆库、不推倒现网的前提下，把 `foundation`、`AIMS`、`Codocs` 逐步接到新的平台协议上。
