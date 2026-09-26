# Altoc ↔ Aims 下一批整合合同草案

2026-09-13，INT-601/602 代码盘点与实施拆分。本文未切换运行路径，未证明 P5 验收通过；实际租户调用频率、错误率及待处理 operation 数尚未采集。推荐先做合同承接，再做里程碑回款，服务工单结果随后接入；这是依赖顺序建议，不是已测故障排名。

## 当前真实调用与事实归属

| 链路 | 已存在实现与身份 | 权威事实与回执 |
| --- | --- | --- |
| 合同生效→项目→付款里程碑 | Altoc `contract_orchestration.go:executeContractActivation` 校验 `contract:edit`、合同 owner/department 范围，锁合同并冻结操作。`contract_activation_operations.go` 写 `altoc.contract-activation.aims-project.v1`，随后依赖它的 `altoc.contract-activation.aims-milestones.v1`，capability 均为现有 `aims:write`。TS `contractActivationOperation.ts` 调 Aims `/api/v1/service/projects/from-contract`、`/api/v1/service/projects/{projectCode}/payment-milestones:sync`。 | Altoc：`customer`、`opportunity`、`contract`、`contract_payment_term`、`receivable_plan`；承接关系 `contract_project_link`、`contract_project_line_rel`、`contract_project_obligation_rel`。编排保留 `contract_orchestration_job/step`。Aims：`aims_projects`、`aims_project_members`、`project_lifecycle_events`、`project_counters`、`milestones`。Altoc source outbox 与 Aims target receipt 不得混表。 |
| 里程碑审核通过→可开票 | Aims `milestone_completion_governance.go` 在审核完成事务中调用 `enqueueMilestoneReceivableBillableOperationTx`。命令 `aims.milestone.receivable-billable.v1`，capability `altoc:receivable:mark-billable`。`milestoneReceivableOperationExecutor.ts` 使用真实服务令牌调用 Altoc payment-term endpoint。 | Aims 保有审核/完成事实；Altoc 保有 `contract_payment_term` 和 `receivable_plan` 的可开票状态。`milestone_receivable_receipt.go` 校验来源 Aims、path/paymentTermId、幂等身份，再在 receipt 事务调用 `markReceivablePlansBillableByPaymentTermTx`，原函数不额外写 `audit_log`；上层审计需另按调用合同处理。 |
| 服务工单→执行项→结果回写（第二批） | Altoc `service_ticket_aims_operation.go` 已冻结 `altoc.service-ticket.aims-work-item.v1`，capability `aims:service-ticket:work-item:create`；Aims `service_ticket_delivery.go` 管执行承接，Altoc `service_maintenance.go` 接收 receipt 化结果，capability `altoc:service-ticket:delivery-result:sync`。 | 工单经营与服务协议归 Altoc，实际执行项归 Aims。具体字段、结果版本竞争及全部通知/知识依赖须单独闭包盘点，不能用合同链测试替代。 |

当前名称与历史值必须区分：`aims_projects.customer_code/contract_code` 是关联键，现有 `customer_name` 是创建时输入；不得把它自动升级为 Altoc 当前名称，也不能同库后绕过客户/合同读取权限。当前名称读取应经 Altoc owner reader 授权；历史项目快照保留。`milestones.payment_term_id` 与 `template_key` 用于付款条款/结算计划匹配；`contract_project_link.plan_key` 和结构化 line/obligation 关系是承接边界，不能仅按合同创建一个项目并丢弃多计划。

上述表清单是已读业务路径的起始集合，不是完整迁移闭包。FK、trigger、审计、编号、通知及历史 receipt/outbox 的完整集合必须由 canonical schema 和迁移工具递归展开；实际库表量、hash、存量 lease/drain 证据仍未知。

## 可复用实现与最小提取

