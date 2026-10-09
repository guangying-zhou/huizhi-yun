# Aims–Workflow 统一事务设计（ADR-018a D9）

状态：**第三轮设计修订，落实定稿复核 R1–R3；不是实施/环境批准**。2026-10-01，Codex-sol。

依据：ADR-018a D1/D7/D9/D10、`.git/brief-aims-inprocess-scheduler-20261001.md` §5–6，以及 Fable 第二轮评审与“定稿复核”。任务 A 的进程内里程碑滚转已提交 8b680140，每轮审计落库已提交 376e43d5；本文件定稿任务 B，不改变现行完成审批链路。

## 1. 决策与边界

- Workflow 表迁入每租户统一业务库，Aims 完成申请与创建 Workflow 实例在**一笔事务**内完成；审批决策与 Aims 结果回写也在**一笔事务**内完成。两个阶段各有自己的事务，不把等待人员审批期间当成一个长事务。
- Console/Directory 按 D10 保持独立库。目录事实只在开启统一业务事务前读取不可变快照，事务中不回读 Directory，不使用隐含第二连接。
- 通知与 actionable 仍是对 Console 的外部副作用，保留 Workflow 的现有事务 outbox、创建依赖、版本栅栏、abandoned/恢复审计；不把网络调用放入业务事务。本 lane 不生成还要发给 Aims 的 pending callback 行。
- 内部调用不是免授权通道：用户 token/actor、Host permit、人员动作、关系/范围、资格/受托人/职责分离、版本、冻结证据、回执和审计全部保留。不新增 capability、grant 或通用 SQL/UUID 代理。
- 迁移完成前：任务 A 可以另批先上线；工作项完成保留现有 hzy-aims 投递，**不实施跨库内部 outbox 替代方案**。

## 2. 当前链路与复用点

| 段 | 实现依据 |
|---|---|
| Host 完成提交 | `enterprise/server/utils/enterpriseAimsWorkItemWrite.ts:24–43`：封闭输入、固定 operation、权限/范围 permit、actor 委托 |
| Aims 申请与冻结 | `data-runtime/internal/apps/aims/enterprise_work_item_completion.go:88,185–223,367–387`：target/matter、请求快照、in_review 与 `aims.work-item.completion.workflow-submit.v1` 在同 tx；target v1/matter v2 键/hash 固定 |
| Aims executor | `aims/server/utils/claimedAimsOperationExecutor.ts:21`、`workItemCompletionOperationExecutor.ts:29` 起：租约、冻结命令、Workflow回执匹配、原 operation checkpoint |
| Workflow HTTP | `workflow/server/api/v1/service/aims-work-item-completion-approval.post.ts:16–46`：aims.runtime/来源部署/委托 actor/命令摘要；collectWorkflowInitiatorContext；Runtime Service API；runWorkflowRuntimeEffects |
| Workflow Runtime | `data-runtime/internal/server/workflow_aims_completion.go:10–39`；`internal/apps/workflow/aims_completion_receipt.go:116–208`：ReceiptRepository.Execute、自开事务、匹配路线/createInstanceTx、恢复原 instance |
| Effects | `internal/apps/workflow/actionable_lifecycle.go:132–171` 与 `runtime_instance_writes.go:81`：事务内冻结创建通知、lifecycle依赖、callback；`workflow/server/utils/dataRuntime.ts:79,199–330`：即时投递及 outbox drain |
| Aims 回写 | `aims/server/api/v1/service/work-item-completion/workflow-callback.post.ts:7–11`；`internal/apps/aims/work_item_completion_callback.go:29–125` 起：受信回调/非本人/冻结kind/hash/instance绑定，项目→事项→申请锁与回执 |
| 当前分库 | Workflow `internal/apps/workflow/adapter.go:44` 独立 db.Open；`deploy/self-hosted/cutover/render-runtime-config.py:71` 仍 hzy_workflow；不是同库事务 |

共享回执已有 `integrationoperation.WithReceiptTable` / `WithReceiptOutboxTables`（`repository_tables.go:101–130`）。不能把现有会自开事务的 Adapter 外层函数套进新事务；应抽取复用的 Tx 核心，外部 wrappers 保留鉴权及独立部署行为。

## 3. 目录不可变快照（M1，D10）

### 3.1 读取时点与来源

Runtime Directory owning typed helper 在开统一业务 Tx **之前**，在 Directory 自己的一次一致性只读事务内读：

- `directory_users`：actor 精确 uid（BINARY）、active 状态、姓名别名；
- `directory_user_departments`：active 的 is_primary 关系；必须恰好一个；
- `directory_departments`：主部门、经理/负责人、类型/层级、直接父部门及其经理/负责人。

字段对齐 `workflow/server/utils/initiatorContext.ts:40–82`：initiator_uid/name、dept_code/name、initiator_dept_code、org_type/level、manager/leader别名、parent_code与父级manager/leader。当前 `getUserRoles` 返回空数组，保持不发明角色。快照由权威目录读产生，不能把 body/permit 中的部门当成目录事实。

**投影版本定稿**：读取参与事实的最大 `updated_at` 与各参与行稳定主键/uid/部门码及该行 updated_at，作为 canonical version vector；对字段集与 version vector 规范序列化计算 snapshotSha256。它是这次读取的不可变版本标识，不声称全局严格递增 revision；有既有投影 revision 时一并保存。删除/新增的差异由完整成员集合及摘要识别，不能只凭最大时间代表一致性。

用户不存在/非 active、主部门零个或多个、部门/父级事实缺失或非法、Directory不可达、投影版本不可取得、路线匹配失败，均 **503 失败关闭**；不回退无部门路线。记录固定错误类别，不泄露账号/部门细节。

### 3.2 固化与审批语义

快照+版本向量+hash 写进申请 `snapshot_json` 和 Workflow 实例的上下文/表单快照（现有 JSON 字段复用，不新建表）。路线匹配只用这份快照，业务 Tx 内不再回读目录。

**审批人在实例创建那一刻由快照决定，之后目录变更不影响已创建实例的审批人选择。** 用户是否仍具备审批资格、任务当前受托人、静态 approve/reject 和职责分离仍按每次决策的现有规则复核；快照不会授权停用账号。这与跨进程链路的目录/业务非强一致性取舍一致。

响应丢失的同键重放：仍先验证当前 actor/permit；已成功回执对应的冻结目录快照不被新读取替换、不重新匹配路线。尚未有提交回执的请求使用本次预读快照；事务中的版本/锁校验失败不留下半申请。

## 4. 内部 lane 与统一锁序（M3，S2）

