# Workflow 上线必修项设计（待审）

日期：2026-09-28。对应 [10 月 8 日上线计划 §4](./Go-Live-20261008-Plan.md)。本文件仅提出代码、迁移与验收方案；没有执行数据库、grant、Worker 或生产环境写入。9 月 30 日起按审定方案分批实施。

## 1. 通知投影先于生命周期关闭

**选择“创建先于关闭”的持久依赖，不引入墓碑。** 现有迁移 `workflow/docs/migrations/012_durable_notification_outbox.sql` 已使创建待办通知与 Workflow 业务事实同事务入 `flow_notification_outbox`；`data-runtime/internal/apps/workflow/actionable_lifecycle.go` 的 pending 查询会阻止同一 `actionable_key` 上存在未投递创建通知的 lifecycle；Workflow drain 已按通知 → lifecycle → callback 的顺序执行。这个基础保留并补齐约束，而非另建第二套投影事实。

实施时要求：每个会生成新 pending 待办投影的分支（初次发起、委托、重提、退回前一人）在业务事务内写入带稳定 `idempotency_key`、`actionable_key` 的创建通知；同事务写入关闭旧投影的 effect。effect 要明确冻结它所依赖的创建通知 ID/键；不能仅凭关闭目标的 `actionable_key` 推测依赖，因为委托可能先创建新受托人的键、再关闭旧受托人的键。Runtime 只有在这些通知得到 Console 成功或同键回放的确认并持久 ack 后才放出关闭 effect；通知发送成功但 ack 响应丢失时仍用原键重放，不能重新派生通知。读取通知/生命周期的分页、重试和并发领取均不得跨越此依赖。缺少对应创建事实的存量 effect 必须显式列入迁移核对与人工处置，不能仅因“无 pending 通知”就假定投影存在。

依赖记在关闭 effect 的显式 `depends_on_notification_outbox_id` 列（可空），委托等跨 `actionable_key` 的场景按通知行 ID 冻结；写入与领取时必须核对依赖通知属于同一个 `instance_id`，并按该 ID 核对 delivered，不能只按字符串或“没有 pending”推断。跨实例 ID 必须拒绝或按缺依赖失败关闭，隔离测试覆盖该反例。存量 effect 的依赖先在生产只读盘点计数，再决定人工处置，不自动回填。Console `404 actionable_not_found` 算一次普通失败：保留原 effect 和原幂等键，按有界退避重试；到上限原子转 `abandoned` 并告警，不另设暂停状态。若创建通知 abandoned，关闭 effect 不得绕开依赖。墓碑方案需要在 Console 增加“关闭先到”状态、跨重放与撤销的一致性规则，扩大两个存储系统的状态空间；本期不采用。

验收包括：正常创建→关闭、关闭先于通知可用、通知成功但 ack 丢失、同键重复、委托/退回/重提、旧缺失创建行、Console 返回 404。每种情况核对一条通知、一条待办投影、正确最终状态，且没有重复外发。

## 2. outbox 有界重试、终态与审计

当前 `flow_notification_outbox`、`flow_actionable_outbox` 只有 `pending/delivered`，fail 仅递增 `attempt_count`；通知退避为 60/300/900/3600 秒，lifecycle 为 600/1200/2400/3600 秒。`flow_callback_logs` 虽有 `attempts < 20` 查询上限，但耗尽后仍保留 `failed`，缺少明确终态。方案是在 canonical schema 与增量迁移中为三类投递统一引入不可自动领取的 `abandoned` 终态和 `abandoned_at`、固定 `last_error_code`/`last_http_status` 等安全诊断字段；回调表保持其现有状态名称/行为的兼容迁移，统一明确终态。历史已耗尽记录先盘点，再以有记录的迁移判定，不静默丢弃。

