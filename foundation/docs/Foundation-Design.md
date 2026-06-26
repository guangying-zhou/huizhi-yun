# Foundation Layer 设计文档

> 汇智云平台基础共享层，包名 `@hzy/foundation`

## 1. 背景与目标

### 1.1 问题

汇智云 monorepo 包含 7+ 个独立 Nuxt 4 模块（account、aims、codocs、workflow、altoc、assets、insights），当前各模块间**无代码共享机制**：

- composables（useAuth、useHeartbeat、usePermissions 等）在每个模块中复制一份
- 通用组件（DeptTreeSelector、AppLauncher 等）在 6 个模块中完全重复
- 类型定义、中间件、插件、Pinia Store 均各自维护副本
- 跨模块嵌入只能通过 iframe（如 Codocs 编辑器嵌入 Aims）

### 1.2 目标

1. 建立统一的 **Nuxt Layer**（`foundation`）作为平台基础层，消除重复代码
2. 构建可嵌入的 **WorkflowPanel** 组件，支持任意业务模块内联审批流程
3. 为后续模块间共享（通用组件、通用服务）奠定基础设施

### 1.3 原则

- **渐进迁移**：先在 aims + workflow 试点验证，再推广到其他模块
- **本地优先**：Nuxt Layer 中本地文件优先于 Layer 文件，各模块可覆盖
- **业务与流程解耦**：WorkflowPanel 只负责流程操作，不关心业务内容
- **同应用优先直渲染**：同一应用内优先使用本地只读视图，跨应用再使用 iframe
- **流程引擎权威**：前端不本地推断可执行操作，所有按钮和状态以流程引擎返回为准
- **唯一业务动作键**：流程唯一识别采用 `app_code + resource_code + biz_id + action_code`
- **Codocs 编辑器保持 iframe**：Milkdown+Yjs 依赖过重，不适合放入共享层

## 2. 架构设计

### 2.1 目录结构

```
huizhi-yun/
├── pnpm-workspace.yaml        # pnpm 工作区配置
├── package.json               # 工作区根（便捷脚本 + overrides）
├── .npmrc                     # shamefully-hoist=true
│
├── foundation/                # Nuxt Layer（@hzy/foundation）
│   ├── nuxt.config.ts         # Layer 配置
│   ├── package.json           # name: @hzy/foundation
│   ├── docs/
│   │   └── Foundation-Design.md   # 本文档
│   ├── app/
│   │   ├── composables/       # 共享组合式函数
│   │   │   ├── useAuth.ts         # 统一认证
│   │   │   ├── useHeartbeat.ts    # 心跳上报         ✅ 已迁移
│   │   │   ├── useCookieOptions.ts# Cookie 工具
│   │   │   ├── usePermissions.ts  # 权限检查
│   │   │   ├── useAvatar.ts       # 头像解析         ✅ 已迁移
│   │   │   ├── useAccount.ts      # Account API 封装
│   │   │   └── useWorkflow.ts     # 流程 API 封装（新）
│   │   ├── components/        # 共享组件
│   │   │   ├── DeptTreeSelector.vue   # 部门树选择器   ✅ 已迁移
│   │   │   ├── AppLauncher.vue        # 应用切换器     ✅ 已迁移
│   │   │   ├── WorkflowPanel.vue      # 流程面板（新）
│   │   │   ├── WorkflowTimeline.vue   # 审批时间线（新）
│   │   │   └── WorkflowBadge.vue      # 流程状态标签（新）
│   │   ├── middleware/        # 共享中间件
│   │   │   └── auth.global.ts     # 统一认证中间件
│   │   ├── plugins/           # 共享插件
│   │   │   └── error-handler.client.ts  ✅ 已迁移
│   │   ├── stores/            # 共享 Pinia Store
│   │   │   └── account.ts        # 用户/部门/项目缓存  ✅ 已迁移
│   │   └── types/             # 共享类型定义
│   │       ├── account.ts         # Account 类型     ✅ 已迁移
│   │       └── workflow.ts        # Workflow 类型（新）
│   └── server/
│       ├── api/
│       │   └── workflow-proxy/    # Workflow 代理路由
│       │       └── [...path].ts
│       └── utils/
│           └── accountApi.ts      # Account API 调用工具
│
├── aims/        (extends @hzy/foundation)  ← 试点模块
├── workflow/    (extends @hzy/foundation)  ← 试点模块
├── account/     (待试点验证后纳入)
├── codocs/      (待试点验证后纳入)
├── altoc/       (待试点验证后纳入)
├── assets/      (待试点验证后纳入)
└── insights/    (待试点验证后纳入)
```

### 2.2 工作区配置

**pnpm-workspace.yaml**：
```yaml
packages:
  - 'foundation'
  - 'aims'
  - 'workflow'
  # 待试点验证后纳入：account, codocs, altoc, assets, insights, nuxt-template
```

**各模块接入方式**：

1. `package.json` 添加依赖：
```json
{
  "dependencies": {
    "@hzy/foundation": "workspace:*"
  }
}
```

2. `nuxt.config.ts` 添加 extends：
```typescript
export default defineNuxtConfig({
  extends: ['@hzy/foundation']
})
```

### 2.3 类型共享方案

Nuxt Layer 的 `app/types/` 不会自动被 `~/types/` 路径解析。采用 **re-export 模式**：

```
foundation/app/types/account.ts    ← 类型定义源（唯一维护点）
aims/app/types/account.ts          ← re-export: export type { ... } from '@hzy/foundation/app/types/account'
workflow/app/types/account.ts      ← re-export: 同上
```

composables 和 components 无需此操作，Nuxt 自动导入。