### 4.1 编译期隔离

内部 typed command 位于 `internal/apps/workflow/internal/lane`，字段私有；仅 Workflow owning 协调代码可导入该 Go internal 包，在锁定 Aims/Workflow事实后构造。lane入口使用包内函数。HTTP handler只调用保留全部鉴权的 Adapter公开业务方法，不接收/返回 internal command，不存在内部模式 body/query flag。

统一协调入口由 Workflow owning 包实现（可以调用 Aims 的 Tx 核心；Aims 不反向 import Workflow，避免循环依赖）；server不能 import Workflow的 internal/lane。公开方法接受现有经过验证的 Host边界输入并执行既有许可复核，不能仅靠“server说已经认证”跳过校验。跨 owning 调用只使用受限 typed事实与同一 Tx，不能传 map 注入 trusted flags。

验收：Go internal编译隔离负例 + AST契约扫描，拒绝 `internal/server` 引用 lane构造器、构造内部事实或写 verified标志；扫描不能只匹配特定变量名。测试 HTTP body/query 伪造内部模式无效；外部 Service API保持原严格认证。

### 4.2 人员与 permit

审批人/受托人解析、实例创建候选解析、动态委托与决策主体均显式拒绝 `system:*`、服务 client/subject（包括 aims.runtime、enterprise.runtime、workflow.runtime）；人员身份必须来自已验证的用户事实，不能仅按字符串不像 *.runtime 就当用户。

Host permit校验函数与项目/事项范围、关系撤权复核原样复用：purpose/resource/action/mode、actor/tenant/deployment/project/item、≤15s TTL、策略version/hash、当前权限撤销事实。同键重放也先复核撤权，不能从旧 receipt获得永久许可。

测试：系统主体不能成为任务受托人、不能决策；服务主体同样拒绝；错用途/动作/模式/项目、过期、撤权全部403且不调用领域mutation。合法 target/matter 正例不受影响，自审拒绝。

### 4.3 共享锁序 helper

在 `internal/enterprise` 增加共享锁序 helper，协调两条路径都依它执行：Registry generation SHARE → Aims项目 → 事项 → 完成申请 → Workflow实例 → task/action（同层按稳定 ID 排序）。领域内额外锁在此顺序后取得；receipt 的获取点统一，不能各自先锁 receipt再逆序锁对象。

决策现状先锁 Workflow再回写Aims，必须改为先读取关联定位线索，再依 helper锁 Aims后Workflow；锁后再次核对关联与版本，定位变化拒绝。不得持有Workflow锁时再调用旧的Aims自开事务方法。

隔离 MySQL交叉并发提交/决策 N轮（包括相同项目及多事项、同receipt键、同时撤权/成员变更），证明无死锁/丢更新，重复请求只有一个实例、没有半审批/半回写。测试必须实际交叉，不用顺序执行代替并发。

## 5. 两个业务事务与 effects

### 5.1 完成申请事务

Host现有用户认证/permit → Directory预读快照 → 一次双域Registry绑定Tx → helper锁项目/事项/申请 → owning Aims重验状态、target/matter就绪、冻结证据与原键/版本 → 申请快照 → owning Workflow路线匹配、实例/任务/任务快照、创建通知outbox → 回填instance/kind/hash、in_review、既有receipt/审计 → commit。

这里的“双域Registry绑定Tx”是 B2 的明确交付，不代表现有单域 `Resolve` 已能一次解析两域；多域接口、统一存储/代次栅栏和失败关闭要求见 §6.3。

不能建立等待Aims Node消费的新 Workflow-submit operation；原键仍可用于内部幂等，命令hash/schema/actor语义不变。Workflow路线或任一写入失败整笔回滚；原字段顺序/规范摘要与target v1、matter v2兼容。

### 5.2 审批决策事务

现有静态approve/reject + 当前任务受托人/资格/职责分离 → 同一双域Tx与共享锁序 → 任务version/fencing复核 → Workflow批准/驳回 → 从锁定实例/request事实构造内部Aims回写 → owning Aims比对hash/kind/actor/request/instance、至少一名批准者不是申请人、冻结证据与当前状态 → 批准completed / 驳回in_progress → 写结果receipt/审计、通知/lifecycle outbox → commit。

Aims回写失败时Workflow决策也回滚。不会先提交审批再留下需手工恢复的本lane callback。同键重放返回原回执，不二次推进状态。

### 5.3 仍需外投的 effects

通知和actionable继续由Workflow Worker的即时投递+正式drain处理；创建通知依赖、same-instance/actionableKey绑定、version fail栅栏、ack交错幂等、abandoned/恢复保持。业务commit后才进行外部网络IO。响应丢失的effects由持久outbox恢复。

仅工作项完成的内部callback不产生pending外投行；其它callback继续既有Service API。禁止同一完成效果既同Tx执行又生成pending HTTP callback。审计可以保留内部效果已应用的固定记录，不假装通过服务token验证。

## 6. Workflow 迁入统一库（M5，S1，S4）

### 6.1 表与关联盘点

Canonical `workflow/docs/workflow_schema.sql` 与 Adapter.requiredTables列12表：flow_schemas、form_schemas、flow_action_defs、flow_routes、flow_instances、flow_tasks、flow_actions、flow_actionable_outbox、flow_notification_outbox、flow_callback_logs、flow_delivery_audit、service_command_receipt。另有 template_schema.sql 的system_parameters，真实库有就迁移，无则记录源不存在且不制造数据。

FK保持：action_defs→form_schemas，routes→action_defs/flow_schemas，instances→action_defs/routes/flow_schemas，tasks/actions/outboxes→instances，actions→tasks；FK需指目标物理表。无FK的callback/effect/audit/request逻辑关联同样逐行核对。保留PK、AUTO_INCREMENT、action_def/resource/action与route/level唯一性、notification/callback幂等键、receipt identity/operation唯一索引；013/014全部version/attempt/依赖/恢复归属字段与ENUM保留。

本轮未访问任何环境：实际行数、DDL、版本、字节量、索引、孤儿与租约规模未知。执行前需用户批准只读COUNT、information_schema、SHOW CREATE、count/hash、水位与跨Aims request/Workflow实例关联核对；不能把TABLE_ROWS估计当验收。

### 6.2 物理名与映射定稿

