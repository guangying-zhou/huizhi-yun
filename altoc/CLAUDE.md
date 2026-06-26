# Altoc 模块

> 业务模块 — LTC 经营管理平台 | 端口 3003 | 状态：开发中（MVP 一期基本完成） | 数据库：tenant-runtime 托管（默认 hzy_altoc）
>
> 📖 涉及认证、目录、审批、共享组件或 Server API 复用时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)；简单局部改动不需要预读。

## 职责边界

**负责**：客户管理、联系人、线索、商机漏斗、报价/报价版本、合同管理、回款计划与跟踪、招投标管理、销售活动、维保合同、服务权益 / SLA、服务工单入口、续约机会、AI 辅助分析（客户摘要、商机风险、活动总结）

**不负责**：项目交付执行和服务工单执行（→ Aims）、文档内容编辑和运维知识正文（→ Codocs）、完整 ERP/财务（→ Finance）、用户权限治理（→ Platform / Foundation）

## 面向场景

ToB/ToG 项目型企业（IT 服务商、系统集成商、方案型销售团队），覆盖 Lead to Cash 全流程。

## Aims 桥接（有效方案，Phase 1 已完成）

- Altoc 管经营视角（客户→商机→合同→回款）
- Aims 管交付视角（项目→迭代→任务→交付物）
- 通过 API 桥接：商机→项目、合同→里程碑、回款→PIVR 阶段

当前状态：Phase 1 已完成主链路：Altoc 合同生效交付编排入口、Aims 合同项目桥接、付款条款里程碑同步、Altoc 回款计划可开票 service endpoint、Altoc 发起 Finance 开票申请、Finance submit 审批提交、Altoc 合同 Finance 摘要展示，以及 Finance 核销后回传经营侧回款计划摘要的 service endpoint 均已落地。

## 一体化运营闭环 Phase 1 契约

首条闭环按 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 与 `docs/MODULE_CONTRACTS.md` 执行：Altoc 是客户、商机、合同、付款条款、回款计划的事实源。Aims、Finance、Assets 只引用 `customer_code`、`contract_code`、`opp_id`、`contract_id`、`payment_term_id`、`receivable_plan_code` 等稳定业务键，不复制经营主档。