1. Aims `service_contract_bridge.go` 已有私有 `createProjectFromContractTx`、`syncPaymentMilestonesTx`，保留项目编号/归属冲突、归档排除、行锁及模板/付款条款匹配算法。`service_contract_receipts.go` 当前通过 `ReceiptRepository.Execute` 自开事务；新增最小 InTransaction 桥接，将原 receipt handler 交给 caller tx，旧入口调用同一实现。不要重新实现创建项目或复制里程碑 SQL。
2. Altoc `executeContractActivation` 仍自开/提交事务，应提取共享事务入口，复用合同范围检查、计划编排、operation 冻结以及结果回填。现有同键 job 直接返回逻辑也须保留，补差异输入契约验证，不能假定它已等同 command-hash receipt。
3. Altoc `executeMilestoneReceivableBillable` 的领域函数已经接受 tx；外层 receipt 仍 `Execute` 自开事务。提取其 receipt + mutation 共享事务入口，比改写整段回款状态机小。Aims 审核完成入口也须提取原事务体，保留审核锁序和后续里程碑推进。
4. 已有 `Registry.BeginWriteTransaction` 可为同 tenant/environment/runtimeDeployment、pool/schema/generation 的两域持久 guard；`BeginSnapshotReadTransaction` 支持范围/当前名称一致读。已存在 `ReceiptRepository.ExecuteOwnedInTransaction` 与映射 repository、scheduler claim/ACK 事务基础可复用，但跨应用 receipt 必须保留原 source/target，不能伪装成 owning receipt。
5. `enterpriseplanning/handoff.go` 已证明调用共享事务内真实 Aims owning handler 的模式；它服务的是产品规划转交，不能直接拿其 permit 授权 Altoc 合同创建项目。需独立 Altoc 合同权限 + Aims 目标权限编译、当前事实复核。

## 实施包与验收 TODO

- [ ] **AA-01 / INT-601**：用去敏指标确认合同/里程碑/工单调用量与故障优先级。导出 canonical 两域闭包、命名冲突、正式受管视图可用表及历史快照字段；未采集项保持未知。
- [ ] **AA-02**：仅提取上述 Aims 两个 receipt handler、Altoc 激活事务与结果 checkpoint 的 InTransaction 入口。新旧入口共同使用相同 operation/idempotency/hash。首先保持冻结操作和回执，不删历史记录、不批量重新生成旧命令。
- [ ] **AA-03**：实现统一合同承接服务：绑定双域 writer，复核当前合同及计划权限；按原依赖顺序完成项目、里程碑、结构化关系和编排 checkpoint。对已冻结的同库命令，可在短事务内执行 target receipt 并提交 source checkpoint；不得在数据库事务内发网络请求。多计划是否整个激活原子提交需按实际规模选择并记录，不能默认一个无限长事务。
- [x] **AA-04**：Aims 审核事务体已可由 caller-owned `sql.Tx` 执行，旧 callback 入口仍自开/提交事务；保留原审核权限、付款条款/合同交叉校验和 receipt 身份。尚未由协调器把 Aims 与 Altoc receipt/audit 置于同一事务，不能声称源审核、目标状态、receipt、audit 已一起 rollback；已发送旧 operation 继续按原键收敛。
- [ ] **AA-05**：固定 Runtime route/capability 与 Host BFF 编译证据，独立服务令牌/当前 credential 检查；已有 broad `aims:write` 不自动扩展为新 Enterprise 权限。新增精确 capability 需正式登记与真实 OAuth 验证。
- [ ] **AA-06**：隔离 MySQL + 真实 Runtime HTTP：两租户隔离、同键新旧重放、异 hash 409、多计划关联、跨合同 payment term 拒绝、项目编号竞争、late audit rollback、generation 切换等待、凭据撤销后重放拒绝、源/目标成功但 ACK 丢失恢复。
- [ ] **AA-07**：最后才做工单执行结果独立闭包与共享事务；覆盖结果重复/乱序、通知、服务协议及后续知识发布依赖。
- [ ] **AA-08**：完整迁移 dry-run/hash→源持久 fence→最后追平→pending/leased/dead-letter 核对→单写所有权切换→实际页面验收。回退需要反向迁移新事实，不是修改一个内存配置。

## 哪些仍保持异步

Finance 开票/核销、Assets 交付资产状态、Codocs 知识发布、People 工时/通知以及任何尚未登记进同一 pool 的目标，继续通过真实 owner worker 和正式 OAuth 边界执行。已有网络 operation 不因两域可同库就清空：要记录已领租约、目标 receipt 与 source ACK，完成恢复或 drain 后再选择本地执行路径。Altoc `integration_operation`、Aims `integration_operation` 及各自 attempt/receipt/dead-letter 表均必须按 Registry 物理映射，不允许裸同名 view 或任意 SQL 前缀猜测。

本次只读盘点及草案不证明上述新事务已实现，不构成 INT-602/P5 完成或生产切换证据。

## AA-02 已完成的有界基础（2026-09-13）

