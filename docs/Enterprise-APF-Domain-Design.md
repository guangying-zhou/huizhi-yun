# Altoc / People / Finance：统一业务库新 Schema 与领域设计（APF M1-设计）

日期：2026-10-03。状态：设计稿，待用户审阅；未改代码、未动环境、未提交。依据 `.git/brief-apf-m1-design-20261003.md`、[整合计划](./Enterprise-Altoc-People-Finance-Integration-Plan.md)、[M0 盘点](./Enterprise-APF-M0-Inventory.md)（§13 生产只读核查、§14 用户决定）、现有三域 Runtime 适配器与 canonical schema、[ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md) §4、[ADR-018a](./ADR-018a-Fold-Aims-Codocs-Into-Enterprise.md) D11、[Aims-Workflow 同库事务设计](./Aims-Workflow-Unified-Transaction-Design.md) B1–B3。配套 DDL 草案：[Enterprise-APF-Domain-Design.sql](./Enterprise-APF-Domain-Design.sql)。

## 0 前提与总体决定

用户决定（2026-10-03）：三域历史数据**全部不迁移**，`hzy_altoc` / `hzy_people` / `hzy_finance` 冷存档只读保留；数据结构可以重新设计；暂按 **A 方案**——沿用已验证的业务规则（状态机、付款条款/开票条件、审批、职责分离、成本口径），重整表结构；规则有缺陷的单列“建议调整”（§6）由用户决定，本设计不擅自改流程。客户主数据另有外部系统，本设计只预留导入接口（§4.6），不设计从冷存档导入。

由此确定的总体决定：

| # | 决定 | 依据 |
| --- | --- | --- |
| G1 | 物理名 = 逻辑名，域前缀 `altoc_*` / `people_*` / `finance_*`，**不生成兼容视图**；Registry 域映射 logical==physical，`enterpriseviews` 对同名表不派生视图 | 无历史 SQL 消费者需要兼容；`views.go` 对 physical==logical 的表跳过视图 |
| G2 | SharedPhysicalNames 的 4 项（`integration_operation`、`integration_operation_attempt`、`integration_operation_dead_letter_actionable`、`service_command_receipt`）每域各建一套 `<domain>_` 前缀表，经 `Resolved.Table` 访问，不合并账本 | 整合计划 §8.1；`shared_names.go` 冻结名单不变 |
| G3 | 跨域引用只存稳定业务键（`uid`、`dept_code`、`project_code`、`customer_code`、`contract_code`、`contract_line_code`、`obligation_code`、`billing_schedule_code`、`invoice_code`、`receipt_code`），不建跨域 FK；域内保留 FK | 根 CLAUDE 跨模块稳定标识；ADR-018 §4.1 |
| G4 | 删除全部 `legacy_*`、迁移映射、源系统快照列和表（`altoc_legacy_migration_map`、`altoc_legacy_unmapped_income`、`finance_migration_map`、`altoc.invoice`、`altoc.payment_record`、`altoc.domain_event_outbox`、Altoc 本地 `role/permission/role_permission/user_role/approval_rule`） | 不迁移；manifest 是权限唯一事实源；Workflow 持有审批规则；`integration_operation` 取代 outbox |
| G5 | 单一发票事实源：`finance_invoice`；Altoc 不再有发票表，合同/客户页面经 Finance typed 只读入口读取发票与摘要 | M0 §13 C10 双来源问题；ADR-018 §4.3 |
| G6 | `receivable_plan` 与 `contract_billing_schedule` 合并为 `altoc_billing_schedule`（结算计划）。它是 Finance 开票申请、核销回写、Aims 里程碑 mark-billable、应收催收通知的唯一 Altoc 目标对象；Finance 的 `receivable_plan_code` 列改名 `billing_schedule_code` | 两表语义重叠且各自维护状态与金额（§2.3.4） |
| G7 | 共享事务只用于计划 §9.1 列出的链；锁序固定为 **People → Altoc → Aims → Assets → Finance → Workflow**（域内按 §2.6 表序，同表按 id 升序），正反向调用都遵守，不按请求方向翻转 | ADR-018 §4.5；同库事务设计 §4.3；整合计划 §7.3 |
| G8 | People → Console Directory 继续用 outbox（`people_integration_operation`，`target_app=console`），不进入共享事务 | Console 独立安全库；整合计划 §5/§9.1 |
| G9 | 保留各域现有命名风格（People 复数 `people_employees`，Finance/Altoc 单数）以最大化 SQL 复用；只对未带前缀的 Finance 表加前缀 | §3 复用对照 |
| G10 | 通用列：`row_version INT UNSIGNED NOT NULL DEFAULT 1` 乐观锁、`created_by/updated_by/created_at/updated_at(DATETIME(3))`、需软删的表有 `deleted_at`；金额 `DECIMAL(18,2)`、比例 `DECIMAL(8,4)`、`currency_code CHAR(3) NOT NULL DEFAULT 'CNY'` | 统一口径，便于通用 CRUD 适配器 |

**生产事实约束（M0 §13）**：生产统一库只有 aims/assets 两域；Altoc 13 表只在 hzy0；存量合同全部单行、无项目关联、到账从未核销、People 无审批定义。因此多行/多项目/核销链只能用合成样本验收；hzy0 的 13 表只读安装必须在新域安装前显式回滚（§5.4）。

## 1 三域领域模型与表设计

### 1.1 批次标记

| 标记 | 含义 |
| --- | --- |
| **B1** | 首批：Finance 参数/账户 + Altoc 客户/报价/合同主链。DDL 在配套 SQL 中完整给出 |
| B2 | M2 其余：People 员工/任职/职级/成本设置；Altoc 线索/商机/活动/团队/字典；合同到项目 |
| B3 | M3：Finance 开票/到账/核销/支出/申请/审批映射；Finance→Altoc 摘要共享事务 |
| B4 | M4：成本/快照/绩效/贡献/报表 |
| B5 | M5：Altoc 投标/服务运营/反馈/知识；People HR 来源/入离职异常；剩余任务 |

### 1.2 Altoc 域

权威职责：客户、联系人、开票资料、线索、商机、报价、合同及其行/条款/义务/结算计划、项目关联、服务运营、投标。不持有发票、到账事实。

#### 1.2.1 表清单与变化

