# Platform 代码升级矩阵（DDL v2 对齐）

状态：In Progress（主链路 + API 分层 + Console 应用化权限已落地）  
日期：2026-04-23

## 1. 目标

基于 `HZY-Platform-SQL-DDL-Draft-v2.sql` 与设计文档，对 `platform` 模块进行“成组升级”，避免旧表与新表混用导致的碎片化改造。

本次升级优先保证：

1. runtime 运行时接口可直接落在 v2 表结构
2. admin / dashboard 主链路（应用、订阅、部署、license、身份授权）可运行
3. 数据访问统一使用 v2 表名与关系（尤其 `subscriptions`、`license_deployments`、`platform_app_*`）
4. API 分层落到 `/ops` 与 `/tenant-admin`，保留 `/admin` 兼容过渡
5. 租户控制台权限模型按 `app_code='console'` 应用权限处理，与其它业务应用保持一致

## 2. 旧新表映射

| 旧实现表 | v2 目标表 | 升级说明 |
|---|---|---|
| `applications` | `platform_applications` | 去掉 tenant 维度，改平台域应用目录 |
| `app_manifests` | `platform_app_releases` + `platform_app_manifests` + `platform_app_manifest_registrations` | release 版本与 manifest 内容版本分离 |
| `app_secret`（applications 字段） | `tenant_app_credentials` | 企业 x 应用当前凭证，就地轮换，历史走审计 |
| `licenses.deployment_id` | `licenses` + `license_deployments` | license 与 deployment 解耦、通过映射关系生效 |
| `role_permissions(resource_id)` | `tenant_role_permissions(app_code,resource_code,action)` | 从资源 ID 绑定转为 app/resource/action 三元 |
| `role_scopes(resource_id)` | `tenant_role_scopes(app_code,resource_code,action,scope*)` | 同上 |
| `resources` | `platform_app_manifest_resources` + `platform_app_manifest_resource_actions` | 资源动作按 manifest 版本快照存储 |
| `users` | `tenant_subjects`（`subject_type='user'`） | 零 PII，用户主体与授权主体合一 |
| `subjects` | `tenant_subjects` | 主体目录与用户解耦 |
| `subject_identities` | `tenant_subject_identities` + `tenant_identity_providers` | 引入 provider 实体，映射规范化 |
| `roles` | `tenant_roles` | 租户角色体系 |
| `permission_templates` | `tenant_permission_templates` | 模板租户域化 |
| `template_roles` | `tenant_template_roles` | 模板-角色关系租户域化 |
| `template_bindings` | `tenant_template_bindings` | 模板绑定租户域化 |
| `template_overrides` | `tenant_template_overrides` | 模板覆盖租户域化 |

## 3. 已完成升级（代码）

### 3.1 Runtime

- `runtime/applications` 改为 `subscriptions + platform_applications`
- `runtime/manifest` 改为读取 `platform_applications.latest_manifest_id`（fallback active manifest）
- `runtime/heartbeat` 支持：
  - `appVersion/manifestVersion/manifestHash/sdkVersion` 报到
  - 入库 `deployment_heartbeats.app_version/manifest_version/manifest_hash`
  - 回写 `deployments.reported_* / last_reported_at / version_status`
- `runtime/status` 返回 `connectivityStatus/versionStatus/reported_*`
- runtime 相关查找函数统一走：
  - `license_deployments`
  - `policy_bundle_targets`
  - `revocation_snapshot_targets`

### 3.2 应用与发布治理

- `/admin/applications*` 全部改到 `platform_applications`
- `/admin/applications/:id/regenerate-secret` 退役为 410：
  - Platform 不再维护 app 级全局 secret
  - 企业 x 应用当前凭证统一落到 `tenant_app_credentials`
  - 升级时就地轮换，历史走审计日志和 console credential-vault
- `/admin/applications/:appCode/manifests*` 改到：
  - `platform_app_releases`（GitLab release/tag = 应用版本）
  - `platform_app_manifests`
  - `platform_app_manifest_registrations`
  - `platform_app_manifest_resources`
  - `platform_app_manifest_resource_actions`
  - 同步更新 latest manifest / latest registration / latest released version
- manifest 文件不再声明版本；内容变化由 `manifest_seq` 递增表达，release 版本号来自 GitLab release/tag
- 权限覆盖检测基于 `platform_app_manifest_resource_actions.requires_grant` 与 `platform_app_role_permissions.manifest_action_id` 实时 JOIN，只提示 warning，不强制阻断发布

### 3.3 订阅-部署-License 主链路

- `server/utils/subscriptions.ts` 重写：
  - 以 `platform_applications` 为目录
  - 关联 `subscriptions/deployments/licenses/license_deployments`
  - stage 判定纳入 `connectivity_status`
- `/admin/subscriptions.post` 重写：
  - 先 upsert `subscriptions`
  - 再 upsert `deployments(subscription_id)`
  - 可选签发/更新 `licenses`
  - 维护 `license_deployments`
- `/admin/deployments.post` 改为要求 active subscription，写入 `subscription_id`
- `/admin/licenses*` 改为通过 `license_deployments` 解析 deployment
- `license_capabilities` 写入去掉 `tenant_code`

### 3.4 身份授权与模板主链路

- `/admin/users*` 改到 `tenant_subjects(subject_type='user')`
- `/admin/subjects*` 改到 `tenant_subjects`（user 主体直接通过 `subject_type='user' + subject_code=uid` 表达）
- `/admin/subject-identities` / `/admin/subjects/:id/identities` 改到：
  - `tenant_subject_identities`
  - `tenant_identity_providers`