### 2.4 已解决的技术问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| h3 版本冲突 | workspace hoisting 导致多版本共存 | `package.json` 中 `pnpm.overrides` 统一 h3 版本 |
| `@nuxt/fonts` 报错 | `provider: 'none'` 在新版不再支持 | 改为 `fonts: false` 彻底禁用 |
| `~/types/account` 找不到 | Layer 类型不走 `~/` 路径 | 模块中 re-export from `@hzy/foundation` |
| `~/composables/useAvatar` 显式导入失败 | 文件已迁移到 Layer | 改为 Nuxt 自动导入（删除显式 import） |
| UDashboardSidebar body `overflow-visible` | 内部滚动区域不生效 | 改为 `overflow-hidden` |
| 头像 404（模块无 OSS） | 各模块缺少 `/api/oss/avatar` | 头像统一由 Account 模块提供，`resolveAvatarSrc` 拼 Account URL |

### 2.5 头像统一方案

头像图片统一由 Account 模块（端口 3000）的 `/api/oss/avatar?path=xxx` 接口提供。

`resolveAvatarSrc()` 逻辑：
1. 完整 URL / data / blob → 直接返回
2. OSS 相对路径 → 拼 `{accountUrl}/api/oss/avatar?path=xxx`
3. `accountUrl` 从 `runtimeConfig.public.accountUrl` 读取

各模块 `nuxt.config.ts` 需配置：
```typescript
public: {
  accountUrl: process.env.HZY_ACCOUNT_API_URL || 'http://localhost:3000'
}
```

### 2.6 布局共享方案

**LayoutSidebar** 组件封装了整个页面框架（应用层入口 + 当前应用侧边栏 + 顶部导航栏），采用 slot 模式：

```
┌────────┬──────────────┬──────────────────────────────────┐
│AppRail │ Logo         │ #navbar-left   AppLauncher User  │
│应用层  ├──────────────┤              #navbar-right        │
│入口    │ #menu        ├───────────────────────────────────┤
│        │              │                                   │
│        ├──────────────┤        #default (页面内容)         │
│        │ #extra       │                                   │
│        │ (可滚动)     │                                   │
│        ├──────────────┤                                   │
│        │ #utility     │                                   │
│        ├──────────────┤                                   │
│        │ 折叠btn      │                                   │
└────────┴──────────────┴───────────────────────────────────┘
```

**Slots：**

| 插槽 | 参数 | 用途 |
|------|------|------|
| `#app-rail` | `{ currentAppCode }` | 应用层入口；默认由 Foundation AppRail 渲染 |
| `#menu` | `{ collapsed, menuOverlayEnabled, navigationUi }` | 主菜单（固定不滚动） |
| `#extra` | 同上 | 额外内容区域（独立滚动，如项目列表） |
| `#utility` | 同上 | 底部工具菜单（固定不滚动） |
| `#navbar-left` | — | 顶部导航栏左侧（如项目切换器） |
| `#navbar-right` | — | 顶部导航栏右侧额外内容（AppLauncher + UserMenu 已内置） |
| `#default` | — | 页面主内容区域 |

**内置组件：**
- AppRail（左侧应用层入口，桌面端推荐启用）
- AppLauncher（导航栏右侧）
- UserMenu（导航栏右侧）
- 折叠/展开按钮（侧边栏底部）
- Logo + 应用名称（侧边栏顶部，通过 useAppInfo 获取）

**应用层入口模式：**

```ts
type AppNavigationMode = 'rail' | 'popover' | 'none'
```

- `rail`：桌面端左侧显示 AppRail，点击应用同窗口跳转到该应用 `homeUrl`。
- `popover`：仅保留顶栏 AppLauncher，适合窄屏、嵌入页或暂不启用统一壳层的模块。
- `none`：不显示应用层入口，适合公开页、登录页、iframe 嵌入页或特殊全屏页面。

AppRail 数据源与 AppLauncher 保持一致，统一读取当前应用本地 `/api/user/applications`。该接口优先转发 Console 的当前用户应用列表；不可用时使用 Console runtime config 的应用入口投影；本地开发模式下再回退 Foundation 本地开发应用目录，并且仅在本地 policy bundle 与 Console runtime bundle 版本一致时才继续做迁移期可见性过滤。应用列表按 Platform 下发的 `sortOrder` 升序展示。当前应用高亮由 `runtimeConfig.public.appCode` 判断。应用入口图标使用 manifest / platform application 的 `icon` 字段，优先渲染 `i-lucide-*` 等 Iconify 图标名；AppRail 会在图标下方展示去掉 `汇智云` 前缀后的短名称，避免与侧边栏 logo / 应用名称重复。特殊壳层不要复制 AppRail，可通过 `fixedItems` 注入本地入口，通过 `appOverrides` 覆盖 URL / 图标 / 可见性，通过 `hiddenAppCodes` 隐藏特定应用。

**aims 两级菜单**：通过 `#menu` slot 内的条件渲染实现，LayoutSidebar 本身不感知。

## 3. 迁移内容清单

### 3.1 Phase 1：100% 重复代码（已完成 ✅）

| 文件 | 来源 | 改动说明 |
|------|------|----------|
| `composables/useHeartbeat.ts` | aims/workflow 等 5 模块 | appCode 改为自动读取 `runtimeConfig.public.appName` |
| `composables/useAvatar.ts` | aims/workflow 等 6 模块 | 直接迁移，各模块删除显式 import |
| `components/DeptTreeSelector.vue` | 6 模块完全相同 | 直接迁移 |
| `components/AppLauncher.vue` | 6 模块 95% 相同 | 统一为 `align: 'end'` 版本 |
| `plugins/error-handler.client.ts` | 6 模块完全相同 | 直接迁移 |
| `types/account.ts` | 6 模块完全相同 | 源在 foundation，模块中 re-export |

### 3.2 Phase 2：规范化多变体代码（已完成 ✅）