Aims 新增 `Adapter.CreateProjectFromContractCommandInTransaction(ctx,tx,repository,body)` 与 `SyncPaymentMilestonesCommandInTransaction(ctx,tx,repository,projectCode,body)`。调用方注入原或映射 receipt repository，成功与错误都不关闭 caller 事务。旧合同 HTTP handler 自开事务并复用这两个入口；机会桥原 `executeAimsServiceReceipt` 兼容 wrapper 保留。来源仍为 Altoc，未变成同应用 owned receipt。

真实测试发现原里程碑 path 校验仅在 mutation handler 内，成功 receipt 重放会跳过；现移到原 `ReceiptCommandFromBody` 验证及来源检查之后、receipt 执行之前。因此同一成功 key/原 payload 换项目 URL 也拒绝。

`node data-runtime/scripts/test-contract-receipts-mysql.mjs` 隔离 canonical Aims MySQL/race 通过（2.402s）：共享事务创建项目及付款里程碑，调用方最后 SQL 失败后 rollback，项目、成员、计数器、生命周期审计、里程碑与两个 receipt 全部为零；提交后旧 Go 命令入口重放原 key/operation ID；错来源、成功回执错 URL、异 payload 和 nil repository 拒绝，并验证失败后 caller 事务仍可查询。该测试调用真实 owning Go handler，不是新 Runtime HTTP 或 Host 授权验收；没有声称完整 Altoc 激活事务或 P5/P6 整合已完成。临时 MySQL 由 harness 清理。


Altoc 对应共享入口 `ExecuteMilestoneReceivableBillableInTransaction(ctx,tx,repository,path,body)` 已提取，接受映射 receipt repository，保留 Aims source、精确 capability/hash/key 及成功重放前的 URL/paymentTermId 检查。纯解析函数供旧 wrapper 在 BeginTx 前与共享入口共同使用，坏请求保持原先不访问 DB 的语义；caller 事务不会被新入口关闭。

`node data-runtime/scripts/test-altoc-receipt-mysql.mjs` 实际隔离 canonical Altoc MySQL/race 通过（2.090s）。覆盖回款状态与 receipt 完成后 caller 审计 SQL 失败并 rollback、提交后旧 Go 入口重放、成功 key 错 URL、错来源、异 payload 和 nil repository 拒绝，以及失败后 caller tx 仍可查询。物理 receipt 使用 `altoc_service_command_receipt` 映射；fixture 为旧入口提供同表 INVOKER alias，仅用于跨入口测试，不是新增生产 Registry 裸 receipt view。原领域函数没有 audit 写入，本次没有擅自改变审计语义。未接新 HTTP/Host route，未启用 P6。

AA-02 继续完成两段 Altoc 事务体提取，不能混称为一个原函数：`ExecuteContractActivationInTransaction` 对应 `contract_orchestration.go` 的 job/step、本地计划、审计、domain event 与早重放；`ActivateContractDeliveryInTransaction` 对应 `service_receivables.go` 的合同生效、签约回款计划、冻结两个 Aims operation。旧方法各自管理事务，新方法不提交或回滚，两者均没有网络等待。本次实际执行发现 job 的 `depends_on_step_keys` 原来把 `[]string` 直接交给 SQL driver；在原写入点改为 JSON 编码，保留字段内容。

扩展同一隔离 MySQL 用例后通过（2.165s）：caller 同一事务创建 job→生效→冻结项目/里程碑，最后审计 SQL 失败时合同状态、job/step、签约回款计划、domain event、审计及两个 operation 全回滚；提交后两旧入口重放且 operation 不重复。测试尚未在此事务内消费 Aims target receipt，不是完整跨域激活验收。Aims 纯 envelope/source/path 校验也恢复到旧 wrapper BeginTx 之前，并与共享入口复用；坏 envelope 无 DB 行为及真实成功 key 错 URL 重放回归通过（Aims MySQL 2.485s）。Aims/Altoc 全包 race 分别通过 3.485s/1.563s。


## AA-04 Aims caller-owned 审核事务体（2026-09-14）

Aims 新增 `ApplyMilestoneCompletionWorkflowCallbackInTransaction`，机械承接原
`applyMilestoneCompletionWorkflowCallback` 从锁定 completion request 开始的全部事务体：
不可变 callback 绑定、workflow instance/status 冲突、milestone 锁、审核记录、拒绝解锁、
批准完成与下一里程碑推进，以及 `enqueueMilestoneReceivableBillableOperationTx` 均保持原顺序。
新入口不提交或回滚 caller 的 `sql.Tx`；nil transaction 明确拒绝。旧 callback 继续负责
verified-envelope 的前置校验和 serializable Begin/Commit 包装，因此既有 HTTP/operation 路径不变。