建议通知与 lifecycle 上限各 **12 次失败尝试**；回调沿用现有 **20 次**上限并补终态迁移。每次失败在事务内以 `pending` 与当前版本作条件更新：未达上限写下次可领取时间；达到上限原子改 `abandoned`，落时间、错误码和审计事件。成功 ack 只允许 pending→delivered；已 delivered 的同键回放返回原结果；abandoned 不由自动 drain 复活。本期只增加最小的受控 Runtime 恢复命令，不做 UI：请求只含原 effect ID、操作者与固定原因，要求单独精确 capability；服务端复核原行与版本，把 abandoned→pending 并保留原幂等键，在同事务审计旧新版本及操作者。另交操作 Runbook，说明检查、恢复、观察与回滚。审计只记录租户、部署、effect ID、种类、尝试次数、固定错误码、状态和时间，不存令牌、通知正文或原始异常。health 或诊断端点至少按租户/类型报告 pending 最长等待时间、abandoned 数、依赖阻塞数；72 小时观察期逐日核对，出现 abandoned 不得把审批闭环报为健康。

回滚兼容性：现有通知与 lifecycle 领取查询只取 `delivery_status='pending'`，回调领取只取 `status IN ('pending','failed')`；旧二进制不能因看到 abandoned 行而枚举解析报错或崩溃。实现批须复核所有旧版读取路径没有对全状态做严格枚举映射，隔离库演练迁移与二进制回滚，并写入 Runbook；生产环境写入另经批准。

013 的 ALTER 属非事务 DDL。每次隔离或目标库演练前记录 MySQL 版本，对三条 ALTER 分别记录实际 `ALGORITHM`（INSTANT/INPLACE/COPY）与耗时；MySQL 8.0.29 以下的 `ADD COLUMN ... AFTER` 可能重建表，生产执行前须据实评估锁表窗口。备份、停止相关写进程、逐条后验与失败恢复步骤由 Runbook 固定，不能把计划算法当成实际算法。

迁移和测试应覆盖并发 fail/ack、恰好到阈值、重启后阈值持续、不同失败类别、abandoned 后不再领取、人工重放仍使用原键、关联创建通知 abandoned 时关闭保持阻塞。上线前在隔离库演练升级与回滚；生产写入需另获用户批准。

## 3. 四项云端定时任务的唯一 owner 与精确授权

**唯一调度主体为 Tenant Gateway 的 5 分钟 cron + Platform 租户 scheduler registry。** Gateway 从受保护 registry 分页取租户/应用，按持久 generation/部署绑定签名唤醒，不让应用 Worker 各自另开 cron。当前 `deploy/cloudflare/tenant-gateway/src/index.js` 已包含 `aims`、`workflow` wake 与 `/api/internal/integration-operations/drain` 私有路径；这只是代码能力，不能证明任何生产租户的 scheduler owner 已登记。开启前逐租户核对 registry、generation、Gateway 版本与四项实际 wake 水位，并关闭或使 legacy Aims cron 在 unified owner 下明确 skipped/409。普通 HTTP 不得调用私有 wake。各 worker 都要检查签名 tenant、deployment、runtime endpoint、时间窗与 generation，过期/冲突失败关闭。

| 任务 | 唯一业务执行者及调用链 | Runtime 精确 scope / 接口 | 双 audience grant 设计（仅列候选，不写入） |
| --- | --- | --- | --- |
| Aims integration drain | Gateway 签名唤醒 Aims `POST /api/internal/integration-operations/drain`；Aims 执行有界 claim/投递/ack | `aims.runtime` 的 `aims:integration_operation:execute`；`/v1/enterprise/aims/integration-operations:*`，单数 execute，不借管理复数 scope | `data-runtime:aims:integration_operation/execute`、`tenant-runtime:aims:integration_operation/execute`；两行 `semanticScope=aims:integration_operation:execute` |
| Aims 到期通知 | 同一签名 Aims wake 内独立有界扫描/确认；`HZY_AIMS_DUE_NOTIFICATIONS_ENABLED` 仍是单独开关，legacy 15 分钟 cron 在 unified 下跳过 | `aims.runtime` 的 `aims:notifications-due:execute`；`/v1/enterprise/aims/notifications:scan-due|acknowledge|acknowledge-closure`，带 generation | `data-runtime:aims:notifications-due/execute`、`tenant-runtime:aims:notifications-due/execute`；两行 `semanticScope=aims:notifications-due:execute` |
| Aims 里程碑 rollover | 同一签名 Aims wake 内执行；legacy 每日 cron 在 unified 下跳过；Runtime 持 registry SHARE 锁核 generation | `aims.runtime` 的 `aims:milestone-rollover:execute`；`POST /v1/enterprise/aims/milestones:rollover-due` | `data-runtime:aims:milestone-rollover/execute`、`tenant-runtime:aims:milestone-rollover/execute`；两行 `semanticScope=aims:milestone-rollover:execute` |
| Workflow callback drain | Gateway 单独签名唤醒 Workflow `POST /api/internal/integration-operations/drain`；该入口依次 drain 创建通知、lifecycle、callback，callback 按原 effect/key 投业务 app | `workflow.runtime` 对三类 effects 的领取与 ack/fail 一律用新的单数 `workflow:integration_operation:execute`，Runtime 仅对这些精确路由接受此 scope；普通 Workflow 用户读写仍使用原 scope。投递另用 `aud=<业务 app>, scope=workflow:callback` | `data-runtime:workflow:integration_operation/execute` 与 `tenant-runtime:workflow:integration_operation/execute` 两行；均为 `semanticScope=workflow:integration_operation:execute`。callback 目标 app 的 `workflow:callback` grant 另按实际业务 app 核对 |