| 文件 | 变体数 | 规范化策略 |
|------|--------|-----------|
| `composables/useAuth.ts` | 2 | 采用 codocs 增强版（含 localStorage 清理、wecom 防重登） |
| `composables/usePermissions.ts` | 3 | 参数化 appCode，从 `runtimeConfig.public.appName` 读取 |
| `composables/useCookieOptions.ts` | 2 | 采用 codocs SSR 增强版（支持服务端请求头提取域名） |
| `composables/useAccount.ts` | 2 | 采用 aims 超集版本（含 BusinessDomains、AccountUsers） |
| `composables/useDashboard.ts` | 各模块相同 | 直接迁移（侧边栏状态、快捷键、通知） |
| `composables/useAppInfo.ts` | 各模块相同 | 直接迁移（应用名称/logo 从 Account 获取） |
| `composables/useAvatar.ts` | — | 改为指向 Account 模块头像接口 |
| `stores/account.ts` | 各模块相同 | 直接迁移，添加显式类型标注 |
| `components/UserMenu.vue` | 3 | 统一版本，cookie 读取改用 useCookieOptions |
| `components/LayoutSidebar.vue` | — | **新开发**：V2 布局壳子（折叠/展开/悬停预览 + 顶部导航栏） |

`auth.global.ts` 与统一 CAS 登录/回调路由已迁入 Foundation；业务模块仅在确有特殊需求时覆盖。

**特殊处理**：account 模块保留自有 auth 中间件（它是 Account API 本身）。

### 3.3 Phase 3：WorkflowPanel 组件套件（待实施）

详见第 4 节。

### 3.4 Phase 4-5：集成验证与文档（待实施）

- aims 中接入 WorkflowPanel（项目立项场景）
- 端到端测试：发起 → 审批 → 查询/回调 → 项目状态变更
- 全模块 typecheck + lint
- 更新 CLAUDE.md

## 4. 审批中心与流程组件设计

### 4.1 整体架构

审批能力通过 foundation 提供，各模块继承后自动获得审批中心页面。审批人**不离开当前应用**即可完成审批操作。

```
┌─────────────────────────────────────────────────────────────┐
│                     审批体系架构                              │
│                                                               │
│  aims 内部审批中心          workflow 全局审批中心              │
│  /approval/tasks            /approval/tasks                   │
│  (app_code=aims)            (所有 app_code)                   │
│       │                          │                            │
│       └──────────┬───────────────┘                            │
│                  ▼                                             │
│        统一流程处理页面 /approval/tasks/[taskId]               │
│  ┌──────────────────────┐  ┌──────────────────────────┐      │
│  │ 左侧：业务详情        │  │ 右侧：流程操作面板        │      │
│  │                      │  │ WorkflowPanel             │      │
│  │ 同应用：本地只读视图  │  │ - 时间线                  │      │
│  │ 跨应用：iframe embed │  │ - 当前节点/能力集         │      │
│  │                      │  │ - 引擎允许的操作按钮       │      │
│  └──────────────────────┘  └──────────────────────────┘      │
│                                                               │
│  业务页面仅显示状态标签 + 跳转链接（不嵌入审批操作）           │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 核心设计原则

1. **审批与业务解耦**——业务页面不做审批操作，只显示 WorkflowBadge 状态标签
2. **同应用优先直渲染**——当前应用内若已有只读业务视图，则直接渲染，不额外引入 iframe
3. **跨应用统一 embed**——跨应用审批场景统一通过 iframe 加载业务模块提供的 embed 页面
4. **流程引擎权威**——可见状态、可执行动作、是否允许重新提交/撤销/审批，全部由 workflow API 返回
5. **各模块自带审批中心**——foundation 提供页面，各模块继承后按 `app_code` 自动过滤

### 4.3 唯一识别与并发规则

流程相关能力统一围绕一个**业务动作键**展开：

```text
biz_key = app_code + resource_code + biz_id + action_code
```

字段语义：
- `app_code`：业务应用编码，如 `aims`
- `resource_code`：实体名称编码，如 `project`、`milestone`
- `biz_id`：实体编码/业务主键
- `action_code`：动作名称编码，如 `initiation`、`change`

约束规则：
- 同一个 `biz_key` 在任一时刻**最多只允许一个运行中实例**（`running` / `suspended`）
- 同一个业务对象可存在多个历史实例，但必须按 `action_code` 维度区分
- 驳回后允许再次提交，但该操作定义为 **resubmit**：复用原实例，不创建新实例
- `resubmit` 后原实例恢复为 `running`，并在同一实例下追加新的任务轮次和 `resubmit` 动作记录
- 再次提交前必须保证不存在同 `biz_key` 的其他活动实例
- `WorkflowBadge`、审批中心过滤、回调、状态查询都必须显式携带 `biz_key` 维度，禁止只按 `resource_code + biz_id` 查询

实现要求：
- workflow 创建实例前检查是否已有同 `biz_key` 的活动实例，若存在则拒绝发起或转为重新提交
- workflow 查询接口统一支持 `app_code + resource_code + biz_id + action_code`
- 数据库索引从当前 `idx_biz(resource_code, biz_id)` 扩展为覆盖 `biz_key` 的组合索引
- `resubmit` 不得删除首轮审批记录；第一次审批的 `tasks/actions` 必须保留，作为同一实例的历史轨迹

### 4.4 Foundation 提供的内容

#### 页面

```
foundation/app/pages/approval/
  tasks.vue                    ← 审批中心（待办/已办/我发起的）
  tasks/[taskId].vue           ← 统一流程处理页面
