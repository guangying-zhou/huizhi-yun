# Huizhi-yun Altoc 商业合同与履约中枢 P0–P3 实施方案

> 文档状态：工程评审后修订稿，可作为产品、架构、开发、测试和实施共同使用的执行基线
> 适用企业：约 50–300 人的软件、信息化服务、系统集成及技术运营企业
> 实施重点：P0 合同核心重构；P1 项目、客户交付资产、运维服务和结算衔接；P2 采购及成本闭环；P3 全生命周期经营与智能化
> 代码基线：基于当前 `huizhi-yun` 源码、`altoc/CLAUDE.md` 和 `docs/MODULE_CONTRACTS.md` 已落地契约修订
> 修订重点：复用已落地 Aims / Assets / Finance / Workflow / Codocs service 链路；明确事实源边界；将 P0 首期收敛为合同行最小闭环，义务 / 结算 / 编排分阶段后置

---

## 1. 执行摘要

Altoc 当前合同模块已经具备合同登记、付款条款、合同状态、回款计划、维保合同以及部分 Aims、Finance 集成基础，但核心仍然是“合同头表 + 固定付款阶段”的管理方式。它尚不能稳定表达一份合同中包含的软件产品、第三方产品、硬件、定制开发、实施、运维、数据服务等多种交付内容，也无法按合同内容自动决定是否创建项目、形成客户交付资产、启动服务协议或触发采购。

本方案将 Altoc 合同管理升级为汇智云的**商业履约中枢**：

```text
商机 / 报价 / 采购需求
        ↓
      合同主档
        ↓
      合同行
        ↓
      履约义务
        ↓
┌────────┬────────────┬────────────┬────────────┐
│ Aims项目 │ Assets客户交付资产 │ 服务协议/SLA │ Finance结算 │
└────────┴────────────┴────────────┴────────────┘
        ↓
   变更、续签、终止与经营分析
```

实施策略不是一次建设一个重型 ERP，而是采用以下原则：

1. **用业务模板简化用户操作，用合同行保证模型准确。**
2. **合同只保存商业依据和履约计划，执行明细仍由各专业应用负责。**
3. **默认自动生成建议，用户只处理例外。**
4. **P0A 先结构化合同内容；P0B 再补齐履约义务和结算；P1A 再打通项目、资产、服务和结算编排。**
5. **保留现有数据和页面兼容期，避免大爆炸式切换。**

建议交付节奏修订为：

- **P0A：2–4 周**，只完成合同分类、模板、合同行、报价转合同、旧合同汇总行迁移和“产品与服务”详情展示；不引入履约义务、结算计划和编排表。
- **P0B：4–6 周**，在 P0A 稳定后完成履约义务、结算计划、状态机矩阵、领域命令硬化、禁写规则和对应工作台能力。
- **P1A：4–6 周**，基于已落地 `activate-delivery`、Aims 项目桥接、Finance 开票申请和 Assets delivery package 链路，补齐履约启动计划、编排作业、步骤状态、重试和结果展示。
- **P1B：4–6 周**，完成客户交付资产策略、服务协议兼容迁移、SLA 覆盖和采购合同最小闭环决策。
- **P2：8–10 周**，在 P1B 最小采购闭环基础上完善采购合同、框架释放、收货或服务验收、应付、销售采购穿透和实际毛利。
- **P3：按 3–4 个增量实施，每个增量约 4–6 周**，逐步交付合同变更与基线、续签终止、履约控制塔、风险治理及 AI 辅助。

完整路线预计需要 9–12 个月分阶段建设。P0、P1 是商业履约中枢的必备基础；P2、P3 应根据采购复杂度、数据质量和实际管理成熟度分批启用，避免一次建设成重型 ERP。

上述周期以约 2 名后端、2 名前端、1 名测试、1 名产品/业务分析兼职架构支持为参考，不作为固定承诺。

---

## 2. 建设目标与边界

### 2.1 建设目标

P0–P3 分阶段完成后，系统应逐步实现：

1. 一份合同可包含多种产品和服务，并能分别履约、验收和结算。
2. 报价明细可完整转换为合同行，不再在合同层丢失产品信息。
3. 软件产品、订阅、第三方产品及硬件交付可形成客户交付资产。
4. 运维服务可明确覆盖一个或多个客户交付资产，并附带 SLA 和服务权益。
5. 定制开发、实施、系统集成等内容可创建新项目或关联已有项目。
6. 不需要项目的许可销售、SaaS 续费或简单服务不会被强制建项目。
7. 合同履约进度、项目进度、资产交付和财务结算保持可追溯关联。
8. 合同生效后的跨应用操作具有幂等、重试、审计和失败恢复能力。
9. 采购合同可关联采购订单、收货或服务验收、应付计划，并支持框架额度管理。
10. 销售合同行可穿透关联采购合同、采购订单和项目成本，形成计划毛利与实际毛利对比。
11. 有效合同的金额、范围、工期、服务期和结算条件变更通过正式变更流程更新基线。
12. 续签、终止、义务逾期、维保覆盖和框架额度等风险可被提前识别并形成处理任务。
13. AI 只承担合同信息提取、差异比较和风险提示，关键数据和业务动作由人工确认。
14. 50–300 人企业可以通过预置模板、例外工作台和默认策略使用系统，无需专职合同系统管理员。

### 2.2 分阶段范围与总体边界

各阶段职责如下：

| 阶段 | 核心目标 | 主要交付 |
|---|---|---|
| P0A | 建立合同结构化最小闭环 | 合同分类、模板、合同行、报价转合同、旧合同汇总行、产品与服务页签 |
| P0B | 建立可履约的合同核心 | 履约义务、结算计划、状态机、领域命令、禁写规则、义务与结算工作台 |
| P1 | 打通销售合同履约闭环 | 项目创建或关联、客户交付资产、服务协议、Altoc 回款计划、Finance 开票/摘要衔接、可恢复编排 |
| P2 | 打通采购和成本闭环 | 采购合同、框架释放、采购订单、收货或服务验收、应付、销售采购穿透、毛利分析 |
| P3 | 建立全生命周期经营能力 | 合同变更、版本基线、续签终止、履约控制塔、风险治理、供应商绩效和 AI 辅助 |

为适应 50–300 人企业，整体方案明确不以建设重型 ERP 为目标。以下能力不作为当前路线的必备范围：

- 完整 CPQ 规则引擎和任意脚本化组合定价；
- 完整 Source-to-Pay、供应商寻源、电子招投标和供应商门户；
- 总账、多账簿、多法人合并及会计收入确认自动化；
- 自建电子签章基础设施，可通过标准接口集成第三方服务；
- 大型制造企业级仓储、生产、MRP 和复杂序列号物流；
- AI 自动作出法律判断、自动审批合同或未经人工确认直接修改业务数据；
- 为极少数例外场景建设通用低代码流程引擎。

P2、P3 应建立在 P0、P1 数据质量和执行稳定性之上。若核心合同行、履约义务、项目、资产和结算关联尚不完整，不应提前依赖高级分析或 AI 结果。

### 2.3 P0 首期拆分原则

P0 首期的目标不是一次性建完“合同履约中枢”，而是先完成一个小团队可交付、可回滚、可迁移的合同结构化最小闭环。

P0A 只新增或扩展：

```text
contract                 必要字段扩展
contract_business_template
contract_party
contract_line
```

P0A 不新增：

```text
contract_obligation
contract_billing_schedule
contract_project_link
contract_orchestration_job
contract_orchestration_step
service_agreement
service_agreement_asset
```

P0A 的完成定义是“合同能准确表达卖了什么 / 买了什么，并能从报价无损转换为合同行”。履约、结算触发、跨应用编排和服务协议迁移分别进入 P0B、P1A 和 P1B，避免首期同时改变合同创建、履约、财务、项目、资产和服务链路。

---

## 3. 当前实现基线与需要优先解决的问题

### 3.1 已存在并必须复用的能力

以下能力已经在 `altoc/CLAUDE.md` 与 `docs/MODULE_CONTRACTS.md` 中明确为已落地或冻结契约，P0/P1 不得重复建设平行接口：

1. Altoc `POST /api/v1/service/contracts/{contractCode}/activate-delivery` 已能激活合同、生成回款计划，并编排 Aims 项目创建和付款里程碑同步。
2. Aims `POST /api/v1/service/projects/from-contract`、`GET /api/v1/service/projects/eligible-for-contract` 和 `POST /api/v1/service/projects/{projectCode}/payment-milestones:sync` 已作为合同项目桥接基线；`GET /api/v1/service/projects/by-contract/{contractCode}` 仅作为兼容读接口，不作为 P1 项目选择规则。
3. Aims 可通过 Altoc service endpoint 将回款计划推进到 `to_invoice`。
4. Altoc 用户态 `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 已编排 Finance 开票申请和 submit。
5. Finance 核销后已可通过 Altoc `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync` 回传经营侧摘要。
6. Assets `POST /api/v1/service/deliveries/upsert`、`GET /api/v1/service/deliveries/package` 和 delivery document 链路已落地，可作为客户交付资产首版复用基础。
7. 运维服务 P4 已落地 `maintenance_contract`、`service_entitlement`、`service_ticket`、`renewal_opportunity` 和 Aims / Codocs / Finance 摘要链路。
8. Altoc data-runtime 已有 `contract_commands.go`、`contract_management.go`、`service_receivables.go`、`service_maintenance.go` 等命令文件，P0/P1 应优先扩展和拆分这些实现，而不是新建重复通道。

### 3.2 仍需优先解决的结构性问题

结合现有源码，以下结构性问题需要按 P0A、P0B 和 P1A 分阶段解决：

1. `contract` 主要是销售合同头表，缺少合同方向、业务主类型和合同行。
2. 报价已有 `quotation_item`，合同没有对应的 `contract_line`，报价产品信息无法延续到履约。
3. `contract_stage` 只支持签约、交付、验收、服务结束四个固定阶段，无法表达多批次、多里程碑和持续服务。
4. `maintenance_contract` 与普通合同并行，重复保存法律合同、金额、客户和周期信息。
5. 当前合同生效后倾向于自动创建一个 Aims 项目，隐含“一合同一项目”的限制。
6. Assets 客户交付视图强制依赖项目，无法支持不建项目的许可销售和订阅交付。
7. 合同完成、履约完成、开票完成和回款完成的语义混在一个状态中。
8. `force_complete` 等管理操作会补记开票或回款，不适合作为正常业务动作。
9. 合同生命周期仍可由通用 CRUD 修改，缺少完整的领域命令、状态校验和审计。
10. 已有跨应用链路缺少统一的履约计划、步骤状态、重试入口和结果展示，导致用户只能看到局部结果，不能按步骤恢复失败。

---

## 4. 面向 50–300 人企业的产品设计原则

### 4.1 模型准确，但不把技术模型全部暴露给用户

后台使用：

```text
合同主档 → 合同行 → 履约义务 → 下游执行对象
```

普通用户看到的是：

```text
选择业务模板 → 确认产品和服务 → 确认交付方式 → 确认收付款节点
```

“合同行”“履约义务”等专业概念应在需要时显示，不能要求每位销售人员理解完整领域模型。

### 4.2 模板优先，综合合同可组合

系统提供常用业务模板，用户不从空白表单开始。模板只负责生成默认内容，生成后仍可调整。

### 4.3 默认值优先，渐进式披露

- 创建时只展示必要字段；
- 高级计价、采购策略、资产策略等放在“高级设置”；
- 系统根据合同类型自动建议项目、资产、服务和结算策略；
- 用户只需确认异常项。

### 4.4 一次录入，多处复用

- 报价产品自动带入合同行；
- 合同行自动生成履约义务；
- 履约义务可映射项目里程碑；
- 产品交付自动形成客户交付资产；
- 运维行自动生成服务协议；
- 结算计划自动生成 Altoc 回款计划；采购方向在 P1B/P2 生成 Finance 应付计划或等价应付创建请求。

### 4.5 明确应用边界

Altoc 是商业履约中枢，不取代专业应用：

| 应用 | 主要职责 |
|---|---|
| Altoc | 合同主档、合同行、商业条款、履约义务、结算条件、跨应用编排 |
| Aims | 项目、工作分解、任务、工时、成本、里程碑和交付物 |
| Assets | 产品技术主档、客户交付资产、客户环境、采购订单和收货 |
| Finance | 开票申请、正式发票、到账、付款、核销、应付和财务摘要 |
| Workflow | 合同、变更、采购、付款等审批 |
| Codocs | 合同文本、版本、补充协议、验收资料和服务报告 |
| Align | 协作任务、提醒和跨部门协调 |

应用间通过稳定业务编码、服务 API 和领域事件关联，不建立跨数据库外键。

事实源边界必须按现有跨模块契约执行：

- Altoc 是客户、商机、合同、合同行、商业结算条件、回款计划和服务工单入口的事实源。
- Finance 是开票申请、正式发票、到账、核销、付款和财务摘要的事实源。
- Aims 是项目、里程碑、工作项、工时、交付物执行状态的事实源。
- Assets 是产品技术主档、客户交付视图、环境、资产、采购订单和收货的事实源。
- Codocs 是合同文本、补充协议、验收资料和运维知识正文的事实源。
- 其他模块只保存稳定业务键和必要快照，不复制主档或执行明细。

---

## 5. 合同分类与业务模板

## 5.1 后台采用多维分类

### 合同方向

```text
sales       销售合同
purchase    采购合同
```

### 协议形式

```text
single              单次合同
framework            框架合同
master               主协议
quantity_framework   数量框架合同
value_framework      金额框架合同
supplement           补充协议
change_order         变更单
renewal              续签合同
tripartite           三方协议
```

### 销售合同主类型

```text
software_license
saas_subscription
custom_development
implementation_delivery
maintenance_support
product_maintenance_bundle
third_party_resale
hardware_sales
system_integration
data_service
managed_operation
consulting_training
mixed_solution
```

### 采购合同主类型

```text
software_procurement
software_subscription_procurement
hardware_procurement
cloud_resource_procurement
data_api_procurement
outsourced_development
professional_service_procurement
maintenance_outsourcing
managed_service_procurement
framework_procurement
mixed_procurement
```

主类型用于选模板、决定默认流程和统计口径；真实履约行为由合同行决定。

## 5.2 普通用户只看到业务模板

P0 建议首批提供 8 个模板：

| 模板 | 默认合同行 | 默认下游动作 |
|---|---|---|
| 软件产品销售 | 自研软件许可 | 交付后形成客户资产；项目可选 |
| SaaS/数据订阅 | 订阅或用量服务 | 开通服务实例；通常不建项目 |
| 定制开发 | 定制开发、实施 | 必须创建或关联项目 |
| 产品+实施+维保 | 软件许可、实施、维保 | 项目 + 客户资产 + 服务协议 |
| 系统集成 | 软件、硬件、第三方产品、集成服务 | 项目必需；可产生采购需求和多项资产 |
| 运维/技术支持 | 运维服务 | 必须关联客户交付资产并生成服务协议 |
| 第三方产品转售 | 第三方软件、硬件或云资源 | 可触发采购；交付后形成客户资产 |
| 综合合同 | 用户自由组合 | 按每条合同行策略生成下游计划 |

采购侧建议首批提供 4 个模板：

```text
软件/订阅采购
硬件设备采购
外包开发/专业服务采购
采购框架合同
```

## 5.3 模板实现方式

P0 建议增加版本化 JSON 模板表，避免首期建设复杂模板设计器：

```text
contract_business_template
--------------------------
id
code
name
direction
primary_type
is_system
status
version_no
template_json
created_by
created_at
updated_at
```

`template_json` 包含：

- 默认合同行；
- 默认履约义务；
- 项目、资产、服务和采购策略；
- 默认结算节点；
- 默认必填字段；
- 推荐 Workflow 和 Codocs 模板代码。

合同创建时将模板内容复制为业务快照。合同生效后不应受模板后续修改影响。

---

## 6. P0 核心数据模型

## 6.1 合同主档 `contract`

在现有表上增量扩展，首期不重建整张表。

建议新增：

```text
direction                   sales / purchase
primary_type                合同主类型
parent_contract_id          父合同ID，用于主合同-补充协议/变更单/续签协议关系
is_master_contract          是否可作为主合同；新建时按 parent_contract_id 自动推导，编辑时支持显式维护以处理历史数据
agreement_form              协议形式
template_code               创建时使用的业务模板
primary_customer_id         销售合同主要客户
primary_supplier_id         采购合同主要供应商
legal_status                法律生命周期
fulfillment_status          履约状态
financial_status            财务状态，只读或由事件更新
activation_status           履约启动状态
source_type                 quotation/opportunity/purchase_request/manual
source_code                 来源业务编号
baseline_version_no         当前生效基线版本
lock_version                乐观锁版本
```

兼容策略：

- 保留现有 `customer_id`、`status` 等字段；
- 新代码以新字段为准；
- 兼容期由领域命令同步维护旧字段；
- 完成页面和报表迁移后再废弃旧字段。

### 关键校验

- `direction=sales` 时必须存在主要客户；
- `direction=purchase` 时必须存在主要供应商；
- 草稿可缺金额，提交审批前必须通过完整性校验；
- 有效合同的核心商业字段禁止普通 CRUD 直接修改；
- 核心修改只能通过合同变更命令处理。

## 6.2 合同参与方 `contract_party`

用于支持三方协议、付款方、最终客户、代理商和供应商等角色。

```text
contract_party
--------------
id
contract_id
party_type              customer/supplier/organization/person
party_ref_code
party_name_snapshot
role_code               buyer/seller/payer/end_customer/vendor/agent/guarantor
is_primary
contact_name
contact_mobile
contact_email
sort_no
```

为简化常用查询，合同主档仍保留主要客户和主要供应商字段。

## 6.3 合同行 `contract_line`

合同行是商业履约中枢的核心。

```text
contract_line
-------------
id
code
contract_id
line_no
line_type
name
description

