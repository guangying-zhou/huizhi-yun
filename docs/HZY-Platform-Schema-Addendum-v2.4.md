# hzy_platform Schema v2.4 补遗

状态：Draft v2.4  
日期：2026-04-24  
基线：`HZY-Platform-SQL-DDL-Draft-v2.sql` + `HZY-Platform-Schema-Addendum-v2.3.md`

---

## 1. 文档定位

v2.4 是对 v2.3 的约束校准。v2.3 确认了“应用版本 + 租户订阅 + 凭证治理”的主线，v2.4 将后续讨论形成的最终边界固化：

- 应用版本以 GitLab release/tag 为准。
- manifest 文件不声明版本，manifest 内容变化由 `manifest_seq` 递增表达。
- manifest 资源动作必须按版本快照单独存储，并可被权限表追溯引用。
- 权限覆盖检测只提示，不阻断 release 发布。
- 租户 runtime 凭证保留当前态，轮换历史走审计，不做可回滚版本链。
- 租户应用用户登录链路（含 `/oauth/token`）由客户侧 `console` 处理，platform 仅治理“展示哪些登录入口”与角色授权。
- 平台根签名密钥统一落 `platform_signing_keys`，只用于签 bundle/license/revocation；deployment 签名密钥不进入 platform-core。

---

## 2. 最终业务约束

1. 一个订阅计划包括必选基础模块/应用（`console`、`account`、`workflow`）和多个业务应用。示例：`Starter = codocs + aims`，`Pro = Starter + altoc + assets`，`Advanced = Pro + insights`；`Align` 调整为未来可选深度组织协同增强应用，不进入第一阶段 Starter 必选集合。
2. 一个企业同时只能选择一个 active 订阅计划。
3. 应用可以从 GitLab release 创建；首次创建应用时同步创建应用版本，版本号与 release/tag 一致。
4. manifest 从 release 对应 commit 中读取，解析为资源动作项，例如 `aims.projects.view`、`aims.projects.edit`、`aims.projects.admin`。manifest 资源内容变化时产生新的 `manifest_seq`，从 1 开始递增，与 release 版本号无关。
5. 每个应用版本都对应一个 manifest 版本。平台会遍历该 manifest 的资源动作并提示未覆盖权限的 action，但不做强制阻断，因为存在资源已定义但暂不启用、灰度或无需授权的场景。
6. 订阅计划默认自动对应应用最新 `released` 版本；需要灰度或冻结时，计划应用可显式 pin 到某个 release。
7. 每个企业保留当前部署/目标应用版本列表，用于升级检查。runtime 调用凭证统一存 `tenant_runtime_credentials`（租户级当前态）；轮换历史通过审计日志说明，不要求回滚旧 token。
8. 平台维护统一角色与授权模板；租户可以在 dashboard 中基于模板自定义角色权限。角色和用户/主体的对应关系在 dashboard 中实现。

---

## 3. 应用版本、Release 与 Manifest

### 3.1 版本来源

- `platform_app_releases.release_version` 等于 GitLab release/tag，如 `v0.0.1`。
- `platform_app_releases.source_tag` 记录实际读取的 tag/ref。
- `platform_app_releases.source_commit_sha` 记录该 release/tag 解析出的 commit。
- `app.manifest.json` 不声明 `version` / `displayVersion`；即使旧 manifest 中带这些字段，Platform 导入时也应忽略。

### 3.2 Manifest 版本

`platform_app_manifests` 只表达内容版本：

```text
app_code
manifest_seq      -- 应用内从 1 递增
manifest_hash     -- 规范化 manifest JSON 的 hash
manifest_json     -- 原始能力声明快照
```

去重规则：

- 同一个 `app_code + manifest_hash` 命中时复用已有 manifest。
- 内容变化时创建新 manifest，并分配 `MAX(manifest_seq) + 1`。
- 一个 release 必须引用一个 manifest，但多个 release 可以引用同一个 manifest。

### 3.3 Release 状态

`platform_app_releases.status`：

```text
draft
permissions_pending
ready
released
deprecated
```

约定：

- `released` 是订阅计划默认解析“最新版本”时可见的状态。
- 发布时更新 `platform_applications.latest_release_id` 和 `last_released_at`。
- 权限覆盖 warning 不阻断 `ready -> released`，由运营判断是否接受。