`go test ./internal/apps/aims` 通过（0.464s）。原入口的 approved callback 用 sqlmock 验证
完整提交行为；新增共享事务用例让审批记录和 milestone 更新之后的下一里程碑查询失败，调用方
rollback 被精确断言，证明晚失败不会留下这些源写入。该用例没有把 Aims 和 Altoc 接到新的
HTTP/capability 或 coordinator，也没有宣称跨域 receipt/audit 的原子提交；Altoc 既有
`ExecuteMilestoneReceivableBillableInTransaction` 保持复用，后续协调器必须同时持有两域的
受管 binding 和 caller transaction。

## AA-03 caller 事务内核心（尚未接 Registry 服务外壳）

`ExecuteLocalContractActivationInTransaction` 复用 Altoc job、生效/freezing、Aims 两个真实 owning receipt handler、原 `ValidateReceiptEvidence`、映射 Repository claim/ACK 和 `RecordContractActivationStepResultInTransaction`。冻结 payload 不由 coordinator 重建；仅从源表读取已冻结命令形成原 service-command envelope。项目操作先完成源 ACK，依赖它的付款里程碑才可 claim。成功 source 再重放时，目标 receipt ID 必须与 source 已保存证据一致。项目关联及结构化关系由原 job checkpoint 更新，未直接写状态 SQL。

source 四表与 target 单 receipt 各自显式映射；冻结入口可接受身份与原 reserved context 完全匹配的本地 TrustedContext，从 `OperationTable()` 解析源表。旧调用省略该参数保持原路径。不存在通过 HTTP 接收 table/schema 配置的入口。

隔离 Altoc+Aims MySQL/race 通过（2.508s）：late checkpoint 触发器在目标 receipt 与 source ACK 执行后失败，项目/里程碑/receipt/attempt 均 rollback；模拟旧目标已提交 receipt、source 尚 pending 的 ACK 丢失状态，重入后收敛两个成功操作、两个 target receipt，再次重放不重复目标事实。两个 receipt 物理表分离，目标 CHECK 名按域区分；没有为冲突 outbox 建裸 view。

此处是 caller 事务内核心，尚未向外暴露服务。调用方必须提供两域 Registry 同 pool/schema/generation guard、当前权限、真实逻辑部署绑定和 owning repository；后台消费权不能从 Write 自动推导。Registry 服务初始化/当前授权复核与运行迁移尚未完成，不能把这组 fixture 当作跨租户 HTTP 或上线证据。

## AA-03 Registry 服务与冲突表映射（后续补齐）

已新增 `enterprisecontracts.NewActivationService`：初始化精确验证 Altoc/Aims 两域 Write 与 Altoc Scheduler 登记、同 pool/key/schema/generation，按各域有限名单验证受管 views；审计、领域事件、source outbox、两域 receipt 使用各自注册的物理表。没有为 `audit_log`、`domain_event_outbox` 或 receipt 建全局裸 view。Altoc 原 `altocInsertRecordTx` 在局部 `ContractStorage` context 下解析审计表；领域事件同理，已登记却缺表时失败，旧路径继续原表/原可选事件行为。该 context 只由本地注册映射构造，不能从请求 body 注入。

服务入口 `Activate` 在同一双域 generation guard 事务中调用必须提供的独立 authorizer；结果必须精确绑定 tenant/environment/runtimeDeployment、actor、合同、幂等键、schema/generation 与最多 15 秒有效期，分别具备 Altoc contract edit 和 Aims project write。Altoc 再运行原 owner/department 范围检查；未配置 authorizer、错 tenant、过期或缺少任一域权限均拒绝。Source client/deployment 与 target deployment 从显式本地 `DeploymentBinding` 提供，不从 browser 输入推断；当前没有对外 route，正式 Host 编译器/JWT/实时 credential 接线仍未实现，测试 authorizer 不是实际租户权限验收。

`node data-runtime/scripts/test-registered-activation-mysql.mjs` 实际隔离 MySQL/race 通过（2.896s）。fixture 使用全前缀物理表、有限受管 view、两域独立 receipt，Aims FK 引用实际 Aims 物理表；有真实同名 `aims_audit_log` tripwire，Altoc 审计只落 `altoc_audit_log`。覆盖错误 tenant、过期 grant、独立 Aims 权限缺失、只有 Write 没有 Scheduler 的初始化拒绝；真实并发证明持有授权事务时 generation 更新等待，事务提交后更新成功，旧 Registry 后续写失败。Altoc 与新服务默认 race 测试通过（1.695s/1.708s）。这组测试使用一个 tenant 的隔离库及错 tenant 请求，不冒称已完成两实际租户/线上 HTTP 测试。无新路由、部署或所有权切换。

