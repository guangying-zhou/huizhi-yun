# hzy_platform Schema v2.3 补遗

状态：Draft v2.3
日期：2026-04-24
基线：`HZY-Platform-SQL-DDL-Draft-v2.sql` + `Schema-Addendum-v2.1.md` + `Migration-v2.2.sql`
迁移 SQL：`HZY-Platform-SQL-Migration-v2.3.sql`

> 后续决策已并入 `HZY-Platform-Schema-Addendum-v2.4.md`。v2.4 修正了本文件中“权限方案强阻断发布”“每版本独立 App Secret”“platform_app_resources 聚合表”“tenant_role_permissions.source_manifest_id”等早期表述。

---

## 1. 文档定位

v2.3 不是重构，是针对 8 条业务约束把 v2/v2.1/v2.2 里缺的一等实体补齐，让"应用版本 + 租户订阅 + App 凭证"三条主线闭合。

---

## 2. 业务约束（输入）

1. 订阅计划 = 必选基础模块（console / account / workflow） + 业务应用
2. 一个企业同时只能选一个订阅计划
3. 应用从 GitLab release 创建；初始创建应用时同步创建应用版本，版本号 = release 号
4. manifest 从 release 对应仓库提交解析为资源×动作项；资源变化 → manifest 版本 +1（整数，从 1 起），与 release 号独立
5. 应用版本都对应一个 manifest 版本；权限覆盖检测给出 warning，不强制阻断发布
6. 订阅计划自动对应最新 released 版本
7. 企业维护"已部署应用版本清单"；企业 x 应用保留当前 App Secret，升级时就地轮换，历史走审计
8. 平台出统一角色/模板；租户 dashboard 自定义角色权限并做"角色×用户"分配

---

## 3. 核心变更一览

| 变更类型 | 对象 | 说明 |
|---|---|---|
| **新增** | `platform_app_releases` | 应用版本主表（release_version = gitlab tag，引用 manifest，带 bundle 信息和状态机） |
| **新增** | `tenant_subscriptions` | 租户级主订阅（一企业一计划，active 唯一约束） |
| **新增** | `tenant_app_credentials` | 企业×应用的 OIDC 凭证（升级即就地轮换，不留历史） |
| **修改** | `platform_app_manifests` | 新增 `manifest_seq INT`，废弃 `version VARCHAR`；新增 `uk(app_code, manifest_hash)` 支持按 hash 去重 |
| **修改** | `platform_plan_apps` | 新增 `role_in_plan`（core/business）、`pin_release_id`（NULL=自动追最新）、`sort_order` |
| **修改** | `platform_applications` | 新增 `latest_release_id`；删除 `current_credential_id`（被 `tenant_app_credentials` 取代） |
| **修改** | `subscriptions` | 新增 `tenant_subscription_id`（父指针）、`target_release_id`；语义从"订阅主体"降为"计划展开后的 per-app entitlement" |
| **修改** | `deployments` | 新增 `target_release_id`；删除 `client_id` / `client_secret_ref`（下放到 `tenant_app_credentials`） |
| **修改** | `tenant_roles` / `tenant_role_permissions` | `tenant_roles.source_manifest_id` 保留角色来源摘要；`tenant_role_permissions.source_manifest_action_id` 追溯到 manifest action |
| **删除** | `platform_app_credentials` | 被 `tenant_app_credentials` 取代 |

---

## 4. 约束到模型的映射

### 约束 1｜计划 = 基础模块 + 业务应用

```
platform_plan_apps
  + role_in_plan ENUM('core','business')
```

seed 数据按约束填：
- `Starter`：{console, account, workflow} core + {codocs, aims} business；轻量员工入口、待办、通知、简单事项入口由 console 承接
- `Pro`：Starter 全集 + {altoc, assets} business
- `Advanced`：Pro 全集 + {insights} business
- `Align`：未来可选深度组织协同增强应用，不进入第一阶段 Starter 必选集合

### 约束 2｜一企业一计划

