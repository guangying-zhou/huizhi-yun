# Console 整合 Workflow Runtime 实现计划

状态：Draft  
日期：2026-04-26  
定位：把现有独立 `workflow` 审批流程引擎收敛为 `console.workflow-runtime` 的实施方案；配套 `Huizhi-yun-Architecture.md`、`Console-Directory-Runtime-Integration-Plan.md`、`foundation/docs/Workflow-Integration-Guide.md`。

---

## 1. 背景与决策

### 1.1 背景

当前企业端基础能力正在从多个独立服务收敛到 `console`：

- `account` 的目录与本地 auth 能力迁入 `console.directory-runtime / auth-runtime`。
- `workflow` 当前作为独立服务运行在 3020，数据库为 `hzy_workflow`。
- 业务应用通过 Foundation 调用 Workflow 服务发起审批、查询待办、接收回调。

如果 `account` 已经并入 `console`，继续保留独立 `workflow` 会带来类似问题：

- 企业私有化部署仍需要多部署一个基础服务和数据库。
- Workflow 审批人解析依赖目录，迁移后应直接读 `console.directory-runtime`，不应再走 Account。
- 基础运行时拆得过散，`console.env / license.lic / runtime token / service client / vault` 等能力无法统一管理。
- 审批配置、流程实例、待办和登录/session 都属于客户侧本地运行数据，天然适合放在 Console。

### 1.2 决策

目标形态：

```text
console =
  org-profile
  system-settings
  integration-config
  credential-vault
  service-client
  directory-runtime
  auth-runtime
  workflow-runtime
  account-compat facade（迁移期）
  workflow-compat facade（迁移期）
```

`workflow-runtime` 是 Console 内的逻辑域，不是简单把 Workflow 代码无边界地混入 Console。它必须保持独立 API、独立表前缀、独立 engine/service 目录，以便未来必要时重新拆成独立服务。

### 1.3 不做什么

- 不把业务对象终态放进 workflow-runtime。审批通过后，业务状态仍由 Aims / Codocs / Altoc / Assets / Align 自己更新。
- 不把 Platform 授权治理塞进 workflow-runtime。审批动作可来自 app manifest，但授权、订阅、License、policy bundle 仍由 Platform 负责。
- 不在业务应用中直连 Console workflow 表。业务应用只能通过 Foundation workflow adapter 或 Console Workflow API 调用。
- 不在 MVP 引入完整 BPMN、可视化复杂编排、异步长任务编排平台；当前仍定位为轻量审批流。

---

## 2. 现状盘点

### 2.1 当前 Workflow 页面

| 页面 | 当前职责 | Console 目标位置 |
|------|----------|------------------|
| `/admin/actions` | 审批业务动作管理、绑定流程/表单/默认路由 | `/workflow/admin/actions` |
| `/admin/flows` | 流程定义管理、模板复制、节点配置 | `/workflow/admin/flows` |
| `/admin/forms` | 动态表单定义管理 | `/workflow/admin/forms` |
| `/admin/routes` | 条件路由规则管理 | `/workflow/admin/routes` |
| `/tasks` | 我的待办/已办 | `/workflow/tasks` |
| `/tasks/{id}` | 任务详情、审批/拒绝/委托 | `/workflow/tasks/{id}` |
| `/instances` | 我发起的流程 | `/workflow/instances` |
| `/instances/{id}` | 流程实例详情 | `/workflow/instances/{id}` |
| `/login` | 独立 Workflow 登录页 | 删除，统一用 Console auth-runtime |

### 2.2 当前 Workflow API

