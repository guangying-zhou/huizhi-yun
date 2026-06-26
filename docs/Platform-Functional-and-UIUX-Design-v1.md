# Platform 功能与整体界面设计方案 v1.1

> **实施状态（2026-06）**：Dashboard 端整套 UI 重设计已落地，呈现层规范、关键决策与已知偏差以 [`Platform-UIUX-Redesign-v2.md`](./Platform-UIUX-Redesign-v2.md) §11 为准。

状态：Draft v1.1  
日期：2026-04-22  
基线：`HZY-Platform-SQL-DDL-Draft-v2.sql`（已合并 v2.1 增量）

---

## 1. 设计目标与边界

目标：在同一套平台中，形成清晰的双端产品形态，并保证功能承诺与现有 schema/API 能力一致。

1. 平台管理端（`/admin`）
- 面向平台运营与治理团队（`platform_accounts.account_type='staff'`）
- 核心任务：租户与应用治理、订阅与部署控制、运行时治理、平台级审计

2. 租户管理端（`/dashboard`）
- 面向租户管理员与 IAM 管理员（`platform_accounts.account_type='tenant_admin'` + `tenant_account_memberships`）
- 核心任务：开通填报、身份与授权管理、本租户应用启用与部署配置

`/admin` 和 `/dashboard` 虽位于同一个 platform 模块并共享租户、应用、授权等数据，但操作主体完全不同：
- `/admin` 使用平台员工账号、`platform_admin` session scope、`hzy_platform_admin_session` cookie。
- `/dashboard` 使用租户管理员账号、`tenant_admin` session scope、`hzy_tenant_dashboard_session` cookie。
- 路由守卫和服务端 API 必须按 scope 校验账号类型，不能因为共享 `platform_accounts/platform_sessions` 表而共享登录态。

3. 设计原则
- 信息架构按“职责域”组织，不按数据库表平铺
- 所有关键状态在列表可见，详情可追溯，操作可审计
- onboarding 采用“双轨状态机”：租户填报轨 + 平台确认轨
- 控制台权限与业务权限分命名空间，不混用
- 遵循零 PII 原则：平台不存应用终端用户 PII；租户管理员作为控制面用户可存必要资料

---

## 2. 产品结构（IA）

## 2.1 平台管理端 IA（`/admin`）

1. 工作台
- 今日待办（待审核 manifest、待开通租户、连通性失败、待激活 license、版本漂移 deployment）
- 运行态概览（活跃租户、活跃 deployment、heartbeat 健康度、版本兼容状态）

2. 租户中心
- 租户台账、开通阶段、生命周期事件
- 租户详情（组织信息、订阅、license、部署、最近审计）

3. 应用治理
- 应用台账（`platform_applications`）
- Manifest 注册与审核（`platform_app_manifest_registrations`）
- 应用版本管理（`platform_app_releases`）
- Manifest 资源动作快照（`platform_app_manifest_resources` / `platform_app_manifest_resource_actions`）
- 支持 scope（`platform_app_supported_scopes`）

4. 订阅与授权
- 套餐与能力目录（`platform_plans` / `platform_capabilities`）
- 租户订阅（`subscriptions`）
- License 与能力下发（`licenses` / `license_capabilities` / `license_deployments`）

5. 部署运行
- 部署台账（`deployments`）
- 连通性检查历史（`deployment_connectivity_checks`）
- 心跳监控（`deployment_heartbeats`）
- 版本报到与漂移告警（`deployments.reported_*`）

6. 策略与吊销
- Policy Bundle 版本与分发（`policy_bundles` / `policy_bundle_targets`）
- Revocation Entries / Snapshots（`revocation_entries` / `revocation_snapshots` / `revocation_snapshot_targets`）

7. 模板与权限底座
- 平台资源、平台角色与权限（`platform_resources` / `platform_roles`）
- 应用权限角色与企业系统角色（`platform_app_roles` / `platform_system_roles`）

8. 运营与审计
- 订单、发票、支付、工单、公告、灰度
- 平台审计日志（`platform_audit_logs`）

## 2.2 租户管理端 IA（`/dashboard`）

1. 概览
- 当前开通阶段、应用启用进度、最近部署状态、关键告警

