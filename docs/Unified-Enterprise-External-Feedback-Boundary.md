# 统一企业应用的外部产品反馈边界

2026-09-13。对应 ADR-018 保留的外部集成边界与 INT-105/106/206。本文记录尚待落实的具体合同，不表示该路径已经迁移或可发布。

## 当前事实

- `data-runtime/internal/apps/aims/productcenter/feedback_status_outbox.go` 与 `feedback_progress_outbox.go` 在需求决策/合并的业务事务中查询 Altoc 工单绑定。存在绑定时要求可信 Aims 来源、租户、部署及原 actor，并向 `integration_operation` 写入不可变命令。
- 反馈状态与进度是不同 operation/schema/idempotency key，保留各原始需求的反馈绑定；合并不能删除来源证据或把它们改成同一个目标工单。
- `aims/server/utils/integrationOperationDrain.ts` 对领取结果分别核对 tenant、deployment 与 sourceApp=aims，然后调用现有执行器。数据库合并本身不会迁移这些任务的领取、回执或失败恢复。
- Host 的真实服务主体是 enterprise；不能因业务域名为 aims 而改写未验证的入站 token 来源，也不能让浏览器选择 outbox deployment。

## 待实施合同

1. 根据已验证 Host 上下文及 Registry 逻辑域登记生成领域来源；明确逻辑业务来源与物理服务主体的区别，并在目标接口保留实际服务身份校验。
2. 为统一库中的原 outbox 确定唯一领取者。迁移前后保留 operation identity、原 actor、payload hash、幂等键、尝试次数、租约及 receipt；不能复制 pending 任务后让两个调度器同时处理。
3. claim、执行和 ACK 使用同一登记代际及正确的持久表；仍跨 Altoc 边界的调用保留短期服务凭据、精确 capability、目标身份与返回映射。
4. 对故障恢复验证“目标提交但响应丢失”、旧租约结束、新旧入口重放、代际变更和 worker 暂停后恢复；不得仅验证 outbox 插入成功。

已配置并验证真实 Aims worker 来源时，需求决策、合并及轻量计划采纳可在同一事务写入映射后的反馈 outbox；缺少该配置时仍整体回滚。生产者事务通过不表示外部投递完成，不能通过忽略反馈、提前提交业务状态、关闭鉴权或生成虚构部署来消除限制。

## 当前验证边界

已登记调度的停用/绑定漂移必须显式输出 `storage: "disabled"` 并保留代际，不能省略配置而退回旧调度。Gateway 对 disabled 不发业务 wake，Foundation 可验签该状态供 worker 拒绝消费；Gateway 12 项调度测试通过。控制面持久登记与解析输出由独立工作包继续实现，尚未写入实际租户。

Gateway 只在调度选择字段完全不存在时保留旧路径；显式空对象、null、非法 storage、数字或非规范 uint64 字符串 generation 均拒绝唤醒，避免配置错误变成旧库消费。代际须以字符串传递以保留 uint64 精度。新增六种非法配置场景后，调度测试共 13 项通过。

测试预检已允许显式 Aims unified scheduler，要求统一写入、与 Host 区分的真实 `aims.runtime` 部署绑定，以及四张不同物理 outbox 表；实际 grant 和逐租户切换证据缺失时列为待验收，静态配置永不自动成为 deployment-ready。预检 5 项测试通过。

Gateway 可从单租户 `apps.aims.enterpriseScheduler` 读取 `{storage: "unified", generation: "7"}`，将两个字段纳入 `enterprise-scheduler-v1` HMAC 扩展；未配置的唤醒保持原签名格式。Foundation 仅向已通过完整 Gateway/时效/HMAC 校验的调用方返回该选择，拒绝篡改或移除字段。Gateway 11 项调度测试及 Foundation 2 项签名行为测试通过。Runtime 九个统一调度接口均在身份与当前 grant 验证后、业务事务前要求 `X-HZY-Scheduler-Generation`：规范正 uint64 字符串，格式/缺失 400，与当前配置不符 409；事务内仍再次持锁验证持久 generation。专属 worker helper 已要求显式代际并透传此 header。此配置仍不可启用：共享 worker 消费已验证选择的接线与实际任务所有权切换尚待完成，当前没有修改租户登记或实际调度配置。