catalog_item_id
catalog_item_code
product_code
product_version
product_origin             own / third_party
supplier_code
source_quotation_item_id

quantity
unit
quantity_factors_json
unit_price
amount_tax_exclusive
amount_tax_inclusive
tax_rate
planned_cost
planned_margin
currency_code

billing_method             fixed_price/time_material/subscription/
                           usage/milestone/quantity/value
fulfillment_method         point_in_time/over_time
service_start_date
service_end_date

project_policy             none/optional/required
project_template_code
asset_policy               none/planned_on_effective/
                           create_on_delivery/create_on_acceptance
service_policy             none/warranty/maintenance/managed_service
procurement_policy         none/optional/required
acceptance_required
acceptance_criteria

status
sort_no
snapshot_json
created_at
updated_at
```

### 首批合同行类型

```text
own_software_license
own_saas_subscription
third_party_software
hardware
cloud_resource
custom_development
implementation
system_integration
data_service
managed_service
maintenance_support
consulting_training
reimbursable_expense
other_fee
```

### 产品与目录的简化方案

P0 不建议立即重命名或拆分现有 `product` 表。可先将其明确为“商业产品与服务目录”，新增：

```text
item_type
default_line_type
asset_product_code
default_project_policy
default_asset_policy
default_service_policy
default_procurement_policy
```

其中 `asset_product_code` 指向 Assets 的产品技术主档。

## 6.4 履约义务 `contract_obligation`（P0B）

`contract_obligation` 不进入 P0A 首期。P0A 只在合同行 `snapshot_json` 或模板快照中保留“将来可生成义务”的策略字段，避免一开始就同时迁移履约节点、状态机和结算触发。

```text
contract_obligation
-------------------
id
code
contract_id
contract_line_id
obligation_type
name
description
fulfillment_method
planned_start_at
planned_due_at
actual_completed_at
accepted_at
acceptance_required
acceptance_criteria
status
owner_user_id
evidence_document_uuid
evidence_note
waiver_reason
sort_no
version_no
created_at
updated_at
```

状态：

```text
not_started
in_progress
submitted
accepted
rejected
completed
waived
blocked
cancelled
```

普通业务模板自动生成常见义务，例如：

- 软件许可交付；
- 许可证激活；
- 部署完成；
- 数据迁移；
- 用户培训；
- 上线；
- 初验；
- 终验；
- 月度服务；
- 服务期结束。

## 6.5 结算计划 `contract_billing_schedule`（P0B）

替代“付款条款只能关联四个固定阶段”的模式。

```text
contract_billing_schedule
-------------------------
id
code
contract_id
contract_line_id
obligation_id
direction                 receivable/payable
name
trigger_type
trigger_ref_code
amount
ratio
currency_code
expected_date
recurrence_rule_json
invoice_required
status
finance_plan_code
created_at
updated_at
```

触发类型：

```text
contract_effective
fixed_date
obligation_completed
obligation_accepted
project_milestone_completed
project_milestone_accepted
asset_delivered
asset_go_live
asset_accepted
service_period
usage_confirmed
manual_approval
```

P0A 不新增 `contract_billing_schedule`，继续使用旧 `contract_payment_term` 和既有回款计划链路，只做只读兼容和合同行金额校验。P0B 再引入“商业结算条件”和 Altoc 经营侧回款计划的结构化映射；实际开票申请、正式发票、收款、付款和核销仍由 Finance 管理。Finance 回传的合同财务摘要只能刷新 Altoc 的经营侧摘要字段或回款计划状态，不得反向改写合同商业条款。

## 6.6 合同—项目关系 `contract_project_link`（P1A）

`contract_project_link` 不进入 P0A。P0A 只在合同行保存 `project_policy` 和 `project_template_code` 等建议策略；一合同多项目、关联已有项目和义务映射项目里程碑进入 P1A。

```text
contract_project_link
---------------------
id
contract_id
contract_line_id
obligation_id
project_code
project_role              primary/delivery/development/
                          implementation/maintenance/operation/subcontract
plan_key                  履约启动项目计划键
line_codes_json           覆盖合同行编码
obligation_codes_json     覆盖履约义务编码
link_mode                 created_from_contract/linked_existing
status
created_by
created_at
```

一份合同可以关联多个项目，一个项目也可以关联主合同、补充协议或采购分包合同。

## 6.7 领域事件与编排记录（P1A）

以下编排表不进入 P0A / P0B 首期。P0B 可先通过同步领域命令维护合同、义务和结算状态；P1A 再在现有 `activate-delivery` 链路上增加可恢复编排。

```text
contract_orchestration_job
contract_orchestration_step
domain_event_outbox（复用既有领域事件表，不新增合同专用 outbox）
```

`contract_orchestration_job` 记录一次履约启动或合同变更的整体状态；`step` 记录创建项目、创建资产、创建服务协议、生成结算计划等步骤的执行结果。

状态：

```text
planned
running
partially_failed
completed
cancelled
```

每个步骤必须具备：

```text
step_key
idempotency_key
target_app
target_action
request_snapshot
result_snapshot
status
retry_count
last_error
next_retry_at
```

编排执行约束：

- P1A 先硬化现有 `activate-delivery` 链路，不引入另一套合同生效入口。
- `job` 必须有 `job_type`、`source_contract_code`、`requested_by`、`tenant/deployment`、`feature_flag_snapshot`、`started_at`、`finished_at` 和 `cancel_reason`。
- `step` 必须有 `depends_on_step_keys` 或等价依赖表达，避免资产、服务协议、结算计划在前置项目或合同行未确定时并发执行。
- worker 必须使用 lease 或等价锁字段，例如 `locked_by`、`locked_until`、`heartbeat_at`，防止多实例重复执行同一步。
- 重试必须使用指数退避或有上限的固定退避，超过最大次数后进入 `needs_manual_action` 或 `dead_letter`，并在合同详情展示可读错误。
- 幂等冲突必须返回已创建对象的稳定业务键；不得只返回“重复请求”而丢失可恢复上下文。
- 取消作业只停止未执行步骤；已成功创建的项目、资产、服务协议、Altoc 回款计划或采购应付计划通过补偿任务解除、关闭或标记，不做跨应用级联物理删除。
- 每个跨应用写步骤必须记录 `source_app`、`target_app`、`source_biz_type`、`source_biz_code`、`idempotency_key`、`request_id`、`actor_uid`、`service_client_id` 和错误映射。

---

## 7. P1 服务与客户交付资产模型

## 7.1 客户交付资产

优先增强现有 Assets 交付模型，不在 Altoc 复制资产主档。

客户交付资产定义为：

> 某个客户实际获得、部署、订阅或有权使用的产品或服务实例。

建议在 Assets 增强或新增等价对象：

```text
customer_delivery_asset
-----------------------
code
customer_code
name
product_code
product_version
catalog_item_code
product_origin
source_contract_code
source_contract_line_code
source_obligation_code
source_project_code

deployment_mode
instance_key
tenant_key
environment_code
license_model
license_quantity
capacity
unit

status
planned_delivery_at
delivered_at
go_live_at
accepted_at
expired_at
terminated_at
warranty_start_at
warranty_end_at
support_expiry_at
```

生命周期：

```text
planned → provisioning → delivered → online → accepted
                                      ↘ suspended/expired/terminated
```

### 生成规则

| 合同行 | 默认生成时机 |
|---|---|
| 软件许可 | 许可证或授权信息交付时 |
| SaaS/数据订阅 | 租户、账号或服务实例开通时 |
| 私有化部署 | 合同生效时可建计划资产，上线后激活 |
| 定制开发成果 | 交付或验收后形成资产 |
| 硬件销售 | 出库或客户签收时 |
| 第三方产品 | 许可证、序列号或服务权益交付时 |

必须取消“客户交付资产必须关联项目”的硬性要求。项目可选，但来源合同行必须可追溯。

## 7.2 服务协议 `service_agreement`

P1 将当前独立的维保合同模式逐步迁移为：

```text
统一合同
  └─ 运维/维保合同行
       └─ 服务协议
            ├─ 覆盖客户交付资产
            └─ 服务权益/SLA
```

建议新增：

```text
service_agreement
-----------------
id
code
contract_id
contract_line_id
customer_code
name
service_level
service_start_date
service_end_date
service_window
billing_mode
renewal_policy
response_minutes
resolution_minutes
included_quota
quota_unit
consumed_quota
renewal_remind_at
status
owner_user_id
maintenance_contract_id
created_at
updated_at
```

```text
service_agreement_asset
-----------------------
service_agreement_id
delivery_asset_code
coverage_type
coverage_start_date
coverage_end_date
included
exclusion_note
```

现有 `service_entitlement` 在 031 迁移中会补 `service_agreement_id`，并把主要 SLA / 额度字段折算到 `service_agreement`；更细的多优先级权益可后续继续保留在权益明细层：

- 服务窗口；
- 响应时限；
- 解决时限；
- 现场服务时限；
- 包含工时或工单数；
- 超额计费方式；
- 适用优先级；
- 升级路径；
- 排除事项。

服务工单优先关联：

```text
delivery_asset_code
service_agreement_id
service_agreement_code
entitlement_status
response_due_at
resolution_due_at
quota_consumed
```

系统应自动判断服务是否在有效期、资产是否在覆盖范围及是否需要额外收费。

---

## 8. 合同状态机

## 8.1 法律状态

```text
draft
under_review
pending_approval
approved
signing
effective
suspended
terminated
expired
closed
invalid
```

## 8.2 履约状态

```text
not_started
in_progress
partially_fulfilled
fulfilled
blocked
cancelled
```

## 8.3 财务状态

销售合同：

```text
unplanned
planned
partially_invoiced
invoiced
partially_received
received
overdue
written_off
```

采购合同：

```text
unplanned
planned
partially_invoiced
invoiced
partially_paid
paid
overdue
```

财务状态应由 Finance 或应收、应付事件更新，普通用户不可直接修改。

## 8.4 履约启动状态

```text
not_planned
planning
ready
running
partially_failed
completed
```

## 8.5 关键原则

- 履约完成不等于已全额开票或回款；
- 合同终止不等于剩余应收全部坏账；
- 正常业务流程不得自动伪造开票、回款或付款记录；
- 历史迁移补录必须使用独立的“数据迁移/财务调账”命令和权限；
- 法律、履约、财务和编排状态只能由领域命令变更。

编码前必须补齐状态转移矩阵。矩阵至少包含：

```text
当前状态
  + 命令
  + 前置校验
  + 目标状态
  + 副作用
  + 幂等行为
  + 拒绝错误码
  + 允许角色 / capability
