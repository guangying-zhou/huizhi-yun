# Altoc Data Model

## 1. 文档信息

* 文档名称：Altoc 数据模型说明
* 当前版本：v0.1
* 文档状态：草案
* 更新时间：2026-03-17
* 对应文档：`docs/Altoc_PRD.md`

## 2. 文档目的

本文件用于定义 Altoc MVP 及后续扩展的核心业务对象、关键字段、对象关系和设计约束，作为数据库设计、接口设计和权限设计的基础。

本文件当前聚焦：

* MVP 一期 P0 核心对象
* 少量 P1 AI 辅助对象
* 为二期投标、交付和续约预留扩展位

## 3. 设计原则

* 所有核心对象使用统一主键 `id`
* 所有业务单据使用独立业务编号 `code`
* 统一支持创建人、更新人、创建时间、更新时间
* 关键业务对象统一支持状态字段 `status`
* 关键业务对象统一支持归属组织和归属人
* 所有关键状态流转和金额变更保留操作日志
* 尽量通过关联对象表达业务关系，避免冗余复制

## 4. 通用字段约定

### 4.1 基础字段

适用于绝大多数业务表：

* `id`
* `code`
* `name`
* `status`
* `owner_user_id`
* `owner_dept_id`
* `created_by`
* `updated_by`
* `created_at`
* `updated_at`
* `deleted_at`
* `remark`

### 4.2 审计字段

关键对象额外建议支持：

* `version_no`
* `last_status_changed_at`
* `last_status_changed_by`

### 4.3 金额字段

涉及金额的对象统一建议包含：

* `currency_code`
* `amount_tax_inclusive`
* `amount_tax_exclusive`
* `tax_rate`

## 5. 核心对象总览

MVP 核心对象：

* customer
* contact
* customer_invoice_info
* lead
* opportunity
* opportunity_contact_role
* opportunity_stage_log
* sales_activity
* sales_task
* product
* quotation
* quotation_item
* quotation_version
* contract
* contract_payment_term
* receivable_plan
* invoice
* payment_record
* dashboard_snapshot

组织与团队对象：

* sales_team
* sales_team_member

基础配置对象：

* industry
* region
* customer_level
* customer_type
* opportunity_stage
* payment_term_template
* approval_rule
* role
* permission
* user_role

辅助对象：

* activity_ai_summary
* customer_ai_summary
* opportunity_ai_risk
* operation_log

## 6. 核心实体说明

### 6.1 customer

#### 用途

客户主数据，承接企业客户、政府客户、事业单位、国企和渠道伙伴。

#### 关键字段

* `id`
* `code`
* `name`
* `short_name`
* `customer_type_id`
* `industry_id`
* `region_id`
* `customer_level_id`
* `source_type`
* `status`
* `owner_user_id`
* `website`
* `address`
* `description`
* `is_partner`
* `credit_level`
* `last_follow_up_at`

#### 业务约束

* `name` 在有效客户范围内建议唯一
* 必须有 `owner_user_id`
* 删除建议采用软删除

### 6.2 contact

#### 用途

客户联系人，记录客户组织内关键角色。

#### 关键字段

* `id`
* `customer_id`
* `name`
* `gender`
* `dept_name`
* `job_title`
* `mobile`
* `phone`
* `email`
* `wechat`
* `decision_role`
* `influence_level`
* `is_key_contact`
* `status`
* `owner_user_id`

#### 业务约束

* 必须关联 `customer_id`
* 同一客户下联系人姓名 + 手机组合建议唯一

### 6.2.1 customer_invoice_info

#### 用途

客户开票资料，记录购方名称、税号、开户地址、电话、开户行、银行账号和收票信息，用于客户详情维护和后续开票申请默认带出。

#### 关键字段

* `id`
* `customer_id`
* `taxpayer_name`
* `taxpayer_no`
* `registered_address`
* `registered_phone`
* `bank_name`
* `bank_account`
* `invoice_type`
* `invoice_email`
* `receiver_name`
* `receiver_phone`
* `receiver_address`
* `is_default`
* `status`