| 新物理表 | 批次 | 来源表 | 结构变化（相对 canonical） |
| --- | --- | --- | --- |
| `altoc_customer_type` / `altoc_customer_level` | B1 | 同名 | 加 `is_enabled`、审计列 |
| `altoc_payment_term_template` | B1 | 同名 | 加审计/乐观锁 |
| `altoc_contract_business_template` | B1 | 同名 | 不变 |
| `altoc_catalog_item` | B1 | `product` | 改名“商业目录项”；去 legacy 列；加 `product_code`（Assets 产品主档引用）、`product_origin`。产品主档归 Assets（ADR-018 §4.3），这里只保存商务口径（价、税、单位） |
| `altoc_customer` | B1 | `customer` | 去 `legacy_*`、`legacy_stats_json`；`owner_user_id`→`owner_uid`；加 `source_system`/`external_ref`/`external_synced_at`（导入接口预留，§4.6）、`workflow_instance_id`、`approved_at/by`、`row_version`；唯一键 `(source_system, external_ref)` |
| `altoc_contact` | B1 | `contact` | 加稳定 `code`（CN-）；去 legacy、`star_level` |
| `altoc_customer_invoice_profile` | B1 | `customer_invoice_info` | 改名；加稳定 `code`（Finance 开票申请冻结引用）；允许一客户多条资料、**一条有效默认**（生成列 `default_slot` 唯一） |
| `altoc_quotation` / `altoc_quotation_item` / `altoc_quotation_version` | B1 | 同名 | item 加 `line_no` 唯一、`catalog_item_id`；version 加 `snapshot_sha256` 与 `(quotation_id, version_no)` 唯一；quotation 加 `workflow_instance_id` |
| `altoc_contract` | B1 | `contract` | 去 `prime_amount/invoiced_amount/executed_amount/source_contract_type/legacy_*`；`lock_version`→`row_version`；`owner_user_id`→`owner_uid`；保留 `status + legal_status + fulfillment_status + financial_status + activation_status`（见建议调整 A-07） |
| `altoc_contract_party` | B1 | `contract_party` | 不变 |
| `altoc_contract_line` | B1 | `contract_line` | 加 `row_version`；`catalog_item_code`、`product_code` 语义见上 |
| `altoc_contract_payment_term` | B1 | `contract_payment_term` | 加稳定 `code`（PT-）、`contract_line_id`（行级条款）、`currency_code`、`trigger_type`（统一枚举）、`trigger_obligation_id`、`invoice_required`、`row_version`；原 `trigger_stage_type` 保留为 `stage_completed` 的子类型 |
| `altoc_contract_obligation` | B1 | `contract_obligation` | 去 `source_ref_id`（只保留 code）；`evidence_document_uuid` 改 CHAR(36)；加 `row_version` |
| **`altoc_billing_schedule`** | B1 | `contract_billing_schedule` + `receivable_plan` | 合并（§2.3.4）。加 `payment_term_id`、`recurrence_period`、`invoiced_amount`、`received_amount`、生成列 `unreceived_amount`、`is_overdue/overdue_days`、`collection_responsible_uid`、`billable_at/billable_source`、`finance_synced_at`；去 `paid_amount`、`finance_plan_code`、`customer_id`、`opportunity_id` |
| `altoc_contract_stage` | B1 | `contract_stage` | 不变（合同级环节事实） |
| `altoc_contract_project_link` | B1 | 同名 | 去 `line_codes_json`/`obligation_codes_json`/`contract_line_id`/`obligation_id`（关系一律用两张 rel 表），加 `row_version` |
| `altoc_contract_project_line_rel` / `altoc_contract_project_obligation_rel` | B1 | 同名 | 不变 |
| `altoc_contract_orchestration_job` / `_step` | B1 | 同名 | job 加 `job_key` 幂等、`plan_sha256`；step 加 `target_domain`、`result_biz_code`，`operation_id` 可空（同库共享事务时不再经 operation） |
| `altoc_document_link` / `altoc_attachment` / `altoc_audit_log` | B1 | 同名 | 去 legacy；audit 加 `entity_code`、`channel`（D11 通道标记） |
| `altoc_integration_operation` / `_attempt` / `_dead_letter_actionable` / `altoc_service_command_receipt` | B1 | 共享账本 | 仅加前缀 |
| `altoc_lead` / `altoc_lead_conversion` / `altoc_opportunity` / `altoc_opportunity_stage` / `altoc_opportunity_stage_log` / `altoc_opportunity_contact_role` / `altoc_sales_activity` / `altoc_sales_task` / `altoc_sales_team` / `altoc_sales_team_member` | B2 | 同名 | 去 legacy；`owner_user_id`→`owner_uid`；加 `row_version`；`converted_customer_id/opportunity_id` 保留域内 FK |
| `altoc_billing_schedule_notification_checkpoint` | B3 | `altoc_receivable_notification_checkpoint` | `source_type` 改 `billing_schedule`，FK 指向新表 |
| `altoc_contract_line_cost_allocation` / `altoc_contract_line_profit_summary` / `altoc_service_cost_summary` | B4 | 同名 | 不变 |
| `altoc_contract_delivery_asset_plan` / `altoc_service_agreement` / `_asset` / `_coverage` / `_project_rel` / `altoc_maintenance_contract` / `altoc_service_entitlement` / `altoc_service_ticket` / `altoc_service_ticket_product_feedback` / `altoc_product_feedback_status_projection` / `_progress_projection` / `altoc_assets_delivery_status_projection` / `altoc_renewal_opportunity` / `altoc_tender` / `_agency` / `_member` / `_milestone` | B5 | 同名 | 去 legacy，加 `row_version`；服务协议 `service_agreement_asset` 只在 coverage 回填完成前保留 |
| `altoc_dashboard_snapshot` | B5 | 同名 | 可选，经营概览缓存 |
| 删除 | — | `invoice`、`payment_record`、`legacy_migration_map`、`legacy_unmapped_income`、`domain_event_outbox`、`role`、`permission`、`role_permission`、`user_role`、`approval_rule`、`notification`、`customer_ai_summary`、`opportunity_ai_risk`、`activity_ai_summary` | 发票/到账归 Finance；权限归 manifest；审批规则归 Workflow；站内通知归 Console；AI 摘要属新需求另立 |

#### 1.2.2 首批核心表的键与索引（摘要，完整见 SQL）

| 表 | 主键/业务键 | 关键索引 | 并发/完整性 |
| --- | --- | --- | --- |
| `altoc_customer` | `id`；`uk code`；`uk (source_system, external_ref)` | `normalized_name`、`unified_social_credit_code`、`organization_domain`（去重匹配）、`(owner_uid,status)`、`(owner_dept_code,status)` | `row_version`；去重由领域校验（lead_matching 规则复用） |
| `altoc_contract` | `uk code` | 五条状态轴各一索引、`(customer_id, legal_status)`、`(owner_uid, legal_status)` | 状态变更先 `SELECT … FOR UPDATE`（`lockContractTx` 复用），`row_version` 校验 |
| `altoc_contract_line` | `uk code`；`uk (contract_id, line_no)` | `(contract_id, sort_no, id)`、`product_code` | 行变更后 `recalculateContractLineTotalsTx` 回写合同金额 |
| `altoc_contract_payment_term` | `uk code` | `(contract_id, sort_no)`、`contract_line_id`、`(trigger_type, trigger_stage_type)` | `CHECK amount>=0, ratio∈[0,100]` |
| `altoc_contract_obligation` | `uk code` | `(contract_id, sort_no)`、`(status, planned_due_at)`、`(owner_uid, status)` | `version_no` 每次状态变更 +1（现有行为） |
| `altoc_billing_schedule` | `uk code`；`uk (payment_term_id, recurrence_period, obligation_id)` 防重复派生 | `(contract_id, due_date)`、`(status, due_date)`、`(collection_responsible_uid, status, due_date)` | `unreceived_amount` 生成列；`CHECK` 金额非负；催收责任人 CHECK 复用 |
| `altoc_contract_project_link` | `uk (contract_id, project_code, project_role)` | `project_code`、`(contract_id, plan_key)` | 结构关系全量替换走 `syncContractProjectStructuredRelationsTx` |

### 1.3 Finance 域

权威职责：参数与字典、账户与余额快照、开票申请、正式发票、到账、核销分配、支出与三类申请、审批映射、项目核算与成本分摊、绩效金额口径、审计。

| 新物理表 | 批次 | 来源表 | 结构变化 |
| --- | --- | --- | --- |
| `finance_subject` / `finance_income_type` / `finance_expense_type` / `finance_subject_mapping` / `finance_accounting_object` | **B1** | 同名 | 加 `row_version`、审计列；`accounting_object` 去 legacy，加 `uk (source_app, source_code)` |
| `finance_people_cost_parameter` | **B1** | 同名 | 加 `row_version`、`CHECK` 生效区间/非负；同一时点只允许一条 active（领域写入校验，People 读取 `effective_date` 命中） |
| `finance_bank_account` / `finance_account_balance_snapshot` | **B1** | 同名 | 去 legacy；账号只存 `account_no_secret_ref`（Console Vault） |
| `finance_audit_log` | **B1** | 同名 | 加 `channel` |
| `finance_integration_operation*` / `finance_service_command_receipt` | **B1** | 共享账本 | 仅加前缀 |
| `finance_invoice_request` | B3 | `invoice_request` | 加前缀；`receivable_plan_code`→`billing_schedule_code`；加 `invoice_profile_code`、`currency_code`、`issued_by`、`idempotency_key`（唯一） |
| `finance_invoice` | B3 | 同名 | `uk invoice_no`；加 `billing_schedule_code`、`reconciled_amount` + 生成列 `unreconciled_amount`、`reversal_of_invoice_id`、`reversed_*`、`issued_by`；`invoice_file_url`→`invoice_file_key`（不存签名 URL）；去 `source_refs_json`/legacy |
| `finance_receipt` | B3 | 同名 | `receivable_plan_code`→`billing_schedule_code`；`handler_user_id`→`handler_uid`；`unreconciled_amount` 改生成列；`CHECK reconciled<=received`；默认 `status='draft'`（建议调整 F-03） |
| `finance_reconciliation` | B3 | 同名 | 加 `target_type`、`billing_schedule_code`、`currency_code`、`idempotency_key`（唯一）、`reconciled_by`、`row_version`；`CHECK` 撤销字段一致性 |
| `finance_expense` | B3 | 同名 | `handler_user_id`→`handler_uid`、`sales_owner_uid` 不变；去 legacy；加 `row_version`；`source_request_type/code` 保留（三类申请 → 台账） |
| `finance_unclassified_income` | B3 | 同名 | 去 `project_legacy_id`/legacy |
| `finance_expense_claim` / `finance_expense_claim_item` | B3 | `expense_claim(_item)` | 加前缀；`applicant_user_id`→`applicant_uid`；加 `row_version` |
| `finance_project_expense_request` / `_item` | B3 | `project_expense_request(_item)` | 同上 |
| `finance_payment_request` | B3 | `payment_request` | 同上；`payee_account_secret_ref` 保留 |
| `finance_approval_instance` / `finance_approval_callback_log` | B3 | `external_approval_instance` / `approval_callback_log` | 加前缀；instance 加 `logical_app_code`（altoc/finance）记录审批组归属 |
| `finance_contract_summary` | B3 | 同名 | 可重建读模型；加 `billing_schedule_count`、`input_sha256`；去 `synced_to_altoc_at`（回写改共享事务，§2.4） |
| `finance_notification_checkpoint` | B3 | 同名 | `source_type` 枚举改 `invoice_request/finance_receipt` 对应新表名 |
| `finance_project_summary` | B4 | `project_finance_summary` | 改名；保留 `cost_readiness_*`、`cost_input_hash` |
| `finance_project_cost_allocation` | B4 | `project_cost_allocation` | 加前缀；`currency_code` 改 NOT NULL（新数据无“历史未知”） |
| `finance_employee_cost_snapshot` | B4 | `employee_cost_snapshot` | 加前缀；`cost_source` 枚举去 `hrm`；加 `people_snapshot_code` 引用 People 快照 |
| `finance_employee_contribution` / `finance_performance_rule` / `finance_employee_performance` / `finance_performance_calculation_snapshot` | B4 | `employee_finance_contribution` / `performance_rule` / `employee_finance_performance` / `performance_calculation_snapshot` | 加前缀；`employee_performance` 加 `people_cycle_code` 引用 |
| `finance_product_cost_attribution_head` / `_revision` | B4 | 同名 | 加前缀 |
| `finance_attachment` | B3 | 同名 | 加 `file_sha256`、`deleted_at` |
| 删除 | — | `finance_migration_map` | 不迁移 |