```

- `tasks.vue`：按 `runtimeConfig.public.appName` 自动过滤本模块任务；workflow 模块不过滤（全局审批中心）
- `tasks/[taskId].vue`：左侧通过 `WorkflowBusinessView` 决定本地渲染或 iframe，右侧 WorkflowPanel 审批操作

#### 组件

| 组件 | 用途 |
|------|------|
| `WorkflowPanel.vue` | 流程操作面板，所有操作能力来自流程引擎返回的 capabilities |
| `WorkflowTimeline.vue` | 审批历史时间线 |
| `WorkflowBadge.vue` | 流程状态标签（用于业务页面，按 `biz_key` 查询） |
| `WorkflowTaskList.vue` | 待办/已办列表组件 |
| `WorkflowBusinessView.vue` | 业务详情容器，支持 `local` / `iframe` 两种渲染模式 |

#### Composable

| Composable | 用途 |
|------------|------|
| `useWorkflow.ts` | 流程 API 封装（prepare/submit/approve/reject/fetchByBiz/fetchCapabilities） |

### 4.5 业务模块的职责

每个业务模块需要：

**1. 提供同应用只读视图解析器（推荐）**

同应用场景下，业务模块可注册 `resource_code -> 只读组件/页面解析器`，供 `WorkflowBusinessView` 直接渲染。

特点：
- 不额外引入 iframe
- 直接复用本应用已有数据加载和只读 UI
- 仅在不增加额外复杂性的前提下启用

若模块暂时没有合适的只读视图，可跳过此能力，回退到 embed 方案。

**2. 提供 embed 页面（跨应用必需，同应用可回退）**

```
aims/app/pages/embed/[resourceCode]/[bizId].vue
```

嵌入页特点：
- 使用精简布局（无侧边栏、无导航栏）
- 只读模式，只展示业务信息
- 高亮本次变更内容（如里程碑变更前后对比）

例如：
```
aims/pages/embed/project/[bizId].vue        → 项目立项详情
aims/pages/embed/milestone/[bizId].vue      → 里程碑变更详情
aims/pages/embed/work-item/[bizId].vue      → 工作项详情
codocs/pages/embed/document/[bizId].vue     → 文档审批详情
```

**3. 在业务页面显示流程状态**

```vue
<!-- aims 项目详情页 -->
<div class="flex items-center gap-2">
  <h1>{{ project.name }}</h1>
  <!-- 只显示状态标签，点击跳转审批中心 -->
  <WorkflowBadge
    app-code="aims"
    resource-code="project"
    :biz-id="project.id"
    action-code="initiation"
  />
</div>
```

**4. 提供状态同步策略**

可选两种模式：
- **主动回调模式**：业务模块提供 `POST /api/v1/workflow-callback`，workflow 在终态时主动通知
- **查询拉取模式**：业务模块不接回调，由业务页面或后台任务主动调用 workflow 查询状态并更新本地业务状态

说明：
- 回调是**可选能力**，不是基础接入前置条件
- 若使用回调，业务模块必须实现签名校验、幂等和失败补偿
- 若不使用回调，业务模块必须明确在哪个时机执行状态拉取和落库

### 4.6 Embed URL 配置

`flow_action_defs` 表扩展 `embed_url_pattern` 字段：

```sql
ALTER TABLE flow_action_defs
  ADD COLUMN embed_url_pattern VARCHAR(500) COMMENT '业务详情嵌入URL模式';

-- 示例数据：
-- app_code=aims, resource_code=project, action_code=initiation
-- embed_url_pattern = '{app_base_url}/embed/project/{biz_id}'
--
-- app_code=codocs, resource_code=document, action_code=publish
-- embed_url_pattern = '{app_base_url}/embed/document/{biz_id}'
```

变量替换规则：
- `{app_base_url}`：从 workflow 的应用注册表或配置中获取模块基础 URL
- `{biz_id}`：流程实例的 biz_id
- `{resource_code}`：资源代码

补充说明：
- 该字段仅用于**跨应用展示**或同应用 fallback
- 同应用存在本地只读视图时，优先使用本地视图，不强制依赖 embed URL

### 4.7 WorkflowPanel 组件接口

WorkflowPanel 自身不决定能做什么操作。组件加载后必须向 workflow 获取流程详情和 `capabilities`，前端只负责渲染。

**输入模式：**

| 模式 | 入参 | 用途 |
|------|------|------|
| `task` 模式 | `taskId` | 审批中心处理任务 |
| `instance` 模式 | `instanceId` | 查看实例详情、已办详情 |
| `launch` 模式 | `launchPayload` | 在业务页面发起审批 |

约束：
- 三种模式三选一，不允许混传
- `launch` 模式仅负责发起，发起后跳转或切换到 `instance` 模式

**Props：**

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | `number` | 否 | `task` 模式使用 |
| `instanceId` | `number` | 否 | `instance` 模式使用 |
| `launchPayload` | `{ appCode, resourceCode, bizId, actionCode, bizTitle, bizContext?, callbackUrl? }` | 否 | `launch` 模式使用 |

**流程引擎返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `string` | 流程状态 |
| `current_node` | `number` | 当前节点 |
| `timeline` | `array` | 时间线数据 |
| `capabilities` | `object` | 当前用户在当前状态下允许的操作 |
| `business_view` | `object` | 业务视图信息，含 `mode/local/embed_url` |

`capabilities` 示例：

```json
{
  "can_approve": true,
  "can_reject": true,
  "can_delegate": false,
  "can_cancel": false,
  "can_resubmit": false,
  "can_comment": true
}
```

**Events：**

| 事件 | 载荷 | 触发时机 |
|------|------|----------|
| `@submitted` | `{ instanceId: number }` | 发起审批成功 |
| `@approved` | `{ taskId: number, instanceId: number }` | 审批通过 |
| `@rejected` | `{ taskId: number, instanceId: number }` | 审批驳回 |
| `@cancelled` | `{ instanceId: number }` | 撤销流程 |
| `@error` | `{ message: string }` | API 错误 |

**面板状态流转：**

| 状态 | 展示内容 |
|------|----------|
| 审批中（非审批人） | 时间线 + 当前节点高亮 + 只展示只读能力 |
| 审批中（是审批人） | 时间线 + 审批意见输入 + `capabilities` 允许的按钮 |
| 已通过 | 完整时间线 + 最终状态标记 |
| 已驳回 | 时间线 + 驳回原因 + 若 `can_resubmit=true` 则显示“重新提交” |

### 4.8 完整审批流转

```
1. 发起人
   在业务页面填写信息 → 点击"提交审批"
   → 调用 Workflow API 创建流程实例
   → workflow 以 biz_key 检查是否已存在活动实例
   → 不存在则创建，存在则拒绝或转重新提交流程