#### 业务约束

* 必须关联 `customer_id`
* 当前客户详情页按单条默认开票信息维护

### 6.3 lead

#### 用途

销售入口信息，用于承接早期机会并形成转化链路。

#### 关键字段

* `id`
* `code`
* `name`
* `org_name`
* `source_type`
* `source_detail`
* `contact_name`
* `contact_mobile`
* `contact_email`
* `status`
* `owner_user_id`
* `score`：runtime 维护的规则型线索评分（0-100），由客户对象、需求摘要、联系人/证据、负责人、下一步行动、预算信号、采购计划和来源可信度加权计算；普通 CRUD 不接受客户端直接写入。
* `next_action`
* `next_action_due_at`
* `last_follow_up_at`
* `invalid_reason`
* `converted_customer_id`
* `converted_opportunity_id`
* `converted_at`

#### 状态建议

* `new`
* `pending_assign`
* `following`
* `converted`
* `closed_invalid`

### 6.4 opportunity

#### 用途

商机对象，是 Altoc 的核心经营对象。

#### 关键字段

* `id`
* `code`
* `name`
* `customer_id`
* `lead_id`
* `stage_id`
* `forecast_category`
* `status`
* `amount_tax_inclusive`
* `amount_tax_exclusive`
* `currency_code`
* `expected_sign_date`
* `expected_payment_date`
* `win_rate`
* `owner_user_id`
* `pre_sales_user_id`
* `delivery_user_id`
* `next_action`
* `next_action_due_at`
* `risk_level`
* `risk_reason`
* `competitor_info`
* `key_contact_complete_rate`
* `won_at`
* `won_reason_code`
* `won_reason`
* `lost_at`
* `lost_reason_code`
* `lost_reason`
* `pause_reason_code`
* `pause_reason`

#### 状态建议

* `active`
* `won`
* `lost`
* `paused`

#### 预测分类建议

* `pipeline`
* `best_case`
* `commit`

### 6.4.1 opportunity_contact_role

#### 用途

记录同一联系人在具体商机中的角色、影响力和态度，用于支持项目型销售中的干系人地图。

#### 关键字段

* `id`
* `opportunity_id`
* `contact_id`
* `role`
* `influence_level`
* `attitude`
* `is_primary`
* `remark`
* `created_by`
* `updated_by`
* `created_at`
* `updated_at`
* `deleted_at`

#### 角色建议

* `decision_maker`
* `economic_buyer`
* `sponsor`
* `procurement`
* `technical_influencer`
* `end_user`
* `competitor_supporter`

### 6.5 opportunity_stage

#### 用途

销售阶段配置表。

#### 关键字段

* `id`
* `code`
* `pipeline_code`
* `name`
* `stage_kind`
* `sort_no`
* `is_closed`
* `is_won`
* `is_lost`
* `required_fields_json`
* `exit_criteria_json`
* `is_enabled`

### 6.6 opportunity_stage_log

#### 用途

记录商机阶段流转历史。

#### 关键字段

* `id`
* `opportunity_id`
* `from_stage_id`
* `to_stage_id`
* `changed_by`
* `changed_at`
* `change_reason`
* `amount_snapshot`
* `forecast_category_snapshot`
* `expected_sign_date_snapshot`
* `win_rate_snapshot`
* `version_no`

### 6.7 sales_activity

#### 用途

沉淀销售活动过程和纪要信息。

#### 关键字段

* `id`
* `code`
* `activity_type`
* `subject`
* `customer_id`
* `contact_id`
* `opportunity_id`
* `activity_at`
* `participants_json`
* `content`
* `result_summary`
* `next_action`
* `next_action_due_at`
* `owner_user_id`
* `status`

#### 活动类型建议

* `visit`
* `call`
* `demo`
* `meeting`
* `tender`
* `memo`

### 6.8 sales_task