2. 开通向导（双轨）
- 租户填报步骤：`profile` / `auth_mode` / `applications` / `deployment` / `connectivity`
- 平台确认步骤：`commercial_review` / `license_activation` / `release_gate`
- 基于 `tenants.onboarding_stage` + `tenant_onboarding_steps`，但 `active` 仅由 release gate 判定

3. 组织与身份
- 租户用户（uid 视图）、主体目录、身份源映射
- 控制台会话（`platform_sessions`）与应用会话（`tenant_sessions`）分开展示
- 外部身份展示（姓名/邮箱）为只读 read-through，不落库回写

4. 角色与模板
- 角色、权限、scope
- 模板、模板绑定、模板覆盖

5. 应用与订阅
- 已开通应用、订阅状态、license 状态、license 下发状态

6. 部署与连接
- 本租户 deployment 配置
- 连通性测试与结果追踪

7. 审计与安全
- 租户审计日志
- 关键安全动作记录（绑定、授权变更、吊销）

---

## 3. 功能模块到数据模型映射

| 端 | 模块 | 主表 |
|---|---|---|
| Admin | 租户台账 | `tenants`, `tenant_onboarding_steps`, `platform_tenant_lifecycle_events` |
| Admin | 应用治理 | `platform_applications`, `platform_app_releases`, `platform_app_manifests`, `platform_app_manifest_registrations`, `platform_app_manifest_resources`, `platform_app_manifest_resource_actions` |
| Admin | 订阅与 License | `subscriptions`, `licenses`, `license_capabilities`, `license_deployments`, `platform_plans`, `platform_capabilities` |
| Admin | 部署运行 | `deployments`, `deployment_connectivity_checks`, `deployment_heartbeats`, `tenant_runtime_credentials` |
| Admin | 策略治理 | `policy_bundles`, `policy_bundle_targets`, `revocation_entries`, `revocation_snapshots`, `revocation_snapshot_targets` |
| Admin | 平台权限底座 | `platform_resources`, `platform_roles`, `platform_role_permissions`, `platform_app_roles`, `platform_system_roles` |
| Dashboard | 开通向导 | `tenants.onboarding_*`, `tenant_onboarding_steps`, `subscriptions`, `licenses`, `license_deployments`, `deployments` |
| Dashboard | 身份授权 | `platform_accounts`, `tenant_account_memberships`, `tenant_identity_providers`, `tenant_subjects`, `tenant_subject_identities`, `tenant_subject_roles` |
| Dashboard | 控制台权限 | Dashboard 访问由 `tenant_account_memberships` 控制；Console 模块权限统一进入 `app_code='console'` 应用授权 |
| Dashboard | 模板体系 | `tenant_permission_templates`, `tenant_template_roles`, `tenant_template_bindings`, `tenant_template_overrides` |
| Dashboard | 安全审计 | `platform_sessions`, `tenant_sessions`, `tenant_audit_logs` |

---

## 4. 关键流程（现代 SaaS UX 流程化）

## 4.1 新租户开通（跨端双轨）

1. 租户管理员先注册/登录控制面账户（`platform_accounts`），或由平台邀请加入已有租户
2. 形成 `tenant_account_memberships` 后进入 `/dashboard`，Console 模块能力授权按应用角色分配
3. Dashboard 完成租户可填步骤，逐步写入 `tenant_onboarding_steps.step_payload_json`
4. 平台运营完成商业确认与 license 激活（订阅、license、下发关系）
5. Dashboard / Admin 完成部署配置并触发连通性检查
6. `release_gate` 判定通过后，`onboarding_stage -> active`
7. 自动记录平台/租户两侧审计

`release_gate` 最小判定条件（MVP）：
- `licenses.status = 'active'`
- `license_deployments.status = 'active'`
- `deployments.connectivity_status = 'passed'`

说明：
- 连通性通过不再单独代表“开通完成”
- 商业事实确认与技术验收分轨推进，可并行但统一闸门收敛

## 4.2 应用 Manifest 治理

1. 发布流程、管理员或专用 CLI/API 提交 manifest 注册请求（received）
2. Admin 审核（approved/rejected）
3. 审核通过后 materialize 到 `platform_app_manifests`，并解析 `resources/actions` 到 manifest 快照表
4. 创建或更新 `platform_app_releases`，release 版本号来自 GitLab release/tag
5. `platform_applications.latest_manifest_id/latest_registration_id/latest_release_id` 随注册和发布状态更新
6. 应用启动仅做版本报到与 heartbeat，不再触发新的 manifest 注册
7. 应用治理页显示 release 状态、manifest_seq、权限覆盖 warning 和历史时间线