| 逻辑表 | Workflow物理表 | 访问方式 |
|---|---|---|
| flow_* | **workflow_flow_***（例如 workflow_flow_instances） | Registry精确mapping + 原逻辑名的MERGE/INVOKER全列兼容view；目标已存在任何对象即拒绝覆盖 |
| service_command_receipt | **workflow_service_command_receipt** | 已有SharedPhysicalNames + `Resolved.Table` + `WithReceiptTable`；不建同名view、不与其它域合表 |
| workflow_system_parameters | **workflow_system_parameters** | Workflow 域专属映射；未来读取经 `Resolved.Table`，不生成同名兼容视图 |

源 Workflow 表 `system_parameters` 迁移时改名复制为 `workflow_system_parameters`，逻辑名与物理名都用后者，保留全部记录、`uk_param_key` 与原列/索引定义。Workflow 域映射不得包含逻辑名 `system_parameters`。静态核对：Workflow 运行时 TS/Go没有读取该表，只有 `workflow/docs/template_schema.sql:7` 定义；004主要插入Workflow定义，不依赖该模板参数。未来读取必须经 `Resolved.Table("workflow_system_parameters")`，不能借用 Assets 的无前缀表名。

**不改 `SharedPhysicalNames`，不改 Assets 的 ExclusiveOwners、adapter 或现有 `system_parameters` 视图。** 该视图继续归 Assets，现有 142 视图安装基线中的定义与成员资格保持不变；不移除、不改指、不把 Assets 参数入口改造设为 Workflow 迁移前置。迁移规格区分本张直接物理表与需生成兼容视图的 Workflow 表，不能创建同名自引用视图；全量安装集与派生集双向相等校验必须通过。隔离演练在既有 142 视图安装基线上验证新增 Workflow 对象、两域参数数据隔离和 Assets 视图定义/数据不变；最终视图数按冻结规格派生，不硬编码为 142。

### 6.3 Runtime与工具适配清单

- config.EnterpriseBinding当前白名单不含workflow：增加明确域、owner deployment、read/write/scheduler绑定。
- Workflow.New当前独立pool：新增统一Registry binding/compatibility gate/Txn型owning接口，不只改DB名称。
- **B2 新增/明确多域 Resolve 与测试**：现有 `Registry.Resolve(ResolveRequest)` 是单域；`BeginWriteTransaction`/`BeginSchedulerTransaction` 虽已接受多个请求并逐域 Resolve、比对 DB/Key/schema/generation，再持持久化 Registry 栅栏，但这不等于已完成 Aims–Workflow 双域接线。复用已有事务框架，补多域解析接口与 Workflow 安装完整性检查，不另建第二套连接/事务。

多域接口要求（候选接口名 `ResolveDomains(requests ...ResolveRequest) ([]Resolved, error)`，在 B2 确定精确签名）：

1. 由受信配置构造固定 aims/workflow 两个 Write 请求，不接受 body/query 指定域、owner、存储或代次。拒绝空集、重复域、混合 operation；既有单域 API 与 scheduler 权限分离保持不变。
2. 同时解析两域表映射及各自 owner deployment，要求同一 storage/database/连接池、tenant/environment/runtime deployment、schemaVersion 和非零 generation。每个 owner 须匹配该域登记事实；不是要求两个域的合法 owner 字符串彼此相同。
3. 任一域缺失、模式非 unified、映射漂移、所需物理表/兼容视图未安装或定义不符、owner 与该域登记不一致，都整体拒绝，不返回部分结果，不进入领域代码。热路径显式传入 `WorkflowTransactionRequirements{Aims, Workflow}` 的本 lane 窄集合，只调用既有 VerifyCompatibilityViewsTx，不在持锁时逐域全表扫描 information_schema；完整安装在 adapter 构造期验证。视图集合按 §6.2 保留 Assets 基线。
4. `BeginWriteTransaction` 在同一 Tx 内持有持久化 Registry generation 栅栏，确认两域解析事实仍有效后才交给共享锁序 helper；失败回滚，不出现先提交 Aims 再补 Workflow。多域读取结果按固定域次序返回，由 owning 接口取得自己的 `Resolved.Table`。
5. B2 单测与隔离 MySQL 覆盖：合法双域同 Tx 提交/回滚；两域 generation/storage/tenant/environment 不同；任一域缺失或视图未安装/漂移；任一 owner 不匹配；持久化 generation 变化。所有反例断言领域写入及 receipt 均为零，不能降级为单域执行。

- ReceiptRepository复用注册表取名与现有WithReceiptTable，并增加复用同一Tx的执行入口，不再内部BeginTx；保证replay/hash/唯一性/审计不变。
- `hzy-enterprise-compatibility-rehearsal`当前固定Aims/Assets双域，扩展冻结Workflow规格；全量verify-views/表完整性核对覆盖新域，不硬编码旧视图数。
- `render-runtime-config.py` 改为已验证统一Workflow绑定，不再hzy_workflow独立adapter；注册表代次、源fence、认可/恢复协议必须覆盖新域，不能人工修改generation绕过协议。

### 6.4 演练与停写窗口估算

使用**生产hzy_workflow完整副本**和对应统一业务库副本，包含真实规模outbox/callback/receipt/审计、水位/租约，不能用hzy0替代性能证据。副本取得与转移另需用户批准，秘密只放受保护配置。

实测分段：停写与租约收敛 → 一致封存 → FK拓扑创建/数据复制/索引构建 → count/hash/完整closure核验 → 全视图验证 → generation激活/同候选切换 → 暂停写/drain的只读冒烟。记录MySQL版本、每条DDL ALGORITHM/耗时、数据规模、复制与索引最大耗时；重复演练取最大值并加明确安全余量，才报生产窗口分钟数。本轮不编造时间估计。

演练覆盖：plan/reviewHash漂移、半装失败、只创建不覆盖、未知表失败关闭、FK/JSON/auto_increment、源不变、重复安装拒绝、停Runtime护栏、snapshot目录版本、同Tx全部正反例与恢复路径。正式动作每步失败即停，不自动放开写。

## 7. 历史 operation 与切换（S3，M2）

### 7.1 历史数据收口

任务书提供生产两库integration_operation=0行；执行时仍需重新核对。**pending/processing/failed=0**是最低门禁，同时核对retry_wait/partial_unknown/dead_letter/failed_permanent等实际状态，不能因为名称不在三项里忽略未收口效果。

hzy0/test非零时逐条以原operationId/key/hash/schema/instance定位：有目标成功receipt→正式对账/原checkpoint收口；无receipt→原机制重投或经批准终止；已有abandoned记录保留审计。Aims operation不支持某终态时不能直写abandoned、不删证据，未有正式处置路径就停门禁。不能把历史未处理operation转换为新lane请求或新建实例。已running的历史审批必须在窗口前完成/原键收口，或迁移其实例并保留明确的legacy callback owner；不静默改成新lane。