#### 用途

销售任务与待办管理。

#### 关键字段

* `id`
* `code`
* `name`
* `related_type`
* `related_id`
* `assignee_user_id`
* `due_at`
* `status`
* `priority`
* `content`
* `completed_at`

#### 状态建议

* `todo`
* `doing`
* `done`
* `canceled`
* `overdue`

### 6.9 product

#### 用途

报价产品 / 服务目录。

#### 关键字段

* `id`
* `code`
* `name`
* `product_type`
* `specification`
* `unit`
* `standard_price`
* `cost_price`
* `tax_rate`
* `status`

#### 类型建议

* `software`
* `service`
* `implementation`
* `maintenance`
* `hardware`

### 6.10 quotation

#### 用途

报价主单据。

#### 关键字段

* `id`
* `code`
* `quotation_no`
* `customer_id`
* `opportunity_id`
* `version_no`
* `status`
* `valid_until`
* `discount_rate`
* `gross_margin_rate`
* `amount_tax_inclusive`
* `amount_tax_exclusive`
* `currency_code`
* `approved_at`
* `approved_by`
* `sent_at`
* `accepted_at`
* `expired_at`
* `owner_user_id`

#### 状态建议

* `draft`
* `pending_approval`
* `approved`
* `rejected`
* `sent`
* `accepted`
* `expired`
* `voided`

### 6.11 quotation_item

#### 用途

报价明细项。

#### 关键字段

* `id`
* `quotation_id`
* `product_id`
* `item_name`
* `specification`
* `unit`
* `quantity`
* `unit_price`
* `discount_rate`
* `cost_price`
* `tax_rate`
* `amount_tax_inclusive`
* `amount_tax_exclusive`
* `sort_no`

### 6.12 quotation_version

#### 用途

记录报价版本快照，支持历史对比。

#### 关键字段

* `id`
* `quotation_id`
* `version_no`
* `snapshot_json`
* `created_by`
* `created_at`

### 6.13 contract

#### 用途

合同主单据。

#### 关键字段

* `id`
* `code`
* `contract_no`
* `name`
* `customer_id`
* `opportunity_id`
* `quotation_id`
* `status`
* `sign_date`
* `effective_date`
* `end_date`
* `amount_tax_inclusive`
* `amount_tax_exclusive`
* `gross_margin_rate`
* `currency_code`
* `payment_term_summary`
* `retention_rate`
* `owner_user_id`
* `approval_status`
* `approved_at`
* `approved_by`
* `terminated_at`
* `completed_at`

#### 状态建议

* `draft`
* `pending_approval`
* `approved`
* `rejected`
* `effective`
* `completed`
* `terminated`
* `invalid`

#### 生命周期写入约束

`status`、审批时间/人员、拒绝原因、生效/完成/终止时间、最后状态变更时间/人员等生命周期字段不得通过普通合同 CRUD 写入。合同提交审批和完成通过 `/api/v1/contracts/:id/status`，审批通过/驳回通过 `/api/v1/contracts/:id/approve`，履约环节通过 `/api/v1/contracts/:id/stages`，异常强制完成/终止/作废通过 `/api/v1/contracts/:id/management`。

### 6.14 contract_payment_term

#### 用途

合同付款条款明细，是回款计划生成基础。

#### 关键字段

* `id`
* `contract_id`
* `term_name`
* `term_type`
* `sort_no`
* `amount`
* `ratio`
* `condition_desc`
* `expected_date`

#### 类型建议

* `advance`
* `milestone`
* `acceptance`
* `retention`

### 6.15 receivable_plan

#### 用途

应收 / 回款计划节点。

#### 关键字段

* `id`
* `code`
* `contract_id`
* `payment_term_id`
* `customer_id`
* `opportunity_id`
* `plan_name`
* `plan_type`
* `status`
* `amount`
* `planned_invoice_date`
* `planned_payment_date`
* `received_amount`
* `unreceived_amount`
* `overdue_days`
* `risk_level`
* `owner_user_id`