```

旧 `contract.status` 兼容映射建议如下：

| 旧状态 | legal_status | fulfillment_status | financial_status | activation_status |
|---|---|---|---|---|
| draft | draft | not_started | unplanned | not_planned |
| pending_approval | pending_approval | not_started | unplanned | not_planned |
| approved | approved | not_started | unplanned | not_planned |
| rejected | draft | not_started | unplanned | not_planned |
| effective | effective | in_progress | planned | ready |
| completed | effective 或 closed | fulfilled | 按 Finance 摘要计算 | completed |
| terminated | terminated | cancelled 或 partially_fulfilled | 按 Finance 摘要计算 | completed |
| invalid | invalid | cancelled | unplanned | not_planned |

兼容期内 `contract.status` 只能由领域命令同步维护，不能再作为新流程的唯一状态事实源。

---

## 9. 领域命令与 API 设计

## 9.1 领域命令分阶段实现

建议由 `data-runtime/internal/apps/altoc/` 内的 Altoc 领域服务执行，而不是继续依赖通用 CRUD 修改生命周期字段。当前 `contract_commands.go` 已有合同审批、状态变更和阶段完成命令；P0A 只补合同行和报价转换命令，P0B 再扩展为完整状态机和义务 / 结算命令，不另建一套平行生命周期入口。

P0A 首期只实现：

```text
POST   /api/v1/contracts/drafts
POST   /api/v1/contracts/from-quotation
PATCH  /api/v1/contracts/{id}/draft
POST   /api/v1/contracts/{id}/validate
POST   /api/v1/contracts/{id}/lines
PATCH  /api/v1/contracts/{id}/lines/{lineId}
DELETE /api/v1/contracts/{id}/lines/{lineId}
```

P0B 再实现：

```text
POST   /api/v1/contracts/{id}/submit
POST   /api/v1/contracts/{id}/withdraw
POST   /api/v1/contracts/{id}/mark-signed
POST   /api/v1/contract-obligations/{id}/start
POST   /api/v1/contract-obligations/{id}/submit
POST   /api/v1/contract-obligations/{id}/accept
POST   /api/v1/contract-obligations/{id}/reject
POST   /api/v1/contracts/{id}/fulfillment/close
POST   /api/v1/contracts/{id}/suspend
POST   /api/v1/contracts/{id}/terminate
```

P1A 再实现：

```text
GET    /api/v1/contracts/{id}/activation-plan
POST   /api/v1/contracts/{id}/activation-plan/preview
POST   /api/v1/contracts/{id}/activation/execute
GET    /api/v1/contracts/{id}/activation/jobs/{jobId}
POST   /api/v1/contracts/{id}/activation/jobs/{jobId}/retry
POST   /api/v1/contracts/{id}/activation/jobs/{jobId}/cancel
POST   /api/v1/contracts/{id}/activation/jobs/{jobId}/steps/{stepKey}/result
POST   /api/v1/contracts/{id}/project-links
```

合同审批结果可由 Workflow 回调命令更新，不允许客户端直接设置 `approved`。

现有接口兼容原则：

- 保留现有 `POST /api/v1/service/contracts/{contractCode}/activate-delivery` 作为已落地生效编排入口；P1A 的 `activation-plan` 是其计划预览和步骤状态扩展，不是替代入口。
- 保留现有 `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 用户态开票申请入口；新的结算计划只负责生成或更新 Altoc 回款计划，再复用该入口发起 Finance 开票申请。
- `force_complete`、自动补记回款和自动补开发票必须迁出正常生命周期，改为数据迁移/财务调账工具，并要求单独权限、原因、审计和 Finance 对账。
- 所有新增命令必须穿透到 data-runtime，Nuxt BFF 只做用户鉴权、service token 编排、错误映射和结果组装。

## 9.2 合同生效计划预览示例

本节属于 P1A，不进入 P0A / P0B 首期。

请求：

```json
{
  "effective_date": "2026-07-01",
  "grouping_preferences": {
    "merge_implementation_lines": true,
    "create_planned_assets": true
  }
}
```

返回：

```json
{
  "contract_code": "CT-20260001",
  "warnings": [],
  "suggestions": {
    "projects": [
      {
        "plan_key": "delivery-main",
        "action": "create_or_link",
        "required": true,
        "line_codes": ["CTL-001", "CTL-002"],
        "suggested_template": "aims:software-delivery"
      }
    ],
    "delivery_assets": [
      {
        "plan_key": "asset-product-a",
        "action": "create_planned",
        "line_code": "CTL-001",
        "product_code": "PRD-A"
      }
    ],
    "service_agreements": [
      {
        "plan_key": "maintenance-3y",
        "action": "create_after_acceptance",
        "line_code": "CTL-003"
      }
    ],
    "billing_schedules": [
      {
        "schedule_code": "CBS-001",
        "trigger": "contract_effective"
      },
      {
        "schedule_code": "CBS-002",
        "trigger": "obligation_accepted"
      }
    ]
  }
}
```

## 9.3 P1 编排命令

```text
POST /api/v1/contracts/{id}/activation/execute
GET  /api/v1/contracts/{id}/activation/jobs/{jobId}
POST /api/v1/contracts/{id}/activation/jobs/{jobId}/retry
POST /api/v1/contracts/{id}/activation/jobs/{jobId}/cancel
```

每个跨应用步骤使用稳定幂等键，例如：

```text
contract:{contract_code}:line:{line_code}:project:{group_key}
contract:{contract_code}:line:{line_code}:asset:{product_code}:{instance_key}
contract:{contract_code}:line:{line_code}:service-agreement
```

## 9.4 普通 CRUD 禁写字段

至少将以下字段加入 runtime 的 `WriteDenyColumns`：

```text
legal_status
fulfillment_status
financial_status
activation_status
approved_at
approved_by
terminated_at
completed_at
baseline_version_no
last_status_changed_at
last_status_changed_by
```

合同金额、合同行、结算计划在合同生效后也不得通过普通 CRUD 修改，必须走合同变更命令。

---

## 10. 履约启动向导

合同签署并满足生效条件后，不直接无条件创建项目，而是进入“履约启动”。

## 10.1 第一步：系统分析

根据合同行策略生成：

- 需要创建或关联的项目；
- 需要建立的计划客户交付资产；
- 需要生成的服务协议；
- 需要生成的 Altoc 回款计划或采购应付计划；
- 需要发起的采购需求；
- 需要创建的周期任务；
- 缺失信息和风险提示。

## 10.2 第二步：用户确认

用户只需处理以下决策：

1. 创建新项目还是关联已有项目；
2. 哪些合同行合并进同一个项目；
3. 是否立即创建计划资产；
4. 运维服务覆盖哪些已有或计划资产；
5. 哪些结算节点需要调整日期；
6. 哪些采购需求暂缓发起。

其余内容使用模板默认值。

## 10.3 第三步：异步执行

使用：

```text
本地事务 + Outbox + 跨应用 Saga + 幂等命令
```

推荐事件：

```text
ContractApproved
ContractSigned
ContractEffective
ContractLineActivated
ProjectLinkRequested
ProjectLinked
CustomerDeliveryAssetPlanned
CustomerDeliveryAssetActivated
ServiceAgreementActivated
ReceivableScheduleGenerated
PayableScheduleGenerated
PurchaseDemandRaised
ContractObligationCompleted
ContractAmended
ContractTerminated
```

## 10.4 第四步：结果可视化

合同详情显示每个步骤：

```text
✓ 交付项目已创建
✓ 软件产品计划资产已建立
! 服务协议创建失败，可重试
✓ Altoc 回款计划已生成
○ 第三方采购需求待确认
```

失败步骤可单独重试，已成功步骤不得重复创建。

---

## 11. 项目创建与关联规则

## 11.1 默认项目策略

| 合同行类型 | 默认项目策略 |
|---|---|
| 软件许可 | `none` 或 `optional` |
| SaaS/数据订阅 | `none` |
| 第三方许可转售 | `none` |
| 简单硬件销售 | `optional` |
| 定制开发 | `required` |
| 实施服务 | `required` |
| 系统集成 | `required` |
| 数据治理项目 | `required` |
| 运维服务 | `none` 或 `optional` |
| 长期运营服务 | `optional` 或 `required` |

## 11.2 创建新项目

Altoc 向 Aims 发送：

- 客户编码；
- 合同及合同行编码；
- 项目名称；
- 项目模板；
- 预计起止日期；
- 合同金额或所含行金额；
- 项目负责人建议；
- 履约义务和验收要求；
- 相关 Codocs 文档引用。

Aims 返回稳定 `project_code`，Altoc 写入 `contract_project_link`。

## 11.3 关联已有项目

项目选择器仅展示：

- 同一客户；
- 未归档；
- 用户有权查看或管理；
- 状态允许接收新合同工作包的项目。

关联时不能只按 `contract_code` 查找第一个项目，必须由用户或明确规则选择。

## 11.4 项目里程碑与履约义务

Aims 项目里程碑建议记录：

```text
source_contract_code
source_contract_line_code
source_obligation_code
```

当里程碑完成或验收时，由 Aims 发送事件，Altoc 更新义务状态，并判断是否满足结算计划触发条件。

---

## 12. 页面与操作流程

## 12.1 新建合同采用四步简化向导

### 第一步：合同基本信息

- 销售或采购；
- 业务模板；
- 客户或供应商；
- 合同名称；
- 来源商机、报价或采购需求；
- 负责人；
- 签署和生效日期。

### 第二步：产品与服务

默认从报价导入。用户可以：

- 调整数量、单价和税率；
- 增加产品或服务；
- 指定产品版本和服务周期；
- 展开高级设置修改项目、资产、服务或采购策略。

### 第三步：履约与结算

系统自动生成：

- 履约义务；
- 验收标准；
- 项目建议；
- 客户资产建议；
- 服务协议建议；
- 结算节点。

普通用户只确认，不必逐条从零创建。

### 第四步：文档与审批

- 选择 Codocs 合同模板或上传合同；
- 显示必备附件；
- 预览 Workflow 审批路线；
- 提交审批。

## 12.2 合同详情工作台

建议标签页：

```text
概览
产品与服务
履约义务
项目
客户交付资产
运维与SLA
收付款
采购与供应商
变更与续签
文档
审批与审计
```

首页概览只显示：

- 合同当前状态；
- 金额和毛利摘要；
- 下一项关键义务；
- 履约启动进度；
- 关联项目健康度；
- 交付资产数量；
- 服务到期时间；
- 开票、回款或付款摘要；
- 风险和待办。

## 12.3 管理员配置界面

50–300 人企业只需配置：

1. 启用哪些业务模板；
2. 模板默认审批流；
3. 默认项目模板；
4. 默认结算节点；
5. 产品目录和默认策略；
6. 合同编号规则；
7. 到期和履约提醒天数。

首期不提供复杂脚本和任意规则编辑器。

---

## 13. 权限与职责设计

建议新增或明确以下 capability：

```text
altoc:contract:view
altoc:contract:create
altoc:contract:edit-draft
altoc:contract:submit
altoc:contract:approve
altoc:contract:mark-signed
altoc:contract:activate
altoc:contract:terminate
altoc:contract:amend
altoc:contract-obligation:update
altoc:contract-obligation:accept
altoc:contract-project:link
altoc:service-agreement:manage
altoc:contract:admin
```

权限命名分层：

- UI 和用户态权限继续使用 Altoc 现有 `resource/action` 资源模型，例如 `contract:view`、`contract:edit`、`receivable:edit`，由 Altoc BFF 和 data-runtime 数据范围校验执行。
- 跨应用 service grant 使用仓库统一格式 `<target-app>:<resource>:<action>`，例如 `altoc:receivable:mark-billable`、`altoc:contract:finance-summary:sync`、`finance:invoice-request:create`。
- runtime 内部 scope 只作为传输层兼容，不得成为第二套业务授权事实源。
- 新增 service endpoint 必须在 `docs/MODULE_CONTRACTS.md`、目标应用 manifest/API 文档和 Console grant 初始化逻辑中同步声明，不允许只在 SQL Seed 或代码白名单中维护。
- 高价值操作必须绑定已验证用户 actor，不得信任普通浏览器 header 传入的 `x-hzy-actor-uid`。

推荐岗位映射：

| 岗位/职责 | 主要能力 |
|---|---|
| 销售/商务 | 创建和编辑草稿、提交合同、查看本人客户合同 |
| 合同管理员 | 完善合同、管理模板、签署登记、履约启动 |
| 业务审批人 | 按 Workflow 任务审批，不自动获得所有合同管理权 |
| 项目经理 | 查看关联合同和义务、确认项目映射、反馈里程碑 |
| 服务经理 | 管理服务协议、覆盖资产和 SLA |
| 财务人员 | 查看结算条件、维护财务执行结果，不能修改合同商业内容 |
| 系统管理员 | 配置系统，不默认获得全部合同业务数据 |

所有数据访问应继续受客户负责人、合同负责人、部门或参与项目范围控制。

---

## 14. 代码级改造建议

## 14.1 数据库迁移

建议按阶段增加，避免 P0A 首期一次性上全套表：