### 1.4 People 域

权威职责：员工事实、任职（有效日期）、岗位/职级字典、职级设置、入离职事项、月度成本快照、绩效周期与贡献快照、Directory 投影水位。

| 物理表 | 批次 | 结构变化 |
| --- | --- | --- |
| `people_positions` / `people_ranks` | B2 | 加 `row_version`；ranks 加 `uk (rank_series, rank_level)` |
| `people_standard_cost_rates`（职级设置） | B2 | **去掉** `direct_labor_cost/benefit_cost/management_allocation_cost/resource_allocation_cost/other_allocation_cost/monthly_standard_cost/source_*`（“历史兼容”分量，无迁移即无用途）；`rank_code` 改 NOT NULL 并建 FK；月标准成本只在快照中计算与保存 |
| `people_employee_number_sequences` | B2 | 不变 |
| `people_employees` | B2 | 去 `monthly_standard_cost` 冗余列（成本只在快照）；`dept/position/rank` 六列明确为“当前有效主任职派生缓存”；加 `row_version` |
| `people_employee_private_facts` | B2 | 不变（敏感字段只经 `employees:admin` 掩码读取） |
| `people_assignments` | B2 | 加 `superseded_by_assignment_code`、`idempotency_key`（唯一）、`row_version`、`CHECK effective_to>=effective_from`；主任职区间排他仍由领域写入在员工行锁下校验（`changePrimaryAssignment` 规则复用） |
| `people_onboarding_cases` / `people_offboarding_cases` / `people_offboarding_tasks` / `people_offboarding_notification_checkpoint` | B2 基础，B5 异常路径 | `object_version` 统一改名 `row_version`（API 仍表达 `vN`，CAS 语义不变）；其余 CHECK 全部保留 |
| `people_cost_snapshots` | B4 | 加 `finance_parameter_code`、`calculation_json`、`input_sha256`、`confirmed_by`；`actual_cost` 改可空（无来源不写 0）；`cost_source` 枚举去 `employee_standard/assignment` |
| `people_performance_cycles` / `people_contribution_snapshots` / `people_contribution_scope_versions` | B4 | 加 `row_version`；cycles 加 `confirmed_by/closed_by` |
| `people_directory_lifecycle_versions` | B2 | 不变（Directory 投影单调水位） |
| `people_documents` / `people_connector_sync_receipts` | B2/B5 | 不变 |
| `people_integration_operation*` / `people_service_command_receipt` | B2 | 仅加前缀（原表无前缀） |

## 2 消除已知问题的模型

### 2.1 单一发票事实源

- 正式发票只存在于 `finance_invoice`；`invoice_no` 全局唯一；红冲为新建红字票 `status='red_reversed'`+`reversal_of_invoice_id` 指向蓝票（蓝票同时置 `red_reversed`，沿用 `RedReverseInvoice` 的状态规则，只是增加了指针）。
- Altoc 合同/客户页面的“发票”“财务摘要”经 Finance typed 只读入口 `finance.ReadContractInvoices(contractCode, scope)` / `ReadContractSummary` 读取；范围与字段披露由 Finance 按 `invoices:view` 和合同关系复核（ADR-018 §4.4）。Altoc 不复制发票行。
- `altoc_billing_schedule.invoiced_amount/received_amount/status` 是 Finance 共享事务回写的**汇总**，不是发票明细；它们只用于合同侧状态展示与催收，金额对账以 Finance 为准。

### 2.2 合同主链一致模型

```
altoc_contract 1─n altoc_contract_line
                1─n altoc_contract_payment_term（contract_line_id 可空 = 合同级）
                1─n altoc_contract_obligation（contract_line_id 可空）
                1─n altoc_billing_schedule（payment_term_id / obligation_id / contract_line_id 可空）
                1─n altoc_contract_project_link ─n altoc_contract_project_line_rel ─1 contract_line
                                               ─n altoc_contract_project_obligation_rel ─1 obligation
```

派生规则（沿用 `ensureContractObligationBillingPlanTx` / `insertDefaultObligationsForLineTx` / `insertDefaultBillingScheduleForLineTx` / `insertBillingSchedulesForLegacyPaymentTermsTx`）：

1. 合同行创建时按 `line_type` 默认策略生成义务（`defaultObligationTypeForLine`）与一条结算计划（`trigger_type=obligation_accepted` 或 `obligation_completed`，取决于 `acceptance_required`）。
2. 付款条款派生结算计划：`term_type=annual_service/recurring` 按 `recurrence_*` 为每个期间生成一条（`recurrence_period` 参与唯一键）；其它条款生成一条，`trigger_type` 由 `trigger_stage_type` 映射（`contract_signed`→`contract_signed`；`delivery`→`stage_completed`；`acceptance/service_end`→`obligation_accepted` 或 `stage_completed`，当条款绑定 `trigger_obligation_id` 时用前者）。
3. 多行：条款与义务都可挂行；结算计划的 `contract_line_id` 继承自条款或义务；合同金额 = 行合计，条款 `ratio` 的基数为“行金额”（行级）或“合同金额”（合同级）。
4. 多项目：一个合同 n 个 `project_link`；每个 link 通过 `line_rel` 声明覆盖哪些行及分摊方式（`unallocated/direct/ratio/amount/workdays`），通过 `obligation_rel` 声明承接哪些义务。Aims 里程碑 ↔ 结算计划以 `billing_schedule_code` 关联（§4.1）。
5. 验收口径（计划 §4）：至少一份多合同行合同 + 多个项目计划 + 条款到里程碑关系，用合成样本验证。

### 2.3 状态机（沿用现有代码）

#### 2.3.1 合同（`contract_commands.go`）

| 动作 | 允许的当前 status | status → | legal_status → | fulfillment → | activation → | 所需人员动作 |
| --- | --- | --- | --- | --- | --- | --- |
| submit | draft, rejected | pending_approval | pending_approval | not_started | not_planned | contract:edit |
| withdraw | pending_approval | draft | draft | not_started | not_planned | contract:edit |
| approve | pending_approval | approved | approved | not_started | ready | contract:approve |
| reject | pending_approval | rejected | draft | not_started | not_planned | contract:approve |
| mark_signed | approved, effective | effective | effective | in_progress | ready | contract:edit |
| suspend | effective | effective | suspended | blocked | ready | contract:edit |
| close_fulfillment | effective, suspended | completed | closed | fulfilled | completed | contract:edit |
| terminate | 非 terminated/invalid/closed | terminated | terminated | cancelled | completed | contract:edit |

`financial_status` 由结算计划汇总维护：`unplanned`→`planned`（首个计划）→`invoicing`（任一计划进入 invoicing/invoiced）→`partially_received`→`received`（全部 received/cancelled）→`bad_debt`。合同环节 `completeContractStage` 规则保留：`contract_signed` 需 approved 或运行中；`delivery/acceptance/service_end` 需运行中；完成环节使合同级条款派生的计划变 `billable`。

#### 2.3.2 履约义务（`contract_obligations.go`）

| 动作 | 允许的当前状态 | 目标 | 副作用 |
| --- | --- | --- | --- |
| start | not_started, rejected, blocked | in_progress | — |
| submit | in_progress, rejected | submitted（需验收）/ completed（无需验收） | 触发 `obligation_completed` 计划 → billable |
| accept | submitted, completed | accepted | 触发 `obligation_completed`、`obligation_accepted` 计划 → billable |
| reject | submitted | rejected | — |

`waived/cancelled` 由合同终止或人工豁免写入（现有 `waiver_reason`）。

#### 2.3.3 报价（`quotation_commands.go`）

`draft/rejected --submit--> pending_approval --approve/reject--> approved/rejected`；`approved --send--> sent --accept--> accepted`；`expired/voided` 由到期扫描或人工作废。批准与发送时固化 `altoc_quotation_version`。转合同要求 `approved/accepted`（`ensureQuotationConvertible`）。

#### 2.3.4 结算计划（合并后）

```
planned ──(义务提交/验收、环节完成、Aims 里程碑验收、人工 mark-billable)──> billable
billable ──(Finance 开票申请创建，共享事务)──> invoicing
invoicing ──(正式发票 issue)──> invoiced        （invoice_required=0 时 billable 直接可核销）
invoiced/billable ──(核销分配，received_amount>0)──> partially_received ──(received>=amount)──> received
任一非终态 ──(人工)──> bad_debt / cancelled
```