### 7.2 切换与批准点

1. 用户批准备份/源完整副本及migration plan；停止Gateway/Aims/Workflow相关drain与全部Workflow写、Host完成/决策写，待租约与在途收口。
2. 封存count/hash/DDL/receipt/outbox水位；迁移锁内按reviewHash复制、验证、登记、generation激活；Runtime/Workflow/Host同一候选切换。Registry只递增，旧源保持只读fenced。
3. **冒烟期写与drain一律暂停**：只读身份/视图/列表/权威状态核对；需要写才能证明的正例先在隔离副本完成，不偷偷把生产写当冒烟。保护任务A不对生产业务自动写（该timer同步暂停）。
4. **“放开写”是独立用户批准点**。收到明确批准后才恢复业务写/drain与计时器；单owner门禁先通过。

### 7.3 回滚定稿

- 激活前：本批目标Workflow对象/映射可整体丢弃，恢复旧配置；既有Aims/Assets数据不动。
- 激活后、放开写前：停Runtime/Workflow，恢复旧配置指向只读保留的hzy_workflow仅供核验；新库Workflow对象作废，**generation不回退**。恢复可写服务必须沿 `enterprise-recovery.v1` 同实例、fence/认可与新代次口径完成，不借恢复旧配置解除旧源只读。现有恢复工具固定Aims/Assets两域，Workflow纳入属于实施前置；工具未适配就保持停止，不使用人工SQL替代。
- 放开写之后：**只前滚修复**。本设计不提供反向增量迁移或恢复旧库写入的选项，不把未存在工具当回滚保证。取证、停止故障写、修复当前统一库/候选并验证后续行。

## 8. 过渡观察与停 hzy-aims（M4，S6）

### 8.1 D7观察期判据

任务A过渡期Aims drain仍保留其它职责，只对rollover收到409 owner后skipped；任务B仍原投递。hzy0连续≥7天、生产连续≥14天无legacy执行后，才可退役相应owner/身份，不把test消费者阻塞生产。

每轮Runtime有结构化日志和operation_logs系统审计（task/principal/result/errorClass/counts/generation/开始结束），无audit_unavailable/遗漏、无重复周期snapshot；Aims rollover只有skipped无成功执行。按唯一period/template/source键对账：两owner实际rolledOver之和等于窗口内可滚转的到期数；pending锁定/人工carryover/业务失败单列，不伪称所有due行必成功。generation_stale/unavailable时零摘要计数不代表无已提交条目，必须以周期snapshot/权威状态对账；审计/代次/owner异常中断观察门禁并查明原因。其它两类后台尚未迁移时，不能声称“三类任务都已进程内”。

阶段1全部任务迁完后再按D7验三类单owner；公司汇总完整生成/审阅/发布/OSS可读/PM工时确认、相关审批往返完整通过，抓包无已迁lane跨进程令牌；中途变更候选/代次应另记观察起点。

### 8.2 Platform W10表示与切换顺序（设计，不实施）

当前 `tenantSchedulerOwnership.ts:7–47` 只接受unified/disabled与aims.runtime，worker_deployment绑定Aims；enterpriseCutoverActivation.ts:36–37、tenant-gateway resolve都消费它。**不能在现行值中填system主体冒充worker client。**

定稿表示：保留 `storage_mode=unified`（数据位置），在同一ownership记录增加明确 `owner_mode=runtime_inprocess`、`owner_principal=system:enterprise-scheduler` 与绑定runtime deployment；旧worker模式为worker。进程内模式不签worker token、无可唤醒Aims worker，worker_client/worker_deployment可空；Runtime code/ready、tenant/env/deployment/generation仍精确复核。该Platform schema/API/发布变更在独立实施批送审与请用户批准，本文件没有DDL或控制面写入。

仅里程碑迁移时W10仍保留worker owner来处理其它drain职责，不能现在把整个app登记切走。全部Aims后台职责迁完且D7门禁通过后：先部署能识别双模式的Platform/Gateway/Runtime → 暂停旧wake，写W10新owner和递增代次/受审证据 → 同步resolve与策略，确认只含Runtime owner且不产生Aims wake → 核验Runtime计时器新代次与probe → 才停Aims。模式不支持/来源绑定错/旧wake仍存在即停，不能停进程容忍502。

### 8.3 按环境分列消费者

| 消费者/项目 | 生产（任务书/评审给定事实，执行前复核） | hzy0 | test/CF |
|---|---|---|---|
| Gateway定时drain/route与目录aims项 | 5分钟 wake 仍覆盖 claim、dead-letter 与多个外投 executor；operation 当前 0 行不证明生产者已退役。保留 worker owner，详见 B4 静态盘点 | 本地 runner/profile/手动 drain，不是 Gateway cron；退役对象为 Aims 一次性唤醒入口及其 runner/profile 配置，具体脚本名以 LOCAL_RUNTIME 清单补齐为门禁 | scheduler registry + HZY_AIMS_SERVICE/route catalog逐租户核对，不影响未迁租户 |
| 工作项完成请求/callback | 当前operation0，不等于今后无请求 | 多历史测试operation/instance，先对账 | 同库前原lane保留 |
| 通用项目立项/里程碑callback | 源码仍以 Aims 为 Service 目标（含 AA-04）；scheduler-only 制品仅允许 drain，实际部署/调用量本轮未知。迁往 Runtime 涉及受信委托边界，先裁定 | AA-04/里程碑/立项测试链存在 | 对每个部署查callback URL，不能整体删aims目标 |
| Altoc/Finance/People→Aims入站 | 评审给定未部署这些app，0消费者；不因此删共享代码 | 项目计划/付款里程碑/工单等仍可能使用，清单独立 | 按登记app和实际operation盘点 |
| 公司汇总/OSS→Codocs、Aims→Altoc/Assets投递 | 后台未投递不代表可关；需迁移职责/配置 | 已有W40及历史回执证据，继续单owner | 单独验证其服务目录/授权 |
| systemd/APPS/制品/健康 | 当前必须保留；全部后台与入站职责收口后才可 disable+mask 并移除制品/健康项。本轮无环境操作 | 单列 Codocs editor、Aims facade、本地 Aims 后台进程与 N9 scheduler-only hzy-aims 制品；仅退役已迁职责，不能停 Codocs editor 或整套网关；具体标识见下方核对门禁 | Workers部署/Binding与健康列表单独审批，不套用systemd |

#### B4 第一阶段生产静态盘点（2026-10-01）