```text
P0A:
altoc/docs/migrations/<next>_contract_line_core.sql

P0B:
altoc/docs/migrations/<next+1>_contract_obligation_and_billing.sql
altoc/docs/migrations/<next+2>_contract_status_machine_hardening.sql

P1A:
altoc/docs/migrations/029_contract_activation_orchestration.sql

P1-3 / P1-4 Altoc 侧占位:
altoc/docs/migrations/030_contract_delivery_asset_and_service_agreement.sql
altoc/docs/migrations/031_service_agreement_ticket_sla.sql
altoc/docs/migrations/032_contract_project_grouping.sql

P1B / P2:
altoc/docs/migrations/<next>_purchase_contract_min_loop.sql
```

当前 `altoc/docs/migrations` 已存在到 `032_*`，实际落地时必须使用下一个连续编号，不能复用本文示例编号。

Assets 侧建议增加：

```text
assets/docs/migrations/<next>_customer_delivery_asset_contract_link.sql
```

迁移必须具备：

- 前置校验；
- 幂等执行；
- 回填统计；
- 异常记录表；
- 回滚或兼容方案；
- 迁移后数据校验 SQL。

## 14.2 Data Runtime

建议在现有实现上按阶段拆分和扩展：

```text
P0A:
data-runtime/internal/apps/altoc/contract_lines.go

P0B:
data-runtime/internal/apps/altoc/contract_obligations.go
data-runtime/internal/apps/altoc/contract_activation.go

P1A:
data-runtime/internal/apps/altoc/contract_orchestration.go

P1B:
data-runtime/internal/apps/altoc/service_agreements.go
```

P0A 只新增合同行相关命令和报价行转换逻辑。现有 `contract_commands.go` 继续承载合同状态机入口，P0B 再将其从单一 `contract.status` 扩展为法律、履约、财务和启动状态的领域命令。`contract_orchestration.go` 明确后置到 P1A。

修改：

```text
data-runtime/internal/apps/altoc/adapter.go
```

为合同生命周期和财务摘要字段增加禁写规则。

现有：

```text
contract_commands.go
contract_management.go
service_maintenance.go
service_receivables.go
```

应逐步拆分职责，避免所有命令继续堆叠在单个文件中。

## 14.3 Altoc BFF

建议增加明确的领域命令路由和统一 runtime 客户端，不由页面直接拼接 runtime 请求。

```text
P0A:
altoc/server/api/v1/contracts/drafts.post.ts
altoc/server/api/v1/contracts/from-quotation.post.ts
altoc/server/api/v1/contracts/[id]/draft.patch.ts
altoc/server/api/v1/contracts/[id]/validate.post.ts
altoc/server/api/v1/contracts/[id]/lines.post.ts
altoc/server/api/v1/contracts/[id]/lines/[lineId].patch.ts
altoc/server/api/v1/contracts/[id]/lines/[lineId].delete.ts

P0B:
altoc/server/api/v1/contracts/[id]/submit.post.ts
altoc/server/api/v1/contracts/[id]/withdraw.post.ts
altoc/server/api/v1/contracts/[id]/mark-signed.post.ts
altoc/server/api/v1/contracts/[id]/fulfillment/close.post.ts
altoc/server/api/v1/contracts/[id]/suspend.post.ts
altoc/server/api/v1/contracts/[id]/terminate.post.ts
altoc/server/api/v1/contract-obligations/[id]/start.post.ts
altoc/server/api/v1/contract-obligations/[id]/submit.post.ts
altoc/server/api/v1/contract-obligations/[id]/accept.post.ts
altoc/server/api/v1/contract-obligations/[id]/reject.post.ts

P1A:
altoc/server/middleware/tenant-runtime.ts                       转发 activation-plan、activation/execute、jobs/retry/cancel、project-links
altoc/server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts  现有入口硬化为编排执行器
```

中间件需要显式允许并转发多层领域命令路径，不能只支持通用 CRUD。P0A 首期只要求合同行和报价转换路由；P0B 才开放义务和结算命令；P1A 才开放履约启动编排和项目关联命令。

## 14.4 前端

建议新增或重构：

```text
P0A:
altoc/app/pages/contracts/new.vue
altoc/app/pages/contracts/[id].vue
altoc/app/pages/contracts/[id]/edit.vue
altoc/app/pages/contracts/templates.vue
altoc/app/components/contracts/ContractWizard.vue
altoc/app/components/contracts/ContractLineEditor.vue

P0B:
altoc/app/components/contracts/ObligationPlan.vue

P1A:
altoc/app/pages/contracts/[id].vue                              已新增“履约启动”页签，展示计划、作业步骤、失败原因和项目关联
altoc/app/components/contracts/ActivationPlan.vue                后续可拆分
altoc/app/components/contracts/OrchestrationStatus.vue           后续可拆分
altoc/app/components/contracts/ProjectLinkSelector.vue           详情页已内置关联已有项目入口，后续可组件化
altoc/app/components/contracts/DeliveryAssetPlan.vue             可在详情页进一步组件化；Assets customer-delivery-assets 契约已落地
```

建议使用组合式组件，不在单个页面中堆积所有业务逻辑。P0A 页面只展示“基本信息”和“产品与服务”；P0B 增加义务与结算；P1A 增加履约启动计划和跨应用步骤状态。

## 14.5 Aims、Assets、Finance 服务接口

### Aims

```text
POST /api/v1/service/projects/from-contract                         已落地，继续复用
GET  /api/v1/service/projects/by-contract/{contractCode}             已落地，仅兼容旧单项目读取；P1 选择项目不得依赖该接口
POST /api/v1/service/projects/{projectCode}/payment-milestones:sync  已落地，继续复用
GET  /api/v1/service/projects/eligible-for-contract                  已落地，供关联已有项目选择
POST /api/v1/service/projects/{projectCode}/contract-links           仅在一合同多项目需要独立链接对象时新增
```

### Assets

```text
POST /api/v1/service/deliveries/upsert                               已落地，作为首版交付视图/计划资产 upsert 基础
GET  /api/v1/service/deliveries/package                              已落地，作为合同详情和客户页读取基础
POST /api/v1/service/customer-delivery-assets/plans                  已落地，合同计划资产同步为 Assets 客户交付资产主档
POST /api/v1/service/customer-delivery-assets/{code}/activate        已落地，和 Assets 生命周期状态保持一致
GET  /api/v1/service/customer-delivery-assets/by-customer            已落地，支持客户 / 合同 / 项目维度读取
POST /api/v1/service/customer-delivery-assets/{code}/status:sync     已落地，Assets 回写 Altoc 计划资产、义务和结算状态
```

### Finance

```text
POST /api/v1/finance/invoice-requests                               已落地，Altoc 通过回款计划开票入口编排调用
POST /api/v1/finance/invoice-requests/{code}/submit                 已落地，Altoc 发起后可自动提交 Workflow
GET  /api/v1/finance/contracts/{contractCode}/summary               已落地，合同详情读取
GET  /api/v1/finance/contracts/summaries                            已落地，合同列表批量读取
POST /api/v1/service/payable-plans/from-contract                    P1B/P2 采购方向新增，必须先确认 Finance 应付事实源契约
GET  /api/v1/service/purchase-contracts/{contractCode}/financial-summary P2 采购方向新增
```

所有写接口必须实现服务端幂等，并返回稳定业务编码。

---

## 15. P0 实施工作包

## P0A-0：架构基线与首期边界冻结

**目标**：把 P0 首期收敛为“合同结构化最小闭环”，不同时上线义务、结算和编排。

任务：

- 编写合同领域 ADR；
- 编写“已落地能力复用矩阵”，逐项标明复用、扩展、废弃和新增；
- 冻结 P0A 表清单：`contract` 必要字段扩展、`contract_business_template`、`contract_party`、`contract_line`；
- 明确 P0A 不创建 `contract_obligation`、`contract_billing_schedule`、`contract_orchestration_*`、`service_agreement*`；
- 增加租户级只读预览开关 `altoc.contract_hub_v2` 和写入开关 `altoc.contract_hub_v2_write`；
- 建立 P0A 数据字典、API 契约、旧接口兼容原则和关键现有流程回归测试。

完成标准：

- ADR 审核通过；
- P0A/P0B/P1A 表清单和功能边界已在文档中冻结；
- 已落地 Aims / Assets / Finance / Workflow / Codocs service 契约已对齐，P0A 未新增重复入口；
- 关闭 `altoc.contract_hub_v2_write` 时旧页面和旧 API 不受影响。

## P0A-1：合同分类、模板与合同行

任务：

- 扩展 `contract` 的必要字段：`direction`、`primary_type`、`parent_contract_id`、`is_master_contract`、`agreement_form`、`template_code`、`source_type`、`source_code`、`lock_version`；
- 新增 `contract_party`、`contract_line`、`contract_business_template`；
- 建立首批 8 个销售模板和 4 个采购模板；
- 从报价复制报价行并保留价格快照；
- 实现合同行金额汇总和合同头金额一致性校验；
- 支持综合合同增删行；
- 在 `contract_line.snapshot_json` 中保留未来义务、结算、项目、资产和服务策略快照，但不生成下游对象。

完成标准：

- 报价转合同后产品和服务不丢失；
- 合同金额由行汇总，可展示差异；
- 软件、开发、实施、维保和系统集成场景可表达；
- 不需要创建项目、义务、结算计划或编排作业即可完成合同草稿创建。

## P0A-2：P0A 页面与迁移

任务：

- 合同创建向导首期只覆盖“基本信息”和“产品与服务”；
- 合同详情新增“产品与服务”页签；
- 旧合同默认回填 `direction=sales`；
- 根据源合同类型映射主类型；
- 每份旧合同生成一条“历史汇总行”；
- 旧付款条款、旧合同阶段继续只读展示，不迁移为新义务或新结算计划；
- 建立迁移异常清单。

完成标准：

- 标准软件销售合同可从报价无损生成结构化合同行；
- 所有旧合同均可在新详情页查看产品与服务汇总；
- 合同总数、金额、客户、商机和报价关联对账一致；
- 无法自动分类的数据进入人工确认队列，而不是静默丢失。

## P0B-1：履约义务与结算计划

进入条件：

- P0A 至少在开发环境完整跑通报价转合同、手工建合同、旧合同汇总行迁移和产品与服务展示；
- P0A 合同行金额、合同数量和旧合同汇总行对账通过；
- P0A 写入开关可按租户关闭并回退到旧合同体验。

任务：

- 新增 `contract_obligation` 和 `contract_billing_schedule`；
- 根据模板和合同行策略自动生成义务；
- 支持义务完成、提交、接受和驳回；
- 支持结算计划绑定义务；
- 将旧付款条款转换为新结算计划；
- 将旧合同阶段迁移为履约义务；
- 保留旧付款条款和旧合同阶段只读兼容期。

完成标准：

- 一份合同支持多个交付和验收节点；
- 结算节点可以绑定具体义务，而不是固定四阶段；
- 所有义务变化有审计记录；
- P0B 不创建跨应用编排作业。

## P0B-2：状态机和领域命令

任务：

- 拆分法律、履约、财务和履约启动状态；
- 补齐状态转移矩阵和旧 `contract.status` 兼容映射；
- 实现合同提交、撤回、审批回调、签署、生效、暂停、终止和履约关闭命令；
- 为命令增加事务、行锁、乐观锁和幂等；
- 禁止通用 CRUD 修改关键状态；
- 隔离 `force_complete`、自动补记回款和自动补开发票为受控的数据迁移/财务调账工具；
- 增加合同事件和审计日志。

完成标准：

- 非法状态跳转被服务端拒绝；
- 并发重复生效不会重复生成数据；
- 履约完成不会自动伪造开票或回款；
- 状态机变更仍不依赖 `contract_orchestration_job`。

## P0B-3：P0B 工作台

任务：

- 在合同创建向导中增加“履约与结算”预览步骤；
- 合同详情增加“履约义务”和“收付款 / 结算条件”页签；
- 展示义务、结算计划和旧数据迁移来源；
- 展示状态机拒绝原因和下一步提示。

完成标准：

- 普通用户不展开高级设置也能完成常见合同；
- 合同详情能解释“为什么此节点可开票 / 不可开票”；
- P0B 页面不要求 Aims、Assets 或 Finance 新增接口就绪。

---

## 16. P1 实施工作包

## 16.0 P1 进入条件与跨团队依赖矩阵

> 本节为工程评审纠正项。P1 多数工作包的关键路径落在 Aims、Assets、Finance 三个**独立模块、独立 git 仓库、独立负责人**上。原计划把这些外部接口的交付直接排进了 Altoc 自己的迭代周期，隐含“外部接口会按时就绪”的假设——这是当前最高执行风险：任一外部模块不排期，对应 Altoc 工作包即整段阻塞，且无法靠 Altoc 内部加人解决。

为消除该风险，P1 增加硬性进入条件：**依赖外部模块新增或改造接口的工作包，必须先完成接口契约冻结与对方排期确认，才能进入跨应用联调与发版承诺。**

### 跨团队依赖矩阵

| Altoc 工作包 | 依赖的外部接口 | 模块 | 当前状态 | 阻塞等级 | 未就绪时的回退 |
|---|---|---|---|---|---|
| P1-1 履约启动编排 | `activate-delivery` | Altoc 自有 | 已落地 | 无 | 直接硬化扩展 |
| P1-2 创建/合并项目 | `projects/from-contract`、`payment-milestones:sync` | Aims | 已落地 | 低 | 直接复用 |
| P1-2 关联已有项目 | `projects/eligible-for-contract` | Aims | 已落地 | 低 | 可直接进入 Altoc 关联 UI / 命令联调 |
| P1-3 客户交付资产 | 交付对象「允许无项目」改造 + `customer-delivery-assets/*` | Assets | 已落地 | 中 | Altoc 仍保留本地计划资产作为降级读模型 |
| P1-4 服务协议覆盖资产 | 覆盖资产引用依赖 P1-3 的交付资产编码 | Assets | 已落地 | 中 | 服务协议可覆盖 Assets 返回的正式交付资产编码或待交付资产 |
| P1-5 Finance 结算衔接 | `invoice-requests`、`finance-summary:sync` | Finance | 已落地 | 低 | 直接复用 |
| P1B 采购最小闭环 | `payable-plans/from-contract`、`purchase-orders/from-contract` | Finance / Assets | 待新增 | 高 | 采购方向整体后置到 P2，P1 不承诺 |