- 前置条件复用：开票申请只允许 `billable/invoicing/partially_received`（原 `to_invoice/to_receive/partially_received`），`received/bad_debt/cancelled` 拒绝；申请金额默认 `unreceived_amount`（原规则）。
- `overdue` 不再是状态（原 `receivable_plan` 用状态表达逾期会覆盖进度，见建议调整 A-05）；逾期扫描只写 `is_overdue/overdue_days/risk_level`。
- `received_amount` 只由 Finance 核销共享事务回写（§2.4），人工不得直接改。

#### 2.3.5 Finance 单据

- 开票申请：`draft --submit--> pending_approval --Workflow approved--> approved --issue--> issued`；`rejected/canceled`。issue 仅接受 `approved`，重复 issue 幂等返回原发票（`IssueInvoiceRequest` 规则）。`assign-issuance` 只允许 `approved` 且未开票。
- 发票：`issued --red_reverse--> red_reversed`；`canceled` 不可红冲。只有 `issued` 可被核销。
- 到账：`draft --confirm--> confirmed --核销--> partially_reconciled/reconciled`；`canceled`。
- 核销分配：`active --void--> reversed`（原地，不删除）。
- 报销/项目支出/付款申请：`draft --submit--> pending_approval --approved/rejected`；`approved --pay/confirm--> paid`（生成 `finance_expense`）；`canceled`。付款确认职责分离复用 `payment_confirmation_duty_separation.go`（制单人 ≠ 确认人，比较已落库 `applicant_uid/handler_uid/created_by` 与受信 actor）。审批职责分离复用 `requireApprovalDutySeparation`（至少一名批准者 ≠ 申请人；申请人自行取消不算审批）。

### 2.4 核销模型：到账分配、撤销、精度、并发、幂等

模型：**一笔到账 → n 条分配行（`finance_reconciliation`）→ 每行一个目标**（`target_type`：`invoice` / `billing_schedule` / `contract` / `advance` / `unclassified` / `manual`）。到账与发票各自维护 `reconciled_amount` 汇总列，`unreconciled_amount` 为生成列。

| 要求 | 设计 |
| --- | --- |
| 精度 | 全部 `DECIMAL(18,2)`；Go 侧沿用 `moneyStringValue` 的字符串/定点处理，SQL 用 `SUM()` 与 `DECIMAL` 比较；**不再**用 `float64 + 0.000001` 判定全额（建议调整 F-01，必改） |
| 分配上限 | 同一事务内：`SUM(active) + amount <= receipt.received_amount` 且 `<= invoice.unreconciled_amount`（或结算计划 `unreceived_amount`）；超出 400 `amount_exceeded`（现有错误码） |
| 并发 | 固定锁序（G7）：`altoc_billing_schedule`（如有目标）→ `finance_receipt FOR UPDATE` → `finance_invoice FOR UPDATE` → 插入分配行 → 在同一事务重算两张汇总列 → 写审计。撤销同序。同一到账的并发分配被行锁串行化；`row_version` 用于乐观更新 |
| 幂等 | `finance_reconciliation.idempotency_key` 唯一：优先取 `Idempotency-Key`，缺省由 `receipt_code + target_type + target_code + amount + reconciled_at(日)` 派生；同键返回原行（不重复分配），同键异参 409 |
| 撤销 | `VoidReconciliation`：锁分配行 → 置 `reversed` → 重算汇总 → 若目标是结算计划，同事务回退 `received_amount` 与状态。撤销后金额与状态可再次分配 |
| 到账状态 | `confirmed`（0 分配）→ `partially_reconciled`（0 < 分配 < 到账）→ `reconciled`（分配 = 到账）；撤销可回退 |
| 跨域回写 | 分配/撤销的目标含 `billing_schedule_code` 时，在同一事务内调用 Altoc owning 入口 `altoc.ApplyFinanceSettlementTx(tx, scheduleCode, delta)` 更新 `received_amount/status/finance_synced_at` 与合同 `financial_status`；这取代 `finance.reconciliation.*.altoc-summary.v1` 的可靠操作（计划 §9.1）。`finance_contract_summary` 在同事务重算或标记脏后异步重建 |
| 多币种 | 分配行 `currency_code` 必须等于到账与目标币种；不同币种拒绝（无换算规则，计划 §6.5.5） |

### 2.5 People 员工 / 任职 / 岗位职级 / 标准成本与有效日期

- `people_assignments` 是任职事实，`effective_from/effective_to` 闭区间；`is_primary=1` 的记录对同一员工在任一日期至多一条有效（`approval_status IN ('none','approved')`）。写入规则复用 `changePrimaryAssignment`：员工行锁 → 冲突的未来主任职（非 Directory bootstrap）409 `people_assignment_change_future_conflict` → 截断当前主任职 `effective_to = new.effective_from - 1` → 插入 → 更新员工派生缓存（`updateEmployeeFromAssignmentChange`）→ 若已生效则冻结 Directory 投影（§4.4）。
- 未来生效任职：允许存在，但 Directory 投影、成本快照、权限范围只取“查询日期有效”的记录（`effectivePrimaryAssignmentsByEmployee(asOf)`）。
- `people_standard_cost_rates` 按 `effective_from/effective_to` 分版本；匹配顺序复用现有 SQL：`enabled=1 AND rank_code=? AND (position_code IS NULL OR =?) AND (employment_type IS NULL OR =?) AND (cost_center_code IS NULL OR =?) AND effective_from<=asOf AND (effective_to IS NULL OR >=asOf) ORDER BY effective_from DESC, sort_order, id DESC LIMIT 1`。
- 月标准成本公式（`calculateRankStandardCost`，不变）：`monthly = base_salary + rank_salary + performance_midpoint + welfare + management + resource`，其中 `welfare = (base+rank+mid)*welfare_rate`，`management = (base+rank+mid+welfare)*management_rate`，`resource = resource_allocation_cost`；参数来自 `finance_people_cost_parameter` 的 `effective_date` 命中项（经 Finance typed 只读入口，不再经 Service API）。

### 2.6 成本快照与历史口径

- `people_cost_snapshots (employee_uid, period_month)` 唯一；生成时写入 `standard_rate_code`、`finance_parameter_code`、`assignment_code`、六个 `*_snapshot` 列、`calculation_json`（全部输入值与各分量、公式版本 `std_cost_formula_v1`）和 `input_sha256`。
- 重算：输入摘要相同则不改行；不同且 `confirmed_at IS NULL` 则覆盖并记录审计；已确认快照不可被重算覆盖（只能新建 `cost_basis='manual_adjusted'` 的调整，见 §6 D-03）。
- Finance 项目人力成本（`finance_project_cost_allocation`，`allocation_type='labor'`）读取 Aims 已审核 `time_entries`、People 月末有效主任职/职级设置、Finance 参数与工作日历，沿用 `SyncProjectLaborCosts` 的 `expectedInputHash` 前置条件与 `not_ready` 语义；`finance_employee_cost_snapshot` 保留 `people_snapshot_code` 指回 People 快照。两套快照职责不同（People 留档 / Finance 分摊），不合并（计划 §9）。

### 2.7 固定锁序表（G7 展开）

| 序 | 域 | 表（按序） |
| --- | --- | --- |
| 0 | Registry | generation SHARE 栅栏（`BeginWorkflowWriteTransaction` 同机制） |
| 1 | People | `people_employees` → `people_assignments` → `people_offboarding_cases` → `people_offboarding_tasks` → `people_performance_cycles` |
| 2 | Altoc | `altoc_customer` → `altoc_contract` → `altoc_contract_line` → `altoc_contract_obligation` → `altoc_billing_schedule` → `altoc_contract_project_link` → `altoc_service_ticket` |
| 3 | Aims | `aims_projects` → `milestones` → `work_items` → `work_item_completion_requests` → `time_entries` |
| 4 | Assets | `asset_offboarding_recovery_cases` → `customer_delivery_assets` |
| 5 | Finance | `finance_invoice_request` → `finance_invoice` → `finance_receipt` → `finance_reconciliation` → `finance_contract_summary`（contract_code 升序） → `finance_project_summary` |
| 6 | Workflow | `flow_instances` → `flow_tasks` → `flow_actions` |
| 7 | 各域 `*_service_command_receipt` / `*_integration_operation`（最后取得） |

实现上扩展 `internal/enterprise` 的锁序 helper（现 `LockCompletionObjects` 固定 Aims→Workflow），新增可选域组，顺序由 helper 决定，调用方只提供 ID；缺行返回 `ErrCompletionObjectMissing` 映射 404/409。事务内禁止 Console、Workflow Node、OSS、通知等网络 IO；Directory、日历等外部事实在事务前预读并冻结版本。

### 2.8 可靠操作与回执