## AA-03 受控 Runtime HTTP 与双域 permit

新增固定 `POST /v1/enterprise/altoc/contracts:activate-delivery`，只接受 `enterprise.runtime` 的正式短期 JWT、精确 `altoc:contract:activate-delivery` grant、绑定 tenant/deployment 与已验签用户 actor，并实时查询 Console credential/grant 状态。新增本地配置 `enterprise.enableContractActivation`，默认 false；只有显式启用且前述两域登记/映射/服务初始化通过才可执行。当前实际配置和部署未变。

请求仅包含 `contractCode`、`authorization`、`aims_authorization`，幂等键来自 header。两份 permit 独立绑定 actorUid/tenant/Host deployment/contractCode/idempotencyKey/expiresAt，分别要求原用户权限 `contract:edit`（Altoc）与 `projects:create`（Aims）。Altoc permit 携带编译后 access/departmentCodes，Aims 创建资格没有既有项目 scope。两者均最多 15 秒、显式 allowed；未知输入由严格 decoder 拒绝。`CompiledActivationAuthorizer` 是已认证 Host 的授权证据接收器，不自行信任 browser；Host 必须先复用 `altocScopedAuthorization.resolveAltocDataAccessQuery` 与 Aims 原 `requirePermission(...,'projects','create')` 规则从当前 Console 授权产生证据。该 Host BFF 编译与页面入口尚未在本包接通，不能把 fixture permit 称为实际用户登录链。

`node data-runtime/scripts/test-contract-activation-http-mysql.mjs` 实际隔离 MySQL + Runtime HTTP/JWT/actor + race 通过（3.048s）。覆盖两域各自缺权、错误 tenant、非精确 cap、actor/过期 permit、late checkpoint 事务全回滚、成功重放、合同 owner 改变后原 key 拒绝、当前 credential 撤销后重放拒绝，以及 disabled 返回 503。使用隔离签名密钥与当前 Console verifier fixture，不输出 token；不代表真实测试租户 OAuth/grant 或线上浏览器验证。server/enterprisecontracts/config 全包 race 分别通过 2.368s/2.028s/1.347s。

### 本地 capability 登记补齐

Altoc manifest 的 `contract` 资源新增服务动作 `activate-delivery`；Foundation 固定操作
`altoc.contracts-activate-delivery` 使用 `/v1/enterprise/altoc/contracts:activate-delivery`
及 `altoc:contract:activate-delivery`，保留用户身份和幂等键。部署模板与探测 allowlist
已同步为37项 Runtime capability；现有实际签发证据仍仅覆盖原36项，未应用新增授权。
用户操作权限继续独立检查 Altoc `contract:edit` 与 Aims `projects:create`，不以服务
capability替代人员权限。本地 Foundation 回归通过；Host真实权限编译及完整链路仍待接通。

### AA-03 Host BFF permit 编译（2026-09-14）

Host 新增固定 `POST /altoc/api/v1/contracts/{contractCode}/activate-delivery`。入口只接受空 body，合同编号来自 route、幂等键来自 header；浏览器提交的 permit、scope 或 allowed 字段在到达 Runtime 前拒绝。经 `requireEnterpriseUser` 取得已验证 actor/tenant/deployment 后，Host 分别从当前 Console scoped authorization 编译 Altoc `contract:edit` 与 Aims `projects:create`。Altoc 复用 `altocDataAccessScope` 的纯 grant compiler 和既有 global-admin 规则；需要 tree scope 时按当前 event 经 Directory 加载树，不复用独立 Altoc BFF 的全局 cache。两份 evidence 独立绑定 actor、tenant、Host deployment、contract、idempotency key 和最多 15 秒有效期。

此处没有挂载 Altoc 页面或整个模块，也没有启用 Runtime 开关、实际第 37 项 grant、配置、数据库或部署；后者仍须实际 OAuth/grant 验证后才可用。

清单组合器已使用真实 Aims/Assets/Altoc manifest 验证兼容：保留 Altoc 既有
`finance-summary:sync` 等复合动作，不重命名既有授权；空段及通配符仍拒绝。
相关清单测试5项通过。当前正式 Host manifest 仍只组合已登记的 Aims/Assets，
本次修正不代表 Altoc 页面、发布或业务路径已启用。