---

## 4. Manifest 资源动作快照

`platform_app_resources` 聚合表废弃。manifest 快照成为唯一权威源：

```text
platform_app_manifest_resources
  manifest_id
  app_code
  resource_code
  resource_name
  description
  sort_order
  status

platform_app_manifest_resource_actions
  manifest_resource_id
  manifest_id
  app_code
  resource_code
  action
  action_code        -- generated: CONCAT(app_code, '.', resource_code, '.', action)
  requires_grant     -- 1=需要授权覆盖；0=无需授权/暂不启用
  status
```

`action_code` 是生成列，避免应用层拼接不一致。`UNIQUE(manifest_id, resource_code, action)` 是同一 manifest 内的动作唯一约束。

### 4.1 与权限表关联

平台标准权限：

- `platform_app_role_permissions.manifest_action_id`
- `platform_app_role_scopes.manifest_action_id`

租户自定义权限：

- `tenant_role_permissions.source_manifest_action_id`
- `tenant_role_scopes.source_manifest_action_id`

`tenant_role_permissions.source_manifest_id` 不再保留；manifest_id 可由 `source_manifest_action_id` JOIN 得出。`tenant_roles.source_manifest_id` 可保留为角色副本的来源摘要。

### 4.2 权限覆盖检测

不建 `platform_manifest_permission_checks` 表。覆盖检测实时 JOIN：

```sql
SELECT mra.id, mra.action_code
  FROM platform_app_manifest_resource_actions mra
  LEFT JOIN platform_app_role_permissions srp
    ON srp.manifest_action_id = mra.id
 WHERE mra.manifest_id = :manifest_id
   AND mra.requires_grant = 1
   AND mra.status = 'active'
   AND srp.id IS NULL;
```

结果语义：

- 空集：该 manifest 需要授权的 action 已全部被平台系统角色覆盖。
- 非空：显示 warning；不阻断 release 发布。
- 运营确认无需授权或暂不启用的 action，通过 `requires_grant = 0` 豁免覆盖检测，操作记录写审计日志。

---

## 5. 订阅计划与版本解析

`platform_plan_apps`：

```text
plan_id
app_code
role_in_plan       -- core / business
pin_release_id     -- NULL=自动跟随最新 released
sort_order
```

约束：

- `role_in_plan='core'` 表示基础模块/应用，例如 `console`、`account`、`workflow`。
- `role_in_plan='business'` 表示业务应用。
- `pin_release_id` 必须和 `app_code` 指向同一应用的 release，使用 `(pin_release_id, app_code)` 复合外键。

解析目标版本：

```sql
SELECT COALESCE(
  (SELECT pin_release_id
     FROM platform_plan_apps
     WHERE plan_id = :plan_id AND app_code = :app_code),
  (SELECT id
     FROM platform_app_releases
     WHERE app_code = :app_code AND status = 'released'
     ORDER BY released_at DESC, id DESC
     LIMIT 1)
) AS target_release_id;
```

---

## 6. 租户订阅、部署版本与 Runtime 凭证

### 6.1 一个企业一个 active 计划

`tenant_subscriptions` 是企业级主订阅。通过 generated column `active_unique_key` 约束：

```text
UNIQUE(tenant_code, active_unique_key)
active_unique_key = 'active' WHEN status='active'
```

`subscriptions` 不再是主订阅，而是由订阅计划展开出的 per-app entitlement。

### 6.2 企业应用版本列表

企业当前目标版本可从以下表组合得到：

- `subscriptions.target_release_id`：订阅期望启用的应用版本。
- `deployments.target_release_id`：部署期望运行的应用版本。
- `deployments.reported_app_version`：运行时上报的实际版本。

升级检查通过 target/reported 对比完成。

### 6.3 Runtime 凭证策略

`tenant_runtime_credentials` 使用 `PRIMARY KEY(tenant_code)`，只保存当前有效 runtime 凭证：

```text
tenant_code
credential_mode
runtime_token_hash
runtime_token_last4
status
issued_by_account_id
issued_at
rotated_at
expires_at
revoked_at
last_used_at
```

策略：