沿用共享约定：每域 `<domain>_integration_operation`、`_attempt`、`_dead_letter_actionable`、`<domain>_service_command_receipt`，列定义与现有 DDL 相同。继续经 outbox 的链：People→Console Directory、People/Altoc/Finance→通知、仍独立的 Workflow 审批提交与回调、Altoc→Assets（尚未同库部分）。被共享事务取代的操作码（`finance.reconciliation.*.altoc-summary.v1`、`altoc.contract-activation.aims-project.v1` 的同库部分、`aims.milestone.*.mark-billable`）不再生成新 operation；进程内 typed 调用的审计行带 `channel='in_process'`（D11 §9.4）。

## 3 现有规则复用对照

复用程度：**直接复用**（逻辑不变，最多改表名常量）/ **改表名**（SQL 表名、列名机械替换）/ **重写查询**（关系或字段语义变化，需要改 SQL 与测试）/ **新实现**。

| 沿用的规则 | 现有代码 | 新表/字段落点 | 复用程度 |
| --- | --- | --- | --- |
| 合同状态机、四轴联动、`already_applied` 幂等、submit 校验 | `altoc/contract_commands.go` | `altoc_contract.status/legal_status/fulfillment_status/activation_status` | 改表名（`lock_version`→`row_version`） |
| 合同环节完成与派生计划 | `contract_commands.go completeContractStage`、`service_receivables.go generateReceivablePlansForStageTx` | `altoc_contract_stage` → `altoc_billing_schedule` | 重写查询（目标表合并） |
| 合同草稿/行 CRUD、行号、金额汇总、父子合同、主合同标志、报价转合同 | `contract_lines.go` | `altoc_contract`、`altoc_contract_line`、`altoc_quotation*` | 改表名 |
| 义务状态机与 billable 触发 | `contract_obligations.go` | `altoc_contract_obligation`、`altoc_billing_schedule` | 改表名 |
| 默认义务/结算计划派生、旧付款条款派生 | `contract_obligations.go insert*Tx`、`insertBillingSchedulesForLegacyPaymentTermsTx` | `altoc_contract_payment_term` → `altoc_billing_schedule` | 重写查询（统一 `trigger_type`，去 `finance_plan_code`） |
| 项目关联全量替换、行/义务关系推断、分摊方法 | `contract_project_relations.go` | `altoc_contract_project_link` + 两张 rel | 改表名（去 `*_codes_json` 回退分支） |
| 履约启动编排（项目/里程碑/资产/服务协议计划） | `contract_activation*.go`、`enterprisecontracts/activation.go` | `altoc_contract_orchestration_job/step`；Aims 同库时走 owning Tx | 重写查询（同库部分改 caller-Tx，外部部分仍 operation） |
| 回款计划开票前置、申请金额默认、幂等序号 | `service_receivables.go prepareReceivablePlanInvoiceRequest`、`receivable_invoice_operation.go` | `altoc_billing_schedule` → `finance_invoice_request`（同库共享事务） | 重写查询 |
| Aims 里程碑验收 → mark-billable | `milestone_receivable_receipt.go`、`markReceivablePlansBillableByPaymentTermTx` | 以 `billing_schedule_code` 定位 | 重写查询（键由 `payment_term_id` 改为 code） |
| 应收催收唯一责任人与到期通知 | `receivable_responsibility.go`、`receivable_due_notifications.go` | `altoc_billing_schedule.collection_responsible_uid`、`altoc_billing_schedule_notification_checkpoint` | 改表名 |
| 客户/联系人/开票资料命令、去重匹配 | `adapter.go`、`lead_matching.go`、`service_receivables.go saveCustomerInvoiceInfo` | `altoc_customer`、`altoc_contact`、`altoc_customer_invoice_profile` | 改表名（多资料默认槽需补一条分支） |
| 线索/商机/报价/投标/服务命令 | `lead_commands.go` 等 | B2/B5 同名表 | 改表名 |
| 文档/附件、审计 | `document_commands.go`、`insertAltocAuditTx` | `altoc_document_link`、`altoc_attachment`、`altoc_audit_log` | 改表名 |
| 开票申请创建/issue/assign-issuance，`trusted_actor_required` | `finance/write_invoice_requests.go` | `finance_invoice_request`、`finance_invoice` | 改表名（`receivable_plan_code`→`billing_schedule_code`） |
| 审批提交元数据校验、回调、职责分离、生成支出台账 | `write_approval.go`、`approval_duty_separation_test.go` | `finance_approval_instance`、三类申请表、`finance_expense` | 改表名 |
| 付款确认职责分离（制单≠确认） | `payment_confirmation_duty_separation.go` | `finance_payment_request`、`finance_expense` | 改表名（表名常量） |
| 核销创建/发票核销/撤销/到账状态重算 | `write_custom.go CreateReconciliation / CreateInvoiceReceiptReconciliation / VoidReconciliation / updateReceiptReconciliationState` | `finance_reconciliation`、`finance_receipt`、`finance_invoice` | 重写查询（定点金额、锁序、幂等键、Altoc 同事务回写） |
| 红冲、余额快照 upsert、科目映射、员工成本 upsert | `write_custom.go` | 对应 `finance_*` | 改表名（红冲加指针列） |
| Finance 范围断言（actor HMAC 覆盖请求目标） | `runtime_auth.go`、`responsibility_access.go` | 不变 | 直接复用 |
| 项目人力成本同步、`expectedInputHash`、not_ready | `sync_project_labor.go`、`write_project_cost.go` | `finance_project_summary`、`finance_project_cost_allocation` | 改表名 |
| 产品成本归因修订 | `product_cost_*.go` | `finance_product_cost_attribution_*` | 改表名 |
| 到期通知检查点、purpose 只读复核 | `due_notification_runtime.go`、`notification_detail_authorization.go` | `finance_notification_checkpoint` | 改表名 |
| 任职变更（未来冲突、截断、派生缓存、幂等） | `people/assignment_change.go` | `people_assignments`、`people_employees` | 直接复用（表名已带前缀；加 `superseded_by` 一列写入） |
| 职级标准匹配与月成本公式、快照生成 | `cost_standard.go` | `people_standard_cost_rates`、`people_cost_snapshots` | 重写查询（去分量列；参数改 typed 读取；写 `calculation_json`） |
| Directory 生命周期冻结与单调版本 | `directory_lifecycle_*.go` | `people_directory_lifecycle_versions`、`people_integration_operation` | 直接复用（operation 表加前缀） |
| 入离职事项 CAS、任务、通知 | `onboarding_*.go`、`offboarding_*.go` | 同名表 | 改表名（`object_version`→`row_version`） |
| 绩效周期 confirm/close/Workflow 取消；贡献 replace-scope 水位 | `performance_cycles.go`、`sync.go`、`contribution_receipt.go` | 同名表 | 直接复用 |
| 员工私密字段来源优先级与掩码 | `employee_private_facts.go`、`employee_access.go` | `people_employee_private_facts` | 直接复用 |
| HR 来源部门重映射专用边界 | `hr_source_department_remap.go` | `people_employees/assignments.dept_code` | 直接复用 |
| 可靠操作 claim/lease/fencing/dead-letter/replay | `integrationoperation` 包与三域 `integration_operation_*.go` | `<domain>_integration_operation*` | 改表名（经 `Resolved.Table`） |

## 4 与其它域的接口点

### 4.1 Aims

| 方向 | 接口 | 键 | 事务分类 |
| --- | --- | --- | --- |
| Altoc → Aims | 合同履约启动创建/复用项目与里程碑（`ActivateContractDeliveryInTransaction`） | `project_code`、`plan_key`、`billing_schedule_code` | 共享事务（Altoc → Aims 锁序）；Aims 外部效果仍 outbox |
| Altoc ← Aims | 合同可关联项目列表（eligible projects）、项目名称快照 | `project_code` | typed 只读 |
| Aims → Altoc | 里程碑完成审批通过 → 结算计划 billable | `billing_schedule_code`（Aims `milestones` 需新增该列；现 `payment_term_id` 数字 ID 违反 G3，标为 Aims 侧小迁移） | 共享事务（并入 Aims+Workflow lane，Altoc 组在 Aims 之前） |
| Finance ← Aims | 已审核工时 `time_entries(review_status='approved')` 按项目/期间/uid 汇总 | `project_code`、`uid` | typed 只读，冻结输入 hash |
| People ← Aims | 周期内贡献完整集合 replace-scope | `cycle_code`、`project_code`、revision | 现有可靠操作（后续可改 caller-Tx） |
| Finance → Aims | 项目核算结果只读展示（`project_cost_summary` 不写） | `project_code` | typed 只读 |

### 4.2 Assets

| 方向 | 接口 | 分类 |
| --- | --- | --- |
| People → Assets | 离职任务 `asset_recovery_coordination` → `asset_offboarding_recovery_cases`（owning Assets 入口） | 共享事务（People → Assets）；账号停用、通知 outbox |
| Altoc → Assets | 合同计划资产 → `customer_delivery_assets`；状态回写以 revision 水位到 `altoc_assets_delivery_status_projection` | B5；同库后改 caller-Tx，之前保留 operation |
| Altoc ← Assets | 产品主档 `product_code` 名称/版本 | typed 只读 |

### 4.3 Workflow

