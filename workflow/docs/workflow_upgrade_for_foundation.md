# Workflow 模块升级方案

> 为对接 Foundation Layer 审批中心，Workflow 模块需要进行的 API 扩展和数据库变更

## 1. 背景

Foundation Layer 设计了统一审批中心（详见 `foundation/docs/Foundation-Design.md` 第 4 节），要求 Workflow 模块：

1. 支持 `biz_key`（`app_code + resource_code + biz_id + action_code`）唯一标识和并发控制
2. 返回 `capabilities`（当前用户可执行的操作集）
3. 支持按 `app_code` 过滤待办/已办/我发起的
4. 返回 `business_view`（业务详情视图信息）
5. 支持 `embed_url_pattern` 配置

## 2. 现状差距

| # | 差距 | 严重性 | 现状 |
|---|------|--------|------|
| 1 | 无 biz_key 并发控制 | 🔴 P0 | 创建实例不检查是否已有活动实例，可重复发起 |
| 2 | 无 capabilities 返回 | 🔴 P0 | tasks/[id] 和 instances/[id] 不返回可执行操作集 |
| 3 | 无 app_code 过滤 | 🔴 P0 | pending/done/initiated 不支持按应用过滤 |
| 4 | 无 business_view 返回 | 🟡 P1 | 详情接口不返回 embed_url 和视图模式 |
| 5 | 无 embed_url_pattern | 🟡 P1 | flow_action_defs 表缺少此字段 |
| 6 | by-biz 缺维度 | 🟡 P1 | 只按 resource_code + biz_id 查询，缺 app_code 和 action_code |
| 7 | initiated 缺 app_code 过滤 | 🟡 P1 | 接口已存在，但不支持按应用过滤 |
| 8 | 索引不完整 | 🟡 P2 | idx_biz 只覆盖 (resource_code, biz_id) |

## 3. 数据库变更

### 3.1 flow_action_defs 新增字段

```sql
ALTER TABLE flow_action_defs
  ADD COLUMN embed_url_pattern VARCHAR(500) NULL
  COMMENT '业务详情嵌入URL模式，变量：{app_base_url} {resource_code} {biz_id}'
  AFTER icon;
```

### 3.2 flow_instances 索引优化

```sql
-- 替换现有索引为 biz_key 组合索引
ALTER TABLE flow_instances
  DROP INDEX idx_biz,
  ADD INDEX idx_biz_key (app_code, resource_code, biz_id, action_code, status),
  ADD INDEX idx_initiator_app (initiator_uid, app_code, status, created_at);
```

说明：
- `idx_biz_key`：支持 biz_key 并发检查和 by-biz 查询
- `idx_initiator_app`：支持"我发起的"按 app_code 过滤

## 4. API 变更

### 4.0 submit / resubmit 语义约定

为避免实现歧义，先明确两种提交行为：

- `submit`：首次发起审批，**创建新实例**
- `resubmit`：实例被驳回后的再次提交，**复用原实例**

`resubmit` 的强约束：
- 不创建新的 `instance_id`
- 不生成新的 `instance_no`
- 原实例状态从 `rejected` 恢复为 `running`
- 原有 `flow_actions` 和已完成 `flow_tasks` 必须保留
- 仅取消旧的 pending 任务，并追加一条 `resubmit` 动作和新一轮任务

因此：
- “驳回后再次提交”不属于新的流程申请，而是同一实例的后续轮次
- 同一 `biz_key` 仍然满足“任一时刻最多一个活动实例”

### 4.1 创建实例 — biz_key 并发检查

**文件**：`server/api/v1/instances/index.post.ts`

**变更**：在 INSERT 前检查同 biz_key 是否已有活动实例

```typescript
// 在创建实例前新增检查
const actionDef = ... // 已有：查询 action_def 获取 app_code, resource_code, action_code

const existingActive = await queryRow<RowDataPacket>(
  `SELECT id, instance_no, status FROM flow_instances
   WHERE app_code = ? AND resource_code = ? AND biz_id = ? AND action_code = ?
     AND status IN ('running', 'suspended')
   LIMIT 1`,
  [actionDef.app_code, actionDef.resource_code, body.biz_id, actionDef.action_code]
)

if (existingActive) {
  throw createError({
    statusCode: 409,
    message: `该业务已有进行中的审批流程（${existingActive.instance_no}）`
  })
}
```