## 4.3 Deployment 连通性验收

1. Dashboard/ Admin 发起检查
2. 写入 `deployment_connectivity_checks`
3. runtime 启动后通过 heartbeat 上报 `app_version / manifest_version / manifest_hash / sdk_version`
4. 更新 `deployments.connectivity_status`、最近检查摘要与版本摘要
5. 工作台与部署列表实时显示异常标识和版本漂移告警

## 4.4 吊销链路

1. 产生 `revocation_entries`（logout / admin 强制下线等）
2. 按租户聚合生成 `revocation_snapshots`
3. 记录快照分发目标（`revocation_snapshot_targets`）
4. runtime 拉取 snapshot，按签名校验执行
5. Admin 回溯 `entry -> snapshot -> target deployment`

实现约束：
- 若仅有 `revocation_snapshots.entries_json`，运营侧只能做“快照内容解析型追溯”
- 若需台账级高效检索，补 `revocation_snapshot_entries`（见第 9 节）

---

## 5. 页面与交互模板（UI/UX 规范）

## 5.1 页面模板

1. 列表页（List + Filter + Bulk Action）
- 默认：搜索、状态筛选、时间筛选、保存视图
- 支持列配置、导出、批量操作
- 行点击进入详情抽屉或详情页

2. 详情页（Header + Tabs + Timeline）
- 顶部固定实体摘要与状态
- 中区按标签分信息域
- 右侧时间线显示变更与审计

3. 向导页（Stepper + Side Summary）
- 左侧步骤，右侧当前步骤表单
- 自动保存 + 离开提醒
- 步骤阻塞原因显式展示
- 显示“租户填报/平台确认”责任归属

4. 监控页（KPI + Alert + Trend）
- 卡片指标 + 趋势图 + 异常列表
- 一键跳转到处置页

## 5.2 状态表达规范

- 统一状态色语义：
- `active/passed/approved` -> 成功色
- `pending/running/in_progress` -> 进行中色
- `suspended/paused/degraded` -> 警告色
- `failed/rejected/revoked/expired` -> 危险色

- 统一显示格式：
- 状态徽标 + 最近更新时间 + 责任主体

## 5.3 表单交互规范

- 必填项即时校验，提交前聚合错误摘要
- 长表单分段保存，失败后可恢复草稿
- 密钥字段只显示引用（`*_secret_ref`），不回显明文
- 危险操作二次确认，并要求输入实体名确认

## 5.4 可观测与可追溯性

- 每个关键实体页提供“关联对象”面板
- 每个高风险操作自动写审计并可回跳
- 时间线至少展示：创建、状态变更、审批、失败原因

---

## 6. 视觉与设计系统建议（现代 SaaS 管理端）

1. 版式
- 12 栏栅格，内容区最大宽度 1440
- 顶栏 + 左侧导航 + 内容区三段式

2. 设计令牌
- 间距基线：4/8/12/16/24/32
- 圆角：8（控件）/12（卡片）
- 阴影：低对比柔和阴影，强调分层而非装饰

3. 字体
- 中文：`Source Han Sans SC`
- 英文与数字：`IBM Plex Sans`

4. 组件风格
- 数据密集场景优先清晰对齐与层次
- 主操作按钮固定在右上，次操作收敛到更多菜单

5. 可访问性
- 文本与背景对比度 >= WCAG AA
- 全局可键盘操作
- 关键状态不只用颜色表达，必须有文字标签

---

## 7. 权限与导航策略

1. 导航按角色动态裁剪
- Platform 角色只见 `/admin` 体系
- Tenant Console 角色只见 `/dashboard` 体系
- 两端使用不同登录入口和 session scope；同一浏览器可同时存在 admin 与 dashboard 登录态，但 API 必须按 scope 读取对应 cookie。

2. Dashboard 权限数据落点（MVP）
- Dashboard 访问身份以 `tenant_account_memberships(status='active')` 为准，企业 owner 由 `is_owner=1` 表达。
- Console 模块权限不再使用单独的 `tenant_console` 命名空间；统一作为应用 `app_code='console'` 的系统角色与授权策略处理。
- 租户应用侧授权仍走 `tenant_subject_roles`
- Dashboard 的当前企业来源是当前登录账号的 `tenant_account_memberships(status='active')`，不允许仅凭手工输入 tenantCode 进入其它企业。