- platform 仅存 token hash 与生命周期元数据，不存明文。
- runtime token 轮换/吊销走控制面操作，历史不做可恢复版本链。
- 出现问题时重新签发 token，而不是回滚旧 token。

### 6.3.1 Console Vault Master Key 交付密钥

Console 的 `db_encrypted` 凭证库需要稳定的本地 master key。该 key 不放入租户应用 license，也不由业务应用持有；Platform 在生成 Console 部署交付材料时自动生成 32 字节随机值，保存到 `deployment_bootstrap_secrets`，并写入 `console.env`：

```text
HZY_CONSOLE_VAULT_MASTER_KEY=<platform-generated-stable-random-key>
```

策略：

- 同一 Console deployment 只生成一次，后续重新下载 `console.env` 时复用原值。
- Console license 的签名 payload 写入 `vault.masterKeyFingerprint`，只保存指纹不保存明文；Console 启动时用当前 `HZY_CONSOLE_VAULT_MASTER_KEY` 计算指纹并校验，避免 `.env` 被误改后继续写入不可恢复凭证。
- 该表只服务部署交付材料重建，不进入普通 deployment 配置查询和业务应用 bundle。
- Console 中 GitLab、企业微信、AI Provider、OSS 等系统集成凭证后续默认以 `db_encrypted` 写入 Console vault，不再要求租户在 Console `.env` 中逐项配置业务集成 secret。

### 6.4 登录入口治理边界

- `/oauth/token`、OIDC client secret、用户 session/refresh token 由客户侧 `console` 负责。
- platform 不存 OIDC client secret，只保存登录入口展示策略（如允许的 auth mode、顺序、状态）与角色授权治理数据。
- `console` 作为客户侧基础运行服务在 platform app registry 中使用 app_code=`console`、`service_role='supporting_service'`；平台开通向导只负责下发 deployment/runtime/license/bundle 材料，不接管客户侧 OAuth token 处理。

### 6.5 Runtime Bundle 授权来源边界

- runtime bundle 的主体授权来源应以 `tenant_subject_roles`、`tenant_template_bindings`、`tenant_template_overrides` 为主，结合 `tenant_roles`、`tenant_role_permissions`、`tenant_role_scopes` 计算。
- `tenant_account_roles` 仅用于平台控制台（dashboard/admin）账户授权，不参与业务运行时 bundle。
- `policy_bundles` 保存平台根密钥签名后的 tenant 级全量快照：`bundle_hash` 用作 ETag，`signature / signed_by_kid / signed_at` 用于客户侧验签与审计。
- MVP 阶段 `bundle_uri` 允许使用 `inline://policy-bundles/{tenantCode}/{bundleVersion}`，完整 payload 直接落 `bundle_payload_json`；对象存储分发留到后续波次。

### 6.6 Subject 同步与 PII 约束

- `subject_sync` 只同步最小实体字段：`subject_type / subject_code / external_ref / status`。
- `display_name` 在同步链路中应保持空值或脱敏值；禁止同步真实姓名、邮箱、手机等 PII。

---

## 7. 应用详情页与运营入口

应用详情页需要围绕应用版本管理展示：

- release 列表：版本号、状态、source tag、commit、manifest_seq、manifest_hash。
- release 状态流转：`draft / permissions_pending / ready / released / deprecated`。
- latest released 标记。
- manifest 资源/action 数量。
- 权限覆盖 warning：基于 `requires_grant` 实时 JOIN 计算未覆盖 action。
- GitLab release 导入入口：按 release/tag + commit 读取 `app.manifest.json`，生成/复用 manifest，并创建/更新 release。

---

## 8. 与 v2.3 的修正关系

v2.3 中以下表述被 v2.4 修正：

- “权限方案确定后才能发布”改为“权限覆盖检测只提示，不阻断发布”。
- “每版本独立 App Secret”改为“租户级 runtime token 当前态，升级就地轮换，历史走审计；OIDC secret 留在 console”。
- `platform_app_resources` 删除，改由 manifest resource/action 快照表作为唯一权威源。
- `tenant_role_permissions.source_manifest_id` 删除，改为 `source_manifest_action_id`。
- `action_code` 不再由应用层存普通字段，改为 DB generated column。
- 不再创建 `platform_manifest_permission_checks` 表。