### 4.2 任务详情 — 增加 capabilities 和 business_view

**文件**：`server/api/v1/tasks/[id].get.ts`

**新增工具函数** `server/utils/capabilities.ts`：

```typescript
/**
 * 构建当前用户对流程实例的操作能力集
 */
export function buildCapabilities(
  instance: FlowInstance,
  task: FlowTask | null,
  currentUid: string
) {
  const isAssignee = task?.assignee_uid === currentUid && task?.status === 'pending'
  const isInitiator = instance.initiator_uid === currentUid
  const isRunning = instance.status === 'running'
  const isRejected = instance.status === 'rejected'

  let config: Record<string, any> = {}
  try {
    const snapshot = typeof instance.flow_snapshot === 'string'
      ? JSON.parse(instance.flow_snapshot)
      : instance.flow_snapshot
    config = snapshot?.config || {}
  } catch {
    // ignore
  }

  return {
    can_approve: isAssignee && isRunning,
    can_reject: isAssignee && isRunning,
    can_delegate: isAssignee && isRunning && !!config.allow_delegate,
    can_cancel: isInitiator && isRunning && !!config.allow_withdraw,
    can_resubmit: isInitiator && isRejected && !!config.allow_resubmit,
    can_comment: isRunning
  }
}

/**
 * 构建业务详情视图信息
 *
 * mode 判断逻辑：
 * - 同应用 + 有 embed_url_pattern → 'local'（表示优先本地渲染，不保证本地视图一定存在）
 * - 跨应用 + 有 embed_url_pattern → 'iframe'
 * - 无 embed_url_pattern → 'external-link'（仅提供 biz_url 跳转）
 *
 * 注意：
 * - mode='local' 仅表示“当前请求来自同应用，优先尝试本地视图”
 * - 是否真的能本地渲染，取决于 foundation/业务模块是否已注册对应 resource_code 的只读视图解析器
 * - 若本地解析器不存在，WorkflowBusinessView 必须 fallback 到 iframe 或 external-link
 */
export function buildBusinessView(
  instance: { app_code: string, resource_code: string, biz_id: string, biz_url?: string | null },
  embedUrlPattern: string | null,
  requestAppCode: string
) {
  const isSameApp = requestAppCode === instance.app_code

  // 无 embed_url_pattern 时只能提供外部链接
  if (!embedUrlPattern) {
    return {
      mode: 'external-link' as const,
      app_code: instance.app_code,
      resource_code: instance.resource_code,
      biz_id: instance.biz_id,
      biz_url: instance.biz_url || null,
      embed_url: null
    }
  }

  // 构建 embed URL（{app_base_url} 保留，由前端替换）
  const embedUrl = embedUrlPattern
    .replace('{resource_code}', instance.resource_code)
    .replace('{biz_id}', instance.biz_id)

  return {
    mode: isSameApp ? 'local' as const : 'iframe' as const,
    app_code: instance.app_code,
    resource_code: instance.resource_code,
    biz_id: instance.biz_id,
    biz_url: instance.biz_url || null,
    embed_url: embedUrl
  }
}
```

**tasks/[id].get.ts 返回体扩展**：

在现有返回的 `task`、`instance`、`tasks`、`actions` 基础上新增：

```typescript
// 查询 action_def 获取 embed_url_pattern
const actionDef = await queryRow<RowDataPacket>(
  'SELECT embed_url_pattern FROM flow_action_defs WHERE id = ?',
  [instance.action_def_id]
)

// 获取请求方的 app_code（通过 query 参数传入，见第 5 节）
const requestAppCode = (getQuery(event).request_app_code as string) || ''

return {
  code: 0,
  data: {
    task,
    instance,
    tasks,        // 该实例所有任务
    actions,      // 所有审批动作（即 timeline 数据）
    capabilities: buildCapabilities(instance, task, currentUser),
    business_view: buildBusinessView(instance, actionDef?.embed_url_pattern, requestAppCode)
  }
}
```