矩阵规则：

- “已落地”列以 `docs/MODULE_CONTRACTS.md` 实际冻结契约为准，不以会议口头约定为准。
- “待新增 / 待改造”接口，Altoc 不得先行假定其签名、语义编码、幂等键和错误映射；必须由目标模块先在其 manifest / API 文档冻结契约，并在 `docs/MODULE_CONTRACTS.md` 登记后，Altoc 才进入联调实现。
- 高阻塞工作包在外部接口冻结前，只允许做 Altoc 侧本地建模、读模型和占位 UI，不得进入跨应用联调和发版承诺。

## P1-0：跨团队接口契约冻结与排期（P1 第一项工作包）

任务：

- 与 Aims、Assets、Finance 负责人逐项确认上表“待新增 / 待改造”接口的签名、语义编码、幂等键和错误映射；
- 将冻结结果同步写入 `docs/MODULE_CONTRACTS.md`、各目标模块 manifest / API 文档和 Console grant 初始化逻辑；
- 取得各模块对 P1 联动周的排期承诺，或明确把无法排期的依赖按“回退”列降级、后置；
- 据此修订第 22 节迭代计划：外部依赖未确认的工作包周期不计入交付承诺。

完成标准：

- 依赖矩阵中每个“待新增 / 待改造”接口都有 owner、契约冻结链接和目标交付迭代；
- 每个高阻塞工作包都有明确的“就绪后联调”或“降级后置”决定，文档中不再存在隐含的外部就绪假设；
- 第 22 节甘特图的 P1 联动周已按各模块实际排期承诺标注，不再把外部交付当成 Altoc 可控时间线。

当前实现状态（2026-06-22）：

- P1 主链路依赖的 Aims `projects/from-contract`、`payment-milestones:sync`、`eligible-for-contract`，Assets `customer-delivery-assets/*`，Finance `invoice-requests` / `finance-summary:sync` 均已在 `docs/MODULE_CONTRACTS.md` 冻结并落地；
- P1B / P2 采购相关 `payable-plans/from-contract`、`purchase-orders/from-contract` 明确后置，不进入 P1 发版承诺；
- 第 22 节联动计划已标注“剩余 P1B/P2 采购相关待新增接口未冻结契约并取得排期承诺前，对应联动周不计入交付承诺”。

## P1-1：履约启动计划与编排

任务：

- 基于已落地 `activate-delivery` 链路实现启动计划预览和确认；
- 新增或扩展编排作业、步骤和 Outbox；
- 实现步骤级幂等、失败重试和人工取消；
- 合同详情展示执行结果；
- 建立跨应用 tracing 和审计。

完成标准：

- 下游单点失败不影响已完成步骤；
- 重试不会重复创建项目、资产或 Altoc 回款计划；
- 用户能够看懂每个步骤的状态和失败原因。

当前实现状态（2026-06-22）：

- 已新增 `029_contract_activation_orchestration.sql`，落地 `contract_project_link`、`contract_orchestration_job`、`contract_orchestration_step`；
- 已在 data-runtime 增加 `activation-plan` 预览、`activation/execute`、job 查询、步骤结果回写、失败步骤 retry 和 job cancel；
- 已把现有 `activate-delivery` BFF 纳入编排作业：Altoc 生效/回款计划、Aims 项目创建、Aims 收款里程碑同步都会回写步骤状态；
- 已复用既有 `domain_event_outbox` 记录编排领域事件，不再新增第二套 `contract_event_outbox` 事实源；
- 合同详情已展示履约启动计划、步骤结果、失败原因和关联合同项目。

## P1-2：创建或关联 Aims 项目

任务：

- 支持一合同多项目；
- 支持按合同行合并或拆分项目；
- 支持关联已有项目；
- 将履约义务映射到项目里程碑；
- 接收里程碑完成和验收事件；
- 移除“按合同编码选择第一个项目”的隐含逻辑。

完成标准：

- 软件许可销售可不建项目；
- 定制开发必须选择新建或关联项目；
- 综合合同可以同时关联交付项目和维护项目。

当前实现状态（2026-06-22）：

- 已新增 `contract_project_link` 作为一合同多项目的本地关联事实；
- 已改造 `activate-delivery`：只有启动计划包含 `aims_project_link` 步骤时才调用 Aims 创建项目，软件许可等 `project_policy=none` 的合同不再无条件建项目；
- 已支持 Aims 创建项目成功后自动回写 `contract_project_link`；
- Aims `eligible-for-contract` 已落地，可返回同客户未归档且未绑定其他合同的项目候选；Altoc 合同详情页已通过本地 BFF 查询候选项目，并可写入 `contract_project_link` 关联已有 Aims 项目；
- 已新增 `032_contract_project_grouping.sql`，为 `contract_project_link` 补充 `plan_key`、`line_codes_json`、`obligation_codes_json`，持久化履约启动项目分组和覆盖范围；
- `activation-plan` 已按合同行 `project_policy`、行类型、服务策略和项目模板分组生成多个 `project_plans`：实施 / 定制 / 运维等行可拆分为不同 Aims 项目，已有 `contract_project_link` 会作为对应分组的既有关联；
- `activate-delivery` 编排器已按 `project_plans` 逐个调用 Aims `projects/from-contract`，Aims 不再按 `contract_code` 只复用第一个项目，而是按 `project_code` / `planKey` 幂等创建或复用；
- 义务和结算映射已随项目计划下发：Altoc 返回 `billingSchedules` / `obligations`，BFF 按 `line_codes` / `obligation_codes` 筛选后调用 Aims `payment-milestones:sync`，Aims 支持 `paymentTerms[]` 与 `billingSchedules[]` 两类里程碑幂等 upsert。

## P1-3：客户交付资产

**前置依赖状态**：Assets 已新增 `customer_delivery_assets` 主档及 `customer-delivery-assets/*` service 契约，支持 `project_code` 为空的许可 / SaaS 合同资产。Altoc 仍保留本地计划资产读模型，用于编排失败时展示和重放。

当前实现状态（2026-06-22）：

- 已新增 `030_contract_delivery_asset_and_service_agreement.sql`，落地 `contract_delivery_asset_plan` 作为 Altoc 侧计划资产读模型；
- 已在 Assets 新增 `assets_customer_delivery_assets_20260622.sql` 和 `customer_delivery_assets` 主档，允许无项目交付资产；
- 履约启动执行时会根据合同行 `asset_policy` 自动生成 Altoc 计划资产，并通过 Altoc BFF 调 Assets `customer-delivery-assets/plans` 同步为正式客户交付资产；
- Assets 返回 `delivery_asset_code` 后，Altoc 编排步骤会回填 `contract_delivery_asset_plan.external_asset_code`，合同详情可展示正式资产编码；
- 资产生命周期 delivered / online / accepted 已在 Assets service endpoint 层支持；Assets `activate` 会尽力回调 Altoc `customer-delivery-assets/{code}/status:sync`，回写计划资产状态，`accepted` 会推进关联履约义务并把绑定结算计划置为可结算。

任务：

- 调整 Assets 客户交付对象允许无项目；
- 增加合同行、义务和产品版本引用；
- 支持计划资产、交付、上线和验收状态；
- 从软件、订阅、硬件和第三方产品行生成资产建议；
- 合同详情展示客户交付资产；
- 资产事件反向更新履约义务和结算触发。

完成标准：

- 产品加客户可形成可追踪的具体交付实例；
- 同一客户同一产品可有多个环境、实例或版本；
- 不建项目的许可销售也可以形成客户资产。

## P1-4：服务协议、维保覆盖和 SLA

任务：

- 新增服务协议和覆盖资产关系；
- 将运维合同行转换为服务协议；
- 服务协议必须选择覆盖资产或明确“待交付资产”；
- 迁移现有维保合同和权益；
- 工单关联资产、协议和权益；
- 增加到期和续约提醒。

完成标准：

- 产品+实施+维保合同验收后可自动激活服务协议；
- 工单能够判断是否在保和是否超出权益；
- 一个协议可覆盖多个产品或环境。

当前实现状态（2026-06-22）：

- 已新增 `service_agreement` 和 `service_agreement_asset`，履约启动执行时会根据合同行 `service_policy` 自动生成计划服务协议；
- 服务协议可覆盖 Altoc 侧 `contract_delivery_asset_plan`；当 Assets `customer_delivery_assets` 返回 `delivery_asset_code` 后，计划资产 `external_asset_code` 会随编排结果回填，后续资产状态同步会把覆盖关系改写为正式客户交付资产编码，并在资产验收后激活当前服务期内的计划服务协议；
- `031_service_agreement_ticket_sla.sql` 已补齐服务协议 SLA、额度、续约提醒字段，并将可关联原合同的旧 `maintenance_contract` / `service_entitlement` 迁移为 `SA-MC-*` 服务协议；无资产编码的旧维保以 `pending-maintenance-*` 覆盖占位进入后续补充队列；
- 服务工单创建、更新和 Aims 回写后会优先匹配 `service_agreement` / `service_agreement_asset`，写回协议编号、客户交付资产、权益状态、SLA 截止时间；工单解决或关闭时按 ticket 额度做幂等扣减。

## P1-5：Finance 结算衔接

任务：

- 将销售结算计划生成或更新 Altoc 经营侧回款计划；
- 将触发条件变化同步为可开票状态；
- 复用 Altoc 回款计划开票申请入口编排 Finance 开票申请和 submit；
- 接收 Finance 发票、回款和核销摘要；
- 财务状态由事件或查询结果更新；
- 履约关闭与财务关闭分离；
- 终止合同生成结算处理任务，不自动坏账。

完成标准：

- 履约义务验收可触发 Altoc 回款节点和 Finance 开票申请；
- 合同可显示计划、已开票、已回款和逾期摘要；
- 财务人员仍在 Finance 完成发票和核销操作。
- Finance 不维护 Altoc 回款计划事实，不反向改写合同商业结算条件。

当前实现状态（2026-06-22）：

- Altoc 回款计划开票申请、Finance invoice-request 创建、Finance submit 和 Workflow / local fallback 审批链路已作为既有 Phase 1 基线复用；
- Finance 核销后回传 `finance-summary:sync` 的经营侧摘要刷新链路已落地，合同详情继续以 Finance 为发票、到账和核销事实源；
- 本批 P1A 编排已把 Altoc 合同生效和回款计划生成纳入 `altoc_activate_contract` / `altoc_receivable_plan` 步骤，步骤结果会回写编排作业；
- 义务验收触发可开票仍复用既有 `mark-billable` service endpoint；采购方向应付计划不进入 P1 发版承诺。

## P1B：采购合同最小闭环（建议并行或紧随 P1）

**前置依赖（高阻塞）**：本工作包依赖 Finance `payable-plans/from-contract` 与 Assets 采购订单接口冻结（见 16.0 依赖矩阵）。相关接口未冻结或未取得排期前，采购方向整体后置到 P2，P1 不作承诺。

任务：

- 支持采购方向合同和供应商参与方；
- 支持软件、硬件、云资源、外包和服务采购行；
- 采购合同行关联 Assets 采购订单行；
- 支持数量和金额框架合同的已释放与剩余额度；
- 硬件收货、软件许可交付、服务验收反向更新采购义务；
- 将采购结算计划生成 Finance 应付计划；
- 支持销售合同行关联对应采购合同行，形成成本穿透。

完成标准：

- 第三方产品转售可从销售行追溯到采购合同或采购订单；
- 框架采购合同可显示已下单和剩余额度；
- 采购合同不要求关联销售商机。

---


## 17. P2 实施方案：采购合同、供应商履约与成本闭环

### 17.1 P2 定位与进入条件

P2 将 P1B 的采购合同最小闭环升级为适合 50–300 人企业的“Procure-to-Pay Lite”。目标不是替代专业采购平台，而是让与销售、项目和客户交付直接相关的采购活动能够被合同化、可追溯、可验收并进入财务应付。

P2 建议在以下条件基本满足后启动：

- P0 新合同模型已稳定运行至少一个发布周期；
- P1 项目、客户交付资产、Altoc 回款计划和 Finance 开票/摘要联动成功率达到可接受水平；
- 采购订单、供应商和收货数据在 Assets 中具有稳定业务编码；
- Finance 已能接收采购结算计划或提供应付创建接口；
- 至少 80% 的新销售合同已经使用结构化合同行。

P2 目标流程：

```text
销售合同行 / Aims项目需求 / 内部采购需求
                    ↓
              采购需求或外采建议
                    ↓
       采购合同 / 框架合同 / 直接采购订单
                    ↓
       采购订单释放、收货、许可开通或服务验收
                    ↓
          供应商发票、应付计划、付款和核销
                    ↓
     成本回写销售合同、项目和客户交付资产
```

### 17.2 P2 简化原则

为避免形成重型采购系统，P2 遵循以下规则：

1. **普通采购以采购订单为执行对象。** 单次低风险采购可以不先建立采购合同。
2. **长期、金额较大、分批释放或包含持续服务的采购才要求采购合同。**
3. **框架合同的“释放”优先复用 Assets 采购订单及订单行，不再额外要求用户维护重复单据。**
4. **硬件、软件许可、云资源和服务采购使用不同验收模板，但共享统一采购合同主档。**
5. **销售采购穿透由系统推荐，用户确认例外。** 不要求销售人员理解采购成本分摊模型。
6. **供应商发票、付款和核销仍由 Finance 执行。** Altoc 只维护商业约定、履约条件和聚合状态。

### 17.3 P2 核心数据模型

P2 继续复用统一 `contract` 和 `contract_line`，采购合同通过：