```
tenant_subscriptions
  UNIQUE(tenant_code, active_unique_key)
  active_unique_key = 'active' WHEN status='active' ELSE 'inactive#<no>'
```

任一时刻，同一 `tenant_code` 只能存在一条 `status='active'` 的记录。

### 约束 3｜从 GitLab release 创建应用 + 同步创建版本

流程：

```
1. /admin 选择 repo + release tag
2. 创建 platform_applications（若首次）
3. 从 release commit 拉 manifest.json
4. 按 (app_code, manifest_hash) 查 platform_app_manifests
   ├── 命中：复用已有 manifest_id
   └── 未命中：seq = MAX(manifest_seq)+1，写入
5. 创建 platform_app_releases：
     release_version = gitlab tag
     manifest_id    = 上一步结果
     status         = 'draft'
```

### 约束 4｜manifest 整数递增 + hash 去重

```
platform_app_manifests
  + manifest_seq INT NOT NULL
  + UNIQUE(app_code, manifest_seq)
  + UNIQUE(app_code, manifest_hash)
  - version VARCHAR（废弃）
```

### 约束 5｜权限覆盖检测只提示，不阻断发布

`platform_app_releases.status` 状态机：

```
draft
  ├── permissions_pending
  └── ready
        ├── [点击"发布"]
        └── released  ← 仅此状态被订阅计划可见
              └── deprecated
```

权限覆盖检测通过实时 JOIN 计算：`platform_app_manifest_resource_actions.requires_grant=1` 且未被 `platform_app_role_permissions.manifest_action_id` 覆盖的 action 会展示 warning。

非空结果不阻断发布，因为资源可能已声明但暂不启用、灰度、无需授权或仅内部使用。运营确认无需授权时，将对应 manifest action 的 `requires_grant` 置为 `0`。

### 约束 6｜订阅计划自动对应最新版本

查询契约（应用层）：

```sql
-- 给定 plan_code 和 app_code，解析目标 release_id
SELECT COALESCE(
  (SELECT pin_release_id
     FROM platform_plan_apps
     WHERE plan_id = :plan_id AND app_code = :app_code),
  (SELECT id FROM platform_app_releases
     WHERE app_code = :app_code AND status = 'released'
     ORDER BY released_at DESC LIMIT 1)
) AS target_release_id;
```

`pin_release_id = NULL` → 自动追最新；如果运营希望把某计划锁在特定版本（灰度/回滚），可显式 pin。

### 约束 7｜企业已部署应用版本清单 + 当前 Secret 轮换

```
tenant_app_credentials
  UNIQUE(tenant_code, app_code)
  current_release_id  ← 当前 Secret 对应的版本
  client_id / client_secret_ref
  rotated_at / rotated_from_release_version  ← 仅保留最近一次轮换快照
```

升级流程（租户点"升级到 vX"）：
1. 将 `subscriptions.target_release_id` 切换到新 release
2. 生成新 client_id / client_secret，写入 credential-vault 拿 `secret_ref`
3. 就地 UPDATE `tenant_app_credentials`：
   - `current_release_id` / `current_release_version` → 新值
   - `client_id` / `client_secret_ref` → 新值
   - `rotated_at` = now()
   - `rotated_from_release_version` = 旧版本号（仅保最近一次，不存历史链）
4. 业务应用下次启动时从 console 拉新 secret（前期手工维护，后续自动下发）

历史 secret 不作为可恢复对象；轮换事实写入 `tenant_audit_logs` 或 credential-vault 审计。出现问题时重新生成 secret，而不是回滚旧 secret。

"企业已部署应用版本清单" 的 UI 数据源：

```sql
SELECT s.app_code, s.target_release_id, d.reported_app_version,
       CASE WHEN s.target_release_id <> d.target_release_id
               OR d.reported_app_version IS NULL THEN 1 ELSE 0 END AS upgrade_available
FROM subscriptions s
LEFT JOIN deployments d ON d.subscription_id = s.id
WHERE s.tenant_code = :tenant_code;
```

### 约束 8｜平台模板 → 租户自定义 → 用户分配

