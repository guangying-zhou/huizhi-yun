# 汇智云财务（finance）模块

> 业务模块 — 经营财务中台 | 端口 3006 | 状态：开发中（v0.1-v0.3 MVP 实现中） | 数据库：tenant-runtime 托管（默认 hzy_finance）
>
> PRD：[`docs/Finance_PRD.md`](./docs/Finance_PRD.md)
> 模块设计与实现计划：[`docs/Finance_Module_Design_and_Implementation_Plan.md`](./docs/Finance_Module_Design_and_Implementation_Plan.md)
> Schema：[`docs/finance_schema.sql`](./docs/finance_schema.sql)

## 职责边界

**负责**：正式发票、到账/收款、收款核销、项目支出、费用报销、付款申请、银行账户、账户余额快照、非合同收入归类、项目财务核算、人力成本计算参数、绩效金额/提成奖金财务口径快照、财务报表摘要。

**不负责**：客户/商机/报价/合同经营过程（→ Altoc）、项目交付执行（→ Aims）、员工组织主数据、入转调离事实、个人绩效周期/评分/确认/归档（→ People / Console Directory）、审批流引擎（→ Workflow）、外部连接凭证治理（→ Console/Integration）、完整总账和税务申报。

## 依赖模块

- **Altoc**：合同、客户、经营回款计划、开票申请来源。
- **Aims**：项目、里程碑、工时、交付验收等项目执行事实。
- **Assets**：项目资产采购、资源订阅、环境投入等资产成本归因摘要。
- **People / Console Directory**：员工、部门、岗位、职级、入离职状态、M/P 职级设置、人员成本快照、项目贡献快照和个人绩效主流程。Finance 向 People 提供人力成本计算参数，People 生成并固化月度成本快照。
- **Workflow**：费用报销、项目支出、付款申请、开票申请审批编排。
- **Console/Integration**：钉钉、企业微信、人员/财务外部系统连接与凭证托管。
- **Platform/Console/Foundation**：应用注册、OIDC 登录和运行时能力；Platform 负责签名 bundle，Console 是授权事实源，Finance 只通过 Foundation 获取权限快照、财务 scoped authorization 和实例级职责冲突解释，不读取本地 bundle。

## 一体化运营闭环 Phase 1 契约

首条闭环按 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 与 `docs/MODULE_CONTRACTS.md` 执行：Finance 是开票申请、正式发票、到账、核销、合同财务摘要、项目财务摘要的事实源。Altoc 只发起开票申请和读取摘要，不维护财务事实。

冻结的 service API / 事件目标：
- Altoc → Finance → Workflow：Finance `POST /api/v1/finance/service/invoice-requests/create` 只接受 Altoc service token、精确 capability、标准 service-command envelope 和冻结 actor；`invoice_request` mutation、Finance target receipt 与 `finance.invoice-request.workflow-submit.v1` operation 同事务。后续 Workflow instance receipt 成功后，Finance 在同一 checkpoint 事务更新 `pending_approval`、外部审批投影、attempt 和 source operation。
- Altoc → Finance：`GET /api/v1/finance/contracts/{contractCode}/summary`，使用 `aud=finance`、`scope=finance:read`。
- Finance → Altoc：`POST /api/v1/finance/reconciliation` 在 Finance runtime 核销事务内，从锁定的到账/发票关联和重算摘要生成最小 `finance.reconciliation.altoc-summary.v1` 命令并写入 caller-owned `integration_operation`；浏览器 body 不选择可靠命令的合同、计划、目标或 capability。即时请求和默认关闭的 scheduled drain 领取冻结命令，使用 Console service token 调 Altoc `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync`；Altoc 业务更新与 `service_command_receipt` succeeded 同事务，Finance 只在精确校验 receipt 后确认 source operation。网络/5xx 保留重试，401/403 和确定性契约错误进入终态，ack 丢失用原幂等身份恢复。

所有跨模块写入必须保留 `source_app`、`source_biz_type`、`source_biz_code`、`idempotency_key` 和审计上下文。可靠 operation DDL 为 `docs/migrations/20260710_finance_integration_operations.sql`，Finance target receipt DDL 为 `docs/migrations/20260710_service_command_receipt.sql`；2026-08-27 的 C000001 历史核验已确认对应表存在（见根 docs/Altoc-Finance-走查ISSUE清单-2026-09.md B-014）；其他环境及后续列/索引须逐环境重新 verify。