```text
direction = purchase
primary_supplier_id != null
```

表达。建议为采购合同行增加或确认以下字段：

```text
release_mode                 none / quantity / value
contract_target_quantity
contract_target_amount
minimum_commitment_amount
over_release_tolerance
price_condition_json
cost_center_code
budget_project_code
requested_delivery_at
acceptance_template_code
```

#### 17.3.1 销售—采购依赖关系 `contract_line_dependency`

```text
contract_line_dependency
------------------------
id
code
sales_contract_line_code
purchase_contract_line_code
purchase_order_item_code
project_code
dependency_type            resale/subcontract/pass_through/
                           delivery_support/shared_cost
allocation_rule            quantity/amount/ratio/manual
allocated_quantity
allocated_amount
allocation_ratio
status
source_type
created_by
created_at
updated_at
```

设计要求：

- 一条销售行可以关联多条采购行或采购订单行；
- 一条采购行也可以服务多个销售行或多个项目；
- 分摊总额不得超过采购行实际金额，除非具备专门调整权限；
- 所有自动建议必须保留计算依据和人工确认记录；
- 依赖关系只描述商业穿透，不建立跨数据库外键。

#### 17.3.2 框架合同使用视图

框架使用量优先由采购订单行引用采购合同行形成，不强制新增一套释放单。Assets 的采购订单行建议增加：

```text
purchase_contract_code
purchase_contract_line_code
release_sequence_no
```

Altoc 维护聚合读模型 `purchase_contract_usage_view`：

```text
target_quantity / target_amount
ordered_quantity / ordered_amount
received_quantity / accepted_amount
invoiced_amount / paid_amount
remaining_quantity / remaining_amount
```

聚合由事件更新，并提供定期对账任务纠正漂移。

#### 17.3.3 采购验收引用

不建议为每类采购建立独立验收主表。统一通过 `contract_obligation` 表示合同义务，实际证据来自专业应用：

| 采购类型 | 主要执行与证据来源 |
|---|---|
| 硬件设备 | Assets 收货、序列号、入库或领用记录 |
| 软件许可 | 许可证文件、授权码、激活信息和有效期 |
| SaaS/云资源 | 账号、实例、容量、服务开通和可用期 |
| 外包开发 | Aims 工作包、代码、交付物和项目验收 |
| 咨询或专业服务 | Aims 任务、Codocs 服务报告和验收单 |
| 运维服务 | 服务协议、周期服务记录和 SLA 结果 |
| 数据/API | 用量、可用性、质量或接口验收记录 |

### 17.4 P2 业务流程

#### 17.4.1 采购来源

系统支持三种简化入口：

1. **从销售合同发起**：第三方产品、硬件、云资源或外包行自动生成外采建议；
2. **从 Aims 项目发起**：项目经理提交外包、设备或专业服务需求；
3. **直接采购**：行政、资产或技术人员从 Assets 创建普通采购需求。

外采建议至少包含：

```text
需求来源
建议采购类型
产品或服务
数量和预算
期望交付时间
关联销售合同行或项目
推荐供应商（可空）
```

#### 17.4.2 采购合同与采购订单

系统根据采购场景自动建议：

| 场景 | 推荐做法 |
|---|---|
| 一次性、小额、低风险采购 | 直接采购订单 |
| 多次下单、长期价格约定 | 框架采购合同 + 多次采购订单 |
| 外包开发或持续服务 | 采购合同 + Aims 工作包/服务义务 |
| 第三方软件或年度订阅 | 采购合同或订单 + 许可/订阅资产 |
| 重大硬件或系统集成采购 | 采购合同 + 采购订单 + 分批收货验收 |

#### 17.4.3 验收与应付

采购结算计划可由以下事件触发：

```text
采购合同生效
采购订单下达
硬件收货或入库
软件许可交付或激活
云资源开通
项目工作包验收
服务期间完成
人工验收确认
```

Finance 根据企业策略执行两方或三方校验：

```text
采购合同/订单 + 收货或服务验收 + 供应商发票
```

Altoc 只接收聚合结果，不允许通过合同状态直接伪造已付款或已核销。

#### 17.4.4 销售采购与毛利穿透

对第三方转售、系统集成和外包开发场景，系统计算：

```text
销售收入
计划采购成本
已承诺采购成本
已验收采购成本
项目实际成本
合同预计毛利
合同最新预测毛利
合同实际毛利
```

计算口径必须配置并版本化。首期建议仅支持：

- 合同行直接成本；
- 关联项目的人工及费用成本摘要；
- 采购合同或订单实际成本；
- 不自动分摊总部管理费用和复杂间接成本。

### 17.5 P2 领域命令与 Service API

Altoc 建议增加：

```text
POST /api/v1/contracts/{id}/procurement-plan/preview
POST /api/v1/contracts/{id}/procurement-plan/confirm
POST /api/v1/contracts/{id}/lines/{lineId}/purchase-links
DELETE /api/v1/contracts/{id}/lines/{lineId}/purchase-links/{linkId}
GET  /api/v1/contracts/{id}/procurement-summary
GET  /api/v1/purchase-contracts/{id}/usage
POST /api/v1/purchase-contracts/{id}/close
```

Assets 建议提供：

```text
POST /api/v1/service/purchase-demands
POST /api/v1/service/purchase-orders/from-contract
GET  /api/v1/service/purchase-orders/by-contract-line/{lineCode}
POST /api/v1/service/purchase-receipts/{code}/confirm
POST /api/v1/service/service-acceptances
```

Finance 建议提供：

```text
POST /api/v1/service/payable-plans/from-contract
POST /api/v1/service/supplier-invoices/match
GET  /api/v1/service/purchase-contracts/{contractCode}/financial-summary
```

所有写接口必须具备幂等键、来源业务编码和可重放事件处理能力。

P2 新增接口必须先更新 `docs/MODULE_CONTRACTS.md`、目标应用 manifest/API 文档和 Console grant。若 Assets 已有采购订单或收货 endpoint 能满足场景，应优先扩展既有接口，不新增同义接口。

### 17.6 P2 页面与操作体验

普通用户主要使用三个界面：

1. **采购合同三步向导**：供应商与类型 → 产品服务与额度 → 交付、验收和付款条件；
2. **采购执行工作台**：待下单、待收货、待验收、待开票、待付款和异常事项；
3. **销售合同成本页**：展示外采建议、已关联采购、项目成本和毛利变化。

默认隐藏：

- 复杂成本分摊；
- 多层框架释放；
- 高级价格条件；
- 手工会计维度。

只有采购经理或财务经理在高级模式中维护这些内容。

### 17.7 P2 实施工作包

#### P2-0：采购领域基线与功能开关

任务：

- 明确 Altoc、Assets、Aims、Finance 的采购数据所有权；
- 定义供应商、采购合同、采购订单和验收稳定编码；
- 增加功能开关 `altoc.purchase_contract_full_v2`；
- 确定采购合同和直接采购订单的使用阈值；
- 完成 P2 API 契约和权限矩阵。

完成标准：

- 数据所有权 ADR 审核通过；
- 不再出现 Altoc 和 Assets 同时维护两套采购订单的设计。

#### P2-1：采购合同与采购行

任务：

- 完善采购方向合同创建；
- 增加采购行字段和采购模板；
- 支持供应商、多方参与者和服务期间；
- 支持采购履约义务与付款计划；
- 从销售外采建议或项目需求创建采购草稿。

完成标准：

- 软件、硬件、云资源、外包和专业服务采购均可表达；
- 采购合同不依赖销售商机或客户联系人。

#### P2-2：框架合同与采购订单释放

任务：

- 支持数量和金额框架；
- 采购订单行引用采购合同行；
- 聚合已下单、已收货和剩余额度；
- 增加超额度、超有效期和价格偏差校验；
- 支持合同关闭和未使用额度处理。

完成标准：

- 多次下单不会超过合同额度而无提示；
- 聚合数据可与 Assets 采购订单对账。

#### P2-3：收货、许可开通与服务验收

任务：

- 硬件收货事件更新采购义务；
- 软件许可和云资源开通形成可追溯资产或权益；
- 外包开发和服务采购接收 Aims 验收事件；
- 支持部分收货、部分验收和驳回；
- 保存验收证据引用和验收人。

完成标准：

- 不同采购类型均可形成结构化履约结果；
- 部分验收不会被误判为整份合同履约完成。

#### P2-4：应付与发票匹配

任务：

- 采购结算计划生成 Finance 应付计划；
- 支持供应商发票与合同、订单、收货/验收匹配；
- 同步已开票、已付款和逾期摘要；
- 支持预付款、进度款、质保金和尾款；
- 终止采购合同时生成结算任务，不自动冲销或坏账。

完成标准：

- Finance 是发票、付款和核销唯一事实源；
- 合同可查看财务摘要但不能越权修改财务结果。

#### P2-5：销售采购穿透和毛利

任务：

- 实现销售行和采购行/订单行关联；
- 建立自动推荐和人工确认逻辑；
- 聚合项目人工、费用和采购成本；
- 显示计划、承诺、预测和实际毛利；
- 对毛利显著下降形成风险事项。

完成标准：

- 第三方产品转售和系统集成可追溯到供应商采购；
- 毛利计算口径可解释并能追溯到原始业务对象。

#### P2-6：迁移、报表与试点

任务：

- 将现有 Assets 采购订单按可识别规则关联采购合同；
- 对重点供应商和框架合同进行人工补录；
- 建立采购执行和毛利看板；
- 选择第三方转售、硬件采购和外包开发三个试点场景；
- 完成 P2 用户培训和操作手册。

完成标准：

- 试点业务能够从需求追溯到付款；
- 采购合同金额、订单金额和 Finance 应付摘要可对账。

### 17.8 P2 验收业务故事

至少通过：

1. 第三方软件转售：销售行 → 采购合同/订单 → 许可交付 → 客户资产 → 应付与实际毛利；
2. 年度硬件框架：框架额度 → 多次订单 → 分批收货 → 发票匹配 → 剩余额度；
3. 外包开发：销售项目 → 外包采购合同 → Aims 工作包 → 服务验收 → 供应商付款；
4. 云资源订阅：采购合同 → 资源开通 → 周期账单 → 成本回写；
5. 重复事件和重试：不会重复生成订单、应付或成本分摊。

---

## 18. P3 实施方案：合同全生命周期经营、风险治理与智能化

### 18.1 P3 定位与实施方式

P3 将商业履约中枢从“合同履约执行”提升为“合同全生命周期经营”。重点不在增加更多表单，而在对变更、续签、终止、风险、绩效和经营结果进行持续管理。

P3 不建议一次性整体上线，应拆为独立增量：

```text
P3A：合同变更、版本基线和影响编排
P3B：续签、终止、义务与风险控制塔
P3C：合同绩效、供应商绩效和经营分析
P3D：AI辅助和外部签署集成（可选）
```

只有在结构化合同行、履约义务、项目、资产、采购和财务摘要达到基本完整度后，P3 指标和 AI 分析才具有可信基础。

### 18.2 合同变更与版本基线

有效合同的核心字段不得直接修改。金额、范围、工期、服务期、产品、项目策略和结算条件的变化必须通过正式变更对象完成。

建议新增：

```text
contract_amendment
------------------
id
code
contract_id
amendment_type             scope/amount/schedule/payment_term/
                           party/product/service_period/
                           renewal/termination
status
reason
requested_effective_at
signed_at
from_baseline_version
proposed_baseline_version
source_request_code
workflow_instance_code
codocs_document_uuid
created_by
created_at
updated_at
```

```text
contract_version_snapshot
-------------------------
id
contract_id
version_no
version_type               original/amendment/renewal/termination
snapshot_json
content_hash
effective_from
effective_to
source_amendment_code
created_at
```

```text
contract_change_impact
----------------------
id
amendment_code
target_app
target_object_type
target_object_code
impact_type                create/update/cancel/extend/recalculate
before_snapshot
after_snapshot
severity
execution_status
last_error
```

变更流程：

```text
发起变更
→ 系统计算影响
→ 业务、项目、财务和法务确认
→ Workflow审批
→ Codocs补充协议或新版本签署
→ 建立新合同基线
→ Saga更新项目、资产、服务、结算和采购
→ 对账与关闭变更
```

必须支持预览影响，例如：

- 合同金额和毛利变化；
- 项目里程碑、工作量和预计完成日变化；
- 客户交付资产数量、版本或有效期变化；
- 服务协议覆盖范围和服务期变化；
- 应收、应付及开票计划变化；
- 采购需求、订单和框架额度变化。

### 18.3 续签、终止与退出管理

建议新增：

```text
contract_renewal_plan
---------------------
id
contract_id
service_agreement_code
renewal_policy             manual/auto_renew/auto_expire
notice_days
owner_user_id
next_review_at
decision                   pending/renew/not_renew/renegotiate
renewal_opportunity_code
renewal_contract_code
status
```

系统根据合同和服务协议生成 180、90、60、30 天提醒，但普通用户只在工作台看到需要处理的下一步，不需要维护多张计划表。

续签支持：

```text
生成续约商机
复制为续签合同草稿
更新产品、数量、价格和服务期
重新评估客户资产覆盖
确认新的项目或采购需求
```

终止或到期流程必须区分：

- 法律终止；
- 服务停止；
- 资产停用或许可证失效；
- 项目收尾；
- 未履约义务取消；
- 应收应付结算；
- 数据归还、账号关闭和客户交接。

终止不得自动把未收款标记为坏账，也不得自动把未付款标记为已付。

### 18.4 履约控制塔与例外工作台

P3 的核心页面不是复杂报表，而是面向不同岗位的例外工作台。

建议首批风险类型：