已落地和冻结的 service endpoint / 事件目标：
- 合同生效后通过 Altoc `POST /api/v1/service/contracts/{contractCode}/activate-delivery` 编排入口推进：先由 Altoc tenant-runtime 创建履约启动作业、激活合同并生成签约阶段回款计划；仅当启动计划包含项目步骤时，才用 Console service token 调用 Aims `POST /api/v1/service/projects/from-contract` 和 `POST /api/v1/service/projects/{projectCode}/payment-milestones:sync`，并回写步骤状态。
- 合同详情页可通过 Altoc 本地 BFF 查询 Aims `GET /api/v1/service/projects/eligible-for-contract`，并将已有 Aims 项目写入 Altoc `contract_project_link` 和结构化 `contract_project_line_rel` / `contract_project_obligation_rel`；浏览器不直接持有 Aims service token。项目关系写入支持 `lines[]` 逐合同行设置 `relationType`、`allocationMethod`、`allocationRatio`、`allocatedAmount`、`plannedWorkdays`，旧 `line_codes` / `line_ids` 兼容输入仍可用。
- P1-2 起履约启动按合同行 `project_policy`、行类型、服务策略和项目模板生成多个 `project_plans`；`contract_project_link.plan_key` 保留项目分组键，`line_codes_json`、`obligation_codes_json` 仅作为兼容快照 / 回退数据。合同行 / 履约义务到 Aims `project_code` 的业务真值由 Altoc 结构化关系表负责，Finance 后续按 `project_code -> contract_line` 关系归集成本，Console 不是运行时依赖；历史成本归集查询包含 `planned` / `active` / `closed` 项目，排除 cancelled 和软删除关系。无效、跨合同或不匹配的 line / obligation 引用必须在替换旧关系前整体 400 失败。
- 履约启动包含客户交付资产步骤时，Altoc 使用 Console service token 调 Assets `POST /api/v1/service/customer-delivery-assets/plans`，把本地计划资产同步为 Assets `customer_delivery_assets` 主档，并将返回的 `delivery_asset_code` 回填到合同计划资产。
- Assets 客户交付资产进入 delivered / online / accepted 等状态后，可用 Console service token 调 Altoc `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/status:sync` 回写合同计划资产；Altoc BFF 会先用 Assets `references:resolve` 校验正式 `delivery_asset_code` / `environment_code` / pair，计划 code 只能作为 `sourcePlanCode` 定位来源，不得写入正式资产字段；`accepted` 会推进关联履约义务，并把绑定结算计划置为可结算。
- Altoc 可接收 Aims 验收里程碑完成后的 `POST /api/v1/service/receivable-plans/{receivablePlanCode}/mark-billable` 或 `POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable`，将回款计划推进到 `to_invoice`；Aims `review-approve` 可自动按 `paymentTermId` 触发；service token 必须具备 `altoc:write altoc:receivable:mark-billable`。
- Altoc 可通过 `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 从回款计划发起 Finance 开票申请：Altoc runtime 校验计划并组装 payload，Nuxt 编排器使用 Console service token 调 Finance `POST /api/v1/finance/invoice-requests`，随后自动调用 Finance submit 进入 Workflow / local fallback 审批状态，并在 Altoc runtime 写回款计划审计。
- Finance 核销后由 Finance `POST /api/v1/finance/reconciliation` 编排器调用 Altoc `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync`；Altoc 根据 Finance 回传的合同 / 回款计划摘要刷新 `receivable_plan` 的已收、未收和状态。调用 token 必须具备 `altoc:write altoc:contract:finance-summary:sync`；`finance.contract.summary.updated` 事件仍作为后续事件总线语义保留。

所有跨模块写操作必须使用 Console service token 和 `Idempotency-Key` 或由请求体派生等效幂等键；Altoc 不直写 Aims、Finance、Assets 数据库。

## 成本归集与经营核算 Goal 3 契约

Altoc 是经营归集维度事实源。Goal 3 新增 `contract_line_cost_allocation`、`contract_line_profit_summary` 和 `service_cost_summary`：前者是合同行到 Aims `project_code` 的核算归因快照，可由 `contract_project_line_rel` 在合同利润重算前自动物化，也支持手工维护显式分摊规则；后两者保存可按期间重算的合同行毛利和服务成本汇总。Aims 工时明细不复制到 Altoc，Finance/People 成本单价不迁入 Altoc。

新增 tenant-runtime endpoint：
- `GET/POST /api/v1/service/contract-lines/{contractLineCode}/cost-allocations`
- `POST /api/v1/service/contracts/{contractCode}/profit-summary:recalculate`
- `GET /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary`
- `POST /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary:recalculate`
- `GET /api/v1/altoc/analytics/contract/{contractCode}`、`GET /api/v1/altoc/analytics/customer/{customerCode}`

成本归集强制通过 `project_code`：合同利润重算先把 `contract_project_line_rel` 中的 planned / active / closed 项目关系物化为 `contract_line_cost_allocation`；`unallocated` 仅在同一项目唯一对应一条合同行时自动视为 `direct`，同一项目对应多条合同行但没有 ratio / amount / workdays / direct 分摊时必须返回 `cost_allocation_required`，不得静默归属或平均分摊。合同收入来自 `contract_billing_schedule` 的合同行结算节点，`paid_amount` 优先于 `amount`，支持分期和部分付款。服务成本汇总由 Altoc 统计服务工单和 SLA 工单数，由调用方传入 Aims/Finance 已汇总的服务项目工时与成本，按 `service_agreement_code + project_code + period + calculation_key` 幂等重算。

## 运维服务与客户成功 Phase 4 契约

Altoc 是客户成功经营事实和服务工单入口事实源；Assets 管客户系统 / 交付实例，Aims 管工单执行和缺陷 / 需求 / 变更工作项，Codocs 管运维知识正文，Finance 管维保收入和服务成本。

P4.1 已落地：
- `maintenance_contract`：维保合同 / 维保条款，关联客户、合同、交付视图、项目、产品版本、服务起止日期和续约提醒。
- `service_entitlement`：服务权益 / SLA，记录服务窗口、优先级、响应时限、解决时限、额度和计费方式。
- `service_ticket`：服务工单入口，记录报障、咨询、需求、变更，保存 Aims 工作项和 Codocs 文档 UUID 引用。
- `renewal_opportunity`：续约机会，关联维保合同、来源工单和后续 Altoc 商机。
- data-runtime 已提供上述对象的通用 CRUD 资源，并提供 `GET /api/v1/service/customers/{customerCode}/maintenance-summary` 作为跨模块客户维保摘要读取接口；Finance 等调用方必须使用 Console service token，`aud=altoc`、`scope=altoc:read`。Altoc 客户页使用本地用户态编排入口 `GET /api/v1/customers/{customerCode}/maintenance-summary`。

P1 服务协议迁移已落地：
- `service_agreement` / `service_agreement_asset` 是 P1 后的新服务覆盖事实模型，履约启动可按运维合同行生成计划服务协议，Assets 客户交付资产验收回写后会把覆盖关系切到正式 `delivery_asset_code` 并激活当前服务期内的协议。
- `031_service_agreement_ticket_sla.sql` 将可关联原合同的 `maintenance_contract` / `service_entitlement` 迁移为 `SA-MC-*` 服务协议；无资产编码的旧维保生成 `pending-maintenance-*` 覆盖占位。
- `service_ticket` 创建、更新和 Aims delivery-result 回写后会优先匹配服务协议，写回 `service_agreement_id`、`service_agreement_code`、`delivery_asset_code`、`entitlement_status`、SLA 截止时间，并在解决 / 关闭时按 ticket 额度做幂等扣减。
- 旧 `maintenance_contract` / `service_entitlement` 仍保留兼容读取和历史展示，新能力默认走 `service_agreement`。
- `service_agreement_project_rel` 由 Altoc 管理服务协议到 Aims 服务项目的绑定，字段只保存 `project_code` 不保存 / 依赖 Aims 本地 ID；设置默认项目必须经 data-runtime 事务串行化，当前有效默认项目用于服务工单项目解析。

Goal 2 起服务覆盖正式事实源收口到 `service_agreement_coverage`，旧 `service_agreement_asset` 保留为兼容回退。新模型明确区分 `source_plan_code`（Altoc计划资产）、`delivery_asset_code`（Assets正式客户交付资产）、`environment_code`（Assets正式环境）和 `legacy_reference`（需人工处理的旧引用）；计划 code 不得写入正式目标字段。Assets 回写 `sourcePlanCode/deliveryAssetCode/environmentCode/status` 后，Altoc 会把 pending 覆盖解析为正式资产或资产+环境覆盖；正式 pair 覆盖必须能在 Assets `customer_delivery_asset_environment_rel` 中解析。

新增 service endpoint：
- `GET/POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages`
- `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages/{coverageCode}:resolve|suspend|end|confirm-legacy`
- `GET /api/v1/service/service-agreement-coverages/by-environment/{environmentCode}`
- `GET /api/v1/service/service-agreement-coverages/by-delivery-asset/{deliveryAssetCode}`

P4.2 已落地：
- Aims `POST /api/v1/service/service-tickets/{ticketCode}/work-item` 可按 Altoc 工单创建或复用执行工作项。
- Altoc 用户态编排入口 `POST /api/v1/service-tickets/{ticketCode}/aims-work-item` 负责校验用户 `service_ticket:edit` 权限后调用 Aims service API；项目解析顺序为显式 `project_code`、工单已有项目、服务协议当前默认项目、旧合同项目唯一候选回退。旧合同候选无法唯一确定时返回 `project_resolution_ambiguous`，不得任选第一个项目。成功创建 / 复用 Aims 工作项后会把最终 `project_code` 回写工单并在审计日志记录来源。
- Altoc `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` 可接收 Aims 回写，更新 `service_ticket` 的 Aims 引用、处理状态、解决 / 关闭时间和 Codocs 文档 UUID；Aims service token 必须具备 `altoc:write altoc:service_ticket:delivery-result:sync`。

P4.3 / P4.4 已落地：
- Altoc 客户详情“服务运营”页签聚合展示维保合同、SLA、服务工单、续约机会、Assets 交付系统和 Finance 维保财务摘要。
- `GET /api/v1/customers/{customerCode}/delivery-package` 是 Altoc 本地用户态只读编排入口，使用 Console service token（`aud=assets`、`scope=assets:read`）调 Assets `GET /api/v1/service/deliveries/package`。
- `GET /api/v1/customers/{customerCode}/maintenance-financial-summary` 是 Altoc 本地用户态只读编排入口，先读取 Altoc 维保范围，再以 `contract_codes/project_codes` 和 Console service token（`aud=finance`、`scope=finance:read`）调 Finance 维保财务摘要。
- Codocs `POST /api/v1/service/ops-knowledge/link` 负责通过文档关系索引关联运维知识，Altoc 仅保存 / 展示 `codocs_document_uuid`。

新增代码不得把 Aims 工作项正文、Codocs 文档正文或 Finance 成本明细复制到 Altoc；客户页只能读取跨模块摘要或稳定业务键引用。

## 依赖的模块

- **Foundation**：Console OIDC 登录、共享布局、应用入口、Workflow 代理和通用运行时
- **Console Directory**：用户、部门、项目、业务领域和区域等组织/目录数据
- **Platform / Console / Foundation**：Platform 负责 manifest 与签名 bundle；Console 是运行时授权事实源；Altoc 只通过 Foundation 获取权限快照和 scoped data access，不读取本地 bundle
- **Codocs**：协作文档创建（提案/RFP/合同文档）

## 数据库

Schema 定义：`docs/altoc_schema.sql`（含迁移辅助表）

四层结构：
- 配置表（9）：industry、region、customer_level 等
- CRM 核心（7）：customer、contact、lead、opportunity 等
- 合同、交付与服务运营：contract、quotation、tender、maintenance_contract、service_entitlement、service_ticket、renewal_opportunity 等
- 财务与审计：receivable_plan、payment_record、audit_log 等；`invoice` 仅作为迁移期遗留兼容表保留，正式发票、开票申请、红冲/作废和核销以 Finance 为事实源
- AI 支持（3）：customer_ai_summary、opportunity_ai_risk 等
- 迁移辅助（2）：legacy_migration_map、legacy_unmapped_income

Altoc 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db` / Hyperdrive。所有 `/api/v1/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。`server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository、DB fallback 或 Cloudflare Hyperdrive。

## 开发注意

- API 响应统一格式：`{ code: 0, message: 'ok', data: {...} }`
- 全表软删除（`deleted_at` 字段）
- 分页上限 100 条（offset-based）
- Nuxt UI V4 语义色：primary/success/warning/error，禁止使用原色名
- ADR-016 阶段 2 起，Altoc 通过 `server/middleware/tenant-runtime.ts` 转发 `/api/v1/**` 业务路径；优先使用统一 `HZY_TENANT_RUNTIME_URL`，`HZY_ALTOC_TENANT_RUNTIME_URL` 仅作为应用级覆盖。未启用 tenant-runtime 时应显式报错，不允许回退本地 DB handler。
