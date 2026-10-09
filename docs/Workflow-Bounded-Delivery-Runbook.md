# Workflow 有界投递与依赖阻塞 Runbook

本 Runbook 对应 `workflow/docs/migrations/013_bounded_delivery_outbox.sql` 与 `014_delivery_recovery_attribution.sql`。迁移及恢复命令在实现、演练和单独批准前不得用于现有环境。以下查询只返回计数，不读取通知正文、令牌或原始错误。

候选授权分离：日常 drain 的 `workflow.runtime` 只持有 `workflow:integration_operation:execute`（v2.29 双 audience 候选）；恢复命令由单独的 `workflow.maintenance` 身份持有 `workflow:delivery-recovery:execute`（v2.30 双 audience 候选），**不**给 scheduler 身份恢复权限。10/8 不登记维护身份、不执行 v2.30，也不预置凭据；本段是未来事件发生时的破窗流程，不是上线写入授权。

## 上线与回滚前检查

先记录目标库 `SELECT VERSION()`，在隔离库对 013/014 的每条 `ALTER TABLE` 分别记录实际 `ALGORITHM`（INSTANT、INPLACE 或 COPY）和耗时。MySQL 8.0.29 以下，`ADD COLUMN ... AFTER` 可能重建表；不能仅凭迁移文件推断锁表时间。停止对应 Workflow 写进程、加密备份并验证可恢复后才可执行迁移。按编号逐条执行并运行各自 verify。DDL 非事务，中途失败时按已执行步骤恢复备份，不能假定整批回滚。

先让 v2.29 的双 audience 精确 grant 生效，做 `workflow.runtime` 签发及使用探测；同一维护窗口再切换 Runtime 与 Workflow Worker。不得让 Worker 先请求新 scope，也不得在新 scope 被拒时回退 `workflow.read/write`。生产只读核对必须确认 effects claim/ack/fail 当前只有 Gateway 唤醒的 Workflow Worker drain 在调用；任何额外调用方须先列出并复核。代码搜索当前仅见 `workflow/server/utils/dataRuntime.ts` 的七处调用，Gateway 仅唤醒 `/workflow/api/internal/integration-operations/drain`；生产日志核对待只读通道。Runtime 在 claim/ack 的 403 发生在领域适配器前，不消耗 effect 尝试次数；若探测失败即停，不运行 drain。

三类 pending effect 读取均返回 `versionNo`。Worker 在每次 fail/ack 检查点用 `expectedEffectVersion` 原样传回；缺失时 Runtime 400，不回退无栅栏旧协议。同一观察版本的重复 fail 只有第一次消耗尝试数，第二次返回版本冲突标记且不追加审计；若另一路已经成功投递、失败检查点先写入，pending/failed 状态上的 ack 仍可用当前行版本推进 delivered/success。部署与回滚时须先暂停请求内投递、cron 与手动 drain，再于同一窗口成对切换 Runtime/Workflow Worker，最后恢复投递；不可混跑两个协议版本。目标端原幂等键不变。

旧版领取查询只读取通知/lifecycle 的 `delivery_status='pending'` 与 callback 的 `status IN ('pending','failed')`，不会把 `abandoned` 反序列化为严格枚举；回滚二进制前仍须在隔离库验证这一点。旧版不会自动恢复 abandoned 行。不得通过清空依赖列、换幂等键或重新审批来解除阻塞。

## 依赖阻塞监控

`blocked_total` 定义为处于 pending、却因显式依赖未在同一 instance 中 delivered，或同一 actionable key / **非 NULL** action 的创建通知未 delivered，而不能被 lifecycle drain 领取的行数。退避未到期不计入此数。`abandoned_dependency_blocked` 是其中显式依赖通知已 abandoned 且属于同一 instance 的行数；创建通知到达 abandoned 后，其对应 lifecycle 保持 pending，不消耗自己的尝试次数，必须由受控恢复命令先恢复**原通知行和原幂等键**。该子数必须纳入 `blocked_total`，并在告警中单列。

只读查询（在绑定的 Workflow 库中执行）：