| 审批组（逻辑 app_code） | 动作 | 单据表 | 回调 |
| --- | --- | --- | --- |
| altoc | `customer/approve`、`quotation/approve`、`contract/approve` | `altoc_customer`、`altoc_quotation`、`altoc_contract`（`workflow_instance_id`） | 整组映射到 Enterprise 接收方（计划 §7.4） |
| finance | `invoices/request`、`expenses/claim`、`expenses/project_expense`、`expenses/payment` | 四张申请表 + `finance_approval_instance` | 同上；回调必须携带批准者 uid 集合供职责分离 |
| people | `assignments/employee_onboard`、`assignments/employee_transfer`（保留）；`cost_snapshots/employee_cost_adjust`、`performance_cycles/performance_cycle_confirm`（待决定 D-03/D-04） | `people_assignments`、`people_cost_snapshots`、`people_performance_cycles` | 回调分支 `sync.go` 现有 assignment/performance_cycle |

审批实例、任务、决定归 Workflow；单据域只存 `workflow_instance_id` 与业务状态。已同库 lane 外的审批仍走冻结命令与回执。

### 4.4 Console

| 接口 | 设计 |
| --- | --- |
| Directory 投影 | People 生效任职/离职事实在 People 事务内冻结 `people_integration_operation`（`target_app=console`，操作码 `people.directory.employment-sync.v1` / `people.directory.offboarding-disable.v1`），`people_directory_lifecycle_versions` 单调 `revision_no/snapshot_hash/operation_key`；提交后投递，Directory 按命令键与版本幂等。未来生效任职不提前投影（`prepareDueDirectoryLifecycle`） |
| 目录读取 | 客户负责人、合同负责人、申请人、催收责任人等 uid，以及 `dept_code`、`industry_code/region_code` 字典，经 Foundation 目录快照只读校验存在性与 active；业务表只存 uid/code，不存姓名（展示时查询） |
| 凭证 | `finance_bank_account.account_no_secret_ref`、`finance_payment_request.payee_account_secret_ref` 指向 Console credential-vault；OSS 经 `integrationCode` adapter |
| 入职开通 | `people_onboarding_cases.reservation_id/provision_operation_id` 继续引用 Console 身份预留与建号 operation（跨进程可靠调用） |
| 权限 | 三域 manifest 的 resource/action 不变（Altoc `customer/quotation/contract/receivable…`，Finance `invoices/receipts/reconciliation/expenses/bank_accounts/settings…`，People `employees/assignments/standard_costs/cost_snapshots/performance_cycles…`）；`receivable` 资源映射到 `altoc_billing_schedule` |

### 4.5 Codocs 与文件

- 文档引用：`altoc_document_link.document_uuid`、`altoc_contract_obligation.evidence_document_uuid`、`altoc_contract_stage.document_uuid`、`people_documents.document_uuid`；内容与 ACL 由 Codocs 正式文件合同校验，业务域只存 uuid 与标题快照。
- 附件：`altoc_attachment.file_key`、`finance_attachment.file_key`、`finance_invoice.invoice_file_key` 存 OSS object key；签名 URL 按需生成，不落库。

### 4.6 客户主数据导入接口（只预留）

- 落点：`altoc_customer.source_system`（`manual` / `import:<system>`）、`external_ref`、`external_synced_at`；唯一键 `(source_system, external_ref)` 作为导入幂等键。联系人、开票资料可带同样两列（B2 时补）。
- 入口形态：Altoc typed 命令 `altoc.ImportCustomers(batch)`，输入为规范化记录（名称、统一社会信用代码、类型/等级码、负责人 uid、联系人、开票资料），逐条按 `external_ref` upsert，去重候选（`normalized_name`、`unified_social_credit_code`、`organization_domain`）命中已有手工客户时返回冲突项不覆盖；输出每条的结果与原因。批次与行级结果表（`altoc_customer_import_batch/_row`）在实现时再加，首批不建。
- 不设计从 `hzy_altoc` 冷存档导入；是否接受冷存档导出作为一个来源待用户决定（D-05）。

## 5 首批最小表集与建库/安装规格

### 5.1 首批表集（B1）

| 域 | 表 |
| --- | --- |
| Finance（9 + 4） | `finance_subject`、`finance_income_type`、`finance_expense_type`、`finance_subject_mapping`、`finance_accounting_object`、`finance_people_cost_parameter`、`finance_bank_account`、`finance_account_balance_snapshot`、`finance_audit_log`；`finance_integration_operation`、`_attempt`、`_dead_letter_actionable`、`finance_service_command_receipt` |
| Altoc（22 + 4） | `altoc_customer_type`、`altoc_customer_level`、`altoc_payment_term_template`、`altoc_contract_business_template`、`altoc_catalog_item`、`altoc_customer`、`altoc_contact`、`altoc_customer_invoice_profile`、`altoc_quotation`、`altoc_quotation_item`、`altoc_quotation_version`、`altoc_contract`、`altoc_contract_party`、`altoc_contract_line`、`altoc_contract_payment_term`、`altoc_contract_obligation`、`altoc_billing_schedule`、`altoc_contract_stage`、`altoc_contract_project_link`、`altoc_contract_project_line_rel`、`altoc_contract_project_obligation_rel`、`altoc_contract_orchestration_job`、`altoc_contract_orchestration_step`、`altoc_document_link`、`altoc_attachment`、`altoc_audit_log`；`altoc_integration_operation*`、`altoc_service_command_receipt` |

首批不含 People 表；People 域在 B2 按同一机制安装。`altoc_quotation.opportunity_id` 与 `altoc_contract.opportunity_id` 的域内 FK 在 B2 安装 `altoc_opportunity` 时以 `ALTER TABLE ADD CONSTRAINT` 补齐。

### 5.2 初始字典（seed）

| 表 | 内容 | 来源 |
| --- | --- | --- |
| `finance_subject` | 小企业会计准则科目（现 canonical 第 6 节 73 行） | `finance/docs/finance_schema.sql` |
| `finance_income_type` / `finance_expense_type` / `finance_subject_mapping` | 现 canonical 初始字典 | 同上 |
| `altoc_customer_type` / `altoc_customer_level` / `altoc_opportunity_stage`（B2） / `altoc_payment_term_template` / `altoc_contract_business_template` | 现 canonical 初始行 | `altoc/docs/altoc_schema.sql` |
| `people_positions` / `people_ranks` / `people_standard_cost_rates`（B2） | 现 canonical 15 职级与 2026 职级设置（去分量列） | `people/docs/people_schema.sql` |

seed 只初始化字典与配置，不生成业务记录；`finance_people_cost_parameter` 由财务在 UI 录入（生产冷存档只有 1 行，可人工参照）。

### 5.3 安装规格与 Registry 激活

沿用 `domaininstall` 的固定清单机制并推广为三域、profile 驱动：

1. **规格制品**：从本设计 SQL 生成 `data-runtime/internal/enterprise/domaininstall/{altoc,finance,people}.json`（`Logical=Physical`、Columns、DDL、FK 拓扑序），生成脚本 `--check` 保证与 canonical DDL 一致（同 `generate-altoc-domain-manifest.py` 方式）。共享账本 4 表由一个 DDL 模板按前缀渲染。
2. **Registry 绑定**：在现有 Binding 上新增 `altoc`、`finance` 两域（B2 加 `people`），`Tables` 全部 logical==physical，`OwnerDeployment` 与 aims/assets 相同，`read=unified`，`write/scheduler=disabled` 直到对应批次验收通过后逐项开启；`Generation` 不变；`config/enterprise.go` 已接受三域名。
3. **视图**：无新视图；`enterpriseviews.Install` 对 physical==logical 跳过。既有 Aims/Assets/Workflow 视图基线不变（验证视图数仍按冻结规格派生）。
4. **协议**：`plan`（闭集 + reviewHash：完整 Binding、DDL、既有对象定义与数据摘要）→ 隔离完整副本演练 apply/verify/rollback → 用户批准 hash → 停 Runtime 持迁移锁 apply（逐 CREATE 0600 回执）→ `verify`（对象定义、Registry、既有域摘要不变）→ 激活 proposed config → seed → 真实客户端签发探测与 grant verify（`altoc/finance:enterprise-host:execute`、`:scheduler:execute`、`:notification-detail:authorize`，data-runtime 与 tenant-runtime 双 audience）。
5. **不复制旧数据**：没有 shadow-copy / final-copy 阶段；也没有 source 水位。新 `candidate/hash` 不复用旧 C000001 两域制品。
6. **回滚**：按回执逆序 DROP 本批对象（外部 FK 或定义漂移拒绝），Registry 恢复备份；有业务写入后不再回滚 DDL，向前修复。

### 5.4 hzy0 既有 Altoc 13 表的处置

hzy0 已安装 `altoc_customer/lead/opportunity_stage/contact/contract/contract_line/contract_obligation/contract_billing_schedule/contract_payment_term/receivable_plan/opportunity/quotation/quotation_item` 13 表与 13 兼容视图（read=unified，write 关闭）。新结构同名但列不同，安装前必须：先按 `hzy-enterprise-add-altoc --mode rollback` 删除该批 13 表与视图（标记样本随之清理），确认 Registry 无 altoc 域，再执行新规格；不得在旧表上 ALTER。生产没有该批，直接安装。