`pnpm --dir enterprise test` 15 项通过，覆盖当前 Host 组合、会话和 H3 规划 BFF；这些测试不覆盖本合同的外部反馈任务执行。需求合并已提取共享事务入口并保留原反馈调用，早期失败回滚单测通过；外部反馈联合验收仍待完成。

## 已实现的调度基础（仍待完整外发验收）

- `Registry.BeginSchedulerTransaction` 独立核验 Scheduler 模式并持有持久 generation 共享锁；Read/Write 模式不隐含 Scheduler 授权。
- `SchedulerBinding` 将实际 Aims worker 的 tenant、deployment、source、client 与 subject 绑定到显式来源登记，拒绝借用 enterprise.runtime。
- Repository 的共享事务领取、成功确认与失败记录保留原租约和重试算法；错误回滚调用方事务，成功由调用方提交，空领取亦不提前释放代际锁。
- `enterprisescheduler.Service.Claim` 将登记权限、表映射与共享领取串联，提交后才返回租约供网络投递。
- `authenticateEnterpriseScheduler` 使用现有 manifest 的精确 `aims:integration_operation:execute` 能力，要求严格服务 JWT、真实 Aims 部署绑定及实时 credential/grant 核验。它不使用交互式用户 actor 作为 worker 身份。

Runtime 已接 `POST /v1/enterprise/aims/integration-operations:claim`，body 为 `{}`（领取下一条）或 `{ "operationKey": "..." }`（指定领取）。拒绝额外 body 字段、JSON null 和 query；worker 标识由真实 service client 与请求的 request ID 派生。仅显式 `aims.Scheduler=unified` 时初始化，并要求有效 `aimsDeliveryWorker` 和统一写入来源；缺失配置启动失败，不回退旧调度路径。返回复用原 Aims 领取结果格式。

成功和失败入口为同前缀的 `:succeed` / `:fail`，body 保留原 Aims ACK 字段并增加 `operationKey`。调用方必须沿用领取时的 `X-Request-ID`，不能由 body 覆盖 worker；三入口均重新核验真实 service JWT 和当前 grant。完成服务在 Scheduler generation 锁保护下复用原 Aims 的租约、冻结 command/target receipt 校验及业务 checkpoint，整体提交后返回；领域 4xx 保留，底层错误脱敏为 503。网络投递不进入数据库事务。

Worker 侧 `callAimsUnifiedIntegrationOperationRuntime` 已提供领取/成功/失败及六类通知旧调用到统一端点的显式适配，保留 URL 编码的稳定键、operation ID、原 ACK 字段、版本字符串与收件人；冲突键与未知路径直接拒绝。调用要求实际 `aims.runtime`、稳定 request ID、精确 `aims:integration_operation:execute` 和短期令牌，禁止静态 token。当前未接入 drain 开关：必须完成完整 HTTP 验收和逐租户任务所有权切换后，才能整体选择新调用器，不能将未知路径回退到旧库。适配器 3 项行为测试与局部 ESLint 已通过。

通知的三个 pending 查询及 failure-notified、dead-letter-actionable-published、dead-letter-closure-acknowledged 已注册同前缀 POST 路由。后者通过 body `operationId` 传递原 path 身份，其他字段沿用原合同；共享 Aims helper 保留解析、响应和冲突语义。Repository 六方法及 Scheduler 服务的真实 MySQL 验收已证明未提前提交、回滚无残留、提交后幂等，以及错误租户/过时代际拒绝；通知 HTTP 的发布与 closure 联合隔离验收已补核通过：`test-enterprise-scheduler-http-mysql.mjs` 使用临时 MySQL 和本地 HTTP fixture，覆盖六操作、发布/closure 重放及非法输入拒绝，Go race 包耗时 2.159s。[脱敏证据](../deploy/test-env/artifacts/C000001.scheduler-notification-http-mysql-verification.json)。这不代表实际 worker 所有权已切换，也未证明外部提供方投递及响应丢失恢复。

Scheduler 身份 10 种场景单测及 Server 测试通过；初始化接线后需求真实 HTTP/MySQL 回归通过。四张物理 outbox 表的 Repository 实际 MySQL 验证已覆盖领取、租约、事务回滚与 receipt 重放。Scheduler generation 与领取的整体 MySQL 链、完成回执业务校验、真实 worker 切换和 Altoc 投递仍需验证，不能据此启用后台任务。