| API | 用途 | Console 目标路径 |
|-----|------|------------------|
| `POST /api/v1/action-defs/sync` | 业务应用同步审批动作 | `POST /api/v1/console/workflow/action-defs/sync` |
| `GET /api/v1/actions` | 查询可发起动作 | `GET /api/v1/console/workflow/actions` |
| `/api/v1/admin/action-defs/**` | 管理审批动作 | `/api/v1/console/workflow/admin/action-defs/**` |
| `/api/v1/admin/flow-schemas/**` | 管理流程定义 | `/api/v1/console/workflow/admin/flow-schemas/**` |
| `/api/v1/admin/form-schemas/**` | 管理表单定义 | `/api/v1/console/workflow/admin/form-schemas/**` |
| `/api/v1/admin/routes/**` | 管理路由规则 | `/api/v1/console/workflow/admin/routes/**` |
| `POST /api/v1/instances/prepare` | 匹配路由、准备表单 | `POST /api/v1/console/workflow/instances/prepare` |
| `POST /api/v1/instances` | 创建审批实例 | `POST /api/v1/console/workflow/instances` |
| `GET /api/v1/instances/{id}` | 实例详情 | `GET /api/v1/console/workflow/instances/{id}` |
| `POST /api/v1/instances/{id}/cancel` | 撤销实例 | `POST /api/v1/console/workflow/instances/{id}/cancel` |
| `POST /api/v1/instances/{id}/resubmit` | 驳回后重提 | `POST /api/v1/console/workflow/instances/{id}/resubmit` |
| `GET /api/v1/instances/by-biz` | 按业务键查询当前审批 | `GET /api/v1/console/workflow/instances/by-biz` |
| `GET /api/v1/instances/by-biz-history` | 按业务键查询历史审批 | `GET /api/v1/console/workflow/instances/by-biz-history` |
| `GET /api/v1/tasks/pending` | 待办 | `GET /api/v1/console/workflow/tasks/pending` |
| `GET /api/v1/tasks/done` | 已办 | `GET /api/v1/console/workflow/tasks/done` |
| `GET /api/v1/tasks/initiated` | 我发起的 | `GET /api/v1/console/workflow/tasks/initiated` |
| `GET /api/v1/tasks/{id}` | 任务详情 | `GET /api/v1/console/workflow/tasks/{id}` |
| `POST /api/v1/tasks/{id}/approve` | 同意 | `POST /api/v1/console/workflow/tasks/{id}/approve` |
| `POST /api/v1/tasks/{id}/reject` | 拒绝 | `POST /api/v1/console/workflow/tasks/{id}/reject` |
| `POST /api/v1/tasks/{id}/delegate` | 委托 | `POST /api/v1/console/workflow/tasks/{id}/delegate` |

兼容期可在 Console 中保留旧 `/api/v1/workflow/**` 或 `/api/v1/**` 代理别名，但新增调用必须使用 `/api/v1/console/workflow/**`。

### 2.3 当前数据表

MVP 迁移保留现有表名，降低代码和数据迁移成本：

- `flow_schemas`
- `form_schemas`
- `flow_action_defs`
- `flow_routes`
- `flow_instances`
- `flow_tasks`
- `flow_actions`
- `flow_callback_logs`
- `system_parameters` 中与 workflow 相关的配置迁入 Console `system_parameters` 或 `system_settings`

说明：这些表虽然仍叫 `flow_*`，但迁入 `hzy_console` 后归属为 `console.workflow-runtime`。未来如需拆出独立 Workflow 服务，可以整体复制这些表和 `/api/v1/console/workflow/**` handler。

### 2.4 当前外部依赖

| 依赖 | 当前方式 | 目标方式 |
|------|----------|----------|
| 用户/部门/角色查询 | `@hzy/foundation/server/utils/accountApi` | `console.directory-runtime` 或 Foundation directory adapter |
| 登录态 | Foundation legacy `token + auth_user` | Console `local_sessions` + 兼容 cookie |
| 权限判断 | 当前 Workflow 本地 checkPermission / Account 权限 | Platform policy bundle / Console admin 本地权限，MVP 先保留最小管理权限 |
| 回调业务应用 | `callback_url + WORKFLOW_CALLBACK_SECRET` | Console vault/service client 管理回调密钥，签名协议保持兼容 |
| 通知 | 企业微信 / notifications API | Console integrations + notification facade |

---

## 3. 目标架构

### 3.1 运行时关系

```text
business apps
  -> foundation workflow adapter
  -> console workflow-runtime
  -> console directory-runtime（审批人解析）
  -> business app callback（审批完成）
```

```text
platform
  -> governance only
  -> app manifest / entitlement / policy bundle
  -> 不读取 workflow 实例、表单、待办明细
```

### 3.2 Console 内部目录建议

