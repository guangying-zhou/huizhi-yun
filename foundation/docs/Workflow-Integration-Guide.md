# 业务模块审批流程接入指南

> 指导各业务模块如何接入 Workflow 审批流程，从配置到页面改造的完整步骤。

## 1. 概述

汇智云平台的审批能力由三层协作完成：

| 层 | 职责 | 示例 |
|---|------|------|
| **业务模块**（aims/codocs/altoc...） | 声明审批动作、改造业务页面、提供 embed 视图 | aims 的项目立项审批 |
| **Foundation Layer** | 提供审批中心页面、WorkflowPanel 组件、共享同步机制 | `/approval/tasks`、`useApprovalMode()` |
| **Workflow 服务** | 流程引擎、任务分发、审批人解析、回调 | 流程定义、capabilities、by-biz 查询 |

接入流程：

```
1. 声明审批动作 manifest        → 启动时自动同步到 Workflow
2. 配置流程（模板或自定义）      → 在 Workflow 管理后台操作
3. 业务页面添加"发起审批"按钮   → 调用 prepare + create API
4. 业务页面添加审批模式控制      → useApprovalMode() 隐藏编辑按钮
5. 业务页面添加状态同步          → ProjectNavbar 自动同步审批结果
```

## 2. 前置条件

### 2.1 模块已接入 Foundation

确认 `nuxt.config.ts` 中：

```typescript
export default defineNuxtConfig({
  extends: ['@hzy/foundation']
})
```

且 `package.json` 中有 `"@hzy/foundation": "workspace:*"`。

### 2.2 配置 Workflow API URL

`nuxt.config.ts` 的 `runtimeConfig` 中：

```typescript
hzy: {
  apiBaseUrl: process.env.HZY_ACCOUNT_API_URL,
  apiKey: process.env.HZY_ACCOUNT_API_KEY,
  apiSecret: process.env.HZY_ACCOUNT_API_SECRET,
  workflowApiUrl: process.env.HZY_WORKFLOW_API_URL || 'http://localhost:3020'
}
```

`.env.dev` 中确保 `HZY_WORKFLOW_API_URL` 正确指向 Workflow 服务。

### 2.3 统一使用 appCode

Foundation 相关能力应统一基于 `runtimeConfig.public.appCode` 识别当前应用：

```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      appCode: 'aims',
      appDisplayName: 'Aims'
    }
  }
})
```

约定：

- `appCode`：机器标识，用于权限判断、应用识别和审批业务回跳判断
- `appDisplayName` / `appName`：展示文案，不参与流程与权限语义判断

这是接入审批中心时的关键约束。审批中心列表不再按应用过滤，但业务回跳、审批动作声明与权限判断仍必须使用 `appCode`，不能使用展示名称。

## 3. 步骤一：声明审批动作

### 3.1 在 permissions.ts 中添加 approvalActions

```typescript
// app/config/permissions.ts

export const approvalActions = [
  {
    resourceCode: 'projects',        // 必须对应 resources 中已声明的资源
    actionCode: 'initiation',        // 稳定编码，不要随意变更
    name: '项目立项审批',
    description: '新项目立项审批，审核项目可行性、资源匹配和预算',
    icon: 'i-lucide-folder-plus',
    embedUrlPattern: '{app_base_url}/embed/project/{biz_id}',
    sortOrder: 10,
    enabled: true                    // false 表示暂未启用，同步时标记停用
  }
]
```

**字段说明：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `resourceCode` | 是 | 对应 `resources` 中的 code，如 `projects` |
| `actionCode` | 是 | 动作编码，如 `initiation`、`finish`、`change` |
| `name` | 是 | 显示名称 |
| `description` | 否 | 描述 |
| `formSchemaCode` | 否 | 关联的表单 schema 编码（如果审批需要额外填写表单） |
| `icon` | 否 | 图标 class |
| `embedUrlPattern` | 否 | 审批时展示业务详情的页面 URL 模式 |
| `sortOrder` | 否 | 排序序号 |
| `enabled` | 否 | 是否启用（默认 true） |

### 3.2 创建同步插件

