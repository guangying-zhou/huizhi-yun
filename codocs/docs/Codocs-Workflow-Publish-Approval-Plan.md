# Codocs 发文审批迁移到 Workflow 通用审批方案

> 状态：方案设计
> 日期：2026-05-12
> 适用范围：Codocs 发文审批、对外发文、发布后盖章/发送/接收执行链路

## 1. 背景

Codocs 当前发文审批由模块内部自行实现：

- `document_reviews` 保存审批实例、状态、当前节点、流程快照。
- `review_actions` 保存通过、驳回、提醒记录。
- `review_flow_templates` 保存发文流程模板。
- `/api/reviews/:id/approve|reject|resubmit` 在 Codocs 内部推进流程。
- `/reviews` 和 `/reviews/:id` 自建审批中心、流程图、时间线和审批按钮。

这与平台架构中“审批流程归属 Workflow，业务模块只持有业务对象”的边界冲突。迁移目标是复用 Foundation 提供的 `WorkflowPanel`、`WorkflowBadge`、`/approval/tasks` 和 Workflow 的实例、任务、动作、回调能力。

## 2. 目标

1. Codocs 不再实现审批状态机、审批人解析、节点推进、通过/驳回/重提。
2. Workflow 支撑 Codocs 现有发文规则，包括：
   - 普通逐级审批。
   - 部门发文、公司发文、对外发文路由。
   - 委员会多人会签。
   - 指定人数通过。
   - 按比例通过，例如半数以上、三分之二以上。
   - 从部门成员动态解析审批人。
   - 可排除发起人。
3. Codocs 保留文档发布业务能力：
   - 发布申请信息采集。
   - 文档快照复制到 review OSS 路径。
   - 审批中锁定原文档只读。
   - 审批通过后的确认发布、归档、盖章、发送、接收。
4. 审批入口统一到 Foundation `/approval/tasks`。
5. Workflow 终态通过回调同步 Codocs 本地发布申请状态。

## 3. 边界划分

| 能力 | 当前归属 | 目标归属 |
| --- | --- | --- |
| 审批动作定义 | Codocs 自建模板 | Codocs `approvalActions` manifest 同步到 Workflow |
| 流程定义、路由、节点 | `review_flow_templates` | Workflow `flow_schemas` / `flow_routes` |
| 审批实例 | `document_reviews` | Workflow `flow_instances` |
| 审批任务 | JSON 快照 + `review_actions` | Workflow `flow_tasks` |
| 审批操作 | Codocs approve/reject API | Workflow task approve/reject API |
| 待办/已办/我发起 | Codocs `/reviews` | Foundation `/approval/tasks` |
| 审批业务视图 | Codocs `/reviews/:id` | Codocs embed 页面 + WorkflowBusinessView |
| 发布申请业务数据 | `document_reviews` | Codocs 本地发布申请表 |
| 发布后执行 | Codocs | Codocs 保留 |

## 4. 总体架构

```text
Codocs 文档详情/发布入口
  -> 创建发布申请草稿或申请记录
  -> 复制文档快照，锁定原文档
  -> Foundation WorkflowPanel 发起审批
  -> Workflow 创建 flow_instance / flow_tasks
  -> 审批人在 /approval/tasks 处理
  -> Workflow 终态回调 Codocs
  -> Codocs 更新发布申请状态
  -> 发起人确认发布
  -> Codocs 执行归档/盖章/发送/接收
```

## 5. Workflow 能力扩展方案

### 5.1 扩展节点通过规则

当前 Workflow 的 `approve_mode` 主要支持：

- `any`：任一任务完成即通过。
- `all`：所有任务完成即通过。

Codocs 需要增加：

- `count`：至少 N 人通过。
- `ratio`：达到指定比例通过。

建议兼容扩展 `flow_schemas.nodes`：

```json
{
  "name": "委员会表决",
  "type": "countersign",
  "approve_mode": "ratio",
  "approve_threshold": {
    "ratio": 0.5,
    "round": "floor_plus_one"
  },
  "assignees": [
    {
      "type": "dept_members",
      "scope": "form_field",
      "field_key": "committee_dept_code",
      "exclude_initiator": false
    }
  ]
}
```