详表见 `.git/report-aims-b4-20261001.md`（协调会话归档）。Host 五个项目文档代理（列表/详情、写入、ACL、文件、来源）仍通过受信目录调用 Aims Service API；通知详情授权、Assets 产品版本读取、Altoc 工单接收也有独立入站合同。生产调用量与运行配置本轮未查询。自托管模板启用 scheduler-only，仅准许 drain，因此不能把源码存在等同于生产当前可用，也不能据此宣布职责已迁走。

依任务书 §12 停止条件，发现通用 callback 的受信委托迁移与完成 lane 之外的 Host 文档编排后，先报告范围裁定；B/C 尚未实施。W10 双模式将来可作为候选代码实现，但切换整个 Aims owner 不能先于剩余后台职责迁移。现阶段保持 worker owner 和 Aims 进程。

**后续裁定（2026-10-01）：** Claude 在新机回环探测确认生产 `hzy-aims` 为 scheduler-only，项目文档、Workflow 回调、通知详情授权等入站当前均为 404。用户决定把 `hzy-aims` 剩余入口平移进 Enterprise，并按 [ADR-018a](./ADR-018a-Fold-Aims-Codocs-Into-Enterprise.md) D11（§9）收敛服务授权；本设计 B4 原定的“后台全部迁入 Runtime”与 W10 `runtime_inprocess` 双模式不再实施，B4/B5 的进程退役与 grant 撤销改按 ADR-018a §9.5 执行。B1–B3（Workflow 迁入统一库与同库 lane）不受影响。

#### hzy0 独立退役清单（以 LOCAL_RUNTIME.md 为准）

本轮只读 `deploy/test-env/LOCAL_RUNTIME.md`。该文件现存版本明确记录 Runtime LaunchAgent `cn.wiztek.hzy-test-runtime`（回环 `18084`）、Tunnel LaunchAgent `cn.wiztek.hzy-test-tunnel`，以及配套重启项 `hzy0-enterprise`、`hzy0-gateway`。这些是保留/配套更新对象，**不是本次 Aims 退役对象**，不能套用生产 `disable+mask hzy-aims.service`。

定稿复核要求盘点的以下对象，在本轮读取的 LOCAL_RUNTIME.md 中尚无完整进程/脚本清单，故明确设为退役前停止关口，不推测进程名、端口或候选路径：

| 对象 | hzy0 专属动作与验收 |
|---|---|
| Aims 一次性唤醒脚本及本地 runner/profile 的手动 drain 入口 | 先补齐当前精确脚本路径/调用者/开关；已迁职责停止唤醒，历史 operation 未收口前保留原恢复入口；确认没有本地定时触发。 |
| Codocs editor 进程与 Aims facade 进程 | 先补齐实际进程标识、受保护配置及回环目录。Codocs editor 保留；Aims facade 仅在其所有用户/API/callback 消费者迁完后退役，残留入站仍存在则保留，不把服务目录伪造为可用。 |
| N9 scheduler-only hzy-aims 制品与对应本地启动项 | 先补齐制品提交、目录、启动/健康项与 owner。三类后台完成迁移、历史投递收口及 D7 通过后，才停止对应本地启动项并移出候选/健康清单；不用生产 systemd 命令。 |

执行前另出受审 hzy0 清单，以届时 LOCAL_RUNTIME.md 进程清单和获批只读现状核对为准，逐项列明保留/停止/移除、恢复方式与批准点。当前文档缺项未补齐前不批准退役；本轮不改 LOCAL_RUNTIME.md、不查询或操作运行进程。

### 8.4 退役执行清单与密钥顺序

- W10 owner、Gateway cron、route catalog的aims旧后台入口先迁走；Host用户page与ServiceAPI区分。`x-hzy-service-routes`不能编造aims可用性或冒充Enterprise。
- 更新 `deploy/self-hosted/release-lib.mjs` APPS/BASE_PATHS、build清单、health探针和依赖；移除Wants拉起aims；批准后systemd disable+mask，确认重启主机也不复活。
- 逐grant按§9撤销和实际反例验证；确认B13b `--align-existing`的aims env_ref纳入情况，再在**最后一个aims.runtime grant撤销且缓存上限过去**后撤凭据、作废/移除HZY_SERVICE_CLIENT_AIMS_SECRET（Runtime.env、aims.env及受保护配置）。不得先删secret让迁移期剩余服务报错。
- `probe-prod-service-tokens.mjs`期望集合同步改：已退役scope签发失败是预期反例，不再保留“旧scope应200”的巡检；仍在用的scope必须200、claims正确。记录集合版本/差集，不把真实授权漂移排除掉。

## 9. grant 保留/撤销与24小时门（S5）

本节仅清单与执行条件；具体行ID、audience/semanticScope/绑定在环境审批前只读核对。每次只撤经批准的一组精确行，不删除行、不复活revoked，不改人员角色。

| client | scope / audience | 定稿处理 |
|---|---|---|
| aims.runtime | workflow:work-item-complete:create / workflow（v2.6） | 新同Txlane与历史收口后撤候选 |
| workflow.runtime | workflow:work-item-complete:create / workflow,data-runtime,tenant-runtime（v2.7） | 逐audience查调用，仍有独立部署则保留 |
| aims.runtime | aims:work-item-completion-callback:execute / aims,data-runtime,tenant-runtime（v2.6/v2.17） | 所有本lane历史callback收口后撤候选 |
| workflow.runtime | workflow:callback / aims | **保留**，下列通用callback仍使用 |
| aims.runtime | aims:milestone-rollover:execute / aims,data-runtime,tenant-runtime（v2.8） | 该环境D7及其它部署零调用后撤候选 |
| aims.runtime | integration_operation、notifications-due及Codocs/Altoc/Assets/目录scope | 相应职责未迁完保留，不能一并撤 |
| workflow.runtime、enterprise.runtime | Workflow drain/Console通知与Host域scope、人员approve/reject | 保留，与去除运输链路无关 |

`workflow:callback / aims`的保留路由：

1. Workflow→Aims `POST /api/v1/service/workflow/callback`（`aims/server/api/v1/service/workflow/callback.post.ts:60–70`）；普通Runtime落点 `/v1/aims/service/workflow/callback`。项目立项 `app=aims/resource=project/action=initiation`（003定义）与里程碑 `resource=milestones/action=milestone_completion`（010定义）继续该合同。
2. 上述同一BFF里AA-04开态里程碑分支走 `forwardAimsMilestoneReceivableWorkflowCallback`，仍POST `/v1/aims/service/workflow/callback`，但Runtime出站组合为 `aims.write altoc:receivable:mark-billable`（aimsRuntimeForward.ts:79–90）；没有因工作项同Tx迁移而消失。
3. 工作项专用 `POST /api/v1/service/work-item-completion/workflow-callback` / Runtime同路径在迁移前与历史对账期间保留，只有该lane完全退出才去除目标。