```text
console/
  app/pages/workflow/
    admin/actions.vue
    admin/flows.vue
    admin/forms.vue
    admin/routes.vue
    tasks/index.vue
    tasks/[id].vue
    instances/index.vue
    instances/[id].vue
  server/api/v1/console/workflow/
    action-defs/sync.post.ts
    actions/index.get.ts
    admin/action-defs/**
    admin/flow-schemas/**
    admin/form-schemas/**
    admin/routes/**
    instances/**
    tasks/**
  server/utils/workflow/
    flowEngine.ts
    routeMatcher.ts
    callbackService.ts
    capabilities.ts
    assigneeResolver.ts
    workflowDb.ts
```

### 3.3 Console 导航建议

在 Console 管理面新增：

- `流程 / 待办任务`
- `流程 / 我发起的`
- `流程管理 / 审批业务`
- `流程管理 / 流程定义`
- `流程管理 / 表单定义`
- `流程管理 / 路由规则`
- `流程管理 / 回调日志`

---

## 4. 数据模型方案

### 4.1 表迁移策略

MVP 采用“原表名迁移”：

```text
hzy_workflow.flow_*  ->  hzy_console.flow_*
hzy_workflow.system_parameters(workflow only) -> hzy_console.system_parameters / system_settings
```

原因：

- 现有 Workflow API、engine、页面均以 `flow_*` 为核心语义。
- 原表已经具备较清晰的 workflow 边界。
- 改成 `workflow_*` 会产生大量无收益的代码重命名。
- 未来拆出服务时，`flow_*` 表也可以整体搬迁。

### 4.2 DDL 处理

新增迁移文件建议：

```text
docs/Console-SQL-Migration-v1-workflow-runtime.sql
```

内容：

1. 在 `hzy_console` 中创建 `flow_schemas / form_schemas / flow_action_defs / flow_routes / flow_instances / flow_tasks / flow_actions / flow_callback_logs`。
2. 保持与 `workflow/docs/workflow_schema.sql` + migrations 001-007 的最终结构一致。
3. 所有表使用 `utf8mb4_unicode_ci`，避免跨库迁移 collation 冲突。
4. 不建立到 `directory_users` 的强 FK，用户字段继续保存 `uid` 字符串，避免历史审批记录因用户删除而损坏。
5. 可增加必要索引：
   - `flow_instances(app_code, resource_code, biz_id, action_code, status)`
   - `flow_instances(initiator_uid, app_code, status, created_at)`
   - `flow_tasks(assignee_uid, status, created_at)`
   - `flow_callback_logs(status, created_at)`

### 4.3 数据迁移脚本

新增迁移文件建议：

```text
docs/Console-SQL-Migration-v1-workflow-data.sql
```

迁移顺序：

1. `form_schemas`
2. `flow_schemas`
3. `flow_action_defs`
4. `flow_routes`
5. `flow_instances`
6. `flow_tasks`
7. `flow_actions`
8. `flow_callback_logs`

约束：

- 迁移脚本必须可重复执行，使用 `ON DUPLICATE KEY UPDATE` 或先按业务键比对。
- 保留历史 `id`，否则 `flow_instances -> flow_tasks -> flow_actions` 引用会断。
- 若保留自增 ID，需要在 Console 空库或停写窗口执行。
- 迁移前冻结独立 Workflow 写入，迁移后切业务应用到 Console endpoint。
- 如果必须在线迁移，先全量导入，再按 `updated_at / id` 增量追平，最后短暂停写切流。

---

## 5. API 与鉴权方案

### 5.1 对外 API 命名空间

目标命名空间：

```text
/api/v1/console/workflow/**
```

兼容命名空间：

```text
/api/v1/workflow/**           # 可选兼容
/api/workflow-proxy/**        # Foundation 旧代理可短期保留
```

不建议在 Console 根 `/api/v1/**` 下继续直接暴露 Workflow 旧路径，避免和 Console 自身 API 混杂。

### 5.2 调用方鉴权

| 调用方 | API 类型 | 鉴权 |
|--------|----------|------|
| Console 管理员页面 | 管理 API | `console_session` + Console admin 权限 |
| 当前登录用户 | 待办/已办/发起/审批动作 | `console_session` |
| 业务应用服务端 | action sync / prepare / create / by-biz | Console `ServiceCredential` 或当前用户 session + app context |
| Workflow callback 到业务应用 | 回调业务应用 | 签名 webhook，secret 由 Console vault/service client 管理 |