授予前以实际 service client、tenant/deployment 与 audience 的现有行做差集。候选 seed/verify 只插缺失，不复活 revoked；逐行校验 client、物理 resource/action、`scope_json.audience`、`semanticScope`、tenant/deployment、source 和 ACTIVE。Aims 三项可参考现有 v1.92/v2.8/v2.9 SQL 的物理命名，但旧 seed 未必含全部现代绑定字段，不能原样声称适合生产；Workflow v1.20 同理。实现批应交付相应精确 seed/verify **文件**和隔离 SQL 测试，但本设计阶段不创建这些文件、不执行任何 grant 写入。启用前对每项两个 audience 做真实组合签发和 Runtime 使用探测，错 audience、错来源/部署、缺 scope 必须 403；身份/依赖故障保留 503。不要把 Gateway wake 身份误当成有业务 grant 的 `aims.runtime`/`workflow.runtime`。

契约测试还需覆盖：一个 scheduler generation 对每租户每 app 只有一个 owner；重复 wake 只领取一次、持久游标/幂等键不重复业务动作；Aims 两个子任务在同一 wake 中各受独立开关/精确 scope 控制；Workflow effects 路由的宽 `workflow.read/write` 必须被拒，而非 effects 的存量用户路由不变；四项 worker 调用代码与上述 Runtime route 的 scope 映射一致；data-runtime 与 tenant-runtime audience 均可用而跨 audience 失败；legacy cron 在 unified 模式不执行业务写入；Gateway 不经公网绕回业务 Worker。预发至少跨一个同步周期和一次手动 drain 核对四项水位、receipt 与错误告警。

Gateway cron 也进入 CPU 门禁：每次只读有界 registry 页、限制租户数/唤醒数/并发/总 wall time，超出留下一轮分批处理，不能在单次 cron 内无上限追赶。预发实测 5 分钟 cron 的 CPU p50/p95/p99、`exceededCpu`、处理量和积压消退；同时只读确认 Cloudflare 账户 cron trigger 数未超配额。生产 Platform scheduler registry 登记 wiztek owner 是生产写入，须列入单独的用户批准项。

## 4. wiztek 生产 Workflow 部署判定与顺序

2026-09-28 的[只读核对](./Wiztek-Production-Read-Only-Check-20260928.md)已证实 `hzy-workflow` Cloudflare Worker 有 100% active 版本（2026-09-22）；因此**不是新建 Worker**，而是升级现有 Worker。尚未证实其生产数据库、schema 版本、租户绑定和业务健康，不能断言“已有可复用 Workflow 库”，也不能立即断言“必须新建库”。

实施前先用获批准的生产只读通道核对：Worker 绑定与路由、Workflow 数据库身份和 schema 版本、迁移 001–012 的逐项 verify、租户 deployment/Runtime registry、**当前调用它的应用**、进行中的审批实例与 callback/outbox 存量。若库不存在或与生产隔离要求不符，按上线计划创建**独立生产 Workflow 库**，从 canonical schema/迁移顺序安装并 verify 至 012，再应用本设计新增迁移；若已有合格库，则在加密备份与恢复演练后只补缺失迁移，绝不重建/覆盖实例。两条路径均须记录迁移 hash、Worker 与 Runtime 制品 hash、业务路由、callback 目标与唯一 scheduler owner，并在暗发布用标记审批完成创建→决策→回调→通知/待办各一次，同时对每个既有消费者的进行中审批、终态回调和存量 outbox 作不重复投递回归。生产库、Worker、grant 与 scheduler registry 的任何写入均另经用户批准。