## 一体化运营闭环 Phase 2 契约

Finance 项目核算不得直连 Assets 数据库。资产成本来源统一通过 Assets service API 获取：

- `GET /api/v1/service/projects/{projectCode}/cost-summary?period_month=`，使用 Console service token，`aud=assets`、`scope=assets:read`。
- Assets 返回 `asset_purchase`、`resource_subscription`、`environment_investment`、`monthly_allocation` 四类 line item，Finance 可写入 `project_cost_allocation`，`allocation_type=asset`，并参与 `project_finance_summary` 重算。
- Finance 仍是项目财务汇总事实源；Assets 只是资产成本归因来源，不维护毛利、收入或财务摘要。

## 一体化运营闭环 Phase 3 契约

Finance 项目人力成本不得直连 People 数据库，也不得依赖 People 绩效周期或贡献快照。项目核算主路径由 Finance 按月读取 Aims 工时事实、People 员工职级和 M/P 职级设置，并结合 Finance 人力成本参数计算标准人力成本：

- Finance 项目核算页的项目清单以 Aims 项目事实为准，本地编排端点 `GET /api/v1/finance/project-accounting/aims-projects` 分页读取 Aims 项目列表，并合并当前页 Finance 项目财务摘要；Finance 授权为 `projects` 时必须把精确 `project_codes` 下推 Aims 后再计算 total / 分页，不得先拉固定大页再做本地过滤，也不得要求用户手工输入项目编码作为项目清单来源。
- Finance 本地编排端点 `POST /api/v1/finance/project-accounting/sync-people-costs` 读取 Aims `GET /v1/aims/admin/projects?search=`、`GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=`，并读取 Console Work Calendar 月标准工时，按员工当月本项目工时 / Console 月标准工时计算分摊比例。
- Finance 通过 People `GET /v1/people/service/standard-costs:resolve?employee_uids=&effective_date=` 获取员工有效职级和匹配的 M/P 职级设置；People 只返回职级工资、绩效工资范围等标准成本基础，不返回项目成本分摊结果。
- Finance 维护基本工资、福利费率、管理分摊系数和固定资源分摊参数，并通过 `GET /api/v1/finance/service/people-cost-parameters` 给 People 成本快照生成使用；Finance BFF 在转发 tenant-runtime 前校验入站 service token，要求 `aud=finance`、`scope=finance:read`；项目核算也直接使用同一参数计算月标准成本。
- 月标准成本公式为：基本工资 + 职级工资 + 绩效工资中位数 + 福利成本 + 管理分摊 + 资源分摊。Finance 按 `project_code + period_month + employee_uid` 生成稳定成本分摊编码，写入 `employee_cost_snapshot` 与 `project_cost_allocation(allocation_type=labor)`，并触发 `project_finance_summary` 重算。
- BFF 将完整项目/月度 labor 集合一次写入 data-runtime `POST /v1/finance/project-accounting/labor-costs:sync`；runtime 用 summary 行锁和 `expectedInputHash` 处理并发，在单事务内 upsert 当前集合、反转消失的 managed labor、更新 readiness 和重算摘要。禁止恢复逐员工多次写入后再单独重算的路径。
- Finance service 端点 `GET /api/v1/finance/service/performance-amounts` 向 People 提供绩效金额财务口径快照，支持按绩效周期期间、员工和项目贡献范围过滤；Finance BFF 在转发 tenant-runtime 前校验入站 service token，要求 `aud=finance`、`scope=finance:read`；People 只引用展示，不回写 Finance。
- Finance 入站 service capability 必须精确匹配；`finance:*` / `finance:admin` 不替代端点要求的 scope，已登记的兼容读取 scope 仍按各自合同执行。
- 未登记 capability 的 `/api/v1/finance/service/**` 后缀会在 Finance BFF 转发 tenant-runtime 前拒绝，不得落到通用 `finance.write` 或其他 transport scope。
- 所有已登记的 `/api/v1/finance/service/**` 转发入口在读取业务 body、调用本地 handler 或 tenant-runtime 前，统一保留 Console introspection 故障分类：仅 `service_token_introspection_unavailable` 返回可重试 `503`；明确 invalid / expired / revoked 返回 `401`，已验证但 capability 或 source app 不匹配返回 `403`。
- People 是人员事实、成本快照、贡献快照和个人绩效流程事实源；Finance 只维护项目财务核算结果、绩效金额/提成奖金的财务口径快照，不回写 People 人员事实或绩效终态。
- 没有 People 员工职级、M/P 职级设置、Finance 人力成本参数或 Aims 工时时，Finance 必须持久化 `not_ready`、反转该规则管理的旧 labor allocation，并只能显示项目收支和未就绪原因；毛利与毛利率必须为 `NULL`。历史摘要缺少 readiness 时按未就绪处理，不得从正数成本反推 ready。