```text
obligation_overdue                 履约义务逾期
milestone_slipped                  项目里程碑延期
unlinked_required_project          必需项目未关联
asset_not_created                  应形成客户资产但未形成
service_asset_uncovered            运维协议未覆盖资产
billing_trigger_unprocessed        结算触发未处理
receivable_overdue                 应收逾期
payable_exception                  应付或发票匹配异常
framework_near_limit               框架额度接近上限
framework_expiring                 框架合同即将到期
supplier_delivery_late             供应商交付延期
margin_eroded                      预测毛利显著下降
renewal_decision_overdue           续签决策超期
amendment_execution_failed         变更执行失败
```

每个风险项至少包含：

```text
风险类型
合同和责任人
严重程度
发现时间
业务证据
建议动作
处理人和截止日期
状态
关闭原因
```

系统应优先展示：

- “今天需要处理什么”；
- “哪些合同可能影响收入、回款、客户服务或交付”；
- “哪些异常需要跨部门协作”。

不要要求普通用户每天查看十几个报表。

### 18.5 合同与供应商绩效

P3 建议形成合同 360° 经营视图：

```text
合同金额和变更金额
已履约和待履约义务
项目进度和成本
客户资产交付情况
服务 SLA 和工单结果
已开票、已收款、已付款和逾期
计划毛利、预测毛利和实际毛利
风险、变更和续签状态
```

供应商绩效首期只做可解释指标：

```text
按时交付率
验收一次通过率
质量问题数量
SLA达标率
发票匹配异常率
价格偏差
合同履约完成率
采购金额和框架使用率
```

不建议首期直接生成不可解释的综合评分。若需要总分，应展示各指标权重、数据来源和计算周期。

### 18.6 风险、合规与职责分离

P3 增加合同治理规则，但应保持配置简单。首批规则建议包括：

- 非标付款条件、超长账期和高质保金；
- 毛利低于阈值；
- 自动续约或排他条款；
- 数据安全、个人信息、知识产权和源代码交付；
- 分包或第三方软件依赖；
- 合同经办人与审批人冲突；
- 采购经办人与本人采购验收或付款确认冲突；
- 重要合同缺少 Codocs 正式文本或签署证据；
- 有效合同核心字段被绕过变更流程修改。

系统应支持规则严重程度：

```text
提示
需说明
需追加审批
禁止提交
```

对 50–300 人企业，应允许一人兼岗，但同一业务实例的关键确认尽量由另一人完成。

### 18.7 AI 辅助合同管理

AI 仅作为助手，不能成为合同事实源。建议按以下顺序实施：

#### 第一阶段：结构化提取

从 Codocs 合同文档中提取候选数据：

```text
合同参与方
金额、币种和税率
产品与服务
服务期限
付款节点
验收条件
质保与维保
自动续约与通知期
终止条件
SLA和违约责任
数据与知识产权条款
```

所有字段必须显示来源页码或段落、置信度，并由用户确认后才能写入业务表。

#### 第二阶段：差异比较

- 与企业标准模板比较；
- 与上一版本或补充协议比较；
- 与报价、合同行和结算计划比较；
- 提示“文档写了但系统未录入”或“系统数据与文本不一致”。

#### 第三阶段：风险和下一步建议

- 根据已配置规则提示非标条款；
- 根据履约数据生成风险摘要；
- 推荐续签、催办或变更动作；
- 自动生成会议纪要、合同摘要和交接清单草稿。

AI 安全要求：

- 租户数据严格隔离；
- 保存模型、提示模板和分析版本；
- 敏感合同可禁用外部模型；
- 不允许 AI 自动审批、自动签署、自动终止或直接生成财务事实；
- AI 建议被采纳、修改或拒绝均应可审计。

建议新增：

```text
contract_ai_analysis
--------------------
id
contract_id
document_uuid
analysis_type
model_provider
model_version
prompt_version
result_json
confidence_summary
review_status
reviewed_by
reviewed_at
created_at
```

### 18.8 P3 领域命令与 API

```text
POST /api/v1/contracts/{id}/amendments
POST /api/v1/contracts/{id}/amendments/{code}/impact-preview
POST /api/v1/contracts/{id}/amendments/{code}/submit
POST /api/v1/contracts/{id}/amendments/{code}/apply
POST /api/v1/contracts/{id}/renewal-plan
POST /api/v1/contracts/{id}/renewal-opportunity
POST /api/v1/contracts/{id}/termination-plan
GET  /api/v1/contracts/{id}/control-tower
GET  /api/v1/contracts/{id}/performance
GET  /api/v1/contract-risks
POST /api/v1/contract-risks/{id}/resolve
POST /api/v1/contracts/{id}/ai-analysis
POST /api/v1/contracts/{id}/ai-analysis/{analysisId}/confirm
```

变更应用命令必须使用新的编排作业类型，并支持：

```text
preview → approve → apply → reconcile → complete
```

### 18.9 P3 页面与操作体验

建议新增：

1. **变更向导**：选择变更类型 → 编辑差异 → 查看影响 → 提交审批；
2. **续签工作台**：90/60/30 天待办、续签商机、服务和客户资产范围；
3. **合同控制塔**：按责任人展示高风险和逾期事项；
4. **合同 360°**：收入、成本、项目、资产、服务、财务和风险聚合；
5. **AI 对照审阅页**：左侧合同文本，右侧候选字段、差异和风险，逐项确认。

高级功能按角色和功能开关展示，不增加普通销售创建合同的步骤。

### 18.10 P3 实施工作包

#### P3-0：数据质量与指标基线

任务：

- 定义合同、项目、资产、服务、采购和财务指标口径；
- 建立数据完整性评分和异常队列；
- 修复跨应用编码、重复记录和缺失关联；
- 增加功能开关 `altoc.contract_control_tower`；
- 确定风险规则所有者和维护流程。

完成标准：

- 关键指标均可追溯到业务对象；
- 控制塔不依赖无法解释的黑盒分数。

#### P3-1：合同变更与版本基线

任务：

- 新增变更、快照和影响模型；
- 有效合同核心字段改为只能通过变更命令更新；
- 接入 Workflow 和 Codocs；
- 变更生效后编排项目、资产、服务、结算和采购更新；
- 增加失败恢复和对账。

完成标准：

- 任意有效合同可还原任一历史基线；
- 变更前可预览影响，变更后可追溯所有下游调整。

#### P3-2：续签、终止和退出

任务：

- 生成续签计划和提醒；
- 一键创建续约商机或续签合同草稿；
- 支持服务协议、订阅和客户资产续期；
- 建立终止和退出清单；
- 处理未履约义务和财务结算任务。

完成标准：

- 维保、订阅和运营服务不会因遗漏提醒而无声过期；
- 终止操作不会伪造财务结果或遗漏资产、账号和数据退出事项。

#### P3-3：履约控制塔和合同 360°

任务：

- 建立风险事件和例外工作台；
- 聚合项目、资产、服务、财务和采购状态；
- 支持责任人、部门、客户和合同类型筛选；
- 支持风险分派、截止日期和关闭原因；
- 增加企业经营驾驶舱的聚合接口。

完成标准：

- 管理者可从风险项追溯到具体义务和原始数据；
- 普通用户只看到自己需要处理的例外事项。

#### P3-4：合同与供应商绩效

任务：

- 建立履约、SLA、财务和毛利指标；
- 建立供应商按时交付、质量和发票异常指标；
- 支持按客户、产品、合同类型、项目和供应商分析；
- 提供指标口径说明和更新时间；
- 增加定期快照，避免历史指标被当前数据覆盖。

完成标准：

- 同一指标在 Altoc、Aims、Assets 和 Finance 口径一致；
- 绩效结果可用于续签、供应商复评和合同谈判。

#### P3-5：风险与合规规则

任务：

- 配置首批非标条款和商业风险规则；
- 接入职责分离和审批加签；
- 对高风险合同增加签署前检查清单；
- 建立规则版本和命中审计；
- 支持租户级阈值而非硬编码。

完成标准：

- 风险提示不会因模板更新而改变历史合同的审计结果；
- 禁止级规则只能由有权限的管理员修改。

#### P3-6：AI 辅助和文档对照

任务：

- 接入 Codocs 合同文档；
- 实现字段候选提取和人工确认；
- 实现模板、版本和业务数据差异比较；
- 保存模型、提示和审阅记录；
- 支持租户禁用和敏感合同禁用；
- 建立准确率、采纳率和人工节省时间指标。

完成标准：

- AI 结果未经人工确认不写入合同事实表；
- 每个建议都能展示来源和置信度；
- 模型失败不会阻断正常合同流程。

#### P3-7：电子签署与外部集成（可选）

任务：

- 通过标准适配器接入电子签章或签署状态；
- 接收签署完成、拒签和失效事件；
- 将最终签署文档和哈希写入 Codocs；
- 不在 Huizhi-yun 内自建证书和签章基础设施；
- 增加外部系统失败重试和人工补录。

完成标准：

- 外部签署状态与合同法律状态一致；
- 外部服务不可用时仍可通过人工签署证据完成流程。

### 18.11 P3 验收业务故事

至少通过：

1. 金额和范围变更：补充协议生效后更新项目、应收、采购和毛利，但保留旧基线；
2. 服务续签：提前 90 天生成待办和商机，选择已有客户资产并延长服务协议；
3. 提前终止：生成项目收尾、服务停止、资产/账号处置和财务结算清单；
4. 毛利侵蚀：采购成本上涨或项目超支后形成风险并能追溯原因；
5. 供应商延期：采购义务逾期影响销售交付时，在控制塔中形成跨应用风险；
6. AI 提取：从合同文本提取付款、服务期和续约条款，经人工确认后生成结构化数据；
7. 变更执行失败：部分下游更新失败后可重试，不重复已成功步骤。

---

## 19. 数据迁移方案

## 19.1 总体策略

采用四阶段迁移：

```text
扩展表结构 → 后台回填 → 双读兼容 → 新模型切换
```

P0、P1 不直接删除旧表和旧字段。P0A 只做合同头字段、合同行和历史汇总行迁移；旧付款条款和旧合同阶段在 P0A 只读展示，不迁移为新义务或新结算计划。付款条款和合同阶段迁移进入 P0B。

## 19.2 旧合同迁移

默认规则：

- `direction = sales`；
- 能从 `source_contract_type` 映射的，写入对应主类型；
- 无法识别的写入 `mixed_solution` 或 `legacy_contract` 标识；
- 根据合同金额生成一条“历史合同汇总行”；
- 从 `service_period_months` 生成服务期间；
- 保留原始字段快照到 `snapshot_json`。

## 19.3 付款条款迁移（P0B）

P0A 不执行本节迁移，只保留旧付款条款只读展示和金额对账。P0B 开启 `altoc.contract_obligation_billing_v2` 后再执行：

- `contract_signed` → `contract_effective`；
- `delivery` → 绑定迁移生成的交付义务；
- `acceptance` → 绑定验收义务；
- `service_end` → 绑定服务期结束义务；
- 无法判断的条款保留 `manual_approval` 触发，并列入人工确认。

## 19.4 维保合同迁移（P1B）

P0A / P0B 不迁移 `maintenance_contract`。P1B 采用双读方式，并由 `031_service_agreement_ticket_sla.sql` 完成可自动迁移部分：

1. 为每个现有 `maintenance_contract` 找到或创建统一合同中的运维行；
2. 对已有关联合同的维保合同创建 `service_agreement`；
3. 将 `service_entitlement` 的 SLA、额度和计费方式折算到服务协议；
4. 优先用 `delivery_code` 关联已有客户交付资产；
5. 无法关联资产的生成 `pending-maintenance-*` 覆盖占位，进入“待补充覆盖资产”队列；
6. 工单写回 `service_agreement_id`、`delivery_asset_code`、权益状态和 SLA 截止时间；
7. 旧页面转为只读，保留一个发布周期后再关闭写入。

## 19.5 校验指标

迁移前后必须对账：

- 合同数量；
- 合同总金额；
- 按状态数量；
- 付款条款或结算计划金额；
- 维保合同数量和服务期限；
- 关联客户、商机、项目和报价数量；
- 无法映射记录数量。

---

## 20. 测试与验收

## 20.1 自动化测试层次

### P0A 自动化测试

- 合同方向、主类型、协议形式和模板生成；
- 报价行转换为合同行；
- 合同行金额汇总和合同头金额一致性校验；
- 综合合同增删行；
- 旧合同历史汇总行迁移；
- P0A 写入开关关闭后旧合同页面和旧 API 不受影响；
- P0A 不生成 `contract_obligation`、`contract_billing_schedule` 和 `contract_orchestration_*`。

### P0A 数据库集成测试

- `contract_line` 唯一业务编码；
- 报价转合同事务回滚；
- 合同行并发更新和 `lock_version`；
- 迁移脚本幂等；
- 合同数量、金额、客户、商机和报价关联对账。

### P0B 自动化测试

- 旧状态到新四状态兼容映射；
- 合同状态转换；
- 履约义务生成、提交、验收和驳回；
- 结算计划绑定义务；
- 旧付款条款迁移为结算计划；
- 旧合同阶段迁移为履约义务；
- `force_complete` 从正常生命周期隔离。

### P1A 跨应用契约测试

- Altoc → Aims 创建项目；
- Altoc → Assets 创建计划资产；
- Altoc 回款计划 → Finance 开票申请和 submit；
- Aims → Altoc 里程碑事件；
- Assets → Altoc 交付或验收事件；
- Finance → Altoc 财务摘要事件；
- 下游超时、重复、失败和重试；
- 正确调用、缺 capability、错 audience、错来源应用、错 tenant/deployment、Token 过期和写请求幂等重放。

### P1A 编排恢复测试

- worker lease 过期后由另一个实例接管；
- 前置步骤失败时后续步骤不执行；
- 下游返回幂等冲突时能读取已有对象业务键；
- Finance 成功但 Altoc 审计失败时可重放记录步骤；
- 取消作业不会删除已成功创建的下游对象。

### 端到端测试

按阶段覆盖首批验收场景：P0A 只要求场景一的报价到合同行；P0B 再要求义务和结算触发；P1A 再要求项目、资产、Finance 和失败恢复。

## 20.2 必须通过的业务场景