## 实施批次与审查门槛

1. 通知依赖与 outbox 终态：先交 DDL/兼容性、Runtime 原子状态转换、Workflow drain、隔离 MySQL 与两跳合同测试，审后实施。
2. 四个 owner：交 worker 调用、精确 Runtime 校验、候选双 audience seed/verify、生成的配置与契约测试；云端启用另走环境批准。
3. 预发验证：真实四项 grant 签发/使用、两租户隔离、故障重试/恢复、唯一 cron 水位、Workflow 审批闭环与性能门禁。预发证据未齐不进入 wiztek 暗发布。

**须另取用户批准的环境步骤**：任一 Console grant seed、生产或预发 Workflow schema 迁移及新库、Worker 部署、Runtime 部署、Cloudflare cron/绑定设置、生产 Platform scheduler registry 的 wiztek owner 登记、业务开关启用。设计与本地代码/隔离测试本身不执行这些步骤。

## Claude 审查意见（2026-09-28）

**结论**：方向通过，可以按下列修改在 9/30 开始实施。

1. **§1 的 404 处理要并入 §2 的有界重试。** 显式依赖建立后，`actionable_not_found` 只可能出现在投影丢失或存量缺口时。它应当算普通失败，按上限重试后进入 `abandoned` 并触发告警，不要另设“暂停”状态。依赖关系用关闭 effect 上的显式列记录（例如 `depends_on_notification_outbox_id`，可为空；委托等跨键情况按 ID 冻结）。存量 effect 先在生产只读盘点计数，再决定人工处置，不写自动推断。
2. **§2 的人工恢复本期只做最小命令，不做 UI。** 提供一个受控 Runtime 命令，把 `abandoned` 改回 `pending`：只接受原 effect ID，保留原幂等键，写入操作者、原因、前后版本的审计，并要求单独的精确 capability。另写 Runbook。诊断 UI 放到上线后。监控至少做到：health 或诊断端点能按租户和类型给出 pending 最长等待时间、abandoned 数、依赖阻塞数；72 小时观察期逐日核对。回滚兼容已核实：现有领取查询只取 `delivery_status='pending'`，旧二进制不会领取 `abandoned` 行。迁移仍须在隔离库演练回滚。
3. **§3 的 Workflow drain 不能继续用宽 scope。** 当前 effects 路由用的是 `workflow.read` / `workflow.write`（`server.go:3819-3914`）。根 `CLAUDE.md` 要求，新启用的 scheduled worker 或 outbox drain 必须做 Data Runtime 精确 scope 校验，宽 scope 只用于存量兼容。请为三类 effects 的领取和 ack 定义 `workflow:integration_operation:execute`（单数，与 Aims 命名一致），Runtime 对这些路由只接受这个精确 scope，并按双 audience 生成 seed 和 verify。`workflow:callback` 投递部分不变。
4. **§3 的 Gateway cron 要受 CPU 门禁约束。** 用户已决定不升级 Cloudflare 套餐。5 分钟一次的 Gateway cron 需要分页读取 registry、为每个租户签名唤醒，请在预发实测单次 cron 的 CPU，并确认账户的 cron trigger 数量没有超限；每次 cron 的处理量要有上限，超出部分分批做。在生产 Platform 的 scheduler registry 登记 wiztek owner 属于生产写入，列入用户批准清单。
5. **§4 要加上现有消费者回归。** 生产 Workflow Worker 已在运行（9/22 版本）。只读核对时要确认有哪些应用在用它，以及是否有进行中的审批实例。演练和暗发布时，这些已有流程的审批与回调不能回归，新 drain 也不能让它们的存量 outbox 被重复投递。
6. **排期**：10/8 必须完成 §1 的依赖、§2 的终态、上限和最小恢复命令、§3 的四个 owner 及精确 scope。诊断 UI 和墓碑方案不做。§3 是 Codex-sol 的关键路径，请与收敛批 2 错开：批 2 做代码时，Workflow 这边先做 DDL 和隔离测试。
