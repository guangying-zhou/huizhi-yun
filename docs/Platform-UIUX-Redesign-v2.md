# Platform 控制台 UI/UX 重设计 v2

状态：Draft v2.0
日期：2026-04-24
基线：`HZY-Platform-SQL-DDL-Draft-v2.sql`（v2.4 合并后）
取代：`Platform-Functional-and-UIUX-Design-v1.md` 的第 5–7 章
参考：Cloudflare Dashboard / Vercel / Supabase / Linear / Stripe

---

## 1. 问题诊断

当前实现的别扭主要来自三件事：

1. **文件结构不一致**——只有 `applications` 走了 `index/new/[id].vue` 三件套，其它模块（tenants/subscriptions/deployments/licenses 以及整个 dashboard）都是单文件 `*Manager.vue`，列表+创建+详情挤在一起，靠状态切换。
2. **页面模板各异**——有的用 modal 编辑、有的用 drawer 详情、有的整页跳转，操作前无法预期。
3. **信息密度失衡**——详情页一屏堆所有字段，没有 tab 分组；列表页字段又太少，看不到状态。

下面方案统一这三件事：路由分离 / 模板统一 / 信息分层。

---

## 2. 设计原则（Cloudflare-style）

| 原则 | 含义 |
|---|---|
| **URL 即状态** | 列表、详情、创建、编辑都有自己的 route，可深链、可刷新、可前进后退 |
| **List ≠ Detail** | 列表页只做"扫读+筛选+跳转"；详情页只做"看清+编辑"。两者绝不共用一个组件 |
| **一屏一意图** | 详情页用 tabs 切分；不要一屏暴露所有字段 |
| **操作前可预期** | 主要操作恒定在右上角；危险操作恒定在末尾 + 二次确认 |
| **状态可一眼读** | 所有状态用同一套 Badge 颜色语义（primary/success/warning/error/info/gray） |
| **空状态有出口** | 空列表不是空白页，而是引导首次操作的 CTA |

---

## 3. 全局信息架构

### 3.1 顶层布局（双端共用）

```
┌──────────────────────────────────────────────────────────────┐
│ [logo] HZY Platform                       [user▼] [help]     │  ← 顶栏
├────────┬─────────────────────────────────────────────────────┤
│        │ Tenants > acme-corp > Subscription                  │  ← 面包屑
│ Nav    │ ┌────────────────────────────────────────────────┐  │
│ Group  │ │ ICON  Entity Name              [Status]        │  │  ← 实体头
│        │ │ secondary metadata...        [主操作] […]      │  │
│ Item 1 │ ├────────────────────────────────────────────────┤  │
│ Item 2 │ │ Overview │ Releases │ Resources │ Settings     │  │  ← Tabs
│ Item 3 │ ├────────────────────────────────────────────────┤  │
│        │ │                                                │  │
│        │ │   tab content                                  │  │
│        │ │                                                │  │
└────────┴────────────────────────────────────────────────────┘
```

- **顶栏**：固定。
  - `/admin`：租户是被管理的数据实体，没有"当前租户"概念，**不出切换器**。
  - `/dashboard`：租户即上下文。一个 `platform_account` 允许创建/加入多个租户（通过 `tenant_account_memberships`），所以**顶栏永远出租户切换器**（类似 GitHub Org Switcher / Vercel Team Switcher），下拉里包含：
    - 当前已加入的租户列表，点击切换上下文跳到目标租户的 `/dashboard`
    - 顶部"创建新企业"入口（跳 `/dashboard/onboarding/new-tenant` 走开通向导）
- **左侧导航**：按"职责域"分组，不按表名平铺。当前选中项高亮，hover 显示 tooltip。
- **面包屑**：永远展示从根到当前页的路径。点击任一节点回到该层。
- **实体头 + Tabs**：详情页固定模式（详见 §4.2）。

### 3.2 Admin 端导航（`/admin`）