- `/internal/identity/resolve-subject` 改到 tenant identity 体系
- `/admin/roles*`、`roles/*/permissions`、`roles/*/scopes` 改到 tenant role 体系
- `/admin/resources` 改到最新 release/manifest 对应的 `platform_app_manifest_resources`
- `/admin/templates*`、`template-bindings*`、`template-overrides*`、`templates/:id/roles*` 改到 tenant template 体系

### 3.5 API 分层与 Console 权限应用化

- 新增并落地：
  - `/api/platform/ops/**`（平台运营面）
  - `/api/platform/tenant-admin/**`（租户管理面）
  - 当前保留 `/api/platform/admin/**` 作为兼容入口（过渡期）
- 前端调用已分层：
  - 平台管理端页面统一改为 `/api/platform/ops/*`
  - 租户管理端页面统一改为 `/api/platform/tenant-admin/*`
- `server/utils/tenantConsole.ts` 已降级为兼容 no-op；控制台不再使用 `tenant_console` 命名空间种子与租户 bootstrap。
- Console 模块权限统一作为应用 `app_code='console'` 的系统角色与租户授权处理，旧 `tenant_console_owner/operator/viewer` 不再写入 `platform_system_roles`。
- 租户创建只写入 `tenants` 与 membership；不再自动执行 tenant console RBAC 初始化。
- `tenant-admin` 下旧角色/资源/模板接口仍保留为兼容入口；新增授权分配流程应使用按应用过滤的 `system-roles` / `assignable-roles` 接口。

### 3.6 服务端强鉴权与兼容退役闸门

- 新增全局中间件：`server/middleware/platform-access.ts`
  - `/api/platform/ops/**` 与 `/api/platform/admin/**`：
    - 必须登录（`auth_user + token`）
    - 默认使用表驱动 RBAC（`platform_accounts / platform_roles / platform_role_permissions / platform_account_roles`）
    - 启动时自动补齐最小 seed（`ops_*` 资源、`ops_super_admin` / `ops_auditor` 角色与权限）
    - 支持应急白名单兜底（`PLATFORM_OPS_UIDS`，可通过 `PLATFORM_ALLOW_OPS_UID_FALLBACK` 关闭）
  - `/api/platform/admin/**`：
    - 返回 `x-platform-api-deprecated` 响应头
    - 默认关闭（`PLATFORM_ALLOW_LEGACY_ADMIN_API=false`），命中即返回 410
  - `/api/platform/tenant-admin/**`：
    - 必须登录
    - 必须有租户上下文（`x-hzy-tenant-code` / `hzy-current-tenant` / `tenantCode` query）
    - 校验 header/cookie/query/body（`tenantCode`）一致性，避免跨租户访问
    - 对 `.../{id}` 路径增加目标资源租户校验，阻断跨租户 ID 访问
- 新增访问工具：`server/utils/access.ts`
  - 统一处理 UID、Token、租户上下文、CSV 白名单解析
  - 供中间件与 tenant-admin 专用端点复用
- 新增 ops RBAC 工具：`server/utils/platformOpsRbac.ts`
  - 负责 platform domain seed 初始化与权限查询
  - 把 `/ops` 访问判定从“仅 UID 白名单”升级为“资源-动作权限判定”
- 新增运行配置项（`nuxt.config.ts -> runtimeConfig.security`）
  - `opsBootstrapUids`（`PLATFORM_BOOTSTRAP_OPS_UIDS`）
  - `enableOpsRbac`（`PLATFORM_ENABLE_OPS_RBAC`，默认 `true`）
  - `allowOpsUidFallback`（`PLATFORM_ALLOW_OPS_UID_FALLBACK`，默认 `true`）
  - `allowLegacyAdminApi`（`PLATFORM_ALLOW_LEGACY_ADMIN_API`，默认 `false`）
- tenant-admin 的租户端点已最小权限化：
  - `tenants.get` 只返回当前租户
  - `tenants/[id]/summary.get` 强校验必须是当前租户
  - `tenants.post` 与 `tenants/[id].patch` 明确禁用（403）
- 兼容层代码结构已重排：
  - 真实处理器统一迁移到 `server/api/platform/_handlers/**`
  - `/ops`、`/tenant-admin`、`/admin` 均作为路由转发层引用 `_handlers`
  - 后续删除 `/admin` 路由时不再需要搬迁业务实现

## 4. 当前运行校验

- 已执行：`pnpm -C platform typecheck`
- 结果：通过

## 5. 剩余收口项（下一阶段）

1. `/admin` 兼容路由文件退役（第二阶段）
- 当前已完成：前端切离 `/admin`、默认禁用兼容 API（410）、处理器已抽到 `_handlers`
- 下一阶段：删除 `/api/platform/admin/**` 路由文件并清理相关文档引用

2. `/ops` RBAC 治理深化
- 当前已完成：表驱动权限判定 + 自动 seed + 白名单兜底
- 下一阶段：补 `/ops` 角色管理页面与 API（平台账号分配角色、审计授权变更）

3. Revocation 台账追溯增强
- 若要高效追溯 `entry -> snapshot -> deployment`，建议补 `revocation_snapshot_entries`

4. Onboarding 双轨状态机落库与接口化
- 将“租户填报轨”和“平台确认轨”从文档落实到 API 校验逻辑
- `active` gate 需同时依赖 license + deployment + connectivity

5. 零 PII 展示层策略
- 当前 user 列表已最小化
- 如需“人类可读姓名/邮箱”，需通过外部身份 read-through（不回写 tenant 库）