```typescript
// server/plugins/sync-approval-actions.ts

import { appCode, approvalActions } from '~~/app/config/permissions'

export default defineNitroPlugin(() => {
  setTimeout(async () => {
    const config = useRuntimeConfig()
    const hzy = (config as any).hzy || {}
    const { apiKey, apiSecret, workflowApiUrl } = hzy

    if (!workflowApiUrl || !apiKey || !apiSecret) {
      console.warn('[SyncApprovalActions] Workflow API not configured, skipping')
      return
    }

    try {
      const url = `${workflowApiUrl}/api/v1/action-defs/sync`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}:${apiSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ appCode, actions: approvalActions }),
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const result = await response.json()
        if (result.code === 0) {
          const d = result.data
          console.log(`[SyncApprovalActions] Synced: ${d.created} new, ${d.updated} updated, ${d.deprecated} deprecated`)
        }
      }
    } catch {
      console.log('[SyncApprovalActions] Workflow不可达，跳过同步')
    }
  }, 5000)
})
```

启动模块后，审批动作会自动注册到 Workflow。

### 3.3 优先复用 Foundation 的共享同步函数

如果 Foundation 已提供通用同步 helper，业务模块不应重复手写完整的 `fetch` 逻辑，而应只保留一层很薄的 plugin：

1. 读取本模块的 `appCode`
2. 读取本模块的 `approvalActions`
3. 调用 Foundation 提供的通用同步函数

建议边界：

- 业务模块：持有 manifest
- Foundation：持有同步请求封装、校验和重试策略

这样可以避免各模块复制粘贴近似相同的同步插件实现。

## 4. 步骤二：配置审批流程

在 Workflow 管理后台（`http://localhost:3020/admin/actions`）：

1. 确认审批动作已自动注册（来源显示"sync"）
2. 点击"编辑"，选择关联的审批流程：
   - **使用模板**：选择预置的二级审批、三级审批等模板
   - **选择已有流程**：使用在"流程定义"中自定义的流程
3. 保存后系统自动创建默认路由

**预置模板：**

| 模板 | 节点 | 适用场景 |
|------|------|----------|
| 单级审批 | 部门经理 | 简单事项 |
| 二级审批 | 部门经理 → 分管领导 | 常规事项 |
| 三级审批 | 部门经理 → 分管领导 → 上级部门负责人 | 重大事项 |
| 委员会表决 | 指定角色全员会签 | 集体决策 |

## 5. 步骤三：改造业务页面

### 5.1 添加"发起审批"按钮

在业务详情页的操作区域添加按钮，调用 `prepareInstance` + `createInstance`：

```vue
<script setup lang="ts">
const toast = useToast()
const { isApprovalMode } = useApprovalMode()

async function handleSubmitApproval() {
  // 1. prepare: 匹配路由、获取表单
  const prepareRes = await prepareInstance({
    app_code: 'aims',
    resource_code: 'projects',
    action_code: 'initiation',
    biz_id: String(project.value.id),
    biz_title: project.value.name,
    biz_context: {
      dept_code: project.value.deptCode,
      category: project.value.category
    }
  })

  if (prepareRes.code !== 0 || !prepareRes.data?.matched_routes?.length) {
    toast.add({ title: '未找到匹配的审批流程', color: 'error' })
    return
  }

  const { action_def, matched_routes } = prepareRes.data

  // 2. create: 发起审批
  const createRes = await createInstance({
    action_def_id: action_def.id,
    route_id: matched_routes[0].id,
    biz_id: String(project.value.id),
    biz_title: project.value.name,
    biz_url: `${window.location.origin}/projects/${project.value.id}`,
    biz_context: {
      dept_code: project.value.deptCode
    }
  })

  if (createRes.code === 0) {
    toast.add({ title: '审批已发起', color: 'success' })
    // 更新业务状态
    await updateProjectStatus('approval_pending')
  }
}
</script>

<template>
  <!-- 仅在非审批模式下显示 -->
  <UButton
    v-if="project.status === 'draft' && !isApprovalMode"
    icon="i-lucide-send"
    label="发起立项审批"
    color="warning"
    variant="soft"
    @click="handleSubmitApproval"
  />
</template>
```

**关键 API（自动导入自 foundation）：**

| 函数 | 用途 |
|------|------|
| `prepareInstance(body)` | 匹配路由、获取表单 schema |
| `createInstance(body)` | 正式发起审批 |
| `fetchInstanceByBiz(params)` | 按 biz_key 查询审批状态 |
| `approveTask(taskId, body)` | 审批通过 |
| `rejectTask(taskId, body)` | 审批驳回 |

### 5.2 添加审批状态显示

使用 `WorkflowBadge` 组件在页面标题区域显示审批状态：

```vue
<WorkflowBadge
  app-code="aims"
  resource-code="projects"
  :biz-id="String(project.id)"
  action-code="initiation"
/>
```

组件会自动调用 `fetchInstanceByBiz` 查询状态并显示对应标签。