```
工作台         /admin
─────────────
应用         /admin/applications           ← 列表
  ├─ 创建    /admin/applications/new       ← 从 GitLab 导入
  └─ 详情    /admin/applications/:code     ← tabs: Overview / Releases / Manifests / Resources / Settings
订阅计划     /admin/plans                  ← 列表
  ├─ 创建    /admin/plans/new
  └─ 详情    /admin/plans/:code            ← tabs: Overview / Apps / Capabilities / Subscribers
系统角色     /admin/system-roles           ← 列表（含模板）
  └─ 详情    /admin/system-roles/:code     ← tabs: Permissions / Templates Using / Tenants Using
─────────────
运营
  租户         /admin/tenants                ← 列表
    └─ 详情    /admin/tenants/:code          ← 详情（tabs: Overview / Subscription / Deployments / Members / Audit）
  订单       /admin/orders
  发票       /admin/invoices
  付款       /admin/payments
  工单       /admin/tickets
  公告       /admin/announcements
─────────────
平台设置
  平台账号   /admin/accounts
  平台角色   /admin/platform-roles
  Feature Flag /admin/feature-flags
  审计日志   /admin/audit
```

**说明**：
- 删除当前 `/admin/deployments`、`/admin/licenses`、`/admin/subscriptions` 顶层入口——这些是 Tenant 的下钻视图，不该是顶层（运营 99% 时间从 Tenant 进入定位问题，单独列只是 schema 平铺）。
- `订阅计划`独立是因为它跨租户的业务对象（Plan 是产品定义，subscription 是租户事实）。

### 3.3 Dashboard 端导航（`/dashboard`）

```
概览          /dashboard
─────────────
订阅与应用    /dashboard/subscription       ← 我的计划（singleton 详情页）
  └─ App      /dashboard/apps/:code         ← 单应用：当前版本/Secret/升级/部署状态
─────────────
身份与权限
  成员        /dashboard/members            ← 租户管理员（tenant_account_memberships）
    └─ 详情  /dashboard/members/:uid
  用户主体    /dashboard/subjects           ← tenant_subjects（业务用户/部门/岗位）
    └─ 详情  /dashboard/subjects/:id
  角色        /dashboard/roles              ← tenant_roles
    ├─ 创建  /dashboard/roles/new
    └─ 详情  /dashboard/roles/:code        ← tabs: Permissions / Scopes / Members
  权限模板    /dashboard/templates
    └─ 详情  /dashboard/templates/:code
─────────────
配置
  企业信息    /dashboard/profile           ← tenant 基本信息
  登录方式    /dashboard/auth              ← tenant_identity_providers
  域名        /dashboard/domains           ← primary_domain + 应用子域
  账单        /dashboard/billing           ← 订单/发票/付款 + 默认付费方式
─────────────
审计           /dashboard/audit
```

**关键改动**：
- 当前 `dashboard/applications.vue` 拆成 `subscription`（计划层视图） + `apps/:code`（单应用详情）
- 当前 `dashboard/users.vue` 实际是"租户管理员"管理，更名为 `members` 以避免与"业务用户"混淆
- `subjects` 是业务侧用户/部门/岗位，独立入口

### 3.4 多企业模型与开通向导

**多企业前提**：一个 `platform_account` 允许创建/加入多个企业（`tenant_account_memberships` 多对多）。两条入场路径：

1. **新用户首次创建企业**：注册登录后无任何 membership → 跳 `/dashboard/onboarding/new-tenant`，完成后写入 tenants + memberships，自动作为 owner。
2. **已有用户创建第二/第三家企业**：顶栏租户切换器 →"创建新企业" → 同向导。完成后切换到新企业上下文。

MVP 落地：当前先在 `/dashboard` 首页的“当前企业”卡片承载企业切换与“新建企业”入口，数据来自 `GET /api/platform/console/tenants`；创建入口调用 `POST /api/platform/console/tenants`，会同时写入 `tenants` 和 owner membership。Console 模块权限统一作为 `app_code='console'` 应用权限处理，不再写入 `tenant_console_owner`。后续再把同一数据源抽到全局顶栏租户切换器。

**未完成开通的企业**：进入该企业 dashboard 时，如果 `tenants.onboarding_stage != 'active'`，**整个左侧导航被替换为单页向导**：`/dashboard/onboarding`（恢复未完成的步骤）。完成后才解锁全部菜单。这是 Cloudflare/Vercel 都用的"先完成必填，再放权"策略。