2. 审批人
   在本模块审批中心 /approval/tasks 看到待办
   → 点击任务 → 进入 /approval/tasks/[taskId]
   → 左侧优先本地只读视图，跨应用时使用 iframe embed
   → 右侧 WorkflowPanel 先请求任务详情和 capabilities
   → 用户执行引擎允许的审批操作

3. 状态同步
   流程到达终态
   → 若配置 callback_url，则 workflow 回调业务模块
   → 若未配置 callback_url，则业务模块通过查询接口拉取状态
   → 业务状态更新

4. 发起人
   在业务页面看到 WorkflowBadge 状态变更（已通过/已驳回）
```

补充说明：
- 首次发起使用 `submit`，创建新实例
- 驳回后的再次提交使用 `resubmit`，复用原实例
- 同一实例内必须保留第一轮审批过程的信息，包括提交、审批、驳回和重新提交记录

### 4.9 aims 审批场景示例

| 业务类型 | resource_code | action_code | embed 页面 | 审批关注点 |
|----------|--------------|-------------|-----------|-----------|
| 项目立项 | project | initiation | 项目基本信息、目标、资源、预算 | 可行性、资源匹配 |
| 里程碑变更 | milestone | change | 变更前后对比 | 影响范围、进度影响 |
| 需求评审 | requirement | review | 需求描述、验收标准 | 完整性、可测试性 |
| 任务完成确认 | work-item | complete | 任务详情、交付物 | 质量、完成度 |

### 4.10 Workflow 模块需新增/改造的 API

```
GET  /api/v1/instances/by-biz?app_code=X&resource_code=Y&biz_id=N&action_code=Z
     → 按 biz_key 查询流程实例（WorkflowBadge、业务状态同步使用）

GET  /api/v1/instances/[id]
     → 返回实例详情 + timeline + capabilities + business_view

GET  /api/v1/tasks/pending?app_code=X
     → 支持按 app_code 过滤待办（模块内审批中心使用）

GET  /api/v1/tasks/done?app_code=X
     → 支持按 app_code 过滤已办

GET  /api/v1/tasks/initiated?app_code=X
     → 支持按 app_code 过滤我发起的

GET  /api/v1/tasks/[id]
     → 返回任务详情 + 实例信息 + timeline + capabilities + business_view