### 场景一：软件许可直接销售

```text
报价 → 合同 → 软件许可行 → 不建项目
→ 许可证交付 → 客户交付资产 → 开票节点
```

### 场景二：定制开发

```text
合同 → 定制开发行 → 创建或关联项目
→ 项目里程碑 → 客户验收 → 分阶段应收
```

### 场景三：产品+实施+维保

```text
许可行 + 实施行 + 维保行
→ 交付项目 → 客户资产 → 服务协议 → 续约提醒
```

### 场景四：系统集成

```text
自研软件 + 第三方软件 + 硬件 + 集成服务
→ 多项采购建议 → 交付项目 → 多资产交付 → 分批验收
```

### 场景五：关联已有项目

```text
老客户追加合同 → 关联现有项目
→ 新增工作包和履约义务 → 不重复创建项目
```

### 场景六：维保续签

```text
选择已有客户交付资产 → 创建运维合同
→ 服务协议续期 → 权益延续 → 到期提醒更新
```

### 场景七：下游失败恢复

```text
项目创建成功 → 资产创建失败 → Altoc 回款计划成功
→ 用户重试资产步骤 → 不重复项目和回款计划
```

### 场景八：采购框架合同（P1B）

```text
年度采购框架 → 多次采购订单释放
→ 展示已使用金额与剩余额度 → 收货/服务验收 → 应付计划
```

### 场景九：第三方产品销售采购穿透（P2）

```text
销售合同行 → 外采建议 → 采购合同/采购订单
→ 供应商许可交付 → 客户交付资产 → 应付与实际毛利
```

### 场景十：外包开发验收与付款（P2）

```text
销售项目 → 外包采购合同 → Aims工作包
→ 服务验收 → 供应商发票匹配 → 应付和项目成本
```

### 场景十一：合同正式变更（P3）

```text
发起金额和范围变更 → 影响预览 → 审批和签署
→ 新基线 → 项目/资产/结算/采购调整 → 对账完成
```

### 场景十二：运维服务续签（P3）

```text
到期前提醒 → 生成续约商机 → 续签合同
→ 延长服务协议和客户资产覆盖 → 更新结算计划
```

### 场景十三：AI辅助审阅（P3）

```text
Codocs合同文本 → AI提取和差异提示
→ 人工逐项确认 → 写入结构化合同数据 → 全程审计
```

## 20.3 非功能验收

- 所有写命令具备幂等；
- 合同生效并发请求只成功一次；
- 关键状态变化全量审计；
- 下游失败不造成不可恢复的半成品；
- 列表和详情遵守租户及数据范围；
- 合同常用页面在企业常见数据量下响应稳定；
- 无权限用户不能通过普通 PUT 绕过状态机。

---

## 21. 发布与切换策略

## 21.1 功能开关

按租户控制：

```text
altoc.contract_hub_v2
altoc.contract_hub_v2_write
altoc.contract_obligation_billing_v2
altoc.contract_activation_orchestration
altoc.service_agreement_v2
altoc.purchase_contract_v2
altoc.purchase_contract_full_v2
altoc.contract_amendment_v2
altoc.contract_control_tower
altoc.contract_ai_assistant
```

功能开关应区分“只读预览”和“写入生效”：

- `altoc.contract_hub_v2`：允许读取和预览 V2 合同模型。
- `altoc.contract_hub_v2_write`：允许 P0A 新建或修改 V2 合同、合同行和模板快照。
- `altoc.contract_obligation_billing_v2`：允许 P0B 生成和修改履约义务、结算计划和相关状态机字段。
- `altoc.contract_activation_orchestration`：允许执行多步骤履约启动编排。
- P2/P3 开关必须按能力拆分，不得用一个总开关同时启用采购、变更、控制塔和 AI。

## 21.2 发布阶段

### 阶段一：内部开发环境

- 使用模拟数据；
- 跑完整自动化测试；
- 验证角色权限和跨应用契约。

### 阶段二：试点租户或业务团队

选择：

- 合同数量适中；
- 同时包含软件销售、实施和维保；
- 愿意提供反馈的团队。

试点期间：

- P0A 试点只允许新合同使用 V2 合同头和合同行；
- 旧合同只读展示 V2 合同行转换结果；
- P0B 试点再开启义务、结算计划和状态机拆分；
- P1A 试点再开启履约启动编排和跨应用步骤状态；
- 每周按已开启阶段分别对账合同、合同行、Altoc 回款计划、项目、资产和 Finance 开票/核销摘要数据。

### 阶段三：全租户开放

- 默认启用新合同创建；
- 旧合同页面跳转新工作台；
- 旧维保合同停止新增；
- 保留兼容 API 一个约定发布周期。

### 阶段四：P2 采购和成本试点

- 先选择第三方转售、硬件框架和外包开发三个业务场景；
- 与采购、项目和财务团队按周对账；
- 达到合同、订单、验收和应付一致后再扩大范围；
- 不强制所有零星采购建立采购合同。

### 阶段五：P3 分能力灰度

- 合同变更和版本基线优先上线；
- 续签与控制塔按部门灰度；
- AI 功能默认关闭，由租户管理员和合同负责人选择启用；
- 每个 P3 能力均有独立功能开关和回退路径。

## 21.3 回滚原则

- 不删除旧字段和旧表；
- 所有新建对象保留来源和版本号；
- 编排步骤可停止，但已成功的下游对象不强制删除；
- 通过补偿任务解除或标记，不执行跨应用级联物理删除。

---

## 22. 建议团队与迭代安排

### 推荐团队

```text
产品/业务分析        1
技术负责人/架构       0.5–1
Go 后端               2
Nuxt 前端             2
测试                  1
DevOps/DBA            0.5
Aims/Assets/Finance负责人 各兼职参与接口评审
```

### 参考迭代

| 迭代 | 主要内容 |
|---|---|
| 第 1 周 | ADR、数据字典、功能开关、接口契约 |
| 第 2–3 周 | P0A 合同分类、模板、合同行和报价转换 |
| 第 4–5 周 | P0B 履约义务、结算计划、状态机矩阵和禁写规则 |
| 第 6–7 周 | 新建向导、详情工作台、迁移、兼容映射和 P0 验收 |
| 第 8–9 周 | P1A 履约启动计划、Outbox、编排状态和现有 activate-delivery 链路硬化 |
| 第 10–11 周 | Aims 项目创建/关联与里程碑联动 |
| 第 12–13 周 | Assets 客户交付资产联动 |
| 第 14–15 周 | 服务协议、SLA、Altoc 回款计划和 Finance 开票/摘要联动 |
| 第 16 周 | P1 综合回归、试点发布和培训 |
| 第 17–18 周 | P2 采购领域基线、采购合同和采购模板 |
| 第 19–21 周 | 框架额度、采购订单释放和采购验收 |
| 第 22–24 周 | Finance 应付、发票匹配和成本回写 |
| 第 25–26 周 | 销售采购穿透、毛利看板和 P2 试点 |
| 第 27–30 周 | P3A 合同变更、版本快照和影响编排 |
| 第 31–34 周 | P3B 续签、终止和履约控制塔 |
| 第 35–38 周 | P3C 合同/供应商绩效和风险规则 |
| 第 39–42 周 | P3D AI 辅助、文档对照和可选签署集成 |

> **跨团队联动周（第 10–15 周）以 P1-0 跨团队接口契约冻结为前置（见 16.0）。** Aims `eligible-for-contract`、Assets `customer-delivery-assets/*` 和 Finance 已落地接口可进入联调；剩余 P1B/P2 采购相关待新增接口未冻结契约并取得排期承诺前，对应联动周不计入交付承诺，相关工作包只做 Altoc 侧本地建模与占位 UI。该计划假定外部模块按期交付接口；该假定不成立时，应按 16.0 依赖矩阵的“回退”列降级或后置，而不是顺延整条 Altoc 时间线。

团队规模较小时，应优先保证 P0A、P0B 和 P1A，再依次交付一合同多项目、资产、服务协议和采购基础。P0B 不能为了赶进度取消状态机、领域命令和迁移校验；P1A 不能取消幂等、编排恢复和跨应用审计。

---

## 23. 关键监控指标

上线后建议跟踪：

### 使用便利性

- 从报价创建合同的平均耗时；
- 合同草稿一次提交通过率；
- 使用模板创建的合同占比；
- 需要手工修改高级策略的合同占比；
- 合同启动后人工补录次数。

### 数据完整性

- P0A：有合同行的合同占比；
- P0A：报价转合同产品和金额一致率；
- P0A：旧合同历史汇总行覆盖率；
- P0B：有履约义务的有效合同占比；
- 需要项目但未关联项目的合同数；
- 应形成客户资产但未形成的合同行数；
- 运维协议未覆盖资产的数量；
- P0B：结算计划与合同金额差异数。

### 履约质量

- 履约义务按期完成率；
- 项目里程碑延期率；
- 合同生效到项目启动耗时；
- 客户交付资产上线到验收耗时；
- 服务协议即将到期和逾期续签数量。

### 技术可靠性

- 编排成功率；
- 重试次数；
- 重复请求幂等命中数；
- 跨应用失败步骤数量；
- 数据迁移异常记录数量。

### P2 采购与成本

- 采购合同行关联采购订单的比例；
- 框架合同额度使用率和超额度拦截数；
- 收货或服务验收按期完成率；
- 发票匹配一次通过率；
- 销售合同行采购成本关联率；
- 计划毛利、预测毛利和实际毛利偏差。

### P3 生命周期与治理

- 合同变更平均处理周期；
- 变更影响编排一次成功率；
- 到期合同提前完成续签决策的比例；
- 续签率和流失原因；
- 履约义务逾期数量及关闭周期；
- 高风险合同处理及时率；
- 供应商按时交付率和 SLA 达标率；
- AI 字段提取采纳率、修正率和节省录入时间。

---

## 24. 开发前必须确认的决策

正式进入编码前，产品和架构组应确认：

1. 已落地 Aims / Assets / Finance / Workflow / Codocs service 契约的复用矩阵，以及待新增 / 待改造接口的契约冻结与跨团队排期（见 16.0 / P1-0）；
2. Assets 是否作为产品技术主档和客户交付资产的唯一数据所有者；
3. Altoc 现有 `product` 是否明确作为商业产品与服务目录；
4. 合同编号、合同行编号和履约义务编号规则；
5. P1 是否包含采购合同最小闭环，还是作为 P1B 独立发布；
6. Finance 仅接收开票申请、付款/核销相关命令和财务摘要，还是需要接收结算计划事件；如选择后者，必须先做事实源 ADR；
7. Workflow 的合同审批回调契约；
8. Codocs 合同文本和版本快照的引用方式；
9. 旧 `maintenance_contract` 的兼容期长度；
10. 历史合同是否仅生成汇总行，还是对重点存量合同人工拆行；
11. 试点租户和首批标准业务模板；
12. 采购需求和采购订单是否由 Assets 作为唯一事实源；
13. 框架合同释放是否统一以采购订单行为执行对象；
14. 供应商主数据的唯一所有者和重复合并规则；
15. 采购发票匹配的容差、预付款和质保金策略；
16. 销售采购成本分摊和毛利计算口径；
17. 有效合同基线、补充协议和续签合同的版本规则；
18. 续签提醒周期、责任人和自动生成商机策略；
19. P3 风险规则的业务所有者、阈值和审批权限；
20. AI 模型提供方、数据驻留、敏感合同禁用和结果保留策略；
21. P2、P3 试点部门和逐能力启用顺序；
22. 状态转移矩阵、旧状态兼容映射和 `contract.status` 废弃时点；
23. 编排 worker 的 lease、重试、死信、补偿和用户可见错误规则；
24. 权限命名分层和新增 service capability 清单；
25. 实际迁移文件编号和迁移异常处理表结构。

这些决策应记录为 ADR，不应只存在于会议纪要。

---

## 25. 最终完成定义

P0、P1 不能只以“页面完成”作为验收标准。商业履约中枢按阶段完成：

```text
P0A：
报价中的产品和服务能够进入合同；
合同能够用合同行准确表达卖了什么 / 买了什么；
旧合同能够以历史汇总行进入新详情页；

P0B：
合同能够被拆成可履约的义务；
义务能够决定项目、资产、服务和结算动作；

P1A：
各应用执行结果能够回到合同；
任何一步失败都可识别、可重试、可审计；

全阶段：
普通企业用户能够依靠模板完成操作，而无需理解全部技术模型。
```

P0A 完成后，Altoc 应从“合同登记模块”升级为能结构化表达合同产品与服务的合同核心。P0A 不承诺履约义务、结算计划或跨应用编排。

P0B 完成后，Altoc 应从“合同产品与服务结构化”升级为具备履约义务、结算条件和状态机的合同核心。

P1 完成后，Altoc 应具备销售合同的履约主链路：

```text
商机/报价
  → 合同及合同行
  → 履约启动
  → 创建或关联项目
  → 形成客户交付资产
  → 激活服务协议
  → 触发 Altoc 回款计划和 Finance 开票申请
  → 汇总履约和财务结果
```

P2 完成后，应进一步形成采购和成本闭环：

```text
销售合同行 / 项目需求
  → 外采建议
  → 采购合同或采购订单
  → 收货、许可开通或服务验收
  → 应付和付款
  → 成本回写与实际毛利
```

P3 完成后，应具备可持续经营和治理能力：

```text
合同变更与版本基线
  + 续签、终止和退出管理
  + 履约风险控制塔
  + 合同与供应商绩效
  + 人工确认的 AI 辅助
```

完整路线的最终完成定义是：商业承诺能够被结构化、执行对象能够被自动衔接、变更和风险能够被持续治理、经营结果能够被准确追溯，同时普通企业用户主要依靠模板和例外工作台完成操作，而不需要理解全部底层模型。

这套能力是 Huizhi-yun 成为面向 50–300 人软件和信息化服务企业的一体化经营平台所需的商业履约基础。
