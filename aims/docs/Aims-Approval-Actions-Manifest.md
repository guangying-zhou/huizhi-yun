# Aims 审批动作清单设计

> 目标：将“资源定义”和“审批动作定义”分离；资源作为 Platform manifest 能力声明，不再由 Aims runtime 启动同步；审批动作暂时仍同步到 Workflow。

## 1. 背景

当前 Aims 模块在 [app/config/permissions.ts](/Users/gavin/Dev/huizhi-yun/aims/app/config/permissions.ts) 中维护：

- `appCode`
- `appManifest.resources`
- `routeRules`

其中 `appManifest.resources` 表达 Aims 的资源能力声明，由 Platform 发布/导入链路登记；Workflow 中的审批动作由 `flow_action_defs` 独立管理，主键语义为 `app_code + resource_code + action_code`。

本方案在此基础上新增独立的 `approvalActions` manifest，使资源和审批动作分别进入各自的管理边界。

## 2. 设计目标

1. `appManifest.resources` 只表达权限资源，不承载审批动作配置
2. 新增 `approvalActions`，作为业务模块声明“可配置审批事项”的单一数据源
3. 资源注册不再由 runtime 启动触发，改由 Platform release/import 流程承接
4. 审批动作同步链路直接发往 Workflow
5. Workflow 继续以 `flow_action_defs` 作为审批动作真源

## 3. 职责边界

### 3.1 Account

负责：

- 迁移期登录/审计等 legacy 能力

不负责：

- 新资源注册
- 新角色权限治理
- 审批动作定义
- 表单 schema
- 业务详情嵌入规则
- 流程路由配置

### 3.2 Workflow

负责：

- 审批动作定义
- 动作对应的表单 schema
- 审批路由/流程模板
- 审批实例与任务

### 3.3 Aims

负责：

- 以 manifest 方式声明本模块有哪些资源
- 以 manifest 方式声明本模块有哪些审批动作
- 运行时不注册资源 manifest；审批动作在 Workflow 尚未并入 Console 前仍可启动同步

## 4. Manifest 设计

建议将 [app/config/permissions.ts](/Users/gavin/Dev/huizhi-yun/aims/app/config/permissions.ts) 重构为两类清单：

- `appManifest.resources`
- `approvalActions`

### 4.1 appManifest.resources

作为 Platform manifest 能力声明：

```ts
export const appManifest = {
  appCode: 'aims',
  resources: [
  { code: 'dashboard', name: '工作台' },
  { code: 'projects', name: '项目管理' },
  { code: 'work_items', name: '工作项管理' },
  { code: 'reports', name: '报表统计' },
  { code: 'admin', name: '系统管理' }
  ]
}
```

### 4.2 approvalActions

新增审批动作清单：

```ts
export const approvalActions = [
  {
    resourceCode: 'projects',
    actionCode: 'initiation',
    name: '立项审批',
    description: '项目立项审批',
    formSchemaCode: 'aims_project_initiation',
    icon: 'i-lucide-rocket',
    embedUrlPattern: '{app_base_url}/embed/project/{biz_id}',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'projects',
    actionCode: 'finish',
    name: '结项审批',
    description: '项目结项审批',
    formSchemaCode: 'aims_project_finish',
    icon: 'i-lucide-flag',
    embedUrlPattern: '{app_base_url}/embed/project/{biz_id}',
    sortOrder: 20,
    enabled: true
  }
]
```

### 4.3 类型建议

```ts
export interface ApprovalActionManifestItem {
  resourceCode: string
  actionCode: string
  name: string
  description?: string
  formSchemaCode?: string
  icon?: string
  embedUrlPattern?: string
  sortOrder?: number
  enabled?: boolean
}
```

说明：

- `resourceCode` 必须对应 `appManifest.resources` 中已声明的资源
- `actionCode` 使用稳定编码，如 `initiation`、`finish`
- `formSchemaCode` 优先使用逻辑编码，而不是数据库 ID，避免跨环境不一致
- `enabled=false` 表示 manifest 中保留该动作，但同步时应将 Workflow 中对应 action 标记停用

## 5. 同步方案

### 5.1 资源注册

已下线 Aims runtime 启动同步：

- 来源：[app/config/permissions.ts](/Users/gavin/Dev/huizhi-yun/aims/app/config/permissions.ts)
- 触发器：Platform release/import 流程
- 目标：Platform app manifest / manifest resources

约束：

- Aims runtime 启动时不得调用 Account `/api/v1/resources/sync`。
- Aims runtime 启动时不得隐式创建 Platform manifest registration。
- Platform 从受控发布/导入路径登记资源，支持审核、版本与回滚。

### 5.2 审批动作同步

新增一条并行链路：

- 来源：`approvalActions`
- 触发器：新增 `server/plugins/sync-approval-actions.ts`
- 目标接口：Workflow 新增 `POST /api/v1/action-defs/sync`

触发时机：

- 应用服务启动后延迟数秒执行
- 配置缺失则跳过
- 同步失败仅记录日志，不阻塞服务启动

## 6. Workflow 接口草案

### 6.1 请求

```http
POST /api/v1/action-defs/sync
Authorization: Bearer {apiKey}:{apiSecret}
Content-Type: application/json
```