逐条门：撤销前先记录零调用观察与固定client/audience/scope的反例计划、隔离测试；**正式撤销后**用真实client对旧scope签发预期403/无token，再以已有旧token做使用拒绝（等待签发缓存/撤销上限并记录），相关仍用组合scope必须200。active行未撤时可能签发200，不能把它伪装成预期失败。每条完成后观察24h：非测试request的insufficient_scope=0、无消费缺口/未知重试，再撤下一条；反例请求有标记并从正常错误率排除。全部真实探测均需用户批准，任何非预期拒绝停止下一步。

## 10. 分批实施清单与批准门

| 批 | 文件范围（候选，开工前精确清单） | 必须测试 | Runtime发版 | 环境/批准 |
|---|---|---|---|---|
| B1 Workflow迁移规格/注册映射 | config/enterprise.go；enterpriseviews；workflow adapter；迁移/compatibility-rehearsal/verify-views；render-runtime-config；Workflow参数逻辑/物理改名规格（不改Assets） | 完整隔离副本copy/DDL/FK/hash/半装/不覆盖；双域receipt及workflow_system_parameters隔离；原142视图基线、Assets system_parameters定义/数据不变 | 需 | 代码可审；真实副本、备份、DDL/apply/登记均另批批准 |
| B2 Directory预读快照+Tx核心 | apps/directory typed reader；apps/aims完成申请/回写Tx核心；apps/workflow receipt/实例/任务Tx核心；integrationoperation现有Tx扩展；enterprise多域Resolve/安装校验与锁序helper及测试 | 不可达/非active/非唯一主部门503；快照固定；同Tx回滚；receipt唯一/重放；双域generation/storage/owner/缺视图整体拒绝且零写；交叉并发锁序 | 需 | 只代码+隔离；不启lane |
| B3 同库申请/决策lane | apps/workflow/internal/lane与owning coordinator；server现有业务公开边界接线；Host若响应合同需配套 | 编译/AST隔离；system/服务主体不能审批；原permit过期/撤权矩阵；target/matter；本lane零外投callback；通知outbox恢复 | 需（配套Host/Workflow） | 同候选切换、冻结/激活、放开写分开请用户批准 |
| B4 W10/调度/进程前置 | Platform tenantSchedulerOwnership/resolve/cutover检查与候选schema；Gateway wake配置；self-hostedAPPS/health/systemd；local runner/probe与独立hzy0退役清单（§8.3缺项先补齐） | 两owner模式严格绑定；旧mode不变；无旧wake/路由悬空；重启不复活；生产/hzy0/test消费者独立 | 若配置/绑定消费变则需 | Platform控制面/发布/owner登记、Gateway配置、服务停启各需批准 |
| B5 观察、授权与退役 | 观察Runbook、精确grant计划/verify/probe期望、密钥清理台账 | D7 ≥7/14天；每条撤销签发/使用反例与24h；仍需grant正例 | 单纯授权/进程清理无需新Go版本 | 每条grant/凭据写入、disable+mask、制品下线均用户批准 |

只读设计文件不授权上述环境步骤。迁移/同Tx实施前按本表送精确清单；遇新的授权能力/信任边界或共享事实不确定，先报告，不通过默认值继续。

## 11. Fable意见落实索引

M1→§3；M2→§7.2–7.3；M3→§4；M4→§8.2–8.4；M5→§6.2（按R1替换原SharedPhysicalNames扩展方案）。
S1→§2/6.2（沿用SharedPhysicalNames+Resolved.Table+现有receipt选项）；S2→§4.3；S3→§7.1；S4→§6.4；S5→§9；S6→§8.1。真实库规模与时间仍明确待批准盘点；没有环境写入、没有假称迁移已完成。

定稿复核 R1→§6.2/B1：Workflow 参数表逻辑/物理名均为 `workflow_system_parameters`，不改 SharedPhysicalNames、Assets 或既有视图。R2→§5.1/§6.3/B2：明确多域 Resolve 接口要求、复用现有多请求事务栅栏并补失败关闭矩阵。R3→§8.3/B4：本机 runner/manual 与生产 cron 分开，列出独立退役对象及 LOCAL_RUNTIME 当前缺项门禁；不把缺失记录当作已核实的运行事实。


## 12. B1+B2 实现候选（2026-10-01，未提交/未启用）