### 4.3 实例详情 — 同步扩展

**文件**：`server/api/v1/instances/[id].get.ts`

与 4.2 相同，新增 `capabilities` 和 `business_view`。

capabilities 中 `task` 参数传当前用户在该实例中的 pending 任务（如果有）：

```typescript
// 查找当前用户在此实例中的 pending 任务
const myTask = await queryRow<RowDataPacket>(
  `SELECT * FROM flow_tasks
   WHERE instance_id = ? AND assignee_uid = ? AND status = 'pending'
   LIMIT 1`,
  [instance.id, currentUser]
)

return {
  code: 0,
  data: {
    ...existingFields,
    capabilities: buildCapabilities(instance, myTask, currentUser),
    business_view: buildBusinessView(instance, actionDef?.embed_url_pattern, requestAppCode)
  }
}
```

### 4.4 待办/已办/我发起的 — 增加 app_code 过滤

**文件**：
- `server/api/v1/tasks/pending.get.ts`（改造）
- `server/api/v1/tasks/done.get.ts`（改造）
- `server/api/v1/tasks/initiated.get.ts`（改造，接口已存在）

三个接口统一增加 `app_code` 查询参数：

```typescript
const query = getQuery(event)
const page = parseInt(query.page as string) || 1
const pageSize = parseInt(query.page_size as string) || 20
const appCode = (query.app_code as string) || ''  // 新增

// SQL 条件动态构建（以 pending 为例）
const conditions = ['t.assignee_uid = ?', "t.status = 'pending'", "i.status = 'running'"]
const params: any[] = [currentUser]

if (appCode) {
  conditions.push('i.app_code = ?')
  params.push(appCode)
}

const whereClause = conditions.join(' AND ')
```

`initiated.get.ts` 同理，在现有 `status` 过滤基础上增加 `app_code` 条件。

### 4.5 by-biz — 强制完整 biz_key 查询

**文件**：`server/api/v1/instances/by-biz.get.ts`

**关键变更**：`action_code` 改为**必填参数**，与 biz_key 语义一致。

```typescript
const query = getQuery(event)
const appCode = query.app_code as string
const resourceCode = query.resource_code as string
const bizId = query.biz_id as string
const actionCode = query.action_code as string
const includeHistory = query.include_history === 'true'

// 四个字段全部必填
if (!appCode || !resourceCode || !bizId || !actionCode) {
  throw createError({
    statusCode: 400,
    message: '缺少必填参数：app_code, resource_code, biz_id, action_code'
  })
}

const conditions = ['app_code = ?', 'resource_code = ?', 'biz_id = ?', 'action_code = ?']
const params: any[] = [appCode, resourceCode, bizId, actionCode]

if (!includeHistory) {
  conditions.push("status IN ('running', 'suspended')")
}

const instance = await queryRow(
  `SELECT * FROM flow_instances
   WHERE ${conditions.join(' AND ')}
   ORDER BY id DESC LIMIT 1`,
  params
)

// 如果找到实例，附带 capabilities
let capabilities = null
if (instance) {
  const currentUser = getCookie(event, 'auth_user') || ''
  const myTask = await queryRow(
    `SELECT * FROM flow_tasks
     WHERE instance_id = ? AND assignee_uid = ? AND status = 'pending' LIMIT 1`,
    [instance.id, currentUser]
  )
  capabilities = buildCapabilities(instance, myTask, currentUser)
}

return {
  code: 0,
  data: instance ? { ...instance, capabilities } : null
}
```

> 如果需要"查某业务对象全部动作的历史实例"，应另开接口 `GET /api/v1/instances/by-resource?app_code=X&resource_code=Y&biz_id=N`，不复用 by-biz。

## 5. 请求方 app_code 传递方案

### 问题

workflow-proxy 需要告诉 workflow "请求来自哪个应用"，以便 business_view 判断 local/iframe。

`setHeader(event, ...)` 是设置**响应头**，不会转发给上游。`proxyRequest` 需要通过 `headers` 选项或 URL 参数传递。

### 方案：通过 query 参数传递

最简单可靠的方式——proxy 在转发 URL 上追加 `request_app_code` 参数：