### 5.3 添加审批模式控制

审批人从审批中心点击待办进入业务页面时，页面进入"审批模式"：
- 右侧显示 WorkflowPanel（由 LayoutSidebar 自动处理）
- 顶部导航栏显示"返回审批中心"
- 业务页面的编辑按钮需要隐藏

使用 `useApprovalMode()` 控制按钮显示：

```vue
<script setup lang="ts">
const { isApprovalMode } = useApprovalMode()
</script>

<template>
  <!-- 审批模式下隐藏编辑操作 -->
  <div v-if="!isApprovalMode" class="flex gap-2">
    <UButton label="编辑" @click="openEdit" />
    <UButton label="删除" color="error" @click="openDelete" />
  </div>
</template>
```

**需要隐藏的按钮类型：**
- 编辑/保存按钮
- 删除按钮
- 新建/添加按钮
- 状态流转按钮

**不需要隐藏的：**
- 查看详情/展开折叠
- 导航 Tab 切换
- 筛选/排序

### 5.4 添加审批状态自动同步

在共用导航组件（如 ProjectNavbar）中，页面加载时自动检查审批结果并同步业务状态：

```typescript
async function syncApprovalStatus() {
  const p = project.value
  if (!p || p.lifecycleStatus !== 'approval_pending') return

  try {
    const res = await fetchInstanceByBiz({
      app_code: 'aims',
      resource_code: 'projects',
      biz_id: String(p.id),
      action_code: 'initiation',
      include_history: true
    })

    if (res.code === 0 && res.data) {
      if (res.data.status === 'approved') {
        // 审批通过 → 激活项目
        await updateProject(p.id, { lifecycleStatus: 'active' })
      } else if (res.data.status === 'rejected') {
        // 审批驳回 → 恢复草稿
        await updateProject(p.id, { lifecycleStatus: 'draft' })
      }
    }
  } catch {
    // silent
  }
}

onMounted(syncApprovalStatus)
```

## 6. 步骤四：提供 Embed 页面（可选）

如果需要支持跨应用审批（在 Workflow 全局审批中心查看其他模块的业务详情），需要提供 embed 页面。**同应用审批不需要此步骤**（审批模式会直接在业务页面上叠加 WorkflowPanel）。

### 6.1 创建 embed layout

```vue
<!-- app/layouts/embed.vue -->
<template>
  <div class="h-screen w-screen overflow-auto bg-default">
    <slot />
  </div>
</template>
```

### 6.2 创建 embed 页面

```vue
<!-- app/pages/embed/project/[bizId].vue -->
<script setup lang="ts">
definePageMeta({ layout: 'embed' })

const route = useRoute()
const projectId = computed(() => Number(route.params.bizId))

// 加载项目数据并只读展示...
</script>
```

### 6.3 配置 embedUrlPattern

在 `approvalActions` 的 manifest 中配置：

```typescript
embedUrlPattern: '{app_base_url}/embed/project/{biz_id}'
```

变量说明：
- `{app_base_url}`：由前端根据应用地址替换
- `{biz_id}`：流程实例的业务主键
- `{resource_code}`：资源编码

## 7. 审批中心

Foundation 自动提供通用审批中心页面 `/approval/tasks`，各模块继承后即可使用，并应直接挂接到模块菜单：

```typescript
{
  label: '审批中心',
  icon: 'i-lucide-clipboard-check',
  to: '/approval/tasks'
}
```

### 7.1 菜单入口自动注入规则

建议由 Foundation 在侧边栏底部工具区自动注入“审批中心”入口，而不是由各业务模块手工维护菜单配置。

自动显示条件：

- 当前应用 `appCode !== 'workflow'`
- 且当前应用声明了至少一个 `approvalActions`

入口位置：

- 位于侧边栏最下方
- 位于折叠按钮上方
- 位于通知、个人设置等底部工具菜单区域中

显示范围：

- 普通全局导航模式下显示
- 项目上下文模式下也显示

也就是说，即使当前处于项目上下文侧边栏，审批中心入口仍应保留，因为审批中心属于全局能力，不应被项目导航覆盖。

页面行为约定：

- **待办**：当前用户需要审批的任务（跨应用展示）
- **已办**：当前用户已审批的任务
- **我发起的**：当前用户发起的审批

展示规则：