#### 状态建议

* `pending`
* `to_invoice`
* `to_receive`
* `partially_received`
* `received`
* `overdue`
* `bad_debt`

### 6.16 invoice

#### 用途

发票记录，用于开票和回款核对。

#### 关键字段

* `id`
* `code`
* `receivable_plan_id`
* `contract_id`
* `invoice_no`
* `invoice_type`
* `invoice_amount`
* `invoice_date`
* `status`
* `taxpayer_name`

#### 状态建议

* `draft`
* `requested`
* `issued`
* `canceled`

### 6.17 payment_record

#### 用途

到账记录与核销基础。

#### 关键字段

* `id`
* `code`
* `receivable_plan_id`
* `contract_id`
* `customer_id`
* `received_amount`
* `received_at`
* `payer_name`
* `bank_account`
* `note`
* `confirmed_by`

### 6.18 dashboard_snapshot

#### 用途

缓存经营看板关键统计结果，可按日或按周期聚合。

#### 关键字段

* `id`
* `snapshot_date`
* `scope_type`
* `scope_id`
* `metric_key`
* `metric_value`
* `dimension_json`

## 7. 基础配置对象

### 7.1 industry

* `id`
* `code`
* `name`
* `sort_no`
* `is_enabled`

### 7.2 region

* `id`
* `code`
* `name`
* `parent_id`
* `sort_no`
* `is_enabled`

### 7.3 customer_level

* `id`
* `code`
* `name`
* `sort_no`
* `is_enabled`

### 7.4 customer_type

* `id`
* `code`
* `name`
* `is_partner_type`
* `is_enabled`

### 7.5 payment_term_template

* `id`
* `code`
* `name`
* `template_json`
* `is_enabled`

### 7.6 approval_rule

* `id`
* `code`
* `rule_type`
* `rule_name`
* `condition_json`
* `approver_scope_json`
* `is_enabled`

#### 规则类型建议

* `quotation_discount`
* `quotation_margin`
* `contract_amount`
* `expense`

### 7.7 role

* `id`
* `code`
* `name`
* `description`
* `is_system_role`

### 7.8 permission

* `id`
* `resource_code`
* `action_code`
* `description`

### 7.9 user_role

* `id`
* `user_id`
* `role_id`
* `scope_type`
* `scope_id`

## 8. AI 辅助对象

### 8.1 customer_ai_summary

#### 用途

客户 AI 摘要缓存。

#### 关键字段

* `id`
* `customer_id`
* `summary_text`
* `highlights_json`
* `generated_at`
* `model_name`

### 8.2 opportunity_ai_risk

#### 用途

商机 AI 风险分析结果。

#### 关键字段

* `id`
* `opportunity_id`
* `risk_level`
* `risk_tags_json`
* `risk_reason`
* `suggested_next_action`
* `generated_at`
* `model_name`

### 8.3 activity_ai_summary

#### 用途

销售纪要结构化结果。

#### 关键字段

* `id`
* `sales_activity_id`
* `structured_json`
* `generated_at`
* `model_name`
* `confirmed_by_user`
* `confirmed_at`

## 9. 日志与审计对象

### 9.1 operation_log

#### 用途

记录关键对象操作和状态变化。

#### 关键字段

* `id`
* `object_type`
* `object_id`
* `action_type`
* `before_json`
* `after_json`
* `operator_user_id`
* `operated_at`

#### 动作类型建议

* `create`
* `update`
* `status_change`
* `approve`
* `reject`
* `delete`

### 9.2 domain_event_outbox

领域事件 Outbox。runtime 领域命令在同一事务中写入事件，供后续事件发布器或跨模块编排消费。

当前已使用事件：

* `LeadConverted`：线索转商机后写入，事件键为 `altoc.lead.converted:{lead_id}`。

核心字段：