```typescript
// foundation/server/api/workflow-proxy/[...path].ts
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const workflowBaseUrl = (config as any).hzy?.workflowApiUrl || 'http://localhost:3020'
  const path = getRouterParam(event, 'path') || ''
  const appCode = (config.public as any)?.appName || ''

  // 获取原始 query 参数
  const originalQuery = getQuery(event)
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(originalQuery)) {
    if (value !== undefined && value !== null) {
      queryParams.set(key, String(value))
    }
  }
  // 追加请求来源应用编码
  queryParams.set('request_app_code', appCode)

  const targetUrl = `${workflowBaseUrl}/api/v1/${path}?${queryParams.toString()}`
  return proxyRequest(event, targetUrl)
})
```

workflow 端统一从 `getQuery(event).request_app_code` 读取来源应用，而非 header。

> 如果后续需要 header 方式，可改用 `proxyRequest(event, url, { headers: { 'x-app-code': appCode } })`，但 query 参数方案更透明、调试更方便。

## 6. 迁移 SQL

将以上数据库变更合并为一个迁移文件：

**文件**：`docs/migrations/002_foundation_integration.sql`

```sql
-- ============================================================
-- Migration: 002_foundation_integration
-- Purpose: 支持 Foundation Layer 审批中心集成
-- Date: 2026-03-31
-- ============================================================

-- 1. flow_action_defs 新增 embed_url_pattern
ALTER TABLE flow_action_defs
  ADD COLUMN embed_url_pattern VARCHAR(500) NULL
  COMMENT '业务详情嵌入URL模式，变量：{app_base_url} {resource_code} {biz_id}'
  AFTER icon;

-- 2. flow_instances 索引优化
-- 删除旧索引
ALTER TABLE flow_instances DROP INDEX idx_biz;

-- 新增 biz_key 组合索引（并发检查 + by-biz 查询）
ALTER TABLE flow_instances
  ADD INDEX idx_biz_key (app_code, resource_code, biz_id, action_code, status);

-- 新增发起人+应用索引（"我发起的"查询）
ALTER TABLE flow_instances
  ADD INDEX idx_initiator_app (initiator_uid, app_code, status, created_at);

-- 3. 为现有 action_defs 补充 embed_url_pattern（按实际配置填写）
-- UPDATE flow_action_defs
--   SET embed_url_pattern = '{app_base_url}/embed/project/{biz_id}'
--   WHERE app_code = 'aims' AND resource_code = 'project';
```

## 7. 实施顺序

| 步骤 | 内容 | 依赖 | 涉及文件 |
|------|------|------|----------|
| 1 | 执行迁移 SQL | 无 | `docs/migrations/002_foundation_integration.sql` |
| 2 | 新增 `capabilities.ts` | 无 | `server/utils/capabilities.ts` |
| 3 | 改造创建实例（biz_key 并发检查） | 步骤 1 | `server/api/v1/instances/index.post.ts` |
| 4 | 改造待办/已办/我发起的（app_code 过滤） | 无 | `pending.get.ts`、`done.get.ts`、`initiated.get.ts` |
| 5 | 改造任务详情（capabilities + business_view） | 步骤 2 | `server/api/v1/tasks/[id].get.ts` |
| 6 | 改造实例详情（capabilities + business_view） | 步骤 2 | `server/api/v1/instances/[id].get.ts` |
| 7 | 改造 by-biz（完整 biz_key + 强制 action_code） | 步骤 1, 2 | `server/api/v1/instances/by-biz.get.ts` |
| 8 | 新增 workflow-proxy | 步骤 4-7 | `foundation/server/api/workflow-proxy/[...path].ts` |

步骤 3-7 可并行开发，互不依赖（除了共用 capabilities.ts 工具函数）。

## 8. 回调与状态同步

### 8.1 回调 payload

回调 payload 已包含 `app_code`、`resource_code`、`action_code`、`biz_id` 四个字段，组合即为 `biz_key`。**回调代码无需结构性改动**，但需确保：

- payload 中四个字段在所有回调场景下（approved/rejected/cancelled）均完整填充
- 回调请求携带 Console service token，业务模块按 `aud`、`scope=workflow:callback`、`token_use=service` 和来源应用校验