## 6 建议调整与需用户决定项

### 6.1 需用户决定（D）

| # | 事项 | 现状 | 建议 |
| --- | --- | --- | --- |
| D-01 | **开票申请人 ≠ 开票人** 强制职责分离 | 不存在；只有“批准者 ≠ 申请人”和“制单 ≠ 付款确认” | 表已预留 `finance_invoice_request.requested_by/issued_by`。建议**采用**，实现为 Platform 职责冲突规则 + Finance 领域校验（issue 时 `actor != requested_by`，服务通道无 actor 时按 capability），默认启用；若不采用，字段仍保留审计用 |
| D-02 | **到账确认人 ≠ 核销人** 强制职责分离 | 不存在；到账默认创建即 `confirmed` | 与 F-03 联动：到账改为显式 confirm 后，核销校验 `actor != receipt.confirmed_by`。建议采用，同 D-01 的实现方式 |
| D-03 | People `cost_snapshots/employee_cost_adjust` 审批去留 | 已注册 Workflow 动作，无回调分支、无页面申请链、生产 0 实例 | 建议**退役**该注册；成本调整改为 `people_cost_snapshots` 上新建 `cost_basis='manual_adjusted'` 记录，要求 `cost_snapshots:approve` 人员动作（不经 Workflow）。若用户要求审批，需补申请链与回调（+3–5 人日） |
| D-04 | People `performance_cycle_confirm` 是直接确认还是必须 Workflow | 回调存在，但页面直接调 confirm/close；前端查 edit、后端要 approve 不一致；生产 0 定义 | 建议保留**直接确认**（后端 `performance_cycles:approve`，前端改为按 approve 判显示），退役 Workflow 注册；回调分支留作兼容 |
| D-05 | 客户导入接口是否接受冷存档导出作为来源之一 | 只预留 `(source_system, external_ref)` | 建议先只对接外部主数据系统；冷存档如需导入，由同一接口以 `import:hzy_altoc_archive` 作为 source_system 一次性执行，不另造迁移工具 |
| D-06 | `receivable_plan` 与 `contract_billing_schedule` 合并为 `altoc_billing_schedule`（G6） | 两表并存，Finance/Aims 引用 `receivable_plan_code`/`payment_term_id` | 建议合并（本设计默认）。影响：Finance 三表列名、Aims `milestones` 增 `billing_schedule_code`、AA-04 键改 code |
| D-07 | 商业目录 `altoc_catalog_item` 与 Assets 产品主档的关系 | Altoc `product` 自成一套 | 建议：自有产品必须填写 `product_code` 引用 Assets 主档，名称以主档为准；第三方/服务项只在目录维护 |
| D-08 | 客户开票资料允许多条（一条默认） | 现表一客户一条（唯一键 customer_id） | 建议允许多条；现有 `saveCustomerInvoiceInfo` 需补“切换默认”分支 |

### 6.2 建议调整（A = Altoc，F = Finance，P = People；用户不选择时按“默认”执行）

| # | 问题 | 建议 | 默认 |
| --- | --- | --- | --- |
| A-05 | `receivable_plan.status='overdue'` 覆盖进度状态，回款后无法恢复原状态 | 逾期改为 `is_overdue/overdue_days` 标志，不进入状态机 | 采用（DDL 已按此） |
| A-06 | `contract_project_link.line_codes_json/obligation_codes_json` 与 rel 表双轨 | 只保留 rel 表 | 采用 |
| A-07 | 合同 `status` 与 `legal_status` 两套生命周期并存（`rejected`/`completed` 只在 `status`） | 本轮保留两列（规则直接复用）；待首批验收后评估合并为 `legal_status + rejected_at` | 保留 |
| A-08 | 开票申请幂等序号依赖 `unreceived_amount` 变化（`nextReceivableInvoiceRequestKeyTx` 注释已指出） | 同库后以 `billing_schedule_code + 序号` 作为 `finance_invoice_request.idempotency_key`，前端仍可不传 Idempotency-Key | 采用 |
| F-01 | 核销汇总用 `float64` 与 `0.000001` 容差判定全额；`fmt.Sprintf("%.2f")` 写回 | 全部改 `DECIMAL`/定点字符串，SQL 内比较 | 必改 |
| F-02 | `finance_invoice.invoice_file_url` 存 URL | 存 OSS key，按需签名 | 采用 |
| F-03 | 到账创建默认 `confirmed`，无独立确认动作，`confirmed_by` 可空 | 默认 `draft`，`receipts:confirm` 显式确认后方可核销；与 D-02 配合 | 采用（若 D-02 不采用也建议采用） |
| F-04 | 红冲只改蓝票状态，无红字票记录 | 增加 `reversal_of_invoice_id`，红冲时生成红字票行 | 采用（规则不变，只多一行记录） |
| F-05 | `finance_project_cost_allocation.currency_code` 允许 NULL（历史未知） | 新库 NOT NULL | 采用 |
| F-06 | 发票 `invoice_no` 无唯一约束 | 加唯一键（允许 NULL） | 采用 |
| P-01 | `people_standard_cost_rates` 混放职级工资与“历史兼容”成本分量及预存月成本 | 只保留职级工资/绩效范围；月成本按参数计算并写入快照 `calculation_json` | 采用 |
| P-02 | `people_employees.monthly_standard_cost` 冗余且不随参数版本 | 删除；读取走当月快照或即时计算 | 采用 |
| P-03 | 绩效详情页前端 `edit` / 后端 `approve` 不一致 | 前端按 `approve` 判断；不降后端 | 采用 |
| P-04 | `object_version` 与其他域 `row_version` 命名不一 | 统一 `row_version`，API 继续表达 `vN` | 采用 |

## 7 工作量重估（无数据迁移）

单位：工程人日，口径同 M0 §10（含实现、评审修订、隔离契约/反例；不含等待窗口与观察期）。相对 M0 的变化：去掉全部迁移闭集、shadow-copy、对账与反向迁移；新增三域 DDL 审定、安装规格生成、结算计划合并带来的键改名，以及少量结构调整（F-01/F-03/F-04）。

| 工作包 | M0 估算 | 重估 | 变化说明 |
| --- | --- | --- | --- |
| WP1 三域接入/三通道/来源/回调模板 + 代表页面 | 13–21 | 12–19 | 与迁移无关；来源切换因无旧消费者可略减 |
| WP2 三域 schema → 建库/安装规格（原迁移闭集） | 11–19 | **6–10** | DDL 审定 2–3、三域 manifest 生成与 `--check` 1–2、安装工具推广到 profile/三域 2–3、隔离演练 1–2 |
| WP3 Finance 参数/账户/余额 | 6–11 | 5–9 | 无迁移联调 |
| WP4 Altoc 合同主链（客户/报价/合同/行/条款/义务/结算计划/项目关联） | 14–23 | 13–21 | 结算计划合并 +2，去迁移 −3 |
| WP5 People 员工/任职/岗位职级/入职基础 | 11–19 | 9–16 | 若 D-03/D-04 按建议退役，审批缺口不补 |
| WP6 Finance 收支/申请/审批/核销/摘要共享事务 + 重设计 | 18–28 | 16–25 | 去迁移 −3；F-01/F-03/F-04 +1 |
| WP7 成本/快照/绩效/贡献/报表 | 13–22 | 11–19 | 无历史口径对账 |
| WP8 Altoc 服务/投标/反馈/知识、People HR 来源与离职异常 | 14–24 | 12–20 | 无迁移 |
| WP9 owner 收口、故障/回滚、撤身份、文档 | 6–11 | 5–9 | 无反向迁移 |
| **合计** | **106–178** | **89–148** | |

**第一交付波次**（M1 公共模板 + Finance 参数/账户 + Altoc 合同主链 = WP1+WP2+WP3+WP4）：**36–59 人日**（M0 为 44–74）。不含：客户导入接口实现（预留后实现 3–5）、D-01/D-02 新职责分离的 Platform 冲突规则与测试（各 1–2）、D-03 若选择补审批链（3–5）。

## 8 本轮验证回执

- 只读取仓库源码与文档；未连接数据库、服务或网络；未运行应用、测试或 SQL；未提交、未推送。
- 产出文件：本文与 `docs/Enterprise-APF-Domain-Design.sql`（首批 Finance 9 表 + Altoc 25 表完整 DDL，B2 People 核心 6 表与 B3 Finance 开票/到账/核销 4 表固定结构；共享账本 4 表以注释引用现有 DDL）。
- 下一步（待用户审阅本设计与 §6 决定后）：按 §5.3 生成三域安装 manifest 与 `--check` 脚本，进入 M1 WP1/WP2 实施；任何真实环境 DDL、Registry、grant 变更另按批次申请批准。

## 9. 用户决定（2026-10-03：“按建议”）