* `event_key`：业务幂等事件键，唯一。
* `event_type`：事件类型。
* `aggregate_type`
* `aggregate_id`
* `payload_json`
* `status`
* `attempts`
* `available_at`
* `published_at`
* `last_error`

## 10. 对象关系说明

### 10.1 主关系链

* `lead` 0..1 -> 1 `customer`
* `lead` 0..1 -> 1 `opportunity`
* `customer` 1 -> n `contact`
* `customer` 1 -> 0..1 `customer_invoice_info`
* `customer` 1 -> n `opportunity`
* `opportunity` 1 -> n `sales_activity`
* `opportunity` 1 -> n `quotation`
* `quotation` 1 -> n `quotation_item`
* `opportunity` 0..1 -> n `contract`
* `contract` 1 -> n `contract_payment_term`
* `contract` 1 -> n `receivable_plan`
* `receivable_plan` 1 -> n `invoice`
* `receivable_plan` 1 -> n `payment_record`

### 10.2 AI 关系链

* `customer` 1 -> n `customer_ai_summary`
* `opportunity` 1 -> n `opportunity_ai_risk`
* `sales_activity` 1 -> n `activity_ai_summary`

## 11. 索引建议

### 11.1 高频查询索引

customer：

* `name`
* `owner_user_id`
* `industry_id`
* `region_id`

lead：

* `status`
* `owner_user_id`
* `source_type`
* `last_follow_up_at`

opportunity：

* `customer_id`
* `owner_user_id`
* `stage_id`
* `forecast_category`
* `expected_sign_date`
* `status`

quotation：

* `customer_id`
* `opportunity_id`
* `status`
* `valid_until`

contract：

* `customer_id`
* `opportunity_id`
* `status`
* `effective_date`
* `end_date`

receivable_plan：

* `contract_id`
* `customer_id`
* `status`
* `planned_payment_date`
* `owner_user_id`

## 12. 权限建模建议

### 12.1 行级权限

建议关键对象支持以下权限维度：

* 仅本人
* 本部门
* 本部门及下级部门
* 全部
* 指定客户池 / 团队

### 12.2 字段级权限

建议以下字段支持单独控制可见性：

* 合同金额
* 报价毛利率
* 回款金额
* 赢率
* 风险等级

## 12A. 组织与团队模型

### 12A.1 sales_team

#### 用途

销售团队 / 商务团队 / 售前支持团队的统一管理。支持团队层级（如大区 → 区域 → 小组），是数据权限、业绩统计和审批流的组织基础。

#### 关键字段

* `id`
* `code` — 团队编码
* `name` — 团队名称
* `team_type` — 团队类型：`sales`（销售团队）/ `business`（商务团队）/ `presales`（售前支持团队）
* `parent_id` — 上级团队ID（支持层级）
* `leader_user_id` — 团队负责人（Account模块uid）
* `description` — 团队描述
* `status` — 状态：`active` / `inactive`
* `created_at`
* `updated_at`

#### 业务约束

* `code` 全局唯一
* 团队负责人必须是团队成员之一（角色为 manager 或 senior_manager）
* 支持多级层级，但建议不超过 3 级
* 团队类型决定可关联的业务对象（销售团队关联商机/客户，商务团队关联报价/合同/招投标，售前团队关联方案/演示）

### 12A.2 sales_team_member

#### 用途

团队成员关系表，记录用户在团队中的角色。一个用户可属于多个团队（如同时在销售团队和售前团队）。

#### 关键字段

* `id`
* `team_id` — 所属团队ID
* `user_id` — 用户ID（Account模块uid）
* `role` — 团队内角色：`senior_manager`（高级销售经理）/ `manager`（销售经理）/ `assistant`（助理）/ `member`（成员）
* `is_primary` — 是否主团队（用户的默认归属团队）
* `joined_at` — 加入时间
* `left_at` — 离开时间（NULL 表示在职）
* `status` — 状态：`active` / `inactive`
* `created_at`
* `updated_at`

#### 角色说明