```sql
SELECT COUNT(*) AS blocked_total,
       COALESCE(SUM(CASE WHEN dependency.instance_id = o.instance_id
         AND dependency.delivery_status = 'abandoned' THEN 1 ELSE 0 END), 0)
         AS abandoned_dependency_blocked
FROM flow_actionable_outbox o
LEFT JOIN flow_notification_outbox dependency
  ON dependency.id = o.depends_on_notification_outbox_id
WHERE o.delivery_status = 'pending'
  AND ((o.depends_on_notification_outbox_id IS NOT NULL
    AND (dependency.id IS NULL OR dependency.instance_id <> o.instance_id
      OR dependency.delivery_status <> 'delivered'))
    OR EXISTS (
      SELECT 1 FROM flow_notification_outbox n
      WHERE n.instance_id = o.instance_id
        AND (n.actionable_key = o.actionable_key
          OR (o.action_id IS NOT NULL AND n.action_id = o.action_id))
        AND n.delivery_status <> 'delivered'
    ));
```

该条件与 `pendingActionableLifecycleOutbox` 的领取条件互补。`GET /v1/workflow/delivery-effects/status` 使用独立 Workflow 库的一致读事务，返回绑定租户/部署、`notification`/`actionable`/`callback` 各自的 `pending`、`abandoned`、`oldestPendingSeconds`，以及 `dependencyBlocked`、`abandonedDependencyBlocked`；仅接受 `workflow:integration_operation:execute`。Workflow drain 在 abandoned 数非零时写固定字段的 `abandoned_effects` 错误日志；监控系统的日志告警规则仍须在上线前配置并验证，不得把未配置的规则写成“已有线上告警”。出现 abandoned 时审批闭环不能报健康。

上线后 **72 小时观察**：以受信调度身份每个 5 分钟采样一次上述诊断端点，记录 UTC、租户/部署、三类 abandoned、`dependencyBlocked`、`abandonedDependencyBlocked`、最长 pending 秒数、`maintenance.activeOver15Minutes`、`maintenance.unrevokedCredentialCount` 及本轮 drain 结果；逐日与 `flow_delivery_audit` 的固定事件码对账，不记录正文、令牌或原始错误。维护身份 active 超过 15 分钟或存在任何未吊销凭据也须告警并核对审批窗口。任一 abandoned 或 `abandonedDependencyBlocked>0` 立即告警并建立事件，核对相关事项是否停在 `in_review`。callback abandoned 且事项停在 `in_review` 时，从首次发现起 **4 小时内**完成原因定位与经批准的恢复，或升级人工处置并明确责任人与下一次时间；不能等待 72 小时观察结束。正常 72 小时观察完成前，不将门禁判为通过。

## 结果类通知发布失败观测（无持久 outbox）

`workflow.instance.approved`、`workflow.instance.rejected`（`rejectStrategy` 不为 `to_previous`）与 `workflow.instance.withdrawn` 这三类“结果”通知只由 `workflow/server/utils/runtimeNotifications.ts` 的 `deliverWorkflowRuntimeNotifications` 在请求内发布一次；它们不在 `actionablePrerequisiteNotifications`（`data-runtime/internal/apps/workflow/actionable_lifecycle.go:174`）筛选的持久 `flow_notification_outbox` 之列，因此没有 outbox 重试。10/8 维持这一 best-effort 行为不变，但发布失败或被跳过（收件人缺失、eligibility 拒绝/不可用、操作目标不可用、Console 发布错误等）都会：

- 写入固定日志码 `workflow_result_notification_publish_failed`，字段仅含 `instanceId`、`eventType`、`causeStatus`、`causeClass`、`causeCode`（可用时），绝不记录标题、正文、URL、收件人或令牌。
- 累加进程内计数器，通过 `POST /workflow/api/internal/integration-operations/drain` 响应 `data.resultNotificationPublishFailed.processTotal` 暴露（与 `data.checkpointTokenDenied` 并列）。该计数是进程生命周期累计值，worker 重启会清零；drain 调用本身不会为结果类通知产生新的失败或重试，只读出当前值。
- 任务/委托/重提通知与 `rejectStrategy=to_previous` 的驳回通知（持久 outbox 类）不计入此计数，避免与既有 outbox 告警重复。