### 5.3 app context

业务应用调用 Console workflow-runtime 必须携带稳定应用上下文：

```ts
type WorkflowAppContext = {
  appCode: string
  resourceCode?: string
  actionCode?: string
  requestUid?: string
}
```

来源优先级：

1. Foundation server adapter 从 `runtimeConfig.public.appCode` 注入 `x-hzy-app-code`。
2. 当前用户从 Console session 解析，不信任客户端传入的 uid。
3. ServiceCredential 需要绑定 `app_code` 和 scope，例如 `workflow:action-sync`、`workflow:instance:create`。

### 5.4 回调签名

保留现有 `WORKFLOW_CALLBACK_SECRET` 语义，但管理方式迁入 Console：

- secret 明文不再放业务模块 env。
- Console `vault_secrets` 保存 workflow callback signing secret。
- `workflow_callback_secrets` 可作为逻辑配置，引用 `secret_ref`。
- Header 建议：
  - `x-hzy-workflow-event`
  - `x-hzy-workflow-timestamp`
  - `x-hzy-workflow-signature`
- 签名 payload 使用原始 request body + timestamp，防重放窗口默认 5 分钟。

MVP 可先复用现有签名算法，但必须把 secret 生命周期纳入 Console vault。

---

## 6. Foundation Workflow Adapter 改造

### 6.1 环境变量

目标配置：

```env
HZY_WORKFLOW_PROVIDER=console
HZY_CONSOLE_API_URL=http://localhost:3000
HZY_CONSOLE_CLIENT_ID=...
HZY_CONSOLE_CLIENT_SECRET=...
```

不再要求：

```env
HZY_WORKFLOW_API_URL=http://localhost:3020
```

### 6.2 Adapter 行为

Foundation 提供统一工具：

```ts
createWorkflowClient(config)
syncApprovalActions(actions)
prepareWorkflowInstance(input)
createWorkflowInstance(input)
getWorkflowInstance(id)
getWorkflowInstanceByBiz(input)
listPendingTasks(options)
listDoneTasks(options)
approveTask(taskId, input)
rejectTask(taskId, input)
delegateTask(taskId, input)
```

实现要求：

- 所有请求指向 `HZY_CONSOLE_API_URL + /api/v1/console/workflow/**`。
- 自动注入 `x-hzy-app-code`。
- 服务端调用使用 Console ServiceCredential。
- 用户态调用使用当前 `console_session`。
- 不再新增对独立 `workflow` 服务 URL 的依赖。

### 6.3 业务应用迁移

业务应用迁移顺序：

1. 保持 `approvalActions` manifest 不变。
2. 修改同步插件，调用 Foundation workflow adapter。
3. 修改 `prepare/create/by-biz/tasks` API 代理，指向 Console workflow-runtime。
4. `.env.dev` 移除 `HZY_WORKFLOW_API_URL`，改用 `HZY_CONSOLE_API_URL`。
5. 验证审批发起、审批完成回调、状态同步。

---

## 7. 页面迁移方案

### 7.1 管理页

| 现有 Workflow 页面 | Console 目标页面 | 处理 |
|--------------------|------------------|------|
| `workflow/app/pages/admin/actions.vue` | `console/app/pages/workflow/admin/actions.vue` | 迁移，API 路径改为 `/api/v1/console/workflow/admin/action-defs` |
| `workflow/app/pages/admin/flows.vue` | `console/app/pages/workflow/admin/flows.vue` | 迁移，保留流程模板能力 |
| `workflow/app/pages/admin/forms.vue` | `console/app/pages/workflow/admin/forms.vue` | 迁移，保留 JSON form schema |
| `workflow/app/pages/admin/routes.vue` | `console/app/pages/workflow/admin/routes.vue` | 迁移，审批人解析改读 Console directory |
| `workflow/app/pages/admin/index.vue` | `console/app/pages/workflow/admin/index.vue` | 迁移为流程管理首页 |

### 7.2 用户页