字段规则：

| 字段 | 说明 |
| --- | --- |
| `approve_mode=count` | `approve_threshold.count` 人通过后节点通过 |
| `approve_mode=ratio` | 按解析后的任务总人数计算通过阈值 |
| `approve_threshold.ratio` | 通过比例，如 `0.5`、`0.6667` |
| `approve_threshold.round` | `ceil`、`floor_plus_one`、`floor`，默认 `ceil` |
| `approve_threshold.min` | 最小通过人数，默认 1 |
| `approve_threshold.max` | 最大通过人数，可选 |

半数以上应使用：

```json
{ "ratio": 0.5, "round": "floor_plus_one" }
```

三分之二以上应使用：

```json
{ "ratio": 0.6667, "round": "ceil" }
```

### 5.2 扩展动态审批人解析

当前 `resolveAssignees()` 支持 `user`、`initiator`、`initiator_leader`、`dept_manager`、`dept_leader`、`role`、`form_field`。Codocs 需要从部门成员动态生成候选审批人，并支持从表单字段指定部门。

新增 assignee 类型：

```json
{
  "type": "dept_members",
  "scope": "form_field",
  "field_key": "committee_dept_code",
  "exclude_initiator": true,
  "sample": {
    "mode": "random",
    "count_from_field": "committee_pass_count"
  }
}
```

支持的 scope：

| scope | 部门来源 |
| --- | --- |
| `initiator_dept` | 发起人部门 |
| `resource_dept` | `biz_context.resource_dept_code` |
| `specified` | `assignee.dept_code` |
| `form_field` | `form_data[field_key]` 或 `biz_context[field_key]` |

支持的选项：

| 字段 | 说明 |
| --- | --- |
| `exclude_initiator` | 是否排除发起人 |
| `sample.mode=random` | 随机抽取候选人 |
| `sample.count` | 固定抽取人数 |
| `sample.count_from_field` | 从表单字段读取抽取人数 |
| `sample.seed` | 可选，基于 `instance_no` 或 `biz_id` 做可复现抽样 |

### 5.3 扩展审批人字段解析

`form_field` 当前只支持读取 UID 或 UID 数组。建议扩展：

```json
{
  "type": "form_field",
  "field_key": "business_manager_uid",
  "value_type": "uid"
}
```

并允许节点 assignee 使用业务上下文：

```json
{
  "type": "user",
  "uid_from_context": "upper_leader_id"
}
```

这样对外发文中“上级领导审批”可由 Codocs 在提交时计算 `upper_leader_id`，Workflow 只负责解析。

### 5.4 扩展 WorkflowPanel 发起参数

Foundation `WorkflowPanel` launch 模式目前只能传 `bizContext`，发起时没有显式传 `form_data` 和 `callback_url`。Codocs 需要这两个字段。

建议扩展 `WorkflowLaunchPayload`：

```ts
interface WorkflowLaunchPayload {
  appCode: string
  resourceCode: string
  actionCode: string
  actionName?: string
  bizId: string
  bizTitle: string
  bizUrl?: string
  bizContext?: Record<string, unknown>
  formData?: Record<string, unknown>
  callbackUrl?: string
}
```

`WorkflowPanel.handleLaunchSubmit()` 调用 `createInstance()` 时传：

```ts
form_data: props.launchPayload.formData,
callback_url: props.launchPayload.callbackUrl
```

### 5.5 扩展 usePageWorkflow 回调

`LayoutSidebar` 当前对 `@submitted` 只调用 `pageWorkflow.onSubmitted()`，没有把 `instanceId` 透传给页面。Codocs 需要保存 `workflow_instance_id`。

建议调整：

```ts
onSubmitted?: (payload: { instanceId: number }) => void | Promise<void>
onApproved?: (payload: { instanceId: number }) => void | Promise<void>
onRejected?: (payload: { instanceId: number }) => void | Promise<void>
```