- B1：`unified.Config.SourceWorkflow` 显式可选；`WorkflowMapping` 从已审迁移闭集派生映射，源端 012/013/014 的列必须齐备。模板参数表由源 `system_parameters` 复制到逻辑/物理 `workflow_system_parameters`。Workflow `service_command_receipt` 映射 `workflow_service_command_receipt`；不改 `SharedPhysicalNames`、Assets 参数视图或默认两域安装/映射 hash。`enterpriseviews.Install`、兼容演练与既有 verify-views 使用同一可选 Workflow 视图规格。renderer 保留 `inProcessScheduler`；B3 server 工厂接线前，含 Workflow 域一律拒绝渲染，check 也拒绝 Workflow 域或旧 adapter 指向统一库。
- B2：Directory `ReadWorkflowInitiatorSnapshot` 在自己的 RR 只读事务完成 BINARY actor、active/唯一主部门与父级读取；失败统一固定 503，JSON/hash getter 返回副本。业务事务开始后不得再次读取 Directory。`Registry.ResolveDomains` 在一个互斥区冻结多域，`BeginWorkflowWriteTransaction` 复用持久化 generation 栅栏，纯内存核对完整本地绑定，传入 `WorkflowTransactionRequirements{Aims, Workflow}` 指定本 lane 的窄逻辑名集合并在同一 Tx 核验；不对两域全表逐条查询 ENGINE。完整安装由 adapter 构造期核验；共享名来自 enterprise 包的单一名单，未知逻辑名冲突不得跳过。`LockCompletionObjects` 固定项目→事项→申请→实例→任务→动作顺序，组内 ID 排序去重；其后由各域回执仓库取得 receipt 锁。
- Aims 申请/回写与 Workflow create/approve/reject 已抽取调用方持有 Tx 的核心。原 wrapper 继续自己开/提交事务；调用方核心不提交或回滚。Aims 两个入口接收 Registry 返回的 `Resolved`，比对当前 writer 的 DB/Key/generation/schema/owner/映射；调用方 Tx 内的视图验证也在该 Tx 执行。Workflow 核心先深拷贝 body/command，保留精确 JSON 数字，再补受信上下文，重试不改调用方输入。Workflow caller-Tx 必须显式传入已映射 receipt repository，不能回退独立库未加前缀表。原 permit、人员关系、kind/hash/职责分离与效果冻结保留。
- **接线界限**：B1+B2 没有 Server/Host/Workflow Node 默认路由切换；目录快照写入申请/实例、双域业务编排与禁止本 lane 外投 callback 仍由 B3 接线。原 wrapper 选择私有 typed legacy 模式，保留 Workflow-submit 外投；caller-Tx 固定选择私有 typed in-process 模式，**不生成 Workflow-submit operation**，不可由 body/query 注入。服务工单 delivery 仍按原合同保留（无工单的申请 integration_operation 新增为零），审批申请 receipt/审计不变；B3 不得同时启用新旧两条路径。
- **迁移界限**：可选 Workflow 的通用 shadow-copy + 显式候选映射是 B1 制品；旧 C000001 两域已批准 target/hash 不能复用。当前生产 cutover profile 的排空证据仍按原 Aims/Assets 合同，本批不扩大它的生产授权；真实三域排空/切换执行单随 B4/B5 另审。不能将 renderer 的候选输出视为迁移或 lane 已获环境启用批准。
- 验证索引：`TestOptionalWorkflowKeepsInstalledAssetsBaseline`、`TestWorkflowClosedMigrationMappingAndForeignKeys`、`TestWorkflowSnapshotConsistentImmutableFailureMatrix`、`TestResolveDomainsAtomicFailureMatrix`、`TestCompletionLockOrderCanonicalAndCopiesIDs`；真实 MySQL 以 `test-aims-workflow-unified-mysql.mjs` 的临时实例执行完整 Workflow 复制、双域回滚/并发锁、调用方 receipt 回滚/提交/重放。沙箱拒绝监听时不得把跳过场景记为通过，需由有监听权限的审阅会话补跑。


### 12.1 第四轮评审落实与数据前置（2026-10-01）

M1/M2/M3 与 S1/S2/S4/S6/S7 已在候选修订：renderer 失败关闭；caller-Tx 同库模式零 Workflow-submit；热路径窄集合 + 构造期完整安装；共享名单下沉 enterprise、enterpriseviews re-export；单域/多域 Resolve 都给表映射副本；锁序缺行返回 `ErrCompletionObjectMissing`（B3 映射固定 404/409，不把 sql.ErrNoRows 暴露成 500）。隔离测试明确验证 `flow_tasks` 可更新视图 FOR UPDATE 阻塞 `workflow_flow_tasks` 底表 UPDATE，释放事务后底表写入成功。

**S3 快照字段口径（B3 前用户确认门；用户 2026-10-01 已确认，不放宽）：**

- 主部门必须 `org_type='department'`，主关系必须 active/is_primary=1/`relation_type='member'`；委员会/虚拟组织不替代主部门。上级部门存在时必须 active 且 department，停用/缺失固定 503，不回退无上级路线。
- 姓名使用 SQL `COALESCE(real_name, display_name, nickname, uid)`；顺序与 TS 别名顺序相同，SQL 只跳过 NULL（空串不像 TS `||` 会回退）。`updated_at` NULL 无法形成版本向量，固定 503；上线前只读盘点缺失/非法事实，不能凭默认值补齐。
- 用户 2026-10-01 已确认：无主部门的 `admin` 与 `jinanzhujian` 是非真实员工的系统/管理账号，无需补齐。S3 的员工快照规则不放宽；§10 的更具体裁定要求非 employee 明确 403，优先于主部门缺失 503。若目录把系统账号错误登记成 employee，则仍按原快照规则失败关闭；本批不查询或修改生产目录。

**S5 已提供的生产盘点事实（任务书 §12，Claude 只读结果）：** `hzy_workflow` 正好 canonical 12 表，无 system_parameters、迁移账本、routine/trigger/event；约 1 MB，flow_instances 80 行、flow_tasks 105 行。该次快照未发现未知对象阻断；执行前仍须重新核对闭集与规模。本轮没有访问生产或本机数据库。

**S5 B4 迁移预盘点：**在批准的只读通道列出 Workflow 源库 information_schema 的全部表、对象类型与迁移账本/工具表（例如 schema_migrations、_prisma_migrations）。任何超出 12 表 + 可选参数的对象保持闭集阻断；逐项决定经审加入真实复制还是作为明确“不复制”的工具对象，不自动忽略未知表。结果应先进入 B4 计划和 reviewHash 规格，不能等真实 apply 时再发现或绕过阻断。


## 13. B3 实现候选与 §10 裁定（2026-10-01，未提交、未启用）

### 13.1 公开入口与默认配置

`enterprise.workflowLane.enabled` 默认 false。关闭时完成申请仍走 Aims integration operation，Workflow Node 与旧 callback 外投原样保留。开启要求 Enterprise/Aims/Workflow/Directory 已启用、Aims 与 Workflow Read/Write 均 unified、部署登记齐全、双域 mapping/兼容视图及 Workflow receipt 安装验证成功；缺一启动失败，不回退独立池。关闭时也不允许旧 Workflow adapter 的独立配置指向统一库。

renderer 默认拒绝 Workflow 域；显式 `--workflow-lane` 才生成 enabled、统一 Workflow DB 与登记映射，check 必须使用相同参数并核对配置。只生成候选不代表环境启用获批。

**决策入口按裁定保持 Host → Workflow Node → Runtime**。Host 的 `workflow_tasks:approve/reject`、Node subject-eligibility 和签名 actor 委托继续生效；Runtime 新 lane 复用严格 workflow.runtime 来源/部署/live credential 认证、已有 workflow.write scope 与可信用户 actor。没有 Host 审批签名桥、没有新 capability/grant，也不以 assignee 相等代替上游静态人员授权。申请的 work_items scoped permit 校验与当前范围/关系、≤15s TTL、policy version/hash/revision 仍走原函数，旧 receipt 前再核对。

开关打开后，对所有 Workflow tasks 的 approve/reject/delegate 与 instances 的 cancel/resubmit POST（不限完成类实例）统一要求 Strict workflow.runtime、登记部署、精确 workflow.write 和实时凭据/grant；签名用户 actor 的 purpose 必须为空，拒绝 service subject/未委托 actor。Node 普通用户委托仍可通过；prepare/create 的既有入口鉴权保持原样。HTTP 级测试以真正的 JWT 与 actor 签名经过 ServeHTTP，普通委托到达领域 handler，错误 purpose/服务主体/未签名在 DB 前 403。