- 所有模块的 `/approval/tasks` 均展示当前用户的跨应用审批任务
- `biz_url` 为绝对 URL 时直接跳转
- `biz_url` 为相对路径时，使用任务的 `app_code` 匹配 `/api/user/applications` 中的 `homeUrl` 后拼接跳转
- 找不到目标应用入口或没有 `biz_url` 时，进入 Foundation 标准审批详情页
- 跨应用跳转会追加 `hzy_approval_task_id` 或 `hzy_approval_instance_id`，目标应用据此恢复审批模式

这里必须强调：

- 回跳判断依据是 `appCode`
- 不能使用 `appName` 或其他展示字段
- 菜单入口是否显示由 `approvalActions`/`appCode` 决定，不由业务模块手工写死

审批人点击待办 → 进入业务页面（审批模式）→ 右侧 WorkflowPanel 审批 → 返回审批中心。

## 8. 完整接入清单

新增一个审批事项时，按以下清单逐项完成：

### 配置层
- [ ] `app/config/permissions.ts` 中 `approvalActions` 添加新动作
- [ ] 确认 `server/plugins/sync-approval-actions.ts` 存在
- [ ] 重启应用，确认控制台输出 `[SyncApprovalActions] Synced`
- [ ] 在 Workflow 管理后台为该动作关联审批流程

### 页面层
- [ ] 业务详情页添加"发起审批"按钮（调用 prepare + create）
- [ ] 业务详情页添加 `WorkflowBadge` 状态标签
- [ ] 业务详情页添加 `useApprovalMode()` 隐藏编辑按钮
- [ ] 所有子页面的编辑按钮加 `v-if="!isApprovalMode"`
- [ ] 共用导航组件添加审批状态自动同步逻辑

### 多动作模式（一个页面多种审批）
- [ ] 使用 `usePageWorkflow` 的 `actions` 参数注册多个动作
- [ ] 每个动作配置独立的 `canSubmit`、`completenessIssues`、回调
- [ ] `onApproved` 中实现业务状态流转
- [ ] Store 中提供 `isWorkItemEditable` / `workItemReadonlyReason`
- [ ] 相关页面的创建/编辑/拖拽/删除操作加 `isWorkItemEditable` 条件

### 可选
- [ ] 提供 embed layout 和 embed 页面（跨应用审批需要）
- [ ] 配置 `embedUrlPattern`
- [ ] 提供回调接口 `/api/v1/workflow-callback`（如需主动推送），并校验 Console service token：`token_use=service`、目标 `aud`、`scope=workflow:callback` 和来源应用 `workflow`

## 9. biz_key 约定

所有流程操作围绕 **biz_key** 展开：

```
biz_key = app_code + resource_code + biz_id + action_code
```

约束：
- 同一个 biz_key 在任一时刻**最多一个活动实例**（running/suspended）
- 驳回后重新提交（resubmit）复用原实例，不创建新实例
- 查询时四个字段**全部必填**

## 10. 常见问题

### Q: 发起审批时提示"未找到匹配的审批流程"
确认 Workflow 管理后台中该审批动作已关联流程定义，且状态为启用。

### Q: 审批人看不到待办任务
检查 Account 中部门的 `managerId`/`leaderId` 是否正确设置。审批人由流程引擎根据部门配置自动解析。

### Q: 审批通过后业务状态没有自动更新
确认共用导航组件中有审批状态同步逻辑（`syncApprovalStatus`），且在 `onMounted` 中调用。

### Q: 审批模式下编辑按钮仍然显示
确认页面中使用了 `const { isApprovalMode } = useApprovalMode()`，且按钮加了 `v-if="!isApprovalMode"`。

### Q: 分管领导为空导致流程卡住
流程引擎会自动向上级部门递归查找负责人（最多 5 层）。如果整个链路都没有设置负责人，该节点将无法创建任务。请在 Account 中完善部门管理者配置。

## 11. 多动作模式（usePageWorkflow）

当一个页面需要根据业务状态发起不同的审批（如项目设置页的立项/暂停/恢复/结项），使用 `usePageWorkflow` 的多动作模式。

### 11.1 核心规则

| 规则 | 说明 |
|------|------|
| 同一实体不允许并行审批 | 有活跃实例（running）时，其他动作按钮自动置灰 |
| 已完结实例可重新发起 | approved/cancelled 的历史实例不阻塞新审批 |
| 首次加载不触发回调 | 页面打开时发现的历史状态不触发 onApproved/onRejected |
| 审批历史自动展示 | WorkflowPanel 底部显示该实体的所有历史审批记录 |

### 11.2 页面接入方式