### 8.2 回调失败补偿

当前回调实现是 fire-and-forget（`callbackService.ts` 中错误仅 console.error，不阻塞主流程）。升级要求：

1. **记录回调结果**：在 `flow_instances` 或独立表中记录回调状态（pending/success/failed）和重试次数
2. **自动重试**：失败后按退避策略重试（如 1min、5min、30min），最多 3 次
3. **补偿查询**：提供 `GET /api/v1/instances/callback-failed` 接口，列出回调失败的实例，供人工补偿

> 重试和补偿机制可作为 Phase 3 之后的增强项，不阻塞 MVP 交付。MVP 阶段保持 fire-and-forget，但需记录回调日志。

### 8.3 业务模块回调接口要求

若业务模块启用回调，需实现：

```typescript
// POST /api/v1/workflow-callback
// Headers: Authorization: Bearer <Console service token>, X-Workflow-Event
// Body: { event, instance_id, instance_no, app_code, resource_code,
//         action_code, biz_id, status, form_data, completed_at, initiator_uid }

// 要求：
// 1. 校验 Console service token：token_use=service、aud、scope=workflow:callback、来源应用 workflow
// 2. 幂等处理：按 instance_id + status 去重
// 3. 更新业务状态（如项目从"审批中"转为"已立项"）
```

## 9. 测试与验收标准

### 9.1 自动化测试最小集合

| 类别 | 场景 | 验收标准 |
|------|------|----------|
| **biz_key 并发** | 同一 biz_key 发起两次 | 第二次返回 409 |
| **biz_key 并发** | 驳回后重新提交同一 biz_key | 成功恢复原实例为 running，且不存在第二个活动实例 |
| **biz_key 并发** | 已通过后再次发起同一 biz_key | 成功创建新实例（历史不影响） |
| **resubmit 语义** | 驳回后重新提交 | `instance_id` 不变，`instance_no` 不变 |
| **resubmit 语义** | 驳回后重新提交 | 时间线保留首轮 submit/approve/reject 记录，并追加 `resubmit` |
| **capabilities** | 审批人查看 pending 任务 | `can_approve=true, can_reject=true` |
| **capabilities** | 非审批人查看同实例 | `can_approve=false, can_reject=false` |
| **capabilities** | 发起人查看被驳回实例 | `can_resubmit` 根据 flow_config 返回 |
| **capabilities** | 实例已通过/已取消 | 所有 can_* 均为 false |
| **app_code 过滤** | pending?app_code=aims | 只返回 aims 的待办 |
| **app_code 过滤** | pending（无 app_code） | 返回所有待办（全局审批中心） |
| **by-biz** | 缺少 action_code | 返回 400 |
| **by-biz** | 完整 biz_key，有活动实例 | 返回实例 + capabilities |
| **by-biz** | 完整 biz_key，无活动实例 | 返回 null |
| **by-biz** | include_history=true | 返回最近历史实例 |
| **business_view** | 同应用请求 + 有 embed_url_pattern | `mode=local`，且前端可按解析器注册情况 fallback |
| **business_view** | 跨应用请求 + 有 embed_url_pattern | `mode=iframe` |
| **business_view** | 无 embed_url_pattern | `mode=external-link` |
| **回调** | 审批通过后触发回调 | payload 包含完整 biz_key 四字段 |
| **回调** | 回调失败 | 不阻塞主流程，错误被记录 |

### 9.2 手动验收清单

| 测试项 | 验证内容 |
|--------|----------|
| aims 审批中心 | `/approval/tasks` 只显示 aims 的待办 |
| workflow 全局审批中心 | `/approval/tasks` 显示所有模块待办 |
| 审批处理页面 | 左侧正确加载业务详情（local 或 iframe） |
| WorkflowPanel | 按钮与 capabilities 一致 |
| WorkflowBadge | 按 biz_key 查询并正确显示状态 |
| 重复发起拦截 | 已有活动实例时提示"已有进行中的审批" |
| 驳回后重提 | 驳回后可重新提交，复用原实例且不被并发检查误拦截 |
| 历史审批轨迹 | 重新提交后仍可查看第一轮审批过程 |