**已激活企业**：直接进 `/dashboard`，左侧导航完整。

> 路由约定：`/dashboard/onboarding/new-tenant` 是"创建并开通新企业"的复合流程；`/dashboard/onboarding` 是"恢复当前企业未完成的开通"。前者完成后才有 tenant 上下文，后者已经有 tenant 上下文。

---

## 4. 页面模板（4 种，全平台统一）

### 4.1 List Template（列表页）

**职责**：扫读 + 筛选 + 跳转。**禁止**在列表页内嵌行详情、内嵌编辑。

```
┌────────────────────────────────────────────────────────────┐
│ Tenants                                          [+ 新建]  │  ← H1 + 主操作
├────────────────────────────────────────────────────────────┤
│ [搜索…]  [状态: 全部▼] [类型: 全部▼] [更多筛选]  [视图▼]  │  ← 筛选条
├────────────────────────────────────────────────────────────┤
│ ☐ │ Name           │ Status   │ Plan      │ Last Active │ │  ← 表头
│ ☐ │ acme corp      │ ●Active  │ Pro       │ 2h ago      │ │
│ ☐ │ globex         │ ●Pending │ Starter   │ -           │ │
│ ☐ │ initech        │ ⚠Suspend │ Pro       │ 3d ago      │ │
├────────────────────────────────────────────────────────────┤
│ 共 142 条     ‹ 1 2 3 … 8 ›             [每页 20 ▼]       │
└────────────────────────────────────────────────────────────┘
```

**规范**：
- **行点击 = 进详情页**（不是 drawer），URL 变化
- **行右侧 hover 出 `…` 菜单**（次要操作：导出、复制 ID、暂停等）
- **状态列**：用 Badge，颜色见 §6.2
- **筛选条**：当前筛选状态写入 URL query，可分享/收藏
- **空状态**：图标 + 一句话说明 + 主 CTA（如"创建第一个租户"）
- **批量操作**：勾选行后顶部出现操作条（批量暂停/导出）
- **不要做**：行内展开、行内编辑、modal 弹详情

**Nuxt UI V4 组件**：`UTable` + `UInput` + `USelect` + `UBadge` + `UPagination` + `UDropdownMenu`

### 4.2 Detail Template（详情页）

**职责**：看清当前实体的所有维度 + 在该实体上做编辑/操作。