## 成本归集与经营核算 Goal 3 契约

Finance 保持成本单价和财务口径来源角色，不新增替代 Finance 的成本主账，也不直写 Altoc 或 Aims 数据库。Goal 3 的项目成本重算由上游编排把 Finance/People 成本参数传给 Aims `project_cost_summary`，再把项目期间成本传给 Altoc 的合同行利润和服务成本重算接口。Altoc 只保存经营归集规则和可重建汇总，Finance 仍负责正式发票、到账、核销、项目支出和成本参数。

## 一体化运营闭环 Phase 4 契约

Finance 是维保收入、到账、核销、服务成本和毛利分析的财务事实源。P4.4 已落地 `GET /api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary?contract_codes=&project_codes=&period_month=`，按 `customer AND (maintenance contract OR maintenance project)` 汇总开票、到账、核销、项目成本分摊与项目财务摘要；用户项目授权再作为额外 AND 约束。入站调用必须使用 Console service token，`aud=finance`、`scope=finance:read`，并至少提供一个合同或项目编码；空业务范围失败关闭，不能退化为客户全量。

维保经营上下文仍由 Altoc 提供；Finance 不维护维保合同、SLA、服务工单或续约机会主档。Altoc 客户页读取该接口时会先从 Altoc runtime 获取维保范围，再把 `contract_codes/project_codes` 传给 Finance，避免把客户下全部项目泛化为维保。

## 版本规划

- **v0.1**：财务台账与核销。发票、到账、支出、银行账户、非合同收入归类、合同财务摘要。
- **v0.2**：报销/支出/付款审批。对接 Workflow，并通过 Console/Integration 连接钉钉或企业微信审批。
- **v0.3**：项目核算与绩效金额财务口径。对接 People、Aims、Altoc，计算项目毛利、人力成本、财务贡献归因、提成/奖金/绩效金额快照；个人绩效周期、确认和归档归 People。

## 开发注意

### G4 到期通知与来源详情授权