```

接口改造要求：
- `tasks/[id]` 与 `instances/[id]` 的返回体都补充 `capabilities`
- `business_view` 由 workflow 根据 `app_code`、当前应用、`embed_url_pattern` 和业务模块注册信息综合返回
- `by-biz` 查询默认只返回当前活动实例；若无活动实例，可按参数决定是否返回最近历史实例

### 4.11 回调设计

回调能力保留，但降级为**可选同步机制**，不再作为唯一状态同步来源。

若启用回调，要求如下：
- 使用 Console service token 校验：`token_use=service`、目标 `aud`、`scope=workflow:callback`、来源应用 `workflow`
- payload 中携带完整 `biz_key`
- 回调处理必须幂等，按 `instance_id + status` 去重
- 回调失败不阻塞主流程，但 workflow 需记录失败日志并支持后续补偿

若不启用回调，业务模块必须：
- 在关键页面进入时查询 `by-biz`
- 或在后台任务中定时同步终态流程
- 明确本地业务状态字段与 workflow 状态的映射关系

### 4.12 Workflow 现有页面迁移方案

workflow 模块当前已存在：
- `/tasks`
- `/tasks/[id]`
- `/instances`
- `/instances/[id]`

迁移策略：
1. foundation 新增标准路由 `/approval/tasks`、`/approval/tasks/[taskId]`
2. workflow 先保留旧路由，对旧入口做别名或重定向适配
3. 通知链接、菜单入口、站内跳转逐步切换到新路由
4. 在 aims 试点稳定后，再把 workflow 自身页面逐步收敛到 foundation 版本
5. 最终保留兼容层一段时间，再决定是否下线旧路径

迁移期间要求：
- 旧深链接不失效
- 待办/已办/我发起的数据口径保持一致
- `tasks/[id]` 和 `/approval/tasks/[taskId]` 至少在一个版本周期内并存

## 5. 实施计划与进度

| 阶段 | 内容 | 状态 | 预计工时 |
|------|------|------|----------|
| Phase 0 | 工作区搭建（pnpm workspace + foundation 骨架） | ✅ 已完成 | 0.5 天 |
| Phase 1 | 迁移 100% 重复代码 | ✅ 已完成 | 1 天 |
| Phase 2 | 规范化多变体代码 + 布局共享 + 头像统一 | ✅ 已完成 | 3 天 |
| Phase 3 | 审批中心 + 流程组件 + Workflow API 扩展 | ✅ 已完成 | 7 天 |
| Phase 4 | 集成验证（aims 项目立项端到端 + 回归） | ✅ 已完成 | 3 天 |
| Phase 5 | 清理文档 + 推广到其他模块 | 进行中 | 1 天 |

### Phase 3 细分

| 子任务 | 说明 | 预计 |
|--------|------|------|
| 3.1 Workflow API 扩展 | biz_key 查询、capabilities、app_code 过滤、embed/local view 支持 | 1.5 天 |
| 3.2 foundation 流程组件 | WorkflowPanel、Timeline、Badge、TaskList、BusinessView | 2 天 |
| 3.3 foundation 审批中心页面 | /approval/tasks + /approval/tasks/[taskId] | 1.5 天 |
| 3.4 workflow 迁移兼容层 | 旧路由兼容、菜单/通知链接迁移 | 1 天 |
| 3.5 useWorkflow composable | API 封装 + workflow-proxy 代理路由 | 0.5 天 |
| 3.6 aims 业务视图接入 | 本地只读视图 + /embed/project/[bizId] | 0.5 天 |

## 6. 验证策略

### 6.1 自动化检查

```bash
pnpm --filter aims typecheck
pnpm --filter workflow typecheck
pnpm --filter nuxt-template typecheck
pnpm --filter aims lint
pnpm --filter workflow lint
pnpm --filter foundation typecheck
pnpm --filter foundation lint
```

### 6.2 自动化测试要求

至少覆盖以下场景：

| 类别 | 场景 | 要求 |
|------|------|------|
| API 契约 | `by-biz` 必须按 `app_code + resource_code + biz_id + action_code` 查询 | 覆盖缺参、命中、无结果、历史/活动实例 |
| 并发保护 | 同一 `biz_key` 不允许同时创建两个活动实例 | 覆盖重复提交、驳回后再提交 |
| 能力集 | `tasks/[id]`、`instances/[id]` 返回 `capabilities` | 覆盖审批人、非审批人、发起人、终态 |
| 回调 | callback 开启/关闭两种模式 | 覆盖签名校验、幂等、失败不阻塞主流程 |
| 视图模式 | 同应用 local、跨应用 iframe | 覆盖 fallback 行为 |
| 路由兼容 | `/tasks/*` 与 `/approval/tasks/*` | 覆盖旧链接兼容与跳转 |

### 6.3 手动测试清单

| 测试项 | 模块 | 验证内容 |
|--------|------|----------|
| CAS 登录/登出 | workflow, aims | Cookie 设置、重定向 |
| 企业微信登录 | codocs | OAuth 跳转、Cookie |
| 部门选择器 | aims | 树形渲染、选中交互 |
| 应用切换器 | workflow | 加载应用列表、跳转 |
| 权限控制 | aims | 菜单权限过滤 |
| 心跳上报 | aims | 每 2 分钟 POST /api/heartbeat |
| 审批中心列表 | aims | /approval/tasks 显示待办、已办、我发起的 |
| 流程处理页面（同应用） | aims | 本地只读视图加载 + 审批操作 |
| 流程处理页面（跨应用） | workflow + aims/codocs | iframe embed 加载业务详情 + 审批操作 |
| 审批流转 | aims + workflow | 发起 → 审批 → 查询/回调 → 状态变更 |
| 全局审批中心 | workflow | 显示所有模块的待办 |
| WorkflowBadge | aims | 按 biz_key 显示正确流程状态标签 |
| 重复发起保护 | aims | 同一 biz_key 活动实例存在时禁止再次发起 |
| 驳回后重提 | aims + workflow | 驳回后允许再次提交，且仍然只有一个活动实例 |
| 历史保留 | aims + workflow | `resubmit` 后第一轮审批记录仍可在同一实例时间线中查看 |
| 旧路由兼容 | workflow | `/tasks`、`/tasks/[id]` 老链接可访问或自动跳转 |

## 7. 注意事项

### 7.1 account 模块特殊处理

account 模块是 Account API 本身，不应代理自己。接入 foundation 时：
- 使用 Tier 1 共享（类型、useHeartbeat、DeptTreeSelector、AppLauncher）
- 默认复用 Foundation 的 `auth.global.ts`；仅在确有模块特化时本地覆盖
- 不引入 `server/api/account/` 代理路由

### 7.2 模块特定配置

以下内容各模块各异，**不进入** foundation：
- `config/permissions.ts`（菜单、资源、权限定义）
- `assets/css/main.css`（各模块自有样式）
- 模块特有的 runtimeConfig 字段
- 模块特有的 routeRules

### 7.3 已上线模块

account 和 codocs 已上线，迁移时需额外谨慎：
- 先在 aims + workflow 试点验证
- 确认无回归后再纳入 codocs
- account 最后迁移（需特殊处理）

### 7.4 域名与 iframe 前提

当前系统部署前提是**同一主域名下的多个子域名**。因此：
- 跨子域 iframe 在鉴权上可行
- 但同应用场景仍优先直渲染，不把 iframe 作为默认方案
- 若未来出现跨主域部署，需要重新评估 cookie、登录态和嵌入策略

## 8. Workflow 现状差距与实施清单

本节用于回答一个实际问题：**基于本方案，workflow 模块当前实现是否已经满足要求？**

结论：
- **基础能力可复用**：流程定义、路由匹配、实例创建、任务审批、驳回后重新提交、可选回调已具备基础实现
- **尚未满足接入要求**：当前 workflow 仍不能直接支撑 foundation 审批中心方案落地，必须先完成若干后端契约和兼容层改造

### 8.1 现状评估

| 能力项 | 现状 | 结论 |
|--------|------|------|
| `app_code + resource_code + action_code` 动作定义唯一性 | 已实现 | ✅ 满足 |
| 实例表保存 `app_code/resource_code/action_code/biz_id` | 已实现 | ✅ 满足 |
| 按 `biz_key = app_code + resource_code + biz_id + action_code` 查询实例 | 当前仅按 `resource_code + biz_id` 查询 | ❌ 不满足 |
| 同一 `biz_key` 同时仅允许一个活动实例 | 创建实例前未查重，数据库无保护 | ❌ 不满足 |
| 按 `app_code` 过滤待办/已办/我发起的 | 当前列表接口未支持 | ❌ 不满足 |
| 流程引擎返回 `capabilities` | 当前详情接口未返回，前端本地推断 | ❌ 不满足 |
| 流程引擎返回 `business_view` | 当前未返回 | ❌ 不满足 |
| 回调可选 | `callback_url` 可空，未配置时不回调 | ✅ 基本满足 |
| 回调认证 | 使用 Console service token，不再使用共享签名密钥 | ✅ 满足 |
| 回调失败补偿 | 当前仅记录日志，无重试/补偿 | ⚠️ 部分满足 |
| 驳回后重新提交 | 已支持，且复用原实例 | ✅ 满足 |
| foundation 标准路由 `/approval/tasks*` | 当前 workflow 尚未提供兼容层 | ❌ 不满足 |
| 自动化测试覆盖 | 当前未建立对应测试 | ❌ 不满足 |

### 8.2 核心差距

#### 差距 1：实例查询语义仍旧过宽

当前 workflow 的实例查询和索引仍偏向旧语义：
- 查询接口默认按 `resource_code + biz_id` 查最近一条
- 数据库索引也是 `idx_biz(resource_code, biz_id)`

这与 foundation 方案要求不一致。新方案要求一切状态查询、Badge 展示、状态同步都围绕 `biz_key`：

```text
app_code + resource_code + biz_id + action_code
```

改造目标：
- `GET /api/v1/instances/by-biz` 必须显式接收 `app_code` 和 `action_code`
- 数据库索引必须覆盖 `biz_key`
- 所有查询和状态同步逻辑禁止再只按 `resource_code + biz_id` 查实例

#### 差距 2：缺少“单活动实例”约束

当前 workflow 支持创建实例，也支持驳回后重新提交，但**尚未阻止同一业务动作被重复发起多个活动实例**。

新方案要求：
- 同一 `biz_key` 任一时刻只允许一个活动实例
- 活动实例状态至少包括 `running`、`suspended`
- 驳回后再次提交允许，但采用 `resubmit` 语义复用原实例
- `resubmit` 后不得产生第二个实例编号
- 重新提交前不得存在其他活动实例

改造目标：
- 在 `POST /api/v1/instances` 发起前检查活动实例
- 视业务策略决定返回错误，或引导使用已有实例/重新提交
- 必要时补充数据库层约束或幂等策略，避免并发重复提交

#### 差距 3：前端仍在本地推断操作权限

当前 workflow 页面通过如下方式本地推断是否可操作：
- 当前用户是否为任务处理人
- 当前状态是否为 `pending` / `rejected`
- `flow_snapshot.config.allow_resubmit` 是否允许

这与方案中的“流程引擎权威”原则不一致。

新方案要求：
- 前端不自行推断“能不能审批/驳回/重新提交”
- 一律消费 workflow 返回的 `capabilities`
- 按 `capabilities` 决定按钮显隐和可用性

改造目标：
- `GET /api/v1/tasks/[id]` 返回 `capabilities`
- `GET /api/v1/instances/[id]` 返回 `capabilities`
- foundation 中的 `WorkflowPanel` 只渲染，不判权

#### 差距 4：业务视图承载能力尚不存在

当前 workflow 详情页只支持：
- 展示流程元信息
- 提供 `biz_url` 外链跳转

尚未支持 foundation 方案中的：
- 同应用 `local` 只读视图
- 跨应用 `iframe` embed 视图
- 流程引擎返回 `business_view`

改造目标：
- workflow 统一返回 `business_view`
- `business_view.mode` 至少支持 `local`、`iframe`、`external-link`
- foundation 中新增 `WorkflowBusinessView` 容器组件承接

#### 差距 5：模块内审批中心按应用过滤能力不足

foundation 审批中心要求：
- 在 aims 中只看 aims 相关待办/已办/我发起
- 在 workflow 中可查看全局数据

当前 workflow 的列表接口尚未支持 `app_code` 参数过滤。

改造目标：
- `GET /api/v1/tasks/pending?app_code=...`
- `GET /api/v1/tasks/done?app_code=...`
- `GET /api/v1/tasks/initiated?app_code=...`

若调用方不传 `app_code`：
- workflow 模块可视为全局查询
- 其他模块接入时由 foundation 自动透传 `runtimeConfig.public.appName`

#### 差距 6：标准路由与兼容迁移尚未开始

foundation 目标路由为：
- `/approval/tasks`
- `/approval/tasks/[taskId]`

当前 workflow 仍使用：
- `/tasks`
- `/tasks/[id]`
- `/instances`
- `/instances/[id]`

改造目标：
- foundation 提供标准路由
- workflow 先保留旧路由，增加兼容层或跳转
- 通知链接、菜单入口、站内跳转逐步迁移到标准路由

### 8.3 实施顺序

#### Phase A：数据与接口语义收敛

优先级最高，必须先做。

清单：
- 调整 `flow_instances` 索引，覆盖 `app_code + resource_code + biz_id + action_code`
- 改造 `GET /api/v1/instances/by-biz`，按 `biz_key` 查询
- 定义“活动实例”状态集
- 在实例创建时增加活动实例查重
- 固化 `submit` / `resubmit` 语义边界：前者新建实例，后者复用原实例

完成标志：
- 同一 `biz_key` 无法并发创建两个活动实例
- `WorkflowBadge` 所需查询已具备稳定语义

#### Phase B：流程引擎合同补齐

在 foundation 组件开发前完成。

清单：
- `GET /api/v1/tasks/[id]` 补 `capabilities`
- `GET /api/v1/instances/[id]` 补 `capabilities`
- 两类详情接口补 `business_view`
- 三个列表接口补 `app_code` 过滤

建议返回结构：

```json
{
  "status": "running",
  "current_node": 1,
  "timeline": [],
  "capabilities": {
    "can_approve": true,
    "can_reject": true,
    "can_delegate": false,
    "can_cancel": false,
    "can_resubmit": false,
    "can_comment": true
  },
  "business_view": {
    "mode": "iframe",
    "embed_url": "https://aims.example.com/embed/project/123"
  }
}
```

完成标志：
- foundation 不需要本地推断按钮能力
- foundation 可以单纯消费 workflow 合同

#### Phase C：foundation 与 workflow 路由兼容

在 API 合同稳定后推进。

清单：
- foundation 新增 `/approval/tasks`
- foundation 新增 `/approval/tasks/[taskId]`
- workflow 旧路由保留
- workflow 增加兼容跳转或别名
- 通知链接逐步切换

完成标志：
- 老链接不失效
- 新老路由在一个过渡周期内并存

#### Phase D：状态同步与回调补强

回调不是接入前置条件，但需要明确边界。

清单：
- 保持 `callback_url` 可选
- 回调 payload 中补完整 `biz_key`
- 回调处理要求幂等
- 回调失败至少记录可追踪日志
- 后续可选增加重试队列或补偿任务

若业务系统不启用回调：
- 需明确何时调用 `by-biz` 查询状态
- 需明确业务状态落库责任方

完成标志：
- 使用回调和不使用回调两种模式都能闭环

#### Phase E：测试补齐

最后补强，不允许缺失。

自动化测试最低要求：
- `by-biz` 的 `biz_key` 查询测试
- 同一 `biz_key` 单活动实例测试
- `app_code` 过滤测试
- `capabilities` 返回合同测试
- 回调开启/关闭两种模式测试
- 旧路由兼容测试

### 8.4 实施状态（2026-04-01 更新）

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase A | 数据与接口语义收敛 | ✅ 已完成 |
| Phase B | 流程引擎合同补齐 | ✅ 已完成 |
| Phase C | foundation 与 workflow 路由兼容 | ✅ 基本完成（旧路由暂保留并存） |
| Phase D | 状态同步与回调补强 | ✅ 已完成（回调日志记录 + fire-and-forget） |
| Phase E | 测试补齐 | ⏳ 待实施 |

**已完成的改造清单：**

后端（workflow）：
- ✅ `flow_instances` 索引覆盖 `biz_key` 组合
- ✅ `by-biz` 按完整 `biz_key` 查询（action_code 必填）
- ✅ 创建实例前 biz_key 活动实例查重
- ✅ resubmit 复用原实例语义
- ✅ `tasks/[id]` 和 `instances/[id]` 返回 `capabilities` + `business_view`
- ✅ `pending/done/initiated` 支持 `app_code` 过滤
- ✅ `dept_leader` 向上递归查找
- ✅ 流程模板（is_template + 4 个预置模板）
- ✅ `action-defs/sync` 应用自主注册接口
- ✅ `flow_action_defs.source` 区分手动/同步
- ✅ `flow_action_defs.embed_url_pattern` 字段
- ✅ 回调日志记录（`flow_callback_logs` 表）

foundation：
- ✅ `WorkflowPanel` / `WorkflowTimeline` / `WorkflowBadge` / `WorkflowBusinessView`
- ✅ `/approval/tasks` 审批中心（三列看板：待办/已办/我发起的）
- ✅ `/approval/tasks/[taskId]` 统一处理页
- ✅ `useWorkflow` composable（API 封装）
- ✅ `useApprovalMode` composable（sessionStorage 审批模式）
- ✅ LayoutSidebar 审批模式集成（右侧面板 + 导航栏提示 + 自动折叠）
- ✅ LayoutSidebar 审批中心入口自动注入 + 待办角标
- ✅ `workflow-proxy` 代理路由
- ✅ `accountApi` 服务端工具（`server/utils/accountApi.ts`，提供 `fetchAccountApi` / `requireAccountApiConfig` / `getAccountApiAuthHeaders`）
- ✅ manifest 类型定义 + 共享同步工具
- ✅ `appCode` 统一为首选标识

aims 试点：
- ✅ `approvalActions` manifest + sync 插件
- ✅ 项目概览页发起审批按钮
- ✅ `WorkflowBadge` 状态标签
- ✅ 全部子页面审批模式按钮隐藏
- ✅ `ProjectNavbar` 审批状态自动同步
- ✅ 设置页审批状态卡片 + 撤回功能
- ✅ embed layout + embed 项目详情页

**Account API 代理路由规范：**

foundation 提供 `server/utils/accountApi.ts` 工具函数，各模块按需在自己的 `server/api/account/` 下编写代理路由。不在 foundation 层放置 `server/api/account/` 路由，避免 Account 模块自身 extends foundation 时产生循环调用。

已定义的代理路由（由各模块各自实现）：

| 路由 | 对应 Account API | 说明 |
|------|------------------|------|
| `GET /api/account/users` | `GET /api/v1/users` | 用户列表 |
| `GET /api/account/departments` | `GET /api/v1/departments` | 部门列表 |
| `GET /api/account/accessible-departments` | `GET /api/v1/departments/accessible?uid=xxx` | 当前用户有权部门 |
| `GET /api/account/business-domains` | `GET /api/v1/business-domains` | 业务领域字典 |

**待后续实施：**
- 继续推动存量模块移除本地 `auth.global.ts`，统一接入 Foundation 认证链路
- workflow 旧路由正式下线（当前新旧并存）
- codocs/altoc/assets/account 模块接入 foundation
- 自动化测试覆盖