```
┌─────────────────────────────────────────────────────────────┐
│ Tenants > acme-corp                                         │  ← 面包屑
├─────────────────────────────────────────────────────────────┤
│ 🏢 ACME Corp                                  ● Active      │  ← 实体头
│ tenant_code: acme-corp · 创建于 2026-04-12                  │     图标+主名+状态
│                                  [编辑] [操作 ▼]            │     右上角操作
├─────────────────────────────────────────────────────────────┤
│ Overview │ Subscription │ Deployments │ Members │ Audit    │  ← Tabs
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ 基本信息 ─────────────────────┐ ┌─ 关键指标 ────────┐  │
│  │ 显示名: ACME Corp              │ │ 活跃 deployment  │  │
│  │ 主域名: acme.com               │ │ 12 / 15          │  │
│  │ 默认登录: OIDC                  │ │                   │  │
│  └────────────────────────────────┘ └───────────────────┘  │
│                                                             │
│  ┌─ 最近事件 ────────────────────────────────────────────┐ │
│  │ 2h ago  · admin@acme 创建了订阅                       │ │
│  │ 1d ago  · 部署 codocs-prod 通过连通性检查              │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**规范**：
- **实体头永远固定 4 件套**：图标 + 主名（最大字段） + 状态 Badge + 主操作。次要信息（创建时间、ID）放第二行小字。
- **Tabs 数量上限 6**——超过就拆模块
- **每个 Tab 是独立 child route**：`/admin/tenants/:code/overview`，可深链
- **Overview tab 是仪表盘**：左半"信息卡片"，右半"关键指标"，下半"最近事件 timeline"
- **其它 tab 是该维度的子列表**（如 Deployments tab 内嵌一张迷你列表）
- **编辑入口**：tab 内就近的 ✏️ 图标，点击进 `/[id]/edit`（或 inline edit 单字段）

**Nuxt UI V4 组件**：`UCard` + `UTabs` + `UBadge` + `UButton` + `UDropdownMenu` + `UTimeline`

### 4.3 Create Template（创建页）

**职责**：让用户一次完成新建。**不用 modal/drawer**，因为创建涉及多字段+校验。

两种变体：

**a) 简单创建（≤ 5 字段）**：单页表单
```
┌─────────────────────────────────────────────────────────────┐
│ Roles > 创建角色                                            │
├─────────────────────────────────────────────────────────────┤
│  角色编码 *  [____________________]  唯一标识，仅小写字母  │
│  角色名称 *  [____________________]                         │
│  描述        [____________________]                         │
│  来源        ( ) 自建  (●) 继承自系统角色 [aims:pm ▼]      │
│                                                             │
│                              [取消]  [创建]                 │
└─────────────────────────────────────────────────────────────┘
```

**b) 复杂创建（多步/多源）**：Wizard
```
┌─────────────────────────────────────────────────────────────┐
│ Applications > 从 GitLab 导入                               │
├─────────────────────────────────────────────────────────────┤
│ 1 选择仓库 ─── 2 解析 manifest ─── 3 确认应用 ─── 4 完成    │  ← 步骤条
├─────────────────────────────────────────────────────────────┤
│   仓库地址 *  [https://gitlab.../aims]  [验证]              │
│   Release    [v1.2.0 ▼]  ← 从 release 列表加载              │
│                                                             │
│                              [取消]      [下一步 →]         │
└─────────────────────────────────────────────────────────────┘
```

**规范**：
- **左对齐字段标签**，必填用 `*`
- **必填项即时校验**，提交前聚合错误摘要置顶
- **取消按钮在左**、**主操作在右**（与列表页主操作位置一致）
- **Wizard 用 `UStepper`**，步骤可回退但不能跳跃

### 4.4 Wizard / Onboarding Template

特殊场景（新租户开通），**整页占满**，左侧不再是导航而是步骤条：

```
┌─────────────────────────────────────────────────────────────┐
│ ACME Corp 开通                                  保存草稿 ↺  │
├─────────┬───────────────────────────────────────────────────┤
│         │  步骤 2/5：选择订阅计划                            │
│ ✓ 1 企业│                                                    │
│ ● 2 计划│  ( ) Starter   ¥XX/年    协同 + 文档 + 项目        │
│ ○ 3 登录│  (●) Pro       ¥XX/年    + 资产 + 经营             │
│ ○ 4 域名│  ( ) Advanced  ¥XX/年    + 代码分析 + 高级审计      │
│ ○ 5 部署│                                                    │
│         │  附加说明：[___________________________]            │
│         │                                                    │
│         │                          [← 上一步] [下一步 →]    │
└─────────┴───────────────────────────────────────────────────┘
```

**规范**：
- **步骤可回退**（已完成步骤显 ✓ 可点）
- **未完成的下游步骤灰显且不可点**
- **每步自动保存** 到 `tenant_onboarding_steps.step_payload_json`
- **离开页面前提示** 未保存内容
- **完成后跳 `/dashboard`** 主页

---

## 5. 各实体页面详细规格

### 5.1 Admin · Tenants

**路由**：
- `/admin/tenants` 列表
- `/admin/tenants/new` 创建（手动建租户，多用于试用/演示）
- `/admin/tenants/:code` 详情

**列表字段**：
| 字段 | 类型 | 备注 |
|---|---|---|
| Name | 文本+图标 | 主标识，点击进详情 |
| Status | Badge | active/pending/suspended/terminated |
| Plan | 文本 | 来自 tenant_subscriptions.plan_code |
| Onboarding | Badge | onboarding_stage（未完成才显示）|
| Apps | 数字 | 已激活应用数 |
| Last Activity | 相对时间 | 最近一次心跳/审计 |
| Actions | `…` | 暂停 / 终止 / 复制 ID |

**详情 tabs**：
1. **Overview**：组织信息卡 + 关键指标（活跃 deployment、最近 7 天 heartbeat 健康度） + 最近事件 timeline
2. **Subscription**：当前 plan + 应用 entitlements 列表 + 续费/退订入口
3. **Deployments**：本租户所有 deployment 的迷你列表（tenant_code + app_code 过滤）
4. **Members**：tenant_account_memberships 列表 + 邀请新成员
5. **Audit**：本租户的 platform_audit_logs（target_tenant_code 过滤）

### 5.2 Admin · Applications

**路由**：
- `/admin/applications` 列表
- `/admin/applications/new` 从 GitLab 导入向导（4 步）
- `/admin/applications/:code` 详情

**列表字段**：
| 字段 | 备注 |
|---|---|
| Code/Name | aims / 研发项目 |
| Service Role | Badge: business_app / directory_runtime / supporting_service |
| Latest Release | release_version + status（draft/released） |
| Latest Manifest | seq#X · 时间 |
| Subscribers | 订阅该 app 的租户数 |
| Status | active/suspended |

**详情 tabs**：
1. **Overview**：应用基本信息 + 当前 latest_release + 健康指标
2. **Releases**：版本列表（最重要的 tab！）
   - 列：version / status (draft→ready→released→deprecated) / manifest_seq / 创建时间 / 操作
   - 主操作：从 GitLab 拉取新 release（顶部 + 按钮）
   - 行操作：标记 ready / 发布 / 标记 deprecated
3. **Manifests**：所有 manifest 历史（按 seq 倒序），点击看 JSON
4. **Resources**：当前 latest manifest 解析的资源/动作列表
   - 树状或表格：resource → actions → requires_grant 开关
   - 主操作：批量标记"无需授权"（修改 requires_grant）
5. **Settings**：应用元信息（home_url、callback_url、logout_url、repo_url、service_role 等），可编辑；这些是应用默认值

租户侧 `/dashboard/applications` 负责维护 deployment 级运行地址：

- `runtimeEndpoint`：当前租户访问该应用的最终 URL，生成 policy bundle 时下发为 `applications.homeUrl`。
- `callbackUrl`：当前租户该应用的 OIDC callback 覆盖项；默认按最终 `homeUrl + /api/auth/oidc-callback` 生成，只有特殊回调路由才需要填写。

### 5.3 Admin · Plans

**路由**：
- `/admin/plans` 列表
- `/admin/plans/new`
- `/admin/plans/:code` 详情

**详情 tabs**：
1. **Overview**：基本信息 + 当前订阅租户数
2. **Apps**：plan_apps 双区展示（左 core、右 business），可拖拽调整 sort_order，可锁定 release（pin_release_id）
3. **Capabilities**：计划开放的 feature 能力点
4. **Subscribers**：订阅该计划的租户列表

### 5.4 Admin · System Roles

**路由**：
- `/admin/system-roles`
- `/admin/system-roles/:code` 详情

**详情 tabs**：
1. **Permissions**：该角色拥有的 manifest action 清单（manifest_action_id JOIN 出 action_code）
2. **Used by Templates**：被哪些 system_template 引用
3. **Used by Tenants**：被哪些租户继承（tenant_roles.source_role_code）

### 5.5 Dashboard · Subscription

**单页详情**（无列表，因为只有一条 active 主订阅）：

```
┌─────────────────────────────────────────────────────────────┐
│ 订阅                                       [升级计划]       │
├─────────────────────────────────────────────────────────────┤
│ 📦 Pro 计划                              ● Active           │
│ 订阅号 SUB-20260412-XXX · 自 2026-04-12 起                  │
│                                          [续费] [操作 ▼]    │
├─────────────────────────────────────────────────────────────┤
│ 包含的应用                                                  │
│                                                             │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│ │ 🏗 console │ │ 👥 account  │ │ ⚡ workflow │   核心       │
│ │ v1.2.0      │ │ v3.4.1      │ │ v2.1.0      │            │
│ │ [配置 →]    │ │ [配置 →]    │ │ [配置 →]    │            │
│ └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                             │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│ │ 🤝 align    │ │ 📄 codocs   │ │ 🚀 aims     │   业务       │
│ │ v1.0.0  ⚠  │ │ v2.3.0  ↑v3│ │ v4.5.0      │            │
│ │ [配置 →]    │ │ [升级 →]    │ │ [配置 →]    │            │
│ └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

应用卡片 = 一张 `UCard`，包含：
- 应用图标 + 名称
- 当前部署版本 + 升级提示（target_release_id ≠ reported_app_version 时）
- "配置" 按钮跳 `/dashboard/apps/:code`

### 5.6 Dashboard · App Detail

**路由**：`/dashboard/apps/:code`

**Tabs**：
1. **Overview**：应用基本信息 + 当前部署状态
2. **Deployment**：连通性 / endpoint / heartbeat 摘要
3. **Credentials**：当前 client_id + secret 引用（显示 *** + 复制按钮 + 重新生成）
4. **Upgrade**：可用新版本（从 platform_app_releases status='released' 取） + "升级" 按钮（触发 secret 轮换）

### 5.7 Dashboard · Roles

**路由**：
- `/dashboard/roles` 列表
- `/dashboard/roles/new`
- `/dashboard/roles/:code`

**列表字段**：role_code / role_name / source（custom / 继承自 system role / overridden）/ 成员数 / 应用范围

**详情 tabs**：
1. **Permissions**：该角色拥有的资源×动作（按 manifest_action_id 关联）
   - 树状：app → resource → action 勾选
2. **Scopes**：数据范围规则（tenant_role_scopes）
3. **Members**：被授予该角色的 subjects 和 accounts

### 5.8 Dashboard · Subjects

**路由**：
- `/dashboard/subjects` 列表（按 subject_type tab：用户 / 部门 / 岗位）
- `/dashboard/subjects/:id`

**详情 tabs**：
1. **Overview**：基本信息 + 父级
2. **Identities**：身份源映射（tenant_subject_identities）
3. **Roles**：分配的角色（直接 + 模板继承 + override）

---

## 6. 共用组件规范

### 6.1 EntityHeader（实体头组件）

```vue
<EntityHeader
  :icon="..."
  :title="..."
  :subtitle="..."
  :status="{ value: 'active', label: 'Active' }"
  :primary-action="{ label: '编辑', onClick: ... }"
  :menu-items="[...]"
/>
```

强制规范：图标在左、主名最大、状态 Badge 跟在主名右侧、操作恒定在右上。

### 6.2 StatusBadge 颜色语义

| 状态语义 | Nuxt UI V4 color | 圆点颜色 | 示例值 |
|---|---|---|---|
| 成功/活跃 | `success` | 🟢 | active / passed / approved / released |
| 进行中 | `info` | 🔵 | pending / running / in_progress / draft |
| 警告 | `warning` | 🟡 | suspended / paused / degraded / permissions_pending |
| 失败/危险 | `error` | 🔴 | failed / rejected / revoked / expired / terminated |
| 中性 | `gray` | ⚪ | deprecated / archived / unknown |

**禁止**用 `red`/`green`/`blue` 这类原生色名（违反 Nuxt UI V4 规范）。

### 6.3 Breadcrumb（面包屑）

恒定在内容区顶部、实体头之上。最后一级是当前页（不可点击）。

```
租户 / acme-corp / 订阅
^^^^   ^^^^^^^^^   ^^^^
可点击  可点击      当前页
```

### 6.4 EmptyState（空状态）

```
            [图标]
        还没有任何应用

   从 GitLab 导入第一个应用，开始接入流程

         [+ 从 GitLab 导入]
```

每个列表页都必须有，**不要只是空白表格**。

### 6.5 ConfirmDialog（危险确认）

删除/暂停/吊销等操作必须二次确认，且要求输入实体名匹配：

```
┌──────────────────────────────────────┐
│ 确定终止租户 ACME Corp？              │
│                                      │
│ 此操作不可逆。所有部署将停止服务。    │
│                                      │
│ 输入 "acme-corp" 确认：               │
│ [_________________]                  │
│                                      │
│             [取消]  [终止]            │
└──────────────────────────────────────┘
```

---

## 7. 路由迁移矩阵

| 当前路由/文件 | 新路由 | 改造动作 |
|---|---|---|
| `/admin/applications/index.vue` | 保持 | ✅ 已是 list-detail-create 三件套 |
| `/admin/applications/new.vue` | 保持 | ✅ |
| `/admin/applications/[id].vue` | `/admin/applications/[code].vue` | 改用 app_code 做路由 key（更稳定）|
| `/admin/tenants.vue` | `/admin/tenants/index.vue` + `/admin/tenants/[code].vue` + `/admin/tenants/new.vue` | **拆分** |
| `/admin/subscriptions.vue` | 删除 | 合入 tenant 详情的 Subscription tab |
| `/admin/deployments.vue` | 删除 | 合入 tenant 详情的 Deployments tab |
| `/admin/licenses.vue` | 删除 | 合入 tenant 详情的 Subscription tab（license 是 subscription 派生）|
| 新增 | `/admin/plans/*` | **新建**（替代 plan 的 modal 配置）|
| 新增 | `/admin/system-roles/*` | **新建** |
| `/dashboard/applications.vue` | `/dashboard/subscription.vue` + `/dashboard/apps/[code].vue` | **拆分** |
| `/dashboard/users.vue` | `/dashboard/members/*` | 重命名 + 拆分 list/detail |
| `/dashboard/subjects.vue` | `/dashboard/subjects/*` | 拆分 list/detail |
| `/dashboard/roles.vue` | `/dashboard/roles/*` | 拆分 list/new/detail |
| `/dashboard/templates.vue` | `/dashboard/templates/*` | 拆分 list/detail |
| `/dashboard/onboarding.vue` | 保持 | ✅ 用于"恢复当前企业未完成的开通" |
| 新增 | `/dashboard/onboarding/new-tenant.vue` | **新建** 创建第二/第三家企业的入口 |
| 新增 | `/dashboard/profile.vue` | 新建（企业基本信息）|
| 新增 | `/dashboard/auth.vue` | 新建（IdP 配置）|
| 新增 | `/dashboard/domains.vue` | 新建（主域+应用子域）|
| 新增 | `/dashboard/billing.vue` | 新建（订单/发票/付款）|

---

## 8. 实现技术要点

### 8.1 Nuxt 4 嵌套路由

详情页 tabs 用 child routes 实现：

```
pages/admin/tenants/[code]/
  ├── index.vue         → /admin/tenants/:code（重定向到 overview）
  ├── overview.vue
  ├── subscription.vue
  ├── deployments.vue
  ├── members.vue
  └── audit.vue
```

布局：在 `pages/admin/tenants/[code].vue` 里渲染 `<EntityHeader />` + `<UTabs>` + `<NuxtPage />`。

### 8.2 URL Query 同步筛选

列表页所有筛选状态都映射到 URL：
```ts
const route = useRoute()
const router = useRouter()
const filters = computed({
  get: () => parseFilters(route.query),
  set: (v) => router.replace({ query: serializeFilters(v) })
})
```

### 8.3 共用基础组件

> ⚠️ **platform 模块不依赖 `@hzy/foundation`**，是独立 Nuxt 应用。所有共用组件落 platform 本地路径。

把 §6 列出的组件都做成 platform 自己的 console 通用件：
- `EntityHeader.vue`
- `StatusBadge.vue`（封装 UBadge + 颜色映射）
- `EmptyState.vue`
- `ConfirmDialog.vue`
- `BreadcrumbAuto.vue`（基于 route meta 自动生成）

放 `platform/app/components/console/common/` 下，admin 与 dashboard 双端共用。
现有 `platform/app/components/console/*Manager.vue` 是要被替代/删除的旧件，不要混在 common 目录里。

### 8.4 路由元信息驱动导航

```ts
definePageMeta({
  layout: 'console',
  scope: 'admin',          // admin | dashboard
  navGroup: 'tenants',     // 用于侧边栏高亮
  breadcrumb: { label: '租户列表' }
})
```

侧边栏组件读 `route.meta.navGroup` 高亮当前项；面包屑读 `route.meta.breadcrumb` 自动生成。

---

## 9. 落地优先级（建议三轮）

### 第 1 轮：基础设施 + Admin·Applications（已是模板）
1. 实现 5 个共用组件（§6）
2. 重构 ApplicationDetail 按 §4.2 标准（拆 tabs 为 child route）
3. 验证模板可用性

### 第 2 轮：Admin 其它模块
1. Tenants 拆分（替代当前 manager）
2. Plans / System Roles 新建
3. 删除 deployments / subscriptions / licenses 顶层路由

### 第 3 轮：Dashboard 全部
1. Subscription / Apps 拆分
2. Members / Subjects / Roles / Templates 拆分
3. 新增 Profile / Auth / Domains / Billing

每轮结束 `pnpm typecheck` + 浏览器实际跑一遍主流程。

---

## 10. 不在本设计内（后续讨论）

- 多语言/i18n 策略
- 暗色主题
- 移动端适配（短期 desktop-only）
- 无障碍审计（WCAG AA 是目标但首期不做专项）

---

## 11. 实施状态（2026-06）

Dashboard 端整套重设计已落地（直接改 `.vue` 源码）。下面记录实际实现与本方案的对应关系、关键决策与已知偏差，供后续维护对齐代码现状。

### 11.1 已落地页面

- **管理组件**（admin/dashboard 经 `scope` prop 共用，本轮仅 dashboard 端渲染）：成员 `UsersManager`、主体目录 `SubjectsManager`、应用中心 `ApplicationCatalog`、角色授权 `AuthorizationsManager`。
- **整页**：工作台首页 `index`、部署管理 `deployments`、访问观测 `observability`、订阅计划 `subscription-plans`、开通向导 `onboarding`、登录 `login`、注册 `register`。

### 11.2 标题区标准（EntityHeader 的落地形态）

§6.1 EntityHeader 未做成独立组件，落地为统一的 **`console-hero` 结构**：

- panel body 用 `:ui="{ body: 'console-page' }"`（`console-page` 含灰底 `#f8fafc` + gap/padding）。
- body 顶部 `<section class="console-hero">` 内：`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`，左侧 `<h1 class="text-xl font-semibold text-highlighted">`（20px）+ `<p class="mt-1 text-sm text-muted">` 副标题，右侧放 badge/操作按钮。
- 内容卡片在标题**下方**；H2 区块小标题用 `text-lg`（18px）。
- **两条硬约束**：① 标题不放进 `UCard` 的 `#header`（会被卡片边框框住，显得"标题在卡片里"）；② panel body 必须用 `console-page` 灰底，否则标题落在白底上紧挨白卡片会糊成一体。

### 11.3 语义色

§6.2 语义色全面采用：`text-highlighted/muted/dimmed`、`bg-default/muted/elevated`、`border-default`、`divide-default`、`success/warning/error/info`。dashboard 全端（含 auth 页）已清除硬编码 `slate/sky/lime/rose`，并删除英文 eyebrow（如 Tenant Dashboard/Onboarding/Step）。废弃 `console-title`（clamp 24-32px + 硬编码 slate）、`console-eyebrow`、`.page-h` CSS。

### 11.4 关键产品决策

- **访问观测留在 dashboard 作租户自服务**（不移 admin）：租户管理员看自己企业各应用的访问量/错误率/慢请求 + 自调采样策略。数据按 `tenantCode` 隔离、API 为 `tenant-admin` scope。未配置外部观测服务（`HZY_OBSERVABILITY_API_URL` 空）时前端显示友好提示，不报红。
- **订阅/续订**：下单即开通（直付与对公转账一致）、到期日 = 下单 + 30 天 + 1 年、续订 `GREATEST(到期日, now) + 1 年`、随时可续订；到期前 30 天前端提示。

### 11.5 已知偏差 / 未完成

- observability 的 3 个明细表暂用原生 `<table>`（只换语义色），未替换为 `UTable`。
- 登录页未做"忘记密码"：缺后端 forgot/reset-password API，属需后端的新功能，另立项。
- §6.5 ConfirmDialog 的"输入实体名匹配"未强制；危险操作统一用 `UModal` 二次确认。
- §3/§7 的部分路由拆分（List/Detail 拆 child route、新增 Profile/Domains/Billing 等）不在本轮范围。

### 11.6 回归

`pnpm lint` + `pnpm typecheck` 全绿（2026-06-19）。本地视觉验证需起 platform dev（:3011）+ 登录（生产 huizhi.yun 看不到本地改动）。