### 5.6 扩展 Workflow 表单 Schema 字段类型

Codocs 发布申请可以继续使用 Codocs 自己的 `SubmitReviewModal`，不强制用 Workflow 动态表单。但长期建议 Workflow 表单支持以下字段类型：

- `text`
- `textarea`
- `select`
- `radio`
- `checkbox`
- `user_picker`
- `dept_picker`
- `number`
- `date`
- `hidden`

本次迁移最低要求是 Workflow 能存储并回调 `form_data`，不要求先完成通用表单渲染器。

### 5.7 Workflow 数据库变更

`flow_schemas.nodes` 是 JSON 字段，`approve_mode`、`approve_threshold`、`dept_members` 等节点配置不需要新增列。

建议新增迁移文件：

- `workflow/docs/migrations/008_node_threshold_and_dept_members.md`

内容包括：

- 节点 JSON 约定。
- `approve_mode=count|ratio` 示例。
- `dept_members` assignee 示例。
- 兼容说明：旧节点 `any/all` 不变。

如果需要可追踪抽样结果，不新增表，直接写入 `flow_instances.flow_snapshot.nodes[].resolved_assignees` 即可。

## 6. Codocs 数据模型方案

### 6.1 推荐新表

建议新增 `document_publish_requests`，避免继续把 `document_reviews` 当审批实例表使用。