| 现有 Workflow 页面 | Console 目标页面 | 处理 |
|--------------------|------------------|------|
| `workflow/app/pages/tasks/index.vue` | `console/app/pages/workflow/tasks/index.vue` | 迁移 |
| `workflow/app/pages/tasks/[id].vue` | `console/app/pages/workflow/tasks/[id].vue` | 迁移 |
| `workflow/app/pages/instances/index.vue` | `console/app/pages/workflow/instances/index.vue` | 迁移 |
| `workflow/app/pages/instances/[id].vue` | `console/app/pages/workflow/instances/[id].vue` | 迁移 |
| `workflow/app/pages/login.vue` | 删除 | 统一使用 Console 登录 |

---

## 8. 审批人解析改造

当前 `flowEngine.ts` 通过 Account 查询用户、部门、角色。迁入 Console 后改为：

| 审批人类型 | 目标来源 |
|------------|----------|
| `initiator` | 当前 session uid |
| `initiator_leader` | `directory_users.primary_dept_code` + `directory_departments.leader_uid` 或 manager/leader 关系 |
| `dept_manager` | `directory_departments.manager_uid` 或 `directory_user_departments.relation_type='manager'` |
| `dept_leader` | `directory_departments.leader_uid` 或 `relation_type='leader'` |
| `role` | Platform policy bundle / Console local admin role 映射，MVP 可先限制为目录关系角色 |
| `form_field` | 表单字段中的 uid / dept_code |

实现建议新增：

```text
console/server/utils/workflow/assigneeResolver.ts
```

职责：

- 不直接调用 Account。
- 只读 Console directory-runtime 表或 Directory API。
- 返回稳定 uid 列表。
- 对找不到审批人的情况返回明确错误 `WF_ASSIGNEE_NOT_RESOLVED`。

---

## 9. 实施阶段

### Phase 0：口径与开关

目标：先确认 workflow-runtime 并入 Console，但保留未来物理拆分边界。

任务：

- 更新架构文档：`workflow` 默认内置为 `console.workflow-runtime`，独立 `workflow` 仅作为过渡部署。
- 新增 Console runtimeConfig：`workflow.mode = disabled | primary`。
- Foundation 新增 `HZY_WORKFLOW_PROVIDER=console` 口径。
- 明确 Platform 只治理 Workflow capability，不读取 workflow 实例明细。

验收：

- 文档口径一致。
- 新部署清单不再把独立 `workflow` 作为必选服务。

### Phase 1：DDL 与数据迁移

目标：Console 具备承载 Workflow 数据的能力。

任务：

- 新增 `docs/Console-SQL-Migration-v1-workflow-runtime.sql`。
- 新增 `docs/Console-SQL-Migration-v1-workflow-data.sql`。
- 在 `hzy_console` 创建 `flow_*` 表。
- 从 `hzy_workflow` 全量迁移数据。
- 编写迁移校验 SQL：表计数、实例/任务/动作引用完整性、最新 pending task 对账。

验收：

- Console DB 中可查询完整 workflow 数据。
- 迁移后实例、任务、动作关联不丢失。

### Phase 2：Console Workflow API 落地

目标：Console 暴露 `/api/v1/console/workflow/**`，功能等价当前 Workflow API。

任务：

- 搬迁 `server/utils/flowEngine.ts / routeMatcher.ts / callbackService.ts / capabilities.ts` 到 `console/server/utils/workflow`。
- 搬迁管理 API、实例 API、任务 API 到 Console 新命名空间。
- 新增兼容路由，必要时代理旧 Workflow 路径。
- 回调 secret 改由 Console vault/config 管理。
- 通知发送改走 Console integrations / notification facade。

验收：

- `prepare -> create -> pending -> approve/reject -> callback` 全链路可在 Console 完成。
- 独立 Workflow 服务停掉后，Console API 仍可完成基础审批。

### Phase 3：审批人解析切到 Console Directory

目标：Workflow 不再依赖 Account 查询用户/部门。

任务：

- 新增 `assigneeResolver.ts`。
- 将 `flowEngine.ts` 中 Account API 调用替换为 Console directory-runtime。
- 处理 manager / leader / committee / role 等审批人类型。
- 对审批人缺失、部门缺失、角色无法解析提供明确错误。

验收：

- Account 停机后，发起审批仍可解析审批人。
- 用户、部门变更后，新发起实例使用最新目录快照；历史实例保留 `flow_snapshot` 不受影响。

### Phase 4：页面迁移

目标：管理员和用户不再进入独立 Workflow UI。