- 平台侧：`platform_system_roles` / `platform_system_roles`（v2 已有）
- 租户侧：`tenant_roles` / `tenant_permission_templates`（v2 已有）
- **升级感知**：`tenant_roles.source_manifest_id` 标记角色副本来源；`tenant_role_permissions.source_manifest_action_id` / `tenant_role_scopes.source_manifest_action_id` 标记权限动作来源，manifest_id 可通过 JOIN 得出
- 用户分配：`tenant_subject_roles`（普通用户）/ `tenant_account_roles`（租户管理员）/ `tenant_template_bindings`（模板批量授权）—— 全部在 `/dashboard` 操作

---

## 5. 跨域 FK 约束（严格执行）

按 v2 既定规则，**跨物理域不设 FK**。本次新增/改动遵循：

| 字段 | 来源域 | 目标域 | 是否设 FK |
|---|---|---|---|
| `platform_app_releases.app_code → platform_applications` | Platform → Platform | ✅ 设 |
| `platform_app_releases.manifest_id → platform_app_manifests` | Platform → Platform | ✅ 设 |
| `platform_applications.latest_release_id → platform_app_releases` | Platform → Platform | ✅ 设 |
| `platform_plan_apps.pin_release_id → platform_app_releases` | Platform → Platform | ✅ 设 |
| `tenant_subscriptions.tenant_code → tenants` | Boundary → Boundary | ✅ 设 |
| `tenant_subscriptions.plan_code → platform_plans` | Boundary → Platform | ❌ 应用层校验 |
| `tenant_subscriptions.current_order_id → platform_orders` | Boundary → Platform | ❌ 应用层校验 |
| `subscriptions.tenant_subscription_id → tenant_subscriptions` | Boundary → Boundary | ✅ 设 |
| `subscriptions.target_release_id → platform_app_releases` | Boundary → Platform | ❌ 应用层校验 |
| `tenant_app_credentials.tenant_code → tenants` | Boundary → Boundary | ✅ 设 |
| `tenant_app_credentials.app_code / current_release_id` | Boundary → Platform | ❌ 应用层校验 |
| `deployments.target_release_id → platform_app_releases` | Boundary → Platform | ❌ 应用层校验 |
| `tenant_roles.source_manifest_id` / `tenant_role_permissions.source_manifest_action_id` | Tenant → Platform | ❌ 应用层校验 |

---

## 6. 数据回填

本迁移在改动表上添加新列时采用**宽容策略**（NULLABLE），由运营脚本回填后再在 v2.4 收紧：

1. `subscriptions.tenant_subscription_id` —— 按 `(tenant_code, plan_code)` 聚合建父行并回指
2. `platform_app_manifests.manifest_seq` —— 按 `(app_code, created_at)` 升序从 1 编号
3. `deployments.client_id` / `client_secret_ref` —— 迁入 `tenant_app_credentials`，去重后删除原列（本迁移已删）

SQL 草案放 `HZY-Platform-SQL-Migration-v2.3.sql` 末尾的注释块。

---

## 7. 后续工作（不在本迁移内）

1. 更新 `HZY-Platform-SQL-DDL-Draft-v2.sql` 主线，把 v2.3 变更并入（类似 v2.1 并入的方式）
2. `platform/server/api/platform/ops/app-manifest-imports/*` 改造：按 hash 去重 + 生成 release
3. `/admin/applications/[id]` 前端提供"应用版本"视图，支持 release 状态流转与权限覆盖 warning
4. `/dashboard/onboarding` 里 `commercial` 步骤改为"选择订阅计划"（写 tenant_subscriptions），`applications` 步骤自动按 plan_apps 展开
5. `tenant_app_credentials` 的读写通道并入 console credential-vault
6. v2.4 收紧 `subscriptions.tenant_subscription_id` 为 NOT NULL

---

## 8. 结论

v2 解决"模型分层正确"，v2.1 解决"第一阶段管理端能运营"，v2.3 解决"版本化与订阅结构与业务约束对齐"。至此 8 条约束都有模型支撑。