```sql
CREATE TABLE IF NOT EXISTS `document_publish_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `document_id` BIGINT UNSIGNED NOT NULL COMMENT '源文档ID',
  `document_uuid` VARCHAR(36) NOT NULL COMMENT '源文档UUID',
  `review_type` VARCHAR(50) NOT NULL COMMENT '发布类型',
  `sub_type` VARCHAR(50) NULL COMMENT '子类型',
  `initiator_uid` VARCHAR(64) NOT NULL COMMENT '发起人UID',
  `target_category` VARCHAR(50) NOT NULL COMMENT '归档目标',
  `extra` JSON NULL COMMENT '对外发文等扩展字段',
  `review_oss_path` VARCHAR(500) NULL COMMENT '审批快照OSS路径',
  `workflow_instance_id` BIGINT UNSIGNED NULL COMMENT 'Workflow实例ID',
  `workflow_instance_no` VARCHAR(30) NULL COMMENT 'Workflow实例编号',
  `workflow_status` ENUM('draft','running','approved','rejected','cancelled') NOT NULL DEFAULT 'draft',
  `archive_oss_path` VARCHAR(500) NULL COMMENT '发布后文档OSS路径',
  `execution_status` VARCHAR(30) NULL COMMENT '发布后执行状态',
  `published_document_uuid` VARCHAR(36) NULL COMMENT '发布版本文档UUID',
  `sealed_at` DATETIME NULL COMMENT '确认盖章时间',
  `sent_at` DATETIME NULL COMMENT '确认发送时间',
  `received_at` DATETIME NULL COMMENT '确认接收时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_document_uuid` (`document_uuid`),
  INDEX `idx_workflow_instance` (`workflow_instance_id`),
  INDEX `idx_initiator_status` (`initiator_uid`, `workflow_status`),
  INDEX `idx_status_created` (`workflow_status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档发布申请表';
```

### 6.2 兼容方案

若为了降低迁移成本，也可以继续使用 `document_reviews`，但必须明确：

- `status/current_node/flow_snapshot` 不再作为审批权威。
- 新增 `workflow_instance_id/workflow_instance_no/workflow_status`。
- 读审批状态时优先读取 Workflow 或回调同步字段。
- `review_actions` 只读历史保留，不再写入新审批动作。

推荐新表，旧表保留历史审阅记录。

## 7. Codocs 发文申请字段映射

Workflow 发起参数建议如下：

```ts
{
  appCode: 'codocs',
  resourceCode: 'documents',
  actionCode: 'publish',
  bizId: String(publishRequest.id),
  bizTitle: document.title,
  bizUrl: resolveCurrentAppUrl(`/reviews/${publishRequest.id}`),
  bizContext: {
    document_uuid: document.uuid,
    review_type: selectedType,
    sub_type: selectedSubType,
    resource_dept_code: document.dept_code,
    outside_file_level: outsideFileLevel,
    needs_official_seal: needsOfficialSeal,
    business_dept_code: selectedBusinessDeptCode,
    committee_dept_code: selectedCommitteeDeptCode,
    upper_leader_id: resolvedUpperLeaderId
  },
  formData: {
    review_type: selectedType,
    sub_type: selectedSubType,
    target_category: targetCategory,
    send_to: sendTo,
    send_reason: sendReason,
    outside_file_level: outsideFileLevel,
    needs_official_seal: needsOfficialSeal,
    business_dept_code: selectedBusinessDeptCode,
    committee_dept_code: selectedCommitteeDeptCode,
    committee_mode: committeeMode,
    committee_pass_count: assistReviewerCount,
    committee_vote_type: voteType
  },
  callbackUrl: resolveCurrentAppUrl('/api/reviews/workflow-callback')
}
```

## 8. Workflow 流程配置建议

### 8.1 公司发文 / 部门发文

默认流程：

```json
{
  "code": "codocs_publish_default",
  "name": "Codocs 发文默认审批",
  "nodes": [
    {
      "name": "部门负责人审批",
      "type": "approve",
      "approve_mode": "any",
      "assignees": [{ "type": "dept_manager", "scope": "resource_dept" }],
      "skip_when": { "initiator_uid": { "equals_context": "resource_dept.manager_uid" } }
    },
    {
      "name": "分管领导审批",
      "type": "approve",
      "approve_mode": "any",
      "assignees": [{ "type": "dept_leader", "scope": "resource_dept" }]
    }
  ],
  "config": {
    "allow_resubmit": true,
    "reject_strategy": "to_initiator",
    "notify_channels": ["wecom"]
  }
}
```

说明：`equals_context` 是可选增强。如果本阶段不扩展 `skip_when` 操作符，可继续依赖“发起人自审批自动通过”。

### 8.2 对外发文一般文件

路由条件：

```json
{
  "review_type": "对外发文",
  "outside_file_level": "general"
}
```

流程建议：

- 部门负责人审批。
- 业务部门负责人审批，仅 `business_dept_code` 存在时启用。
- 分管领导审批。

审批通过后 Codocs 回调中通知上级部门领导，不放入 Workflow 节点。

### 8.3 对外发文重要文件

路由条件：

```json
{
  "review_type": "对外发文",
  "outside_file_level": "important"
}
```

流程建议：

- 部门负责人审批。
- 业务部门负责人审批，仅 `business_dept_code` 存在时启用。
- 分管领导审批。
- 上级领导审批：`assignee.type=user` + `uid_from_context=upper_leader_id`。

### 8.4 对外发文关键文件

路由条件：

```json
{
  "review_type": "对外发文",
  "outside_file_level": "critical"
}
```

流程建议：

- 部门负责人审批。
- 业务部门负责人审批，仅 `business_dept_code` 存在时启用。
- 审批委员会表决：

```json
{
  "name": "审批委员会表决",
  "type": "countersign",
  "approve_mode": "ratio",
  "approve_threshold": {
    "ratio": 0.5,
    "round": "floor_plus_one"
  },
  "assignees": [
    {
      "type": "dept_members",
      "scope": "form_field",
      "field_key": "committee_dept_code"
    }
  ]
}
```

- 分管领导审批。
- 上级领导审批。

## 9. API 设计

### 9.1 Codocs 新增 API

#### 创建发布申请

`POST /api/reviews/publish-requests`

职责：

1. 校验文档存在、当前用户可发起发布。
2. 校验发布类型和对外发文字段。
3. 创建 `document_publish_requests`。
4. 复制源文档内容到 `codocs/reviews/{requestId}_{title}.md`。
5. 设置源文档 `readonly_flag = 1`。
6. 返回 `publish_request` 和 `workflowLaunchPayload`。

不负责：

- 不创建 Workflow 实例。
- 不解析审批人。
- 不通知审批人。

#### Workflow 回调

`POST /api/reviews/workflow-callback`

职责：

1. 验证 Console service token：`token_use=service`、`aud=codocs`、`scope=workflow:callback`、来源应用 `workflow`。
2. 按 `payload.biz_id` 查找发布申请。
3. 更新 `workflow_instance_id/workflow_status`。
4. `approved`：保持文档只读，等待确认发布。
5. `rejected`：解除源文档只读。
6. 记录必要业务通知，例如驳回通知、通过通知、一般对外发文上级领导通知。

#### 查询发布申请详情

`GET /api/reviews/publish-requests/:id`

用于：

- Codocs 发布申请详情页。
- Embed 页面。
- 发布后执行页。

### 9.2 Codocs 保留 API

以下 API 保留，但读取发布申请表：

- `POST /api/reviews/:id/archive`
- `POST /api/reviews/:id/seal`
- `POST /api/reviews/:id/send`
- `POST /api/reviews/:id/receive`

校验从：

```text
document_reviews.status = 'approved' / 'archived'
```

调整为：

```text
document_publish_requests.workflow_status = 'approved'
document_publish_requests.execution_status = ...
```

### 9.3 Codocs 废弃 API

迁移完成后停止新流量调用：

- `POST /api/reviews`
- `GET /api/reviews/my`
- `POST /api/reviews/:id/approve`
- `POST /api/reviews/:id/reject`
- `POST /api/reviews/:id/resubmit`
- `POST /api/reviews/:id/remind`

旧数据查看可以保留只读兼容页。

## 10. 前端改造

### 10.1 菜单

将 Codocs 菜单“审阅中心”改为“审批中心”，跳转：

```text
/approval/tasks
```

`/reviews` 可改为发布记录页，或重定向到 `/approval/tasks`。

### 10.2 发布入口

`SubmitReviewModal` 改为发布申请采集组件：

1. 仍保留当前发布类型、子类型、对外发文字段、委员会参数 UI。
2. 提交按钮先调用 `POST /api/reviews/publish-requests`。
3. 创建成功后通过页面 `usePageWorkflow` 或右侧 `WorkflowPanel` 发起 Workflow。
4. 发起成功后关闭弹窗，提示“审批已发起”。

### 10.3 详情页

新增或改造：

- `/reviews/:id`：发布申请详情和发布后执行操作，不显示自建审批按钮。
- `/embed/reviews/:id`：审批中心嵌入只读业务视图。

页面显示：

- 文档快照内容。
- 发布申请字段。
- `WorkflowBadge`。
- `WorkflowTimeline` 可由 `WorkflowPanel` 或审批中心展示，不再使用 Codocs `ReviewFlowChart`。
- 审批通过后显示“确认发布”。
- 对外发文发布后显示盖章、发送、接收操作。

### 10.4 审批模式

审批人统一从 `/approval/tasks` 进入。

- 同应用任务可跳业务 `biz_url`，右侧由 LayoutSidebar 展示 `WorkflowPanel`。
- 跨应用或全局 Workflow 审批中心使用 embed 页面展示业务详情。

## 11. 数据迁移策略

### 11.1 新旧并行期

短期允许：

- 旧 `document_reviews` 历史数据只读展示。
- 新发起的发布申请全部进入 `document_publish_requests` + Workflow。
- `/reviews/:id` 根据 ID 类型或数据来源判断新旧记录。

### 11.2 历史数据

历史 `document_reviews` 不建议迁入 Workflow，因为旧流程快照、动作记录已经完成，强行迁移没有业务收益。

处理方式：

- 保留旧表和旧详情只读能力。
- 停止旧审批动作入口。
- 发布后执行中的旧记录继续使用旧 API，直到完成。

### 11.3 只读锁恢复

迁移前要扫描：

```sql
SELECT document_uuid
FROM document_reviews
WHERE status = 'rejected';
```

确认对应源文档 `readonly_flag` 已解除。

## 12. 分阶段实现步骤

### 阶段 0：准备和冻结新旧边界

1. 确认 Codocs 新发文审批不再新增自建流程能力。
2. 确认 Workflow 服务、Foundation workflow proxy 在目标环境可用。
3. 确认 Console 运行时参数 `workflow.apiUrl`、Codocs/Workflow license bootstrap、Console service client grants 配置。

验收：

- Codocs 能访问 `/api/workflow-proxy/tasks/pending`。
- Workflow 能接收 action-def sync。

### 阶段 1：扩展 Workflow 核心能力

1. 扩展 `FlowNodeDef.approve_mode` 类型：`any | all | count | ratio`。
2. 增加 `approve_threshold` 计算函数。
3. 修改 `advanceFlow()` 节点完成判断。
4. 新增 `dept_members` assignee resolver。
5. 支持 assignee 从 `form_data` 或 `biz_context` 读取部门编码。
6. 支持 `exclude_initiator`。
7. 支持随机抽样并将结果固化到 `flow_snapshot`。
8. 增加单元测试或最小 API 测试：
   - 3 人半数以上：2 人通过后节点通过。
   - 5 人三分之二：4 人通过后节点通过。
   - 指定 2 人协助审查：2 人全部通过后节点通过。
   - 排除发起人后无候选人时返回明确错误。

验收：

- Workflow 可创建包含 `approve_mode=ratio` 的实例。
- 审批任务按阈值推进。
- `flow_snapshot` 保存最终解析出的审批人。

### 阶段 2：扩展 Foundation 通用审批组件

1. 扩展 `WorkflowLaunchPayload`：
   - `formData`
   - `callbackUrl`
2. `WorkflowPanel` 发起实例时传 `form_data/callback_url`。
3. `usePageWorkflow` 支持页面传入 `formData/callbackUrl`。
4. `LayoutSidebar` 将 `submitted/approved/rejected` payload 透传给页面回调。
5. 保持 Aims 现有调用兼容。

验收：

- Aims 现有审批页面不受影响。
- 一个测试页面可通过 `WorkflowPanel` 创建带 `form_data/callback_url` 的实例。

### 阶段 3：Codocs 声明审批动作

1. 在 `codocs/app/config/permissions.ts` 新增 `approvalActions`。
2. 新增 `codocs/server/plugins/sync-approval-actions.ts`。
3. 启动 Codocs，确认 Workflow 中出现 `codocs/documents/publish`。
4. 在 Workflow 管理端配置默认发文审批流程和路由。

验收：

- Workflow action-defs 中有 `codocs documents publish`。
- `prepareInstance()` 能返回匹配路由。

### 阶段 4：Codocs 新建发布申请表和 API

1. 更新 `codocs/docs/codocs_schema.sql`，新增 `document_publish_requests`。
2. 新增 schema ensure helper，开发环境自动补列或建表。
3. 新增 `POST /api/reviews/publish-requests`。
4. 新增 `GET /api/reviews/publish-requests/:id`。
5. 新增 `POST /api/reviews/workflow-callback`。
6. 回调完成后更新本地 `workflow_status`。

验收：

- 能创建发布申请并锁定源文档。
- Workflow approved/rejected 回调能更新本地状态。
- rejected 后源文档解除只读。

### 阶段 5：Codocs 前端接入 WorkflowPanel

1. 改造 `SubmitReviewModal`，提交后创建发布申请。
2. 在文档详情页或发布申请页注册 `usePageWorkflow`。
3. 使用 `WorkflowPanel` 发起审批。
4. 保存 `workflow_instance_id/workflow_instance_no`。
5. 用 `WorkflowBadge` 显示审批状态。
6. 移除通过/驳回/重提弹窗入口。

验收：

- 新发文从 Codocs 页面可发起 Workflow 审批。
- 审批人从 `/approval/tasks` 看到待办。
- 审批操作由 `WorkflowPanel` 完成。

### 阶段 6：发布后执行迁移

1. 改造 archive API 读取 `document_publish_requests`。
2. 改造 seal/send/receive API 读取 `document_publish_requests`。
3. 保持 `document_seal_records`、`document_send_records` 可关联新申请 ID。
4. 如继续使用字段名 `review_id`，文档中注明它在新链路中指向发布申请 ID。
5. 更新发布记录弹窗的数据源。

验收：

- 审批通过后可以确认发布。
- 对外发文可按规则进入待盖章、待发送、待接收。
- 发布版本文档和源文档 publish_info 正确写入。

### 阶段 7：替换审批中心

1. 菜单“审阅中心”改为“审批中心”，跳转 `/approval/tasks`。
2. `/reviews` 改为发布记录页或重定向。
3. `/reviews/:id` 改为发布申请详情和执行页。
4. 新增 `/embed/reviews/:id`。
5. 删除或隐藏旧 `ReviewFlowChart`、`ReviewTimeline` 在新链路中的使用。

验收：

- 待办、已办、我发起的都来自 Workflow。
- 审批详情左侧能显示 Codocs 业务信息。
- Codocs 不再显示自建审批按钮。

### 阶段 8：旧链路收口

1. 停止新调用 `/api/reviews`。
2. 停止新调用 `/approve|reject|resubmit|remind`。
3. 为旧接口增加 deprecation 日志。
4. 保留历史只读查询。
5. 更新 Codocs API 文档、schema 文档、用户说明。

验收：

- 新发文 100% 走 Workflow。
- 旧数据仍可查看。
- 无新 `review_actions` 写入。

## 13. 测试清单

### Workflow

- `any` 节点一人通过即推进。
- `all` 节点所有人通过才推进。
- `count` 节点达到指定人数推进。
- `ratio` 半数以上、三分之二以上计算正确。
- `dept_members` 能解析部门成员。
- 随机抽样结果进入 `flow_snapshot`，后续审批不再重新抽样。
- 驳回后 `callback_url` 收到 `rejected`。
- 通过后 `callback_url` 收到 `approved`。
- 重提复用原实例。

### Codocs

- 创建发布申请时复制 review OSS 快照。
- 创建发布申请后源文档只读。
- Workflow 驳回后源文档解除只读。
- Workflow 通过后源文档保持只读，等待确认发布。
- 确认发布后创建归档版本。
- 对外发文需要盖章时进入 `pending_seal`。
- 盖章后进入 `pending_send`。
- 发送后进入 `pending_receive`。
- 接收后进入 `received`。
- 旧审阅记录仍可查看。

### 集成

- `/approval/tasks` 能按 Codocs appCode 过滤任务。
- 审批中心点击任务能打开 Codocs 业务视图。
- `WorkflowBadge` 正确显示 running/approved/rejected。
- 回调重复发送具备幂等性。

## 14. 风险与处理

| 风险 | 处理 |
| --- | --- |
| Workflow 动态审批人能力不足 | 先完成 `dept_members` 和 `ratio/count`，再迁移 Codocs |
| 旧 `document_reviews` 和新发布申请并存 | 新旧分流，旧数据只读，新数据走 Workflow |
| 回调失败导致 Codocs 状态不同步 | 保留按 `workflow_instance_id` 主动拉取状态的补偿任务 |
| 发布申请已创建但 Workflow 发起失败 | 本地状态保持 `draft`，允许重新发起或取消并解除只读 |
| 随机抽样不可审计 | 抽样结果固化到 `flow_snapshot` |
| Workflow 表单渲染能力不足 | 本阶段继续由 Codocs 采集发布申请字段，Workflow 只存储 `form_data` |

## 15. 完成标准

迁移完成后应满足：

1. Codocs 新发文不写入 `review_actions`。
2. Codocs 新发文不调用 `/api/reviews/:id/approve|reject|resubmit`。
3. Workflow 中存在 `codocs/documents/publish` action definition。
4. 所有新审批待办来自 Workflow `flow_tasks`。
5. Codocs 本地只保存发布申请和发布后执行状态。
6. 对外发文的盖章、发送、接收链路保持现有业务行为。
7. 文档、Schema、API_SPEC 同步更新。