| 角色 | 编码 | 权限范围 | 说明 |
|------|------|---------|------|
| 高级销售经理 | `senior_manager` | 团队及下级团队全部数据 | 大团队负责人，可审批重大合同 |
| 销售经理 | `manager` | 本团队全部数据 | 日常管理，审批报价和一般合同 |
| 助理 | `assistant` | 本团队全部数据（只读为主） | 协助经理处理事务，可录入但不可审批 |
| 成员 | `member` | 仅本人数据 | 一线销售/售前/商务人员 |

#### 业务约束

* 同一用户在同一团队中只能有一条 active 记录
* `is_primary = 1` 在每个用户的所有 active 记录中最多一条
* 用户离开团队时设置 `left_at` 和 `status = inactive`，不物理删除
* 团队的 `leader_user_id` 必须对应一条该团队的 `senior_manager` 或 `manager` 角色记录

### 12A.3 团队与业务对象关联

商机、客户、报价、合同等业务对象通过 `owner_user_id` 关联到用户，再通过 `sales_team_member` 关联到团队。查询逻辑：

* 查某团队的商机 = 查该团队所有 active 成员的 `owner_user_id` 对应的商机
* 经理看板 = 查该团队及下级团队所有成员的汇总数据
* 数据权限判定：用户角色为 manager/senior_manager 时可看团队数据，member 只看自己的

### 12A.4 后续扩展预留

以下能力在本轮不实现，但数据模型已兼容：

* **销售梯队/等级**：可在 `sales_team_member` 增加 `level` 字段（junior/mid/senior/expert）+ 提成系数
* **多人协作**：可增加 `opportunity_collaborator` 表（opportunity_id, user_id, role）
* **团队目标**：可增加 `sales_target` 表（team_id, user_id, period, target_amount, achieved_amount）
* **跨团队协作审批**：可在审批规则中增加团队类型条件

## 13. 扩展模型预留

### 13.1 投标管理（已实现）

投标管理通过以下三张表实现：

* `tender` — 投标项目主表
* `tender_milestone` — 投标关键节点
* `tender_member` — 投标团队成员

详细字段见 `altoc_schema.sql`。

状态流转：信息收集 → 资格审查 → 标书编制 → 投标提交 → 开标评标 → 中标(转合同) / 落标 → 落标复盘(关闭商机) / 放弃

### 13.2 项目交付扩展

建议二期增加对象：

* project
* project_milestone
* acceptance_record

### 13.3 续约与运维扩展（Phase 4 已落地最小模型）

已在 `altoc_schema.sql` 和 `docs/migrations/008_phase4_service_ops.sql` 中增加对象：

* maintenance_contract
* service_entitlement
* service_ticket
* renewal_opportunity

边界：Altoc 只保存客户成功经营事实、服务入口和跨模块引用；工单执行在 Aims，运维知识正文在 Codocs，维保收入和服务成本事实在 Finance。

## 14. 数据一致性规则

* 线索转商机后，不允许再次转化为其他主商机
* 报价接受后，若转合同，必须记录来源报价
* 合同金额调整后，回款计划需重算或提示人工确认
* 回款登记后，必须同步更新回款计划已收和未收金额
* 商机赢单后，若合同长期未创建，应提示异常
* 合同终止后，未完成回款节点需进入人工确认状态

## 15. 命名建议

### 15.1 枚举命名

* 使用英文小写下划线或短横线风格中的一种并保持统一
* 状态值建议短而稳定，不随展示文案变化

### 15.2 编号规则

建议业务编号前缀：

* 客户：`CU`
* 线索：`LE`
* 商机：`OP`
* 报价：`QU`
* 合同：`CT`
* 回款计划：`RP`
* 发票：`IV`
* 到账：`PM`

## 16. 后续输出建议

基于本文件，后续可继续生成：

* `docs/Altoc_API_Design.md`
* `docs/Altoc_Permission_Model.md`
* `docs/Altoc_DB_Schema.sql`