### 13.2 目录人员与冻结

Directory 自己的 RR 事务读取发起人 `user_type` 与 S3 主部门/父部门事实。非 employee（包括 NULL/未知值）固定 `403 workflow_subject_type_not_allowed`，此判定先于缺主部门 503；employee 非 active 固定 403；非唯一主部门/停用父级等快照依赖不完整仍固定 503。已验证服务 client/subject 与 `system:*` 显式拒绝。

在业务 Tx 前仅读取本次涉及的 uid（去重、BINARY 精确匹配、最多 1000 个）：申请先用冻结 Directory 上下文预解析路线候选，决策读取 actor/delegate_to 和该轮既有审批证据 uid，不全表扫描。私有不可变集合只允许 active employee；非 active/未知/非 employee 403，依赖故障/超限 503。实例解析的候选人、受托人、委托对象和决策者必须命中这个集合，不能由 HTTP `user_type`、form 或 query 提升。业务锁持有期间不再访问 Directory。发起人快照连同版本向量进入 Aims snapshot_json；Workflow biz_context 保存同一份快照及 SHA-256，路线和固定候选 UID 据此冻结。每次决策只重新预读行动主体及回写 approvers 的当前类型/active 事实。发起人的 employee 与目录快照仅在申请时校验，后续离职/停用/变更类型不阻断其他员工批准、驳回或委托；撤回仍须由原发起人作为 active employee 行动，不新增代撤权限。路线与证据在锁内重算，若出现预读集合外的新 uid 则拒绝并回滚，不能在持锁时再访问 Directory。申请空 Directory 快照固定 503；决策无需发起人快照。

### 13.3 同库事务与回执

Workflow 的 internal/lane 私有 capsule 自己从 Registry 构造同一个 Tx、双域 Resolved、不可变 Directory 事实并执行 B2 规范锁序。server 不导入/实现 capsule；Go internal 负例和 AST 结构扫描（internal/ 与 cmd/ 所有非 Workflow/Aims 生产包，包含嵌套 selector、任意变量名）固定边界；仅 B2 Registry 自身两个基础函数的声明明确允许，不允许非 owning 包调用它们来构造 lane。

申请：锁项目/事项 → Aims 原 scoped permit 与就绪/版本核心 → Aims 申请 receipt 和冻结请求（typed in-process，无 Workflow-submit operation）→ Workflow 路线/候选 employee 与自审检查 → 实例/任务/创建通知 outbox/Workflow 跨应用 receipt → 回填同一 instance/kind/hash → commit。重放命令从冻结 item/key/title 取值，不读后续可变标题。新冻结申请在上轮驳回后创建独立实例，不覆写旧请求的 form/context。

决策：定位线索 → Directory 预读 → Registry fence → 项目/事项/申请/实例/任务规范锁 → 重核关联/form/generation/当前受托人及非本人 → 结果 receipt → Workflow approve/reject/delegate 或 initiator withdraw 核心 → 同 Tx 直接执行 Aims completion evidence 核心 → outbox/审计 → commit。Aims 回写失败则任务/action/receipt/outbox 全回滚。generic Workflow resubmit 对完成实例返回 409，必须经 Aims 新的冻结申请，不允许绕过源快照。

回执沿用现有表，不改 DDL：申请是 Enterprise→Aims 的 Aims receipt 与 Aims→Workflow 的 Workflow receipt；**决策结果是 Workflow→Aims，由 Aims mapped receipt 拥有**，保留真实 source/target app 和登记部署，但 ServiceClientID 明确为内部 workflow.lane（申请的 Workflow receipt 为 aims.lane），满足既有 `source_app <> target_app` CHECK。callback capability 仅为内部结果 receipt 标签，不签发/消费新 Token。OperationCode 分别为 aims.completion.request.lane.v1/v2 与 workflow.tasks.<action>.lane 或 workflow.instances.cancel.lane，RequestID 加 lane: 前缀；这些是内部审计标识，不对应已验证服务 client，不授予服务调用能力。公开 Service API 仍只接受原固定 operation code/真实 client，拒绝 lane 标识。不采用 Workflow→Workflow OwnedReceipt，不伪造 Enterprise 来源。operation ID 使用 SHA-256 派生并置 UUIDv4 位，request:/decision: 用途命名空间分离，保留评审修复。决策幂等键不得跨任务复用，同键异任务/命令为 409，不回放他任务回执。缺行/行映射漂移在决策路径为 409 completion_binding_changed；申请对象不存在仍 404。重放返回同 receiptId/对象身份，不再推进状态；通知恢复由 durable outbox 完成。

内部完成 callback 在 owning context 的同 Tx 被消费，从 effects.Callbacks 移除，不插入 pending HTTP callback 行；其他 callback 不变。通知/actionable 仍持久化。lane 申请没有经过 Node createInstance 的即时投递，首条创建通知的延迟来自既有 Workflow drain 周期/退避与依赖可用性；不会等待事务内网络 IO。Runtime 不把内部 effects 放入申请响应，Host 原 BFF 原样返回也不会将受托人 effects 泄露给浏览器。Node 处理决策后的既有即时投递/正式 drain 不变。withdraw 同样回写，避免取消遗留 in_review。

发起人离职后：撤回仍要求行动主体为发起人本人且在职，因此不再可撤回，也不提供他人代撤；实例由当前审批人批准或驳回收口，不会卡死（Fable B3 第六轮复核记录项 A）。

### 13.4 验证与启用门

单测固定默认关闭/前置缺失、employee/系统/服务/未知类型、不可达 503、伪造 body 类型无效、internal/AST 隔离；保留原 permit 用途/动作/对象/过期/撤权测试。隔离 MySQL `TestWorkflowUnifiedCompletionLaneMySQL` 用 canonical schema +真实兼容视图，覆盖 target 同键申请/决策六轮真实并发、matter 驳回、冻结快照、零外投、fresh-adapter 通知恢复、Aims 失败整笔回滚、scope 撤销/过期重放、候选服务身份/自审、申请与关系撤销并发。沙箱内这些 MySQL 场景未运行，不能作为通过证据；由 Claude 运行现有 unified runner。

本批无环境、配置启用、迁移、grant、进程或部署操作。B4/B5 仍须历史 operation/callback 对账与新旧 owner 切换门；不能在旧外投未清空时凭开关直接放开写。