Host 直接引用 Altoc 纯范围编译器后，技术发布清单同时强制记录 `altoc` 源码 commit/tree；未记录该依赖的发布输入会拒绝。此源码依赖记录不等于启用 Altoc 全部页面或授予企业人员权限。

最新实际授权状态：2026-09-14T04:30:04.099Z 已登记第37项 Runtime capability `altoc:contract:activate-delivery`，实际Gateway→Console签发及当前凭据/精确grant验签通过，两个负例被拒绝（[证据](../deploy/test-env/enterprise-oauth-selected-b1acc81d582d-evidence.json)）。此前未应用的描述属于历史阶段；Runtime合同激活开关仍关闭，尚未完成真实业务与页面验收。

### AA-04 受信 Workflow callback 与 Registry core（2026-09-14）

Aims BFF 的既有 Workflow service-token 校验仍是唯一入站审批边界：它确认
`workflow:callback`、来源 `workflow` 后才白名单化 payload 并注入 Runtime marker。
Runtime 以 `VerifiedMilestoneCompletionCallback` 复制该固定字段，拒绝无效 status、
request/instance/biz 绑定和 snapshot 形状；输入或 getter 返回 map 的后续突变不会改变
已验证值。跨域服务还要求回调中由已认证 Runtime 注入的租户、来源 Aims deployment、
`aims` source app 与 `aims.runtime` client 匹配服务绑定；缺失或跨租户/部署的值在开事务前拒绝。
来源 deployment 保留旧命令身份，不与统一库 Registry owner deployment 混同。
它不接受普通 milestone edit 或 browser body 作为审批事实。

`MilestoneReceivableService` 已接入既有 Aims callback 的显式迁移分流。它在现有 Registry 的
Altoc+Aims write generation guard 中执行 Aims callback、mapped Aims source outbox claim、
Altoc `ExecuteMilestoneReceivableBillableInTransaction` receipt 及 source success ACK；
Aims scheduler 仍要求独立登记，所有 source/target deployment 与 physical table mapping 从
binding 构造。Runtime `enterprise.enableMilestoneReceivable` 与 Aims服务器
`HZY_AIMS_ENTERPRISE_ENABLE_MILESTONE_RECEIVABLE` 均默认关闭；关闭时保留旧callback，
启用但服务未就绪时503。Foundation仅对固定Runtime audience与固定组合能力提供专用格式，
Runtime重验严格服务身份和实时grant。代码已接通，不代表线上授权/配置或业务路径已切换。

AA-04 隔离 MySQL 通过：callback→Altoc receipt→source ACK、同键重放、ACK 晚失败全回滚、跨合同付款条款及错 tenant/deployment callback 拒绝。


AA-04真实HTTP/JWT/MySQL验证已完成：`node data-runtime/scripts/test-contract-activation-http-mysql.mjs`通过（3.401s）。覆盖callback成功/重放、成功后返回`succeeded`避免BFF再次外发、缺精确capability/错deployment/错token_use/撤销credential拒绝、服务缺失503及开关关闭的legacy回落。独立pending回款计划在processing→succeeded的源ACK触发失败后，approval、milestone及锁、source operation、目标receipt和回款状态全部回滚；仅移除触发器后同一请求成功。该测试包含真实HTTP、JWT和隔离MySQL，Console使用隔离的当前授权表，未证明真实测试租户双audience令牌签发或线上启用。

Console v2.5授权准备只插入缺失grant，保留既有metadata和非active状态。真实隔离MySQL预置inactive/custom行并执行seed两次，旧行未变；部署前仍需精确目标授权核验。代码与隔离验证已具备，完整Altoc模块挂载、测试租户授权、开关和实际业务切换仍未完成。

双audience授权已按现有Console语义映射实现：分别以 `data-runtime:altoc:receivable` 与 `tenant-runtime:altoc:receivable` grant记录映射同一原始 `altoc:receivable:mark-billable`，保留独立目标grant供Runtime实时撤销检查。未扩展Console解析器或通配scope。`test-aa04-grant-mysql.mjs`用实际v2.5 seed/verify和真实 `authorizeServiceClientScopes` 验证两audience的固定组合、错误audience拒绝、单audience撤销隔离以及旧grant保留；不能用SQL行存在替代这些结果。线上授权仍未变更。