```json
{
  "appCode": "aims",
  "actions": [
    {
      "resourceCode": "projects",
      "actionCode": "initiation",
      "name": "立项审批",
      "description": "项目立项审批",
      "formSchemaCode": "aims_project_initiation",
      "icon": "i-lucide-rocket",
      "embedUrlPattern": "{app_base_url}/embed/project/{biz_id}",
      "sortOrder": 10,
      "enabled": true
    }
  ]
}
```

### 6.2 字段映射

建议映射到 `flow_action_defs`：

| Manifest 字段 | Workflow 字段 |
|---|---|
| `appCode` | `app_code` |
| `resourceCode` | `resource_code` |
| `actionCode` | `action_code` |
| `name` | `name` |
| `description` | `description` |
| `icon` | `icon` |
| `embedUrlPattern` | `embed_url_pattern` |
| `sortOrder` | `sort_order` |
| `enabled` | `status`（1/0） |
| `formSchemaCode` | 通过 code 查出 `form_schema_id` 后写入 |

### 6.3 同步语义

与资源 manifest 的治理语义保持一致：

- 新动作 -> 插入
- 已存在且字段变化 -> 更新
- manifest 中缺失 -> 标记停用

不建议自动物理删除。

## 7. Foundation 共享同步能力

为避免 `aims`、`codocs`、`workflow` 各自重复实现一套近似相同的同步逻辑，建议将“同步机制”下沉到 Foundation 作为共享能力，但 **manifest 的定义与触发责任仍保留在各业务应用内**。

### 7.1 适合放到 Foundation 的内容

- manifest 类型定义
- manifest 校验函数
- 调用 Workflow `action-defs/sync` 的通用请求封装
- 通用 Nitro plugin factory 或 helper

例如可抽到：

- `foundation/app/types/manifest.ts`
- `foundation/server/utils/syncResourcesManifest.ts`
- `foundation/server/utils/syncApprovalActionsManifest.ts`
- `foundation/server/utils/createManifestSyncPlugin.ts`

### 7.2 不应放到 Foundation 的内容

- `aims` 自己的 `resources`
- `aims` 自己的 `approvalActions`
- 业务模块自己的 `appCode`
- 具体某个应用是否启用某条审批动作

这些仍然应该保留在业务模块侧，因为它们属于业务清单本身，而不是同步机制。

### 7.3 推荐使用方式

各应用只保留很薄的一层 plugin：

1. 读取本应用 manifest
2. 调用 Foundation 提供的通用同步函数
3. 记录本应用维度的同步日志

这样最终形成：

- `resources` / `approvalActions` 的真源在业务模块
- 同步算法和请求封装在 Foundation
- 各应用只负责“声明”和“触发”

### 7.4 这样设计的好处

1. 避免各模块复制粘贴同步插件
2. 同步请求格式在全局保持一致
3. 后续若 Account 或 Workflow 接口变更，只需要在 Foundation 改一处
4. 不会把 Foundation 变成资源/审批清单的配置中心

## 8. formSchemaCode 解析策略

由于 Workflow 表使用的是 `form_schema_id`，而业务模块更适合声明稳定的逻辑编码，因此同步接口内部建议支持：

1. 优先接收 `formSchemaCode`
2. Workflow 内部根据 `(app_code, schema_code)` 或全局 `schema_code` 查询表单 schema
3. 解析成功后写入 `form_schema_id`
4. 若 `formSchemaCode` 不存在，接口返回 400 并附具体 action 标识

这样可以避免业务模块在 manifest 中直接写数据库 ID。

## 9. Aims 侧实施建议

### Phase 1

- 在 [app/config/permissions.ts](/Users/gavin/Dev/huizhi-yun/aims/app/config/permissions.ts) 新增 `approvalActions`
- 抽出 `ApprovalActionManifestItem` 类型

### Phase 2

- 新增 `server/plugins/sync-approval-actions.ts`
- 启动时读取 `approvalActions`
- 调用 Workflow 的动作同步接口

### Phase 3

- 为 `initiation` 补第一条 manifest 数据
- 后续新增 `finish` 时仅需修改 manifest

## 10. Workflow 侧实施建议

### Phase 1

- 新增 `POST /api/v1/action-defs/sync`
- 支持按 `(app_code, resource_code, action_code)` upsert

### Phase 2

- 支持 `formSchemaCode -> form_schema_id` 解析
- 支持 `embedUrlPattern`

### Phase 3

- 管理后台展示 manifest 同步后的动作定义
- 支持停用状态可视化

## 11. 验证点

至少覆盖以下场景：

1. `approvalActions` 中声明新动作，Workflow 成功插入
2. 修改 `name` / `description` / `sortOrder`，Workflow 成功更新
3. `enabled=false`，Workflow 将对应动作标记停用
4. `resourceCode` 未在 `resources` 中声明时，同步失败
5. `formSchemaCode` 不存在时，同步失败
6. manifest 删除某个动作后，Workflow 将旧动作标记停用

## 12. 结论

最终采用双 manifest、双同步链路：

- `resources -> Account`
- `approvalActions -> Workflow`

同时在工程实现上补充一层共享同步基座：

- `Foundation -> 提供通用同步函数`
- `各业务应用 -> 提供 manifest 并在启动时调用`

这样可以保持：

- Account 是权限中心
- Workflow 是审批动作中心
- Foundation 只负责共享同步机制
- Aims 只负责声明自己拥有哪些资源与审批动作

这是当前实现条件下边界最清晰、后续扩展成本最低的方案。