72 小时观察期间，`resultNotificationPublishFailed.processTotal` 相对上一次采样的**任何正增量**都必须告警（阈值 >0，即刻，不等日终对账）。处理步骤：

1. 在 Workflow 进程日志中按固定码 `workflow_result_notification_publish_failed` 检索，取出该条目的 `instanceId` 与 `eventType`（日志不含正文，不需要也不应尝试还原标题/URL/收件人）。
2. 用该 `instanceId` 只读核对实例当前终态（`GET /api/v1/instances/{id}` 或等效只读接口），确认实例已进入对应终态（approved/rejected/withdrawn），并确认发起人是否已经通过其它渠道（如列表页、邮件、旧通知）得知结果。
3. 仅当确认发起人确实没有收到通知、且用户明确批准补发时，才通过 Console 通知发布路径（`sendNotification` 所用的同一 Console 通知 API，而非重放整条 Workflow effect）为该发起人补发一条通知；`Idempotency-Key`/`idempotencyKey` 必须从原事件派生出的新键（确定性派生：在原 `workflow:{eventType}:{event}` 键后追加固定后缀 `:resend-1`，第二次经批准的补发才用 `:resend-2`；**不得使用随机值或时间戳**，这样人工重复执行同一次补发时 Console 会按键去重，发起人不会收到两条），不得复用原键（会被去重吞掉）也不得省略幂等键。补发内容与原通知的标题、链接、业务身份保持一致，仅收件人限定为已确认未收到的发起人。
4. 补发后在事件记录/审批记录中登记 `instanceId`、原因、批准人与新的幂等键，供后续审计；不重复补发同一 `instanceId`。

本节不改变投递语义：不新增重试、不引入 outbox、不涉及 Runtime/Go 侧代码改动；它只把既有的“发一次、失败即丢”行为的丢失情况变得可观测，方便运维在 10/8 窗口内决定是否需要人工补发。

## 恢复与观察

先只读核对 effect ID、原状态、版本、固定错误码、所属 instance 及依赖通知状态。通知依赖 abandoned 时先恢复创建通知；同键投递并确认 delivered 后，lifecycle 才能被正常 drain 领取。候选恢复接口为 `POST /v1/workflow/delivery-effects/{notification|actionable|callback}/{原 effect ID}/recover`，请求体严格为 `{"reason":"审批记录对应的非空理由","expectedVersion":原版本整数}`，额外键 400、版本变化 409；单独要求 `workflow:delivery-recovery:execute`。**不得在现有环境调用**。Runtime 从已认证的 `workflow.maintenance` 凭据取得租户、部署、client 与 credentialId，另记录请求关联 ID；锁行后以版本条件把 `abandoned→pending`、尝试数清零，保留原幂等键，在同事务写理由、原尝试数、前后版本审计。恢复同一行第二次返回冲突。

### 破窗身份、凭据与审计

`workflow.maintenance` 默认不存在；10/8 不登记、不预置凭据。每次破窗先取得用户针对**具体 effect ID、原因、租户/部署、操作者与有效时段**的批准，并留存审批记录。随后加密备份 Console 的 `service_clients`、`service_client_credentials`、`service_client_grants`、`vault_secrets`/版本及 Workflow 的 effect/审计表，核验可解密。v2.30 SQL **只安装两条恢复 grant**，不会创建 client 或密钥；其固定 C000001/test 绑定不得挪用于其它环境。已受审的受控命令 [workflow-breakglass](../data-runtime/cmd/workflow-breakglass/main.go) 把身份创建与同规格的两条 grant 合为单事务，按受保护审批记录中的租户/部署绑定，不经 Runtime bootstrap。该工具已通过 huizhiyun-fa 代码审查与隔离测试，提交为 `9957ad71`；实际运行任何阶段仍须针对具体事件逐段取得用户批准，**本次上线不运行**。

