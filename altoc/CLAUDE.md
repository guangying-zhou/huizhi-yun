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
- 合同生效后通过 Altoc `POST /api/v1/service/contracts/{contractCode}/activate-delivery` 编排入口推进：Altoc tenant-runtime 在激活合同、生成签约阶段回款计划的同一事务中，按每个可信 `project_plan` 冻结一条 Aims project operation 及其依赖的 milestone operation；即时请求和 scheduled drain 只领取冻结命令，使用 Console service token 调 Aims receipt executor。目标 mutation 与 receipt 同事务，source 校验 receipt 后才 checkpoint；timeout/ack 丢失使用原 operation/idempotency/hash 恢复，不再由 BFF 直接重组网络写请求。
- 合同详情页可通过 Altoc 本地 BFF 查询 Aims `GET /api/v1/service/projects/eligible-for-contract`，并将已有 Aims 项目写入 Altoc `contract_project_link` 和结构化 `contract_project_line_rel` / `contract_project_obligation_rel`；浏览器不直接持有 Aims service token。项目关系写入支持 `lines[]` 逐合同行设置 `relationType`、`allocationMethod`、`allocationRatio`、`allocatedAmount`、`plannedWorkdays`，旧 `line_codes` / `line_ids` 兼容输入仍可用。
- P1-2 起履约启动按合同行 `project_policy`、行类型、服务策略和项目模板生成多个 `project_plans`；`contract_project_link.plan_key` 保留项目分组键，`line_codes_json`、`obligation_codes_json` 仅作为兼容快照 / 回退数据。合同行 / 履约义务到 Aims `project_code` 的业务真值由 Altoc 结构化关系表负责，Finance 后续按 `project_code -> contract_line` 关系归集成本，Console 不是运行时依赖；历史成本归集查询包含 `planned` / `active` / `closed` 项目，排除 cancelled 和软删除关系。无效、跨合同或不匹配的 line / obligation 引用必须在替换旧关系前整体 400 失败。
- 履约启动包含客户交付资产步骤时，Altoc 使用 Console service token 调 Assets `POST /api/v1/service/customer-delivery-assets/plans`，把本地计划资产同步为 Assets `customer_delivery_assets` 主档，并将返回的 `delivery_asset_code` 回填到合同计划资产。
- Assets 客户交付资产进入 delivered / online / accepted 等状态后，可用 Console service token 调 Altoc `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/status:sync` 回写合同计划资产；Altoc BFF 会先用 Assets `references:resolve` 校验正式 `delivery_asset_code` / `environment_code` / pair，计划 code 只能作为 `sourcePlanCode` 定位来源，不得写入正式资产字段；`accepted` 会推进关联履约义务，并把绑定结算计划置为可结算。
- 该状态回写已升级为 `assets.delivery-asset.status-sync.v1` service command：Altoc 只接受来源 Assets 的固定 capability，在 receipt 事务中锁定 `assets_delivery_status_projection`。低 `sourceRevision` 以 `staleSkipped` 成功回执且不执行领域 mutation；同 revision 同 hash 幂等、异 hash 409；只有更高 revision 才更新计划资产、服务覆盖、义务、结算与 applied watermark。
- Altoc 可接收 Aims 验收里程碑完成后的 `POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable`，将该付款条款下的回款计划推进到 `to_invoice`。可靠主路径只接受标准 service-command envelope：Aims 来源、operation code `aims.milestone.receivable-billable.v1`、capability `altoc:receivable:mark-billable`、path/payment term、冻结合同和 idempotency identity 必须一致；业务 mutation 与 `service_command_receipt` succeeded 同事务，同键同 hash 重放不重复更新，异 hash 409。按 plan code 的旧 endpoint 不再是 Aims `review-approve` 主路径。
- Altoc 可通过 `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 从回款计划发起可靠开票链：计划行锁、审计与 `altoc.receivable.finance-invoice-request.v1` operation 同事务；固定 executor 调 Finance target receipt，返回 Finance invoice code 与确定性的 Workflow operation key。无稳定回款计划身份的合同级旧入口明确返回 410。
- Finance 核销后在自身核销事务内写 caller-owned `integration_operation`，再用冻结的 `finance.reconciliation.altoc-summary.v1` 命令调用 Altoc `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync`。Altoc 只接受来源 `finance`、固定 capability `altoc:contract:finance-summary:sync` 的签名 service-command envelope，并在同一事务刷新 `receivable_plan` 已收/未收/状态与写入 succeeded `service_command_receipt`；同键同 hash 返回原回执，异 hash 在业务 SQL 前 409。

所有跨模块写操作必须使用 Console service token 和 `Idempotency-Key` 或由请求体派生等效幂等键；Altoc 不直写 Aims、Finance、Assets 数据库。
未登记 capability 的 `/api/v1/service/**` 后缀会在 Altoc BFF 转发 tenant-runtime 前拒绝；`activate-delivery` 是用户态本地编排入口，仍按当前登录用户 `contract:edit` 和合同数据范围校验，不作为跨应用 service-only 入口。

## 成本归集与经营核算 Goal 3 契约

Altoc 是经营归集维度事实源。Goal 3 新增 `contract_line_cost_allocation`、`contract_line_profit_summary` 和 `service_cost_summary`：前者是合同行到 Aims `project_code` 的核算归因快照，可由 `contract_project_line_rel` 在合同利润重算前自动物化，也支持手工维护显式分摊规则；后两者保存可按期间重算的合同行毛利和服务成本汇总。Aims 工时明细不复制到 Altoc，Finance/People 成本单价不迁入 Altoc。

新增 tenant-runtime endpoint：
- `GET/POST /api/v1/service/contract-lines/{contractLineCode}/cost-allocations`
- `POST /api/v1/service/contract-lines/{contractLineCode}/profit-summary:freeze`
- `POST /api/v1/service/contracts/{contractCode}/profit-summary:recalculate`
- `GET /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary`
- `POST /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary:recalculate`
- `GET /api/v1/altoc/analytics/contract/{contractCode}`、`GET /api/v1/altoc/analytics/customer/{customerCode}`

成本归集强制通过 `project_code`：合同利润重算先把 `contract_project_line_rel` 中的 planned / active / closed 项目关系物化为 `contract_line_cost_allocation`；`unallocated` 仅在同一项目唯一对应一条合同行时自动视为 `direct`，同一项目对应多条合同行但没有 ratio / amount / workdays / direct 分摊时必须返回 `cost_allocation_required`，不得静默归属或平均分摊。调用方必须传入显式项目成本快照，项目确实 0 成本也要以 `projectCosts` 明确传 0，避免缺失成本被当作 0 入账。合同收入来自 `contract_billing_schedule` 的合同行结算节点，`paid_amount` 优先于 `amount`，支持分期和部分付款。冻结后的合同行期间利润摘要不得重算，相关合同行分摊规则也不得通过普通编辑改写。服务成本汇总由 Altoc 统计服务工单和 SLA 工单数，由调用方传入 Aims/Finance 已汇总的服务项目工时与成本，按 `service_agreement_code + project_code + period + calculation_key` 幂等重算。

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
- `service_ticket` 创建、更新和 Aims delivery-result 回写后会优先匹配服务协议，写回 `service_agreement_id`、`service_agreement_code`、`delivery_asset_code`、`entitlement_status`、SLA 截止时间；服务协议行在额度判断/消费期间加锁，ticket/case 按累计 1、hour/hours 按 Aims 累计工时差额幂等扣减。
- 旧 `maintenance_contract` / `service_entitlement` 仍保留兼容读取和历史展示，新能力默认走 `service_agreement`。
- `service_agreement_project_rel` 由 Altoc 管理服务协议到 Aims 服务项目的绑定，字段只保存 `project_code` 不保存 / 依赖 Aims 本地 ID；设置默认项目必须经 data-runtime 事务串行化，当前有效默认项目用于服务工单项目解析。

Goal 2 起服务覆盖正式事实源收口到 `service_agreement_coverage`，旧 `service_agreement_asset` 保留为兼容回退。新模型明确区分 `source_plan_code`（Altoc计划资产）、`delivery_asset_code`（Assets正式客户交付资产）、`environment_code`（Assets正式环境）和 `legacy_reference`（需人工处理的旧引用）；计划 code 不得写入正式目标字段。Assets 回写 `sourcePlanCode/deliveryAssetCode/environmentCode/status` 后，Altoc 会把 pending 覆盖解析为正式资产或资产+环境覆盖；正式 pair 覆盖必须能在 Assets `customer_delivery_asset_environment_rel` 中解析。

新增 service endpoint：
- `GET/POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages`
- `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages/{coverageCode}:resolve|suspend|end|confirm-legacy`
- `GET /api/v1/service/service-agreement-coverages/by-environment/{environmentCode}`
- `GET /api/v1/service/service-agreement-coverages/by-delivery-asset/{deliveryAssetCode}`

P4.2 已落地：
- Aims `POST /api/v1/service/service-tickets/{ticketCode}/work-item/receive` 只接收 Altoc 标准 service-command receipt 链路并按全局 `source_ticket_code` 创建或复用执行工作项；旧 raw `.../work-item` 已退役并返回 410。
- Altoc 用户态编排入口 `POST /api/v1/service-tickets/{ticketCode}/aims-work-item` 校验用户 `service_ticket:edit`，先通过 scoped `dispatch-context` JOIN 读取可信客户/合同/维保合同/服务协议事实，再在同一事务冻结最小业务 command、dispatch 投影和 caller-owned operation。项目解析顺序为显式 `project_code`、工单已有项目、服务协议当前默认项目、旧合同项目严格唯一候选；旧合同使用 Aims `contract_match=exact&limit=2`，无法唯一确定时返回 `project_resolution_ambiguous`。operation 使用固定 target/capability/path，原 actor 仅保存在 operation delegation/audit 证据，不进入业务 command hash；目标工作项 mutation、初始回写 operation 和 receipt 同事务，Altoc 仅在精确 receipt checkpoint 后绑定项目/工作项。succeeded 同键重放不回退 pending，永久失败同键返回 409，须受控 replay 后才能重新领取。
- Altoc `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` 接收 Aims 回写，更新 Aims 引用、处理状态、首次响应 / 解决 / 关闭时间和 Codocs 文档 UUID；已绑定项目/工作项不可改写，结果 operation 使用单调 `deliveryGeneration`，较旧代际忽略，resolved/closed/cancelled 终态不会因更高 generation 非法重开。Aims service token 必须具备 kebab-case capability `altoc:service-ticket:delivery-result:sync`；明确无效、过期或已撤销 token 返回 401，Console introspection 不可用必须保留为可重试 503，不得压成永久认证失败。

P4.3 / P4.4 已落地：
- Altoc 客户详情“服务运营”页签聚合展示维保合同、SLA、服务工单、续约机会、Assets 交付系统和 Finance 维保财务摘要。
- `GET /api/v1/customers/{customerCode}/delivery-package` 是 Altoc 本地用户态只读编排入口，使用 Console service token（`aud=assets`、`scope=assets:read`）调 Assets `GET /api/v1/service/deliveries/package`。
- `GET /api/v1/customers/{customerCode}/maintenance-financial-summary` 是 Altoc 本地用户态只读编排入口，先读取 Altoc 维保范围，再以 `contract_codes/project_codes` 和 Console service token（`aud=finance`、`scope=finance:read`）调 Finance 维保财务摘要。无显式过滤时使用全部维保范围；一旦请求了合同或项目过滤，只传该显式维度的合法交集，不得用另一维全量补齐。Finance/Assets 404 视为上游不可用，不得伪装成成功空数据。
- `POST /api/v1/service-tickets/{ticketCode}/ops-knowledge` 是运维知识归档编排入口：浏览器只提交 Codocs UUID；Altoc 按 `service_ticket:edit` 数据范围重读 trusted dispatch context，先用工单行锁把 UUID 预留为 pending，并在同一事务写入 caller-owned `integration_operation`：Codocs link 与依赖它的 Assets link 各占一条单目标命令，canonical root 固定为 `altoc:ticket:{ticket}:ops-knowledge:{uuid}`，tenant/deployment/service client/request ID 只取 data-runtime 认证注入值。BFF 按 operation key 领取数据库冻结命令；worker/lease/target/capability 不接受 body 覆盖，Codocs relation、Assets document link/event 分别与各自 `service_command_receipt` succeeded 同事务；Altoc 校验 receipt 并保存 `target_receipt_id`，Assets 最终通过 `ops-knowledge:complete` 把 attempt、operation succeeded 与工单 `codocs_document_uuid` 同事务收口。同身份同 hash 重放返回原业务键，异 hash 在目标业务 SQL 前拒绝。即时请求、专属 task 和 Tenant Gateway 私有 wake 复用同一 executor；dead-letter 经 Console 稳定幂等通知并在 source CAS 确认。shared wake 必须通过内部 token + 60 秒 HMAC，event-bound runtime context 只允许 10 条/25 秒，普通 HTTP 与 `/_nitro/tasks/**` 均拒绝。managed 跨应用调用重新进入 tenant host，由 Gateway 分别解析 Codocs/Assets deployment。管理员 API 提供脱敏诊断和受控重放；可视化 UI和部署态 live acceptance 仍属 G3 后续项。

新增代码不得把 Aims 工作项正文、Codocs 文档正文或 Finance 成本明细复制到 Altoc；客户页只能读取跨模块摘要或稳定业务键引用。

## 依赖的模块

- **Foundation**：Console OIDC 登录、共享布局、应用入口、Workflow 代理和通用运行时
- **Console Directory**：用户、部门、项目、业务领域和区域等组织/目录数据；负责人/经办人姓名通过 Foundation 和 Altoc runtime 的 `console:directory-users:read` 最小共享投影解析，不给销售等人类角色附加 Console UI 权限
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

### 应收看板口径

- `GET /api/v1/dashboard/receivables` 的 `ar_quadrants` 是应收全景四象限，全部为时点存量：`plan_total`（计划总额）、`received`（已实收）、`receivable`（应收余额）、`overdue`（逾期）、`uninvoiced`（未开票，仅 `pending`/`to_invoice`）。
- 只有 `received + receivable = plan_total` 成立。`overdue` 与 `uninvoiced` 都是 `receivable` 的子集且可以重叠（已过期且未开票），任何页面或报表都不得把四个值相加或当作互斥分区。
- 四象限金额与 `overdue_breakdown` 账龄分桶必须同口径（均取 `unreceived_amount`，逾期均按 `planned_payment_date < CURDATE()` 且状态不在 `received`/`bad_debt`），否则同屏数字会互相矛盾；`dashboard_reads_test.go` 有对应断言。
- 看板每个应收聚合都必须经 `altocReceivablePlanReadScopeWhere` 应用数据范围，新增聚合要同步补 scope 断言。

### 应收计划临期通知

- `receivable_plan_due` 只通知计划当前显式 `collection_responsible_uid`，并要求 Console Directory 用户 active；`owner_user_id`、合同负责人、部门、管理员、配置和 `@all` 均不得作为 fallback。
- 发布前必须通过 Console subject eligibility 校验固定目的 `receivable:view`。拒绝、inactive 或资格服务不可用时不得发布、不得 ack，保留 checkpoint 重试；资格结果不替代当前 `collection_responsible_uid` 与 exact plan 目标页重鉴权。
- 通知事件固定为 `altoc.receivable_plan.due`，descriptor 固定为 `{resource:'receivable_plan',id:planCode}` 并与 `bizType/bizId` 完全一致。来源详情通过 `aud=altoc`、`scope=altoc:notification-details:authorize` 的 Console service token和 purpose-bound runtime actor 实时重验。
- 用户态 `GET /api/v1/payments` 与 `GET /api/v1/payments/{code}` 的对象读取范围是既有计划 owner / 合同 owner / 合同部门范围，加上当前精确 `collection_responsible_uid`；因此当前催收责任人可直接打开通知中的 exact code URL。写入、确认到账和手工逾期扫描仍使用原 owner / 合同范围，催收责任关系本身不授予写权限；管理员旁路继续由 `receivable/payment/receivable_plan/contract admin` 或全量数据范围显式提供。
- 通知详情授权与普通目标页读取是两个方向不同的合同：前者仍只允许“当前直接催收责任人 + 仍可催收状态”，不得因计划 owner、合同 owner、部门或 admin 身份放行；责任切换后旧 UID 立即失效。
- 可靠扫描使用 `/v1/altoc/service/notifications:scan-due|acknowledge|acknowledge-closure`，支持 phase supersession、责任人变化、发布 ack 丢失和 closure ack 丢失重放。旧 `payments/scan-overdue` 只保留状态标记，不再发布聚合通知。
- `HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED` 默认 `false`；关闭时必须在 runtime binding、token 和网络访问前短路。Cloudflare cron 仅在显式启用且 endpoint、tenant、deployment、Altoc service client ID 完整时渲染。

- API 响应统一格式：`{ code: 0, message: 'ok', data: {...} }`
- 全表软删除（`deleted_at` 字段）
- 分页上限 100 条（offset-based）
- Nuxt UI V4 语义色：primary/success/warning/error，禁止使用原色名
- ADR-016 阶段 2 起，Altoc 通过 `server/middleware/tenant-runtime.ts` 转发 `/api/v1/**` 业务路径；优先使用统一 `HZY_TENANT_RUNTIME_URL`，`HZY_ALTOC_TENANT_RUNTIME_URL` 仅作为应用级覆盖。未启用 tenant-runtime 时应显式报错，不允许回退本地 DB handler。

## 产品反馈接入（PC17，开发中）

`GET/POST /api/v1/service-tickets/{ticketCode}/product-request` 由本地 BFF 处理，按当前用户工单 edit 和对象范围读取预览／冻结首次提交；POST 仅收 expectedSourceSha256。046 迁移的 service_ticket_product_feedback 与 caller operation 同事务创建，后续工单编辑不重建已提交需求。AIMS 接收 capability 固定 aims:product-request:create-from-feedback；服务工单 priority 不转为产品优先级。当前尚缺反馈 executor／checkpoint／页面，202 仅表示源侧受理，不能作为 AIMS 已创建的证据。正式启用仍依赖完整跨应用验收。
