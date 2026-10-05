# Aims SLA / 高风险工作项统一通知

## 目标与边界

Aims 是到期事件的事实源，Foundation 是统一通知出口，Console 站内消息是耐久投递事实。首批事件包括：

- 服务工作项首次响应：`response_due`，阶段 `T-4h`、`T-1h`、`breached`。
- 服务工作项解决：`resolution_due`，阶段 `T-4h`、`T-1h`、`breached`。
- P0/P1 或 critical/high 工作项：`work_item_due`，阶段 `D3`、`D1`、`overdue`。

定时任务一次运行只生成一个 RFC3339 `asOf`，三条流分别以 `due_at + work_item_id` 分页，避免扫描过程中时钟移动导致遗漏。checkpoint 为每个事件条件持久化递增 `condition_generation`：同一条件内从 D3→D1→overdue 或 T-4h→T-1h→breached 沿用 generation，并通过 `previousObjectVersion` 对 Console pending projection 做 CAS 替换；截止日期、状态、风险资格或责任字段变化会关闭旧 generation 并创建新 generation。这样既不会撞上已经终态的投影，也允许工作项重新满足条件时安全打开。工作项完成、首次响应、解决、日期移除/调整或项目归档会关闭旧事件。

## 责任人与安全约束

接收人完全由服务端解析，不接收客户端传入的 recipient：

1. 在职的工作项负责人 `assignee_uid`；
2. 在职的项目负责人 `leader_uid`；
3. 项目所属部门的在职 `manager_id`。

无法解析明确在职责任人时不投递、也不确认 checkpoint，等待目录或责任字段修复后重试。`@all` 始终被拒绝。

## 运行与启用

Cloudflare scheduled binding 使用 `*/15 * * * *` 触发 `notifications:due`。生产投递默认关闭，只有显式设置以下变量后，Cloudflare 配置渲染才会加入该 cron：

```text
HZY_AIMS_DUE_NOTIFICATIONS_ENABLED=true
```

同时必须配置 tenant-runtime URL、tenant、deployment 和 Aims 专用 Console service client。部署仍通过项目 Cloudflare 指令完成，不依赖 GitLab Runner。本变更本身不执行部署。

数据库升级先应用 `docs/migration_v5.2_due_notifications.sql`。该迁移创建 `aims_notification_checkpoint`，并补充 SLA 与工作项到期扫描索引。

## 投递与恢复语义

- `eventVersion`：同一 generation/阶段/事实版本稳定；阶段推进时通过上一版本做 CAS supersede。
- `idempotencyKey`：同一阶段和事实版本稳定，由 Foundation/Console 去重。
- `actionableKey`：在同一工作项、事件流和 condition generation 内稳定；日期、责任或资格语义变化时换 generation，避免复用已有终态投影。
- Console 站内消息成功后即写回 `notification_id` 和最终接收人；外部通道失败由统一通知投递账本负责对账，不重复创建站内消息。
- Directory active 状态或 fallback 结果导致最终 UID 变化时，先用旧 UID 与旧 `eventVersion` 关闭其 projection；随后对新 UID 执行 first publish，不携带旧 UID 的 `previousObjectVersion`。只有最终 UID 未变化时，阶段 supersession 才携带 predecessor 做 CAS。
- owner-move 的 closure 与新 UID publish 都使用稳定版本/幂等身份；任一步发生 ack-loss 后重试必须得到相同 transition，不能把旧 UID predecessor 错用于新 UID。
- checkpoint 写回采用事件版本和既有证据校验；关闭或版本过期的确认返回冲突。
- 条件真正结束时，Aims 通过 Foundation 的 actionable lifecycle helper 以 expectedVersion CAS 将 Console 投影置为 `resolved` 或 `cancelled`；提醒阶段推进仅 supersede，不重复发送 close。

## 通知详情实时授权

到期通知 metadata 保存 `{resource:"work_item",id:"{规范化数字 ID}"}` 的服务端 `authorizationDescriptor`。Console 读取详情前调用 Aims `POST /api/v1/service/notification-details/authorize`，要求 `aud=aims`、`scope=aims:notification-details:authorize`、来源 `console`，请求 tenant/deployment 必须与已验证 token claim 完全一致。Aims BFF 只把 Console 已验证的 `subject.uid` 交给自身 tenant-runtime，客户端 recipient、owner 或自报 actor 均不能决定授权。

该链路使用 purpose-bound、短时 HMAC runtime actor delegation 证明 subject，签名绑定精确 runtime 路径且通知详情用途只允许过去 60 秒、未来偏差 5 秒；普通 query/body 不能声明 actor 或 purpose。runtime 直接证明用户仍是项目负责人或 active 项目成员时立即放行，对象不存在明确拒绝。

非成员采用 Console → Aims 同一 capability 的两阶段重验。prepare 返回固定 `aims/projects/admin` tuple、最小项目事实、`objectRevision` 和绑定 notificationId、subject、descriptor、tenant、deployment 的 `factsHash`；不返回 actor、负责人、成员数组、关系或目录树。Console 用 fresh normal-merged policy 求值后调用 finalize，携带 `policyRevision`、`policyBundleHash` 和规范化 `scopeBasis`。runtime 重读同一工作项/项目与关系事实，逐项重算绑定，并执行 Aims 领域规则：L3 项目不接受 department scope，非成员不能借 member/owner scope 放行。只有 finalize 精确回显 `factsHash/objectRevision/policyRevision/policyBundleHash/scopeBasis` evidence 后 Console 才能释放正文；任何重放、事实漂移、数据库/策略不可用或未知 scope 都 fail closed。