破窗命令只能在目标 Runtime 主机使用 Runtime 自己的配置与业务库账号（不得用 DDL 账号）；wiztek 生产须在客户侧 Runtime 主机执行，不得从开发机连接。不得复制 DSN 或 Vault 主密钥到别的主机。安全边界是操作者对 Runtime 主机及其配置（即 Console DB 和 Vault 主密钥）的访问；审批 JSON 只是流程约束与审计关联，并非安全边界。获批的 `--stage prepare --execute` 使用 owner-only 的 Runtime profile、Vault key 和审批 JSON，先建立 `workflow.maintenance`（`app_code=workflow`、disabled、无当前凭据）与双 audience grant；同一事务写 `operation_logs`，既有身份仅在上一案例完整 retire 后才可供新案例复用，不修复漂移 grant。逐行核对后，另一份限时且对应 `activate` 阶段的审批 JSON 才允许 `--stage activate --execute --secret-out <Runtime 受保护根目录/breakglass/案例号/credential.json>`：Console Vault 建立 15 分钟有效、只绑定此 client 与案例的 secret/credential，临时启用 client；secret 只进入本案例新建的 0700 子目录内、以 O_CREAT|O_EXCL 建立的 0600 JSON 文件；禁止 /tmp、覆盖既有文件或在日志中输出内容；路径可记入日志，命令输出仅 credentialId。文件写入或审计失败会回滚事务。**现有令牌签发入口**是 Console `POST /console/oauth/token` 的 `grant_type=client_credentials`：从保护文件读 client ID/secret 换短期 access token；该入口不创建 secret。单个 secret 在吊销前技术上可再次签发，因此操作限制为一次批准的 effect、15 分钟、恢复后立即 retire，并核对签发审计没有额外使用。审批 JSON 的 `stage/caseId/approvalId/approvalRecordId/operatorId/tenantCode/deploymentCode/effectKind/effectId/database/dbHost/dbPort/serverUuid/secretFile/expiresAtUtc` 须由审批记录制成 0600 文件，三阶段精确绑定同一个 effect；`secretFile` 在 prepare 时为空、activate/retire 时精确指向同一绝对路径，`expiresAtUtc` 不得超过当前一小时；命令还逐项核对 Runtime profile、数据库实例 UUID 与受信 Workflow deployment 绑定。不得把审批号当成免核对的授权。secret/token 不进入命令参数、回执或日志。

恢复请求只允许原 effect ID、原幂等键、批准的 reason 与读取到的 `expectedVersion`；先恢复 abandoned 的创建通知，待其同键 delivered 后再处理被阻塞的 lifecycle，不重新审批。Console `auth_token_events` 的 `issue_service` 与 `vault_access_logs` 的 validate 记录签发/密钥校验；Workflow `flow_delivery_audit` 的 `recover` 行记录 `credential_id`、reason、前后版本。三个脚本阶段各自在同一事务写 Console `operation_logs`，包含审批文件原始字节的 SHA-256 与用户批准记录（消息或工单）的 `approvalRecordId`，激活/吊销还写 `vault_access_logs` 的审批号。完成后使用新的 retire 审批 JSON 执行 `--stage retire --execute --secret-out <原文件>`，原凭据与 Vault 版本吊销、client 禁用，成功后删除保护文件；若删文件失败仍须人工销毁该已失效文件。每阶段记录审批号、操作者、加密备份哈希、逐行前后快照与脚本提交哈希。**可信归属锚点是 credentialId 与审批记录的对应关系**；requestId 可能来自调用方请求头，只是排查关联线索，不能单独证明操作者身份。恢复后只读核对原 effect 恰好一次投递、事项离开 `in_review`、未新增通知或第二次审批，并继续完成 72 小时观察。

激活中途失败须回滚事务并删除已写的本案例凭据文件；retire 可重复执行，重复调用不得再生凭据或审计行。诊断端点的维护身份状态用于 72 小时观察：`activeOver15Minutes=true` 或 `unrevokedCredentialCount>0` 均触发告警。10/8 之后优先改为在同一受控进程中完成换 token 与恢复调用，只在内存保存 secret，不再落盘。