```typescript
import { projectWorkflowActionConfigs } from '~/utils/projectWorkflow'
import type { ProjectWorkflowActionCode } from '~/utils/projectWorkflow'

const { isReadonly } = usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'projects',
  bizId: computed(() => String(project.value?.id)),
  bizTitle: computed(() => project.value?.name ?? ''),
  // 关键：actions 是响应式数组，随业务状态动态变化
  actions: computed(() => {
    const status = project.value?.lifecycleStatus
    switch (status) {
      case 'draft':
        return [buildAction('initiation', { completenessIssues: initiationIssues })]
      case 'active':
        return [buildAction('pause'), buildAction('finish')]
      case 'paused':
        return [buildAction('resume')]
      default:
        return []
    }
  })
})
```

### 11.3 构建动作对象

每个动作需要提供独立的 `canSubmit`、`completenessIssues` 和回调：

```typescript
function buildAction(
  actionCode: ProjectWorkflowActionCode,
  overrides?: { canSubmit?: Ref<boolean>, completenessIssues?: Ref<string[]> }
) {
  const config = projectWorkflowActionConfigs[actionCode]
  return {
    actionCode,
    actionName: config.name,
    icon: 'i-lucide-rocket',  // 可选
    canSubmit: overrides?.canSubmit ?? computed(() => !!project.value),
    completenessIssues: overrides?.completenessIssues ?? computed(() => []),
    async onSubmitted() {
      // 提交后更新业务状态（如立项 → approval_pending）
      toast.add({ title: `${config.successLabel}已发起`, color: 'success' })
      await projectStore.fetchProject(projectId.value)
    },
    async onApproved() {
      // 审批通过后变更业务状态
      const statusMap = { initiation: 'active', pause: 'paused', resume: 'active', finish: 'archived' }
      await projectStore.updateProject(projectId.value, { lifecycleStatus: statusMap[actionCode] })
      toast.add({ title: `${config.name}已通过`, color: 'success' })
      await projectStore.fetchProject(projectId.value)
    },
    async onRejected() {
      // 驳回后回退状态（如立项驳回 → draft）
      toast.add({ title: `${config.name}已驳回`, color: 'warning' })
      await projectStore.fetchProject(projectId.value)
    }
  }
}
```

### 11.4 UI 行为

- **单动作**（如 draft 只有"立项"）：直接显示 WorkflowPanel，无选择器
- **多动作**（如 active 有"暂停"和"结项"）：面板顶部显示按钮组切换器
- **有活跃审批**：当前动作高亮，其他动作按钮 disabled
- **审批历史**：面板底部显示该实体所有已完结审批，点击可展开详情

### 11.5 单动作兼容

只有一个审批动作的页面也使用 `actions` 数组，包裹为单元素即可：

```typescript
usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'tasks',
  bizId: computed(() => String(workItemId.value)),
  bizTitle: computed(() => context.value?.item.title ?? ''),
  actions: computed(() => [{
    actionCode: 'complete',
    actionName: '完成确认',
    canSubmit: computed(() => issues.value.length === 0),
    completenessIssues: issues,
    async onApproved() { /* ... */ }
  }])
})
```

### 11.6 业务状态限制

审批状态变更后，通常需要限制页面操作。推荐在 Pinia Store 中提供响应式判断：

```typescript
// stores/project.ts
const isWorkItemEditable = computed(() => {
  const s = currentProject.value?.lifecycleStatus
  return s === 'draft' || s === 'active'
})

const workItemReadonlyReason = computed(() => {
  const s = currentProject.value?.lifecycleStatus
  if (s === 'paused') return '项目已暂停，恢复后可继续操作'
  if (s === 'archived') return '项目已归档'
  if (s === 'approval_pending') return '项目审批中'
  return null
})
```

页面中使用：

```vue
<!-- 禁用创建按钮 -->
<UButton v-if="isWorkItemEditable" label="新建" @click="create" />

<!-- 禁用拖拽 -->
<div :draggable="isWorkItemEditable ? 'true' : 'false'">

<!-- 显示只读提示 -->
<div v-if="workItemReadonlyReason" class="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
  {{ workItemReadonlyReason }}
</div>
```

### 11.7 Aims 项目状态流转参考

```
draft ──[立项提交]──→ approval_pending ──[立项通过]──→ active
                                         [立项驳回]──→ draft

active ──[暂停通过]──→ paused ──[恢复通过]──→ active
       ──[结项通过]──→ archived

编辑限制：
  - draft：可编辑项目信息、可删除
  - approval_pending：禁止编辑、禁止工作项操作
  - active：禁止编辑项目信息，允许工作项操作
  - paused：禁止编辑项目信息，禁止工作项操作
  - archived：全部只读
```