- Workflow 审批回调只把开票申请置为 `approved`，不得生成 `finance_invoice`。正式开票仅由已显式获得 `invoices:issue` 的用户调用 issue action 完成；`approve` 或 `admin` 不隐式获得开票能力。已批申请通过独立 assign action 维护成对的 `issuance_responsible_uid / issuance_due_at`。
- Finance 定时生产 `invoice_issuance_due`（已批待开票）和 `receipt_reconciliation_due`（到账待核销）两条流，事件分别为 `finance.invoice_request.issuance_due`、`finance.receipt.reconciliation_due`。收件人只能是 runtime 返回的当前直接责任人，并且必须是 Console Directory active 用户；禁止 manager、department、admin、配置项或 `@all` fallback。
- 发布前必须按受信 stream 分别通过 Console subject eligibility 校验固定目的 `invoice_requests:view` / `finance_receipts:view`。拒绝、inactive 或资格服务不可用时不得发布、不得 ack，保留 checkpoint 重试；资格结果不替代当前直接责任人与 exact code 目标页重鉴权。
- Console 来源详情 descriptor 必须精确为 `{resource:'invoice_request',id:requestCode}` 或 `{resource:'finance_receipt',id:receiptCode}`，并与通知 `bizType/bizId` 完全一致且不得增加字段。`POST /api/v1/service/notification-details/authorize` 只接受 Console service token，`aud=finance`、`scope=finance:notification-details:authorize`，再以 purpose-bound actor 调 Finance tenant-runtime 当前关系验证器。
- 服务令牌 introspection 只有明确 inactive/revoked/invalid 才返回 401；Console introspection 网络、5xx 或存储故障必须在读取业务 body、调用 handler 或 tenant-runtime mutation 前返回可重试 503。
- 通知 action URL 必须使用 exact code 目标页：`/finance/invoices/requests/{code}` 或 `/finance/receipts/{code}`。用户态 invoice-request / receipt 列表与详情仅允许当前 `issuance_responsible_uid` / `reconciliation_responsible_uid`，或受信 `tenant:global` / 无对象范围的全局访问；`subject:self` 只映射为当前直接责任关系。`supportedScopes` 只声明既有 `tenant:global`、`subject:self`，不得据此自动创建 grant。
- 开票、到账确认与核销写入仍先要求各自独立的 `invoices:issue`、`receipts:confirm`、`reconciliation:confirm` action，再要求当前直接责任；只有受信全局访问可旁路责任关系。通知详情关系或只读 relation 不得扩张为写权限，浏览器提交的责任 access/actor 字段必须由 BFF/runtime 删除并以受信上下文重建。
- `POST /v1/finance/service/notifications:scan-due`、`:acknowledge`、`:acknowledge-closure` 是 Finance 自身 scheduled runtime 的封闭 worker 合同：仅短期 JWT `sub=client:finance.runtime`、精确 `data-runtime:finance:notifications_due:execute` grant、tenant/deployment 绑定及与完整 request target 绑定的 `finance-due-notification-worker` HMAC purpose 可进入；`finance.write`、static token、普通用户 actor、其他 service client 和 body 传入的 actor/tenant/生命周期字段均不得调用。三个 route 分别只接受 scan、ack、closure ack 的固定字段集合；发布、checkpoint ack、Console actionable closure 均可在 ack 丢失后用同一稳定身份重放。
- Finance 也是 integration-operation dead-letter actionable 的 source：`pending-dead-letter-actionables`、`dead-letter-actionable-published`、`pending-dead-letter-closures`、`dead-letter-closure-acknowledged` 均要求 Finance runtime 的受信 worker context。候选只含安全诊断字段和冻结 generation/CAS 身份；Console 实际收件 UID 与 notification ID 必须回写 source。replay/success 的 resolved/cancelled closure 在同一 operation 事务内写入。DDL 为 `docs/migrations/20260711_finance_dead_letter_actionable_lifecycle.sql`；C000001 历史表存在证据同 B-014，不能据此推断本轮迁移或业务验收通过。
- Finance 跨应用操作诊断页为 catalog-relative `/integration-operations`；只允许 `tenant:global` 的 `finance:integration_operations:view/replay`，详情 descriptor 精确为 `{resource:'integration_operation',id:<lowercase UUID>}`，不会暴露 command、operation key、hash 或原始错误。
- Cloudflare 定时任务默认关闭。只有 `HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED=true` 且 runtime URL、tenant、deployment、Finance service client ID 完整时，版本化 Cloudflare 配置指令才渲染 `*/15 * * * *` cron；managed runtime 还必须从 Cloudflare secret 取得 service client secret，否则在网络调用前失败关闭。关闭时必须在 binding、token 和网络访问之前短路。

- 禁止跨模块数据库直连，跨模块引用使用业务键和服务 token。
- Finance 是财务事实源；Altoc 只展示 Finance 回传的开票/到账/核销摘要。
- 外部平台凭证不得写入 Finance env，统一通过 Console/Integration 配置。
- Finance 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db` / Hyperdrive。所有 `/api/v1/finance/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。
- `server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository、DB fallback 或 Cloudflare Hyperdrive。
- Wizbiz 历史数据迁移属于 runtime 侧能力，不允许在 Finance Nuxt server 内创建源库或目标库连接。
- 首期避免实现完整总账、凭证、关账、多账套、税务申报和银企直连。
- 数据库结构变更必须同步更新 `docs/finance_schema.sql`。
- 已执行旧版 Finance schema 的租户库若要启用 People 职级成本快照生成，应执行 `docs/finance_people_cost_parameter_incremental.sql`，不需要删库重建。
- 已有租户启用项目成本 readiness 前，必须在上述参数迁移之后执行 `docs/migrations/20260709_project_finance_readiness.sql`；迁移会把无法证明完整的历史毛利安全失效，重新同步成功后才恢复 ready 毛利。
