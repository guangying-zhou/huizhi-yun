# Workflow → Console 待办生命周期闭环

Workflow 的业务事实由 Data Runtime 在 MySQL 事务中提交，Console 只维护用户待办投影。两者通过精确 task generation 身份与事务 outbox 衔接，不按 `businessKey` 或实例号批量关闭。

## Task generation 身份

每次进入审批节点时，Data Runtime 先取得实际插入的 `flow_tasks.id` 集合，再生成：

- `generation_key = workflow:tasks:sha256:<sorted-task-id-hash>`：节点本次进入的稳定 generation，用于阈值计算和限定取消范围；
- `actionable_key` / `actionable_version`：当前 assignee 在 Console 中的投影 CAS 身份；
- 委托不改变 `generation_key`，但会把被委托任务的投影身份更新为 `workflow:task:<task-id>:delegate:<action-id>` / `flow_actions:<action-id>`。

回退到上一节点、重新提交和正常节点推进都会插入新 task，因此自然产生新 generation。迁移文件为 `docs/migrations/009_actionable_projection_identity.sql`。

## Runtime effect 契约

Data Runtime 的写请求可返回：

```json
{
  "effects": {
    "notifications": [],
    "actionableLifecycles": [
      {
        "effectId": 81,
        "actionableKey": "workflow:tasks:sha256:...",
        "expectedVersion": "flow_tasks:sha256:...",
        "nextVersion": "flow_actions:123",
        "state": "resolved",
        "recipients": ["approver-uid"]
      }
    ]
  }
}
```

`recipients` 始终是明确 UID：并行审批先只 `resolved` 当前处理人；达到 any/count/ratio 阈值时，剩余 pending assignee 另以 `cancelled` effect 关闭。驳回、撤回和重提按事务实际取消的 task generation 分组。委托先为新 assignee 发布新投影，再关闭原 assignee。

## 投递顺序与恢复

每条 lifecycle effect 与 Workflow 动作同事务写入 `flow_actionable_outbox`。outbox 只保存该 effect 真正依赖的“创建新 pending 投影”通知，不把通过、撤回等状态通知当作屏障。

创建待办的通知（`workflow.task.created`、`workflow.task.delegated`、`workflow.instance.resubmitted`、`rejectStrategy=to_previous` 的退回）另外与业务事实同事务写入 `flow_notification_outbox`（迁移 `012_durable_notification_outbox.sql`），以通知自身 `idempotencyKey` 唯一，覆盖实例发起这类没有 lifecycle effect 的写入。同步快路径仍立即发布；outbox 保证发布失败后由定时 drain 重发，Console 按幂等键 exact replay。某 `actionable_key` 仍有未投递的创建通知时，Runtime 不返回该键的 lifecycle 待投项，避免在投影创建前做 CAS 而永久 `404 actionable_not_found`。`skipped`（无收件人或通知合同不完整，永远无法发布）按终态确认，`failed` 按 60/300/900/3600 秒退避重试。

Workflow BFF 的顺序为：

1. 通过统一通知入口幂等发布 prerequisite notification；
2. 使用 `aud=notifications`、`scope=notifications:publish` 的服务令牌调用 Console `POST /api/v1/console/notifications/actionable-lifecycle`；
3. Console 成功或 exact replay 后，调用 Data Runtime ack；
4. 任一步失败均不回滚已提交的 Workflow 事实，outbox 保持 `pending`，由 Tenant Gateway 受信定时入口 `/api/internal/integration-operations/drain` 重发 prerequisite notification 并重试 Console CAS；普通审批读取不承担全局 outbox 排水，避免阻塞页面首屏。

Console 首次返回 401 时，BFF 仅强制刷新一次服务令牌并重试；第二次 401 或其他错误保持 pending。Console 已成功但 ack 丢失时，下次 drain 依赖 Console 的 exact replay 完成收敛。

Data Runtime 内部恢复接口：

- `GET /v1/workflow/notification-effects/pending?limit=100`
- `POST /v1/workflow/notification-effects/:id/ack`
- `POST /v1/workflow/notification-effects/:id/fail`
- `GET /v1/workflow/actionable-lifecycle-effects/pending?limit=100`
- `POST /v1/workflow/actionable-lifecycle-effects/:id/ack`
- `POST /v1/workflow/actionable-lifecycle-effects/:id/fail`

这些接口由 Workflow BFF 通过 tenant-runtime 服务调用，不暴露为浏览器业务 API。BFF 响应中的 `effect_results` 只用于观测；耐久恢复以 outbox 和受信定时 drain 为准。定时 drain 依次处理创建通知、actionable lifecycle 与 callback outbox，业务 GET 只返回当前读取结果及本次 runtime effects。

## 通知详情实时授权

Workflow 通知在 metadata 中保存服务端 `authorizationDescriptor`。任务通知规范化为
`{resource:"workflow_task",id:"instance:{instanceId}:tasks:{去重升序 taskIds}"}`；没有 task 的结果通知使用
`{resource:"workflow_instance",id:"{instanceId}"}`。Console 读取详情前调用
`POST /api/v1/service/notification-details/authorize`，令牌必须为 `aud=workflow`、
`scope=workflow:notification-details:authorize`、来源 `console`，且请求 tenant/deployment 与 token claim 完全一致。

Data Runtime 只返回 `authorized/reasonCode/resource/id`，不返回流程标题、表单或动作内容。任务集合必须全部属于 descriptor 指定实例；当前 pending assignee 可查看，原发起人或仍与实例存在任务关系的用户按既有实例详情规则可查看。任务集合不一致、对象不存在或当前关系不允许时拒绝；runtime/服务授权不可用时返回 503，禁止使用历史通知 recipient 作为授权依据。