D-01、D-02 采用（开票申请人≠开票人；到账确认人≠核销人，到账默认 draft，需显式 confirm）；D-03 退役 `employee_cost_adjust` 审批，改为 manual_adjusted 快照加 `cost_snapshots:approve`；D-04 保留直接确认，退役对应 Workflow 注册；D-05 客户导入以后再考虑（只预留接口）；D-06 合并回款计划与结算计划（Aims milestones 新增 `billing_schedule_code`）；D-08 一个客户可有多条开票资料、一条为默认。D-07（商业目录与 Assets 产品主档）不在首批，后续讨论。§6 的“建议调整”全部按默认执行。


### APF-11a 共享摘要锁序补充（2026-10-03）

Finance/Altoc 收支用例固定为 Registry generation SHARE → Altoc customer/contract/line/obligation/billing_schedule → Finance invoice_request/invoice/receipt/reconciliation → finance_contract_summary（contract_code 升序）→ finance_unclassified_income → finance_attachment → 各域 service_command_receipt/integration_operation。同表 id 升序；summary 首次创建在已锁定的 Altoc contract 下串行，非合同来源在 Finance 父对象锁下串行。读发现对象后按此序锁定并重新校验；反核销不得先锁 reconciliation 再锁 receipt。核销、撤销、开票、红冲、作废共用 caller-Tx，不调用另开事务的 adapter wrapper。外部 Console/Workflow/OSS IO 只能在事务外。

### APF-14 项目成本规则（2026-10-03 用户决定：“按建议”）

1. 关账：只允许重算未关账期间，已关账期间失败关闭；关账后需要调整时另建调整批次，不覆盖正式历史。Finance 正式关账概念和冻结信号来源随 APF-14a 明确。
2. 零工时与未审核：项目/月存在未审核工时时整月 not_ready，不只算已审核部分；真实零投入需显式“确认零投入”事实，无工时不自动当零。
3. 超标准工时：沿用旧口径，比例可大于 1，不封顶、不跨项目归一化；页面注明为标准成本而非实际薪资。
4. People 月快照：缺快照时 Finance 按冻结的任职/费率事实独立计算、暂不关联 people_snapshot_code，不隐式写 People。
5. 敏感成本：项目管理员只看项目汇总与分摊总额；个人工资/职级分量需同时具备 Finance 管理与 People standard_costs:view 的有效范围，前端不返回个人工资明细。
6. 工作日历：本批只支持 CN；入离职月按现有公式整月标准成本，首次重算说明中写明。

### APF-16 Altoc 服务运营规则（2026-10-03 用户决定：“按建议”）

1. 投标权限：映射既有 opportunity 权限；无商机的手工投标仅 opportunity:edit 可创建，不新增 tender 资源/capability。
2. 服务协议：service_agreement/coverage 为唯一新写来源；旧 maintenance_contract/service_entitlement 只读展示，不开放 confirm-legacy 通道。
3. SLA 与额度：沿用现有已验证 SLA/累计规则，不引入新工作日历或扣费规则。超额度时现有逻辑无明确规则的，按失败关闭处理：拒绝派单并提示需补充合同或额度（协调者按“建议从严”取值，可由用户另行调整）。
4. 工单重开：显式 reopen 动作、独立权限与版本校验；普通编辑和迟到回调不能重开。
5. 续约：本批只做续约记录，不一键生成商机、不自动延长覆盖；续约以新合同/新服务期表达，不改原覆盖终止日。
6. 知识归档：只关联已有且有权限的 Codocs 文档与资产，不创建/复制/发布正文，不改变公开范围。
7. 产品反馈：只做原键恢复、读取评估与进度，不支持补充证据或重新提交已拒绝需求。
8. 客户页摘要：资产/文档/财务/服务各自无权限时显示“无权限”，不泄露数量。

### APF-14a 成本锁序与关账信号（2026-10-03）

新增锁序按 MODULE_CONTRACTS.md 的 APF-14a 合同：Registry → People employee/assignment/standard_rate → Aims project/work_item/time_entries（全状态项目月范围）→ Finance参数 → 必要M3财务事实/contract_summary → project_cost_period → project_summary → employee_cost_snapshot → project_cost_allocation → 不可变cost_batch/item → receipt/operation。同表固定排序，调用方共享Tx，外部日历IO在事务外。工时使用generation栅栏下REPEATABLE READ和既有idx_project_date范围锁，14b隔离验证新增/删除/退回，不新增半覆盖的输入代次。

Finance项目/月正式冻结信号为finance_project_cost_period.closed_at/closed_by；关账仅锁定ready当前批次，禁止普通重算/零确认，后续调整另立批次，不开放reopen。显式零投入事实绑定空工时集合SHA，新增工时令其失效。未审核集合非空整月not_ready。Finance独立冻结任职/费率，People快照引用可空，不写People。当前投影和不可变历史分离，个人薪酬证据留服务端不进Host公开响应。安装候选六表不自动启用业务或环境。

#### APF-16d 实施落点（基础四操作）

新增统一库表 `altoc_renewal_opportunity`（安装规格 `altoc/docs/altoc_enterprise_renewals_schema.sql`）：客户必填、可选同客户合同、负责人/部门、续约类型、金额/预计日期、阶段/状态/风险、下一步行动与日期；row_version、同意图回执及审计。与旧维保表、商机、服务覆盖没有自动写联动。历史记录不迁移。本批不接旧 opportunity_id 字段或任何自动生成/续期命令。

### Finance 角色默认数据范围（2026-10-03 用户决定：“角色范围按建议”）

- finance:admin、finance:manager：tenant:global，仅覆盖该角色 manifest 已声明的精确资源/动作，不增加敏感动作。
- finance:expense_submitter：subject:self，仅其费用资源。
- finance:viewer：不授默认全量；仅在企业角色/任职明确给予的责任关系或精确项目范围内只读。
- 其他会计/出纳/审批/报表角色另行裁定，不随本次批量授予全局。
- 实现方式：manifest recommendedRoles[].defaultScopes + Platform materializer 写 platform_app_role_scopes；无字段保留原范围，显式空数组表示无默认范围；解析器不把无 scope 视为 all。

### APF-17 与 APF-18B 规则（2026-10-03 用户决定：“其他都按建议”）

APF-17：
- R17-01 钉钉 HR 与人工事实按字段归属：正式姓名/行政部门/在离职等下发字段归钉钉，岗位/职级/薪资/员工号及未下发字段归 People；冲突进入复核，不 last-write-wins；不清空 absent/invalid。
- R17-02 生效日与单调 revision 优先，旧快照不覆盖较新任职；HR 同步不自动批准调岗/离职。
- R17-03 资产未归还不阻断离职生效与安全撤权；回收事项保持未完成并通知责任人，不延续登录、不自动扣薪。
- R17-04 离职生效立即冻结 Console 登录与 Platform 撤权；LDAP/邮箱等已配置账号异步停用并有独立 receipt；本批不删除账号、不写回钉钉。
- R17-05 生效离职自动生成稳定 case，允许提前手动安排；须显式有效责任人（非离职人），截止时间由 HR 确认，不默认。
- R17-06 手工入职候选保持失败关闭，在 Console 办理。
- R17-07 人工恢复：hr_source_sync:admin 处理来源冲突；employees:edit 原意图重试开通；integration_operations:replay 仅固定 family；未知效果必须 probe，禁止强制成功或换键绕过。
- R17-08 部门映射 remap 未确认时阻断新 HR 同步，原键恢复后再继续。

APF-18B：
- 销售任务/下一步到期只提醒当前负责人，不自动推进或关闭商机。
- People 绩效周期审批本批不迁移，保留原 People 路径（回调已收窄，见 4a5fa619）。
- 到期提醒：应收按新 altoc_billing_schedule；开票、到账核销、离职交接、资产回收各为独立默认关闭的通知族；旧开关关闭后新 owner 才启用，同族单 owner。

Platform 发布（用户批准“含第 6 步”）：test 账号角色阶段配置为 tenant 级事实，生产以后重签时会出现在生产授权记录中（生产未部署 Finance，不生效）；备份恢复验证使用协调者本机隔离 MySQL，验证后删除副本。

### 2026-10-04 用户决定：验收夹具、临时角色与外部账号停用

- hzy0 APF 验收测试数据（CLAUDE-FIXTURE 客户/报价/合同/线索/岗位/报销/开票申请/到账/核销/台账）暂时保留，不清理。
- Platform 测试租户临时角色 132（test）、133（zhouguangying）不立即撤销，按到期时间（2026-10-10、2026-10-11）自然失效。
- 离职需要停用外部账号（LDAP、邮箱等）：作为 APF-17c 的增量 17c-ext 实施，须先定义精确 capability 与目标合同、独立回执、可恢复与幂等；按 R17-04 在离职生效后异步执行，不删除账号，不写回钉钉，不阻塞 Console/Platform 立即撤权。
- 2026-10-04 更新：外部账号（LDAP/邮箱）停用 17c-ext 暂缓，用户决定“先不管了”；不实施、不派工，盘点结论保留在 .git/report-apf17-20261003.md，待用户重新提出再启动。离职仍执行 Console/Platform 立即撤权。