任务：

- 搬迁 `admin/actions / flows / forms / routes` 到 Console。
- 搬迁 `tasks / instances` 到 Console。
- Console 导航新增流程入口。
- 删除独立 Workflow 登录页使用场景。
- 独立 Workflow UI 加 deprecated 提示或跳转到 Console。

验收：

- Console 可完成流程配置、待办审批、实例查询。
- 用户只需要登录 Console 即可访问审批中心。

### Phase 5：Foundation 与业务应用切流

目标：业务应用统一通过 Foundation 调 Console workflow-runtime。

任务：

- Foundation workflow adapter 改为 `HZY_WORKFLOW_PROVIDER=console`。
- 业务应用移除 `HZY_WORKFLOW_API_URL` 新依赖。
- Aims / Codocs 先切流并回归审批链路。
- Altoc / Assets / Align 接入新 adapter。
- 保留旧 API 代理一个退役窗口。

验收：

- Aims 项目立项审批正常。
- Codocs 文档审批正常。
- 审批完成回调可更新业务对象状态。
- 停止独立 Workflow 服务后，已迁移应用审批能力可用。

### Phase 6：独立 Workflow 下线或转兼容 facade

目标：减少企业端必选服务数量。

任务：

- 独立 `workflow` 标记 deprecated。
- 所有新部署不再启动 `workflow` 服务。
- 旧部署可保留 Workflow 只读或 redirect 到 Console。
- 清理业务应用 env 中的 `HZY_WORKFLOW_API_URL`。

验收：

- 新企业部署只需要 `platform + console + 业务应用`。
- 独立 `workflow` 不是 Starter 必选模块。

---

## 10. 回滚策略

| 阶段 | 回滚方式 |
|------|----------|
| Phase 1 | 保留 `hzy_workflow`，Console 迁移表只读验证，不切流 |
| Phase 2 | 业务应用继续调用独立 Workflow API |
| Phase 3 | 回滚 `assigneeResolver` 到旧 Account 查询逻辑，仅用于独立 Workflow |
| Phase 4 | 保留独立 Workflow UI，Console 页面隐藏入口 |
| Phase 5 | 业务应用 env 恢复 `HZY_WORKFLOW_API_URL`，切回独立 Workflow |
| Phase 6 | 继续部署独立 Workflow |

注意：一旦 Console workflow-runtime 开始写入新实例，回滚到独立 Workflow 前必须做反向数据同步，否则会丢失切流后的审批实例和任务。

---

## 11. 风险与控制

| 风险 | 影响 | 控制 |
|------|------|------|
| Console 职责继续膨胀 | 基础服务变大，故障影响面扩大 | workflow-runtime 独立目录、独立 API、独立表前缀，保留可拆边界 |
| 数据迁移断引用 | 历史审批无法查询 | 保留原 ID，迁移后做实例/任务/动作完整性校验 |
| 审批人解析差异 | 新发起审批走错人 | 先用真实目录数据回归 manager/leader/committee 场景 |
| 回调 secret 管理变化 | 业务应用验签失败 | 保持签名算法兼容，只迁 secret 管理位置 |
| 停止独立 Workflow 后业务应用未切流 | 审批不可用 | 先做调用审计，保留兼容代理退役窗口 |
| Platform 与 Workflow 职责混淆 | 审批运行数据被错误上收 | 明确 Platform 只管 capability/license/治理，不存审批明细 |

---

## 12. 验收标准

第一阶段完成标准：

- `hzy_console` 可承载 `flow_*` 表和历史审批数据。
- Console 暴露 `/api/v1/console/workflow/**`。
- Console 可完成流程配置、发起审批、审批动作、回调日志查看。
- 审批人解析读 Console directory-runtime，不依赖 Account。
- Foundation workflow adapter 可配置 `HZY_WORKFLOW_PROVIDER=console`。

最终完成标准：

- 新企业部署不再必选独立 `workflow` 服务。
- Aims / Codocs / Altoc / Assets / Align 统一通过 Foundation workflow adapter 调 Console。
- 独立 Workflow 可下线，或只保留为旧版本兼容 facade。
- 如果未来需要独立 workflow 服务，可按 `/api/v1/console/workflow/**` 合同与 `flow_*` 表边界重新拆出。