3. 页面权限分三层
- 路由访问权限（route guard）
- 页面动作权限（按钮级）
- 字段级可见性（敏感字段脱敏）

4. 默认上下文
- `/admin` 支持跨租户检索与切换
- `/dashboard` 固定当前租户上下文，避免误操作；首页当前企业卡通过“我的企业”列表进行切换，并提供新建企业入口。

---

## 8. 首期落地范围（MVP）

前置条件：先冻结 `/ops` 与 `/tenant-admin` API 契约，再冻结页面数据契约。

1. Admin
- 工作台
- 租户中心
- 应用治理（含 manifest 审核、凭证）
- 订阅与部署
- Revocation 运营视图

2. Dashboard
- 双轨开通向导
- 组织身份（uid 视图 + 外部身份只读展示）
- 角色模板
- 部署与连通性测试

3. 横切能力
- 统一状态组件
- 审计回溯面板
- 可保存筛选视图

---

## 9. 最小增量变更清单（Schema / API）

## 9.1 Schema（建议）

1. 新增：`revocation_snapshot_entries`
- 字段建议：`id`, `snapshot_id`, `entry_id`, `included_at`, `sequence_no`, `created_at`
- 约束建议：`UNIQUE(snapshot_id, entry_id)`，索引 `idx_snapshot_entries_entry(entry_id, snapshot_id)`
- 目的：支持高效查询 `entry -> snapshot -> target deployment`

2. 开通步骤责任归属（可选）
- 方案 A（无 DDL 变更）：通过 `step_code` 约定前缀区分 `tenant_* / ops_*`
- 方案 B（有 DDL 变更）：`tenant_onboarding_steps` 增 `step_owner`（tenant / ops / system）

## 9.2 API 契约（必须补齐）

1. `/ops/*`（平台运营）
- 租户开通闸门查询与确认
- 商业确认、license 激活、license 下发绑定
- revocation 追溯查询（entry/snapshot/targets）

2. `/tenant-admin/*`（租户管理）
- 开通步骤读写（仅租户可填步骤）
- deployment 配置与连通性检查
- Console 模块权限点读取（`app_code='console'`）
- 外部身份只读展示接口（read-through，不落库）
- 所有 `/tenant-admin/*` 调用除 tenantCode 上下文一致性外，还必须校验当前账号在 `tenant_account_memberships` 中拥有 active membership。

3. `/console/*`（控制台会话与当前账号）
- `POST /api/platform/auth/dev-wechat-login`：仅用于平台员工登录，创建 `platform_admin` session。
- `POST /api/platform/auth/login`：仅用于租户管理员邮箱密码登录，创建 `tenant_admin` session。
- `GET /api/platform/auth/me?scope=admin|dashboard`：按入口读取对应 session；不跨 scope 兜底。
- `POST /api/platform/auth/logout`：按 `scope` 注销对应 session；不影响另一端登录态。
- `GET /api/platform/console/tenants`：返回当前登录账号 active membership 对应的企业列表，用于 dashboard 首页当前企业卡和租户切换。
- `POST /api/platform/console/tenants`：自助创建企业，写入 `tenants`、`tenant_account_memberships(is_owner=1)`；不再初始化 `tenant_console` 全局角色。
- `GET /api/platform/console/authorization?scope=dashboard&tenantCode=...`：基于 active membership 与显式 `tenant_account_roles` 返回 dashboard 控制台权限。

4. `/runtime/*` 与 `/internal/*`
- 保持既有 runtime/SDK 链路，补充与新闸门状态一致的读取语义

---

## 10. 交付物建议

1. 产品稿
- IA 图
- 关键流程图（4 条）
- 页面线框（Admin 10 页 + Dashboard 8 页）

2. 设计稿
- 组件库（表格、状态徽标、时间线、向导）
- 深浅主题（可选）

3. 实现稿
- 路由清单
- 页面数据契约
- 权限点矩阵（含 `app_code='console'` Console 模块权限）
- API 契约分组清单（`/ops`、`/tenant-admin`、`/runtime`、`/internal`）
