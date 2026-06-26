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
- **Platform/Console/Foundation**：应用注册、OIDC 登录和运行时能力；Platform 负责签名 bundle，Console 是授权事实源，Finance 只通过 Foundation 获取权限快照和财务 scoped authorization，不读取本地 bundle。

## 一体化运营闭环 Phase 1 契约

首条闭环按 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 与 `docs/MODULE_CONTRACTS.md` 执行：Finance 是开票申请、正式发票、到账、核销、合同财务摘要、项目财务摘要的事实源。Altoc 只发起开票申请和读取摘要，不维护财务事实。

冻结的 service API / 事件目标：
- Altoc → Finance：Altoc `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 会使用 Console service token 调 Finance `POST /api/v1/finance/invoice-requests`，并带 `Idempotency-Key`；Finance 按 `source_app + source_biz_type + source_biz_code` 自然幂等创建开票申请，随后 Altoc 编排器调用 Finance `POST /api/v1/finance/invoice-requests/{code}/submit` 进入 Workflow / local fallback 审批状态。
- Altoc → Finance：`GET /api/v1/finance/contracts/{contractCode}/summary`，使用 `aud=finance`、`scope=finance:read`。
- Finance → Altoc：Phase 1 已落地 `POST /api/v1/finance/reconciliation` 本地编排器；该入口调用 Finance runtime 创建核销并返回合同 / 回款计划摘要后，使用 Console service token（`altoc:write altoc:contract:finance-summary:sync`）调用 Altoc `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync` 刷新经营侧回款计划已收、未收和状态。Altoc 同步失败不回滚 Finance 核销，响应会附带 `altocFinanceSummarySyncError` 供后续重放；`finance.contract.summary.updated` 事件仍作为后续事件总线语义保留。

所有跨模块写入必须保留 `source_app`、`source_biz_type`、`source_biz_code`、`idempotency_key` 和审计上下文；当前开票申请表已保存前三项，Altoc 回款计划开票入口会把幂等键写入 Altoc 审计日志，核销回传会按请求头或核销单 / 摘要版本派生幂等键。专门 idempotency/bridge log 表进入后续硬化。

## 一体化运营闭环 Phase 2 契约

Finance 项目核算不得直连 Assets 数据库。资产成本来源统一通过 Assets service API 获取：

- `GET /api/v1/service/projects/{projectCode}/cost-summary?period_month=`，使用 Console service token，`aud=assets`、`scope=assets:read`。
- Assets 返回 `asset_purchase`、`resource_subscription`、`environment_investment`、`monthly_allocation` 四类 line item，Finance 可写入 `project_cost_allocation`，`allocation_type=asset`，并参与 `project_finance_summary` 重算。
- Finance 仍是项目财务汇总事实源；Assets 只是资产成本归因来源，不维护毛利、收入或财务摘要。

## 一体化运营闭环 Phase 3 契约

Finance 项目人力成本不得直连 People 数据库，也不得依赖 People 绩效周期或贡献快照。项目核算主路径由 Finance 按月读取 Aims 工时事实、People 员工职级和 M/P 职级设置，并结合 Finance 人力成本参数计算标准人力成本：

- Finance 项目核算页的项目清单以 Aims 项目事实为准，本地编排端点 `GET /api/v1/finance/project-accounting/aims-projects` 读取 Aims `/v1/aims/projects`，并合并 Finance 已有项目财务摘要；不得要求用户手工输入项目编码作为项目清单来源。
- Finance 本地编排端点 `POST /api/v1/finance/project-accounting/sync-people-costs` 读取 Aims `GET /v1/aims/admin/projects?search=`、`GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=`，并读取 Console Work Calendar 月标准工时，按员工当月本项目工时 / Console 月标准工时计算分摊比例。
- Finance 通过 People `GET /v1/people/service/standard-costs:resolve?employee_uids=&effective_date=` 获取员工有效职级和匹配的 M/P 职级设置；People 只返回职级工资、绩效工资范围等标准成本基础，不返回项目成本分摊结果。
- Finance 维护基本工资、福利费率、管理分摊系数和固定资源分摊参数，并通过 `GET /api/v1/finance/service/people-cost-parameters` 给 People 成本快照生成使用；Finance BFF 在转发 tenant-runtime 前校验入站 service token，要求 `aud=finance`、`scope=finance:read`；项目核算也直接使用同一参数计算月标准成本。
- 月标准成本公式为：基本工资 + 职级工资 + 绩效工资中位数 + 福利成本 + 管理分摊 + 资源分摊。Finance 按 `project_code + period_month + employee_uid` 生成稳定成本分摊编码，写入 `employee_cost_snapshot` 与 `project_cost_allocation(allocation_type=labor)`，并触发 `project_finance_summary` 重算。
- Finance service 端点 `GET /api/v1/finance/service/performance-amounts` 向 People 提供绩效金额财务口径快照，支持按绩效周期期间、员工和项目贡献范围过滤；Finance BFF 在转发 tenant-runtime 前校验入站 service token，要求 `aud=finance`、`scope=finance:read`；People 只引用展示，不回写 Finance。
- People 是人员事实、成本快照、贡献快照和个人绩效流程事实源；Finance 只维护项目财务核算结果、绩效金额/提成奖金的财务口径快照，不回写 People 人员事实或绩效终态。
- 没有 People 员工职级、M/P 职级设置、Finance 人力成本参数或 Aims 工时时，Finance 只能显示项目收支和“人力成本未就绪”，不得把毛利展示为完整项目成本核算结果。

## 一体化运营闭环 Phase 4 契约

Finance 是维保收入、到账、核销、服务成本和毛利分析的财务事实源。P4.4 已落地 `GET /api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary?contract_codes=&project_codes=&period_month=`，按客户、维保合同关联的合同编码和项目编码汇总开票、到账、核销、项目成本分摊与项目财务摘要；入站调用必须使用 Console service token，`aud=finance`、`scope=finance:read`。

维保经营上下文仍由 Altoc 提供；Finance 不维护维保合同、SLA、服务工单或续约机会主档。Altoc 客户页读取该接口时会先从 Altoc runtime 获取维保范围，再把 `contract_codes/project_codes` 传给 Finance，避免把客户下全部项目泛化为维保。

## 版本规划

- **v0.1**：财务台账与核销。发票、到账、支出、银行账户、非合同收入归类、合同财务摘要。
- **v0.2**：报销/支出/付款审批。对接 Workflow，并通过 Console/Integration 连接钉钉或企业微信审批。
- **v0.3**：项目核算与绩效金额财务口径。对接 People、Aims、Altoc，计算项目毛利、人力成本、财务贡献归因、提成/奖金/绩效金额快照；个人绩效周期、确认和归档归 People。

## 开发注意

- 禁止跨模块数据库直连，跨模块引用使用业务键和服务 token。
- Finance 是财务事实源；Altoc 只展示 Finance 回传的开票/到账/核销摘要。
- 外部平台凭证不得写入 Finance env，统一通过 Console/Integration 配置。
- Finance 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db` / Hyperdrive。所有 `/api/v1/finance/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。
- `server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository、DB fallback 或 Cloudflare Hyperdrive。
- Wizbiz 历史数据迁移属于 runtime 侧能力，不允许在 Finance Nuxt server 内创建源库或目标库连接。
- 首期避免实现完整总账、凭证、关账、多账套、税务申报和银企直连。
- 数据库结构变更必须同步更新 `docs/finance_schema.sql`。
- 已执行旧版 Finance schema 的租户库若要启用 People 职级成本快照生成，应执行 `docs/finance_people_cost_parameter_incremental.sql`，不需要删库重建。
