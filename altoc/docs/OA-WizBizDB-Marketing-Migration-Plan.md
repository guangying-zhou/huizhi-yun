# OA wizbizdb 营销与财务数据迁移方案

日期：2026-05-15
源库：`oa.wiztek.cn/wizbizdb`
目标库：`hzy_altoc` + 财务模块目标库（暂按 `hzy_finance` 命名）

## 0. 迁移边界

本方案按平台长期边界拆分：

- **Altoc 管经营前台事实**：客户、联系人、产品、合同、付款条款、经营回款计划、应收风险、催收动作和经营看板。
- **Finance 管财务后台事实**：正式发票、到账/银行流水、收款核销、非合同收入、费用支出、银行账户、收入确认、成本归集、凭证和财务报表。

一句话原则：Altoc 管“为什么收、该收多少、什么时候该收、谁负责推进”；Finance 管“票是否开了、钱是否到账、怎么核销、怎么入账”。

因此，OA 存量数据不再全部迁入 Altoc。合同以前的经营链路进入 Altoc，发票、到账、非合同收入、支出进入 Finance；Altoc 只通过 Finance API 或同步投影展示开票/到账摘要。

## 1. 源库盘点

`wizbizdb` 共 76 张表。营销与财务相关核心表如下：

| 源表 | 数据量 | 说明 | 目标归属 |
| --- | ---: | --- | --- |
| `wb_organization` | 751 | 组织/客户，含上下级、地域、官网、联系人摘要、历史合同/应收统计 | Altoc `customer` |
| `wb_contactman` | 1582 | 客户联系人，含部门、职务、电话、微信、地址、星级 | Altoc `contact` |
| `wb_product` | 19 | 产品目录 | Altoc `product` |
| `wb_system` | 215 | 客户运行系统，关联客户、联系人、主合同和维保合同 | Altoc 暂存 legacy 引用；二期可建客户系统台账 |
| `wb_contract` | 1530 | 合同，含客户、联系人、项目、系统、合同类型、金额、付款方式、周期、状态 | Altoc `contract` |
| `wb_invoice` | 1855 | 发票，全部挂合同 | Finance 正式发票；Altoc 只读开票摘要 |
| `wb_project_income` | 2993 | 项目收入/到账，2072 条挂合同，921 条不挂合同 | Finance 收款/收入；Altoc 只读到账摘要 |
| `wb_project_payment` | 3732 | 项目支出，含支出类型、账户、收款人、合同引用 | Finance 费用/支出台账 |
| `wb_payment_plan` | 15 | 组织级付款计划，不挂合同 | Finance/人工待处理，不直接生成 Altoc 回款计划 |
| `wb_bank_account` | 20 | 银行账户 | Finance 银行账户 |
| `wb_account_balance` | 2494 | 银行账户余额 | Finance 账户余额快照 |
| `sys_dict_type/sys_dict_data` | 39/208 | 源系统字典 | Altoc/Finance 迁移映射共用 |
| `wb_employee/sys_user` | 136/17 | 员工和用户 | 映射负责人、经办人、确认人 |

关键质量结论：

| 检查项 | 结果 | 处理 |
| --- | --- | --- |
| 客户状态 | `org_status=0` 743 条，`1` 8 条 | 0 -> `active`，1 -> `archived/deleted_at` 视业务确认 |
| 客户层级 | 根客户 360，子客户 391 | Altoc 增补 `customer.parent_customer_id`，分两轮回填 |
| 合同客户引用 | 缺失客户 0 | 可直接迁合同 |
| 合同联系人 | 229 条无联系人 | Altoc `contract.contact_id` 允许为空 |
| 合同状态 | 正常 1509，完结 1，中止 20 | 0 -> `effective`，1 -> `completed`，2 -> `terminated` |
| 合同金额 | 合同总额 224,940,268.50，有效金额 210,273,226.92 | Altoc 保留合同金额和源汇总快照 |
| 发票引用 | 1855 条全部挂合同，缺失合同 0 | Finance 可直接迁正式发票 |
| 发票金额 | 188,454,032.93 | 财务报表以 Finance 发票明细汇总为准 |
| 到账引用 | 2072 条挂合同，921 条不挂合同 | 挂合同进入 Finance 合同收款；不挂合同进入 Finance 非合同收入/待归类 |
| 到账金额 | 总额 201,947,059.08；挂合同 199,588,527.36；不挂合同 2,358,531.72 | Altoc 不直接持有到账事实，只接收合同回款摘要 |

## 2. 目标模型调整

### 2.1 Altoc 保留内容

| Altoc 表 | 迁移/保留重点 |
| --- | --- |
| `customer` | 客户主数据、上级客户、电话、省市、公众号、源系统起始日期、源系统统计快照 |
| `contact` | 联系人主数据、备用手机、快递地址、源星级 |
| `product` | 产品目录、上级产品、启动日期、完成度、源引用 |
| `contract` | 合同主数据、客户/联系人、合同金额、付款条款摘要、源合同类型、第三方、项目/系统 legacy 引用 |
| `contract_payment_term` | 后续从合同付款条款拆分出的经营付款节点 |
| `receivable_plan` | 经营回款计划/预测，不作为财务应收账 |
| `legacy_migration_map` | 记录源 ID 到 Altoc 目标 ID 的映射，支持幂等重跑和跨模块引用 |

### 2.2 Finance 承接内容

以下表名是财务模块设计前的建议命名，最终以 Finance schema 为准：

| Finance 建议表 | 来源 | 说明 |
| --- | --- | --- |
| `finance_invoice` | `wb_invoice` | 正式发票事实源 |
| `finance_receipt` | `wb_project_income WHERE contract_id IS NOT NULL` | 合同收款/到账事实源 |
| `finance_unclassified_income` | `wb_project_income WHERE contract_id IS NULL` | 非合同收入、利息、补贴、借款、费用分摊等待归类收入 |
| `finance_expense` | `wb_project_payment` | 项目支出、销售费用、采购、退款、银行手续费等 |
| `finance_bank_account` | `wb_bank_account` | 银行账户资料 |
| `finance_account_balance_snapshot` | `wb_account_balance` | 账户余额历史快照 |
| `finance_migration_map` | 所有财务源表 | 财务侧源 ID 到目标 ID 映射 |

### 2.3 现有 Altoc 兼容字段的定位

`docs/migrations/002_wizbizdb_marketing_compat.sql` 已补了 Altoc 的 `invoice`、`payment_record`、`legacy_unmapped_income` 兼容字段。按新边界处理如下：

- 如果 Finance 模块在正式迁移前已经落地：**不执行** Altoc 中发票、到账、未挂合同收入相关的结构迁移；只保留客户/联系人/产品/合同/迁移映射相关增补。
- 如果 Finance 模块晚于 OA 数据迁移：Altoc 可短期使用 `invoice`、`payment_record`、`legacy_unmapped_income` 作为**过渡暂存表**，后续整体迁入 Finance，并在 Altoc 改成只读投影。
- 无论哪种路径，长期事实源都应是 Finance，Altoc 不做正式发票、到账和核销的权威库。

## 3. 字段映射

### 3.1 客户 -> Altoc

| `wb_organization` | `customer` | 规则 |
| --- | --- | --- |
| `org_id` | `legacy_id` | `legacy_source='wizbizdb'` |
| `org_name` | `name` | 保持原名 |
| `short_name` | `short_name` | 原样 |
| `org_type` | `customer_type_id/is_partner` | `1=客户`；若后续出现 `2/3`，映射为伙伴/供应商类型 |
| `parent_id` | `parent_customer_id` | 先建客户，再根据 `legacy_migration_map` 回填 |
| `telephone` | `telephone` | 原样 |
| `province/city` | `province/city` | 原样；`region_code` 后续按 Console 区域字典人工映射 |
| `web_site` | `website` | 原样 |
| `weixin_number` | `wechat_official_account` | 原样 |
| `description` | `description` | 原样 |
| `org_status` | `status/deleted_at` | 0 -> `active`，1 -> `archived` 或设置 `deleted_at` |
| `employee_id` | `owner_user_id` | `wb_employee.user_id -> sys_user.user_name` |
| `operator_id/operate_time` | `created_by/created_at/updated_at` | 操作员映射到用户名，时间沿用 |
| 合同/应收统计字段 | `legacy_stats_json` | 仅保留源快照，实时指标来自 Altoc + Finance 汇总 |

### 3.2 联系人 -> Altoc

| `wb_contactman` | `contact` | 规则 |
| --- | --- | --- |
| `contactman_id` | `legacy_id` | `legacy_source='wizbizdb'` |
| `org_id` | `customer_id` | 通过客户迁移映射查目标 ID |
| `cm_name` | `name` | 原样 |
| `department` | `dept_name` | 原样 |
| `post` | `job_title` | 原样 |
| `mobile/mobile2` | `mobile/alternate_mobile` | 原样 |
| `phone` | `phone` | 原样 |
| `address` | `mailing_address` | 原样 |
| `weixin_number` | `wechat` | 原样 |
| `stars` | `star_level` | 源系统编码保留 |
| `chief` | `is_key_contact` | 字段语义需确认；当前只作为候选关键联系人 |
| `employee_id` | `owner_user_id` | 员工到用户映射 |

### 3.3 产品/系统 -> Altoc

| 源表 | 目标 | 规则 |
| --- | --- | --- |
| `wb_product.product_id` | `product.legacy_id` | `legacy_source='wizbizdb'` |
| `product_code/product_name` | `product.code/name` | 原样 |
| `parent_id` | `parent_product_id` | 二轮回填 |
| `product_status` | `status` | 0 -> `active`，1 -> `inactive` |
| `start_date/completeness/solution_id/dept_id/employee_id` | `started_at/completeness/legacy_refs_json` | 保真 |
| `wb_system` | 暂不直接迁主表 | 合同上的 `system_id` 进入 `contract.legacy_refs_json`；系统台账二期再建 |

### 3.4 合同 -> Altoc

| `wb_contract` | `contract` | 规则 |
| --- | --- | --- |
| `contract_id` | `legacy_id` | `legacy_source='wizbizdb'` |
| `contract_code` | `code/contract_no` | `code` 用源编码；若和 Altoc 新编码冲突，加 `WB-` 前缀 |
| `contract_name` | `name` | 原样 |
| `customer_id` | `customer_id` | 源客户映射 |
| `contactman_id` | `contact_id` | 源联系人映射，允许空 |
| `contract_status` | `status` | 0 -> `effective`，1 -> `completed`，2 -> `terminated` |
| `sign_date/due_date` | `sign_date/effective_date/end_date` | `effective_date` 暂取签订日期 |
| `total_amount` | `amount_tax_inclusive` | 原样 |
| `prime_amount/invoice_amount/exec_amount` | `prime_amount/invoiced_amount/executed_amount` | 只作为源系统历史快照；长期开票/到账汇总来自 Finance |
| `payment` | `payment_term_summary` | 原样；后续可人工/规则拆成 `contract_payment_term` |
| `description/tos` | `content_summary/service_terms` | 原样 |
| `contract_type` | `source_contract_type` | 字典 `wb_contract_type` |
| `is_third_party/third_party_id` | `is_third_party/third_party_customer_id` | 第三方按客户映射 |
| `project_id/impl_project_id/company_id/ba_id/system_id/old_id` | `legacy_refs_json` | 保真，不强行建跨模块外键 |
| `employee_id` | `owner_user_id` | 员工到用户映射；无法映射时用兜底迁移用户 |

### 3.5 发票 -> Finance

| `wb_invoice` | Finance 建议字段 | 规则 |
| --- | --- | --- |
| `invoice_id` | `legacy_id` | `legacy_source='wizbizdb'` |
| `invoice_code` | `invoice_code/invoice_no` | 空编码按 `IV-WB-{invoice_id}` 生成 |
| `contract_id` | `contract_code/contract_legacy_id` | 通过 Altoc `legacy_migration_map` 关联合同 |
| `project_id/company_id` | `source_refs_json` | 保留源项目/公司引用 |
| `receiver` | `receiver_name` | 原样 |
| `item` | `invoice_item` | 原样 |
| `amount` | `invoice_amount` | 原样 |
| `invoice_date` | `invoice_date` | 取日期部分 |
| `ap_id/oldcontract_id/oldinvoice_id` | `source_refs_json` | 保真 |
| `operator_id/operate_time` | `created_by/created_at` | 操作员映射到用户 |

Altoc 需要展示开票进度时，不读取本地 `invoice` 作为事实源，而通过 Finance API 获取按 `contract_code` 汇总的 `invoiced_amount/latest_invoice_date/invoice_count`。

### 3.6 到账/收入 -> Finance

| `wb_project_income` | Finance 建议字段 | 规则 |
| --- | --- | --- |
| `pi_id` | `legacy_id` | `legacy_source='wizbizdb'` |
| `pi_code` | `receipt_code` | 空编码按 `RC-WB-{pi_id}` 生成 |
| `contract_id` | `contract_code/contract_legacy_id` | 有合同时通过 Altoc 迁移映射关联合同 |
| `project_id` | `project_legacy_id/source_refs_json` | 原样保留 |
| `employee_id` | `handler_user_id` | 员工到用户映射 |
| `receipt_date` | `received_at` | 原样 |
| `amount` | `received_amount` | 原样；退款类按 Finance 规则处理正负号 |
| `channel` | `channel` | 源字典保留 |
| `ba_id` | `bank_account_legacy_id` | 关联 Finance 银行账户 |
| `income_type` | `income_type` | 源字典保留 |
| `payer` | `payer_name` | 原样 |
| `matter` | `description` | 原样 |
| `pp_id/operator_id/oldpayment_id` | `source_refs_json` | 保真 |

`contract_id IS NULL` 的 921 条收入进入 Finance `finance_unclassified_income`，不进入 Altoc。Finance 后续可人工归类为合同收款、利息、补贴、借款、费用分摊或其他收入。

### 3.7 支出/银行账户 -> Finance

| 源表 | Finance 建议目标 | 规则 |
| --- | --- | --- |
| `wb_project_payment` | `finance_expense` | 保留项目、合同、支出类型、金额、手续费、账户、收款人、审批编号 |
| `wb_bank_account` | `finance_bank_account` | 银行账户资料迁入 Finance，敏感账号按 Finance 脱敏策略展示 |
| `wb_account_balance` | `finance_account_balance_snapshot` | 作为历史余额快照，不反推当前余额 |
| `wb_payment_plan` | `finance_pending_payment_plan` 或人工核对清单 | 因不挂合同，不生成 Altoc 回款计划 |

## 4. 跨模块同步契约

Finance 模块落地后，建议提供以下只读/回调能力给 Altoc：

| 方向 | 接口/事件 | 用途 |
| --- | --- | --- |
| Altoc -> Finance | `POST /api/v1/finance/invoice-requests` | 合同或回款节点发起开票申请 |
| Altoc -> Finance | `GET /api/v1/finance/contracts/{contractCode}/summary` | 查询合同开票/到账/核销摘要 |
| Finance -> Altoc | `finance.invoice.issued` | 发票开具后更新 Altoc 合同开票摘要 |
| Finance -> Altoc | `finance.receipt.confirmed` | 到账确认后更新 Altoc 回款计划进度 |
| Finance -> Altoc | `finance.receipt.reconciled` | 核销后更新 Altoc 应收风险状态 |

跨模块引用使用业务键：`contract.code`、`receivable_plan.code`、`customer.code`、`legacy_source + legacy_id`。不得跨模块直连数据库。

## 5. 实施步骤

1. **冻结窗口与备份**
   - 备份 `wizbizdb`、`hzy_altoc` 和 Finance 目标库。
   - 在源系统停止营销/财务相关写入或记录增量窗口。

2. **目标结构准备**
   - Altoc 执行客户、联系人、产品、合同、迁移映射相关结构增补。
   - Finance 建立发票、收款、非合同收入、支出、银行账户、迁移映射表。
   - 如果 Finance 未及时落地，才启用 Altoc 的发票/到账过渡表，并在方案中标记迁移清退日期。

3. **准备映射**
   - 构建员工映射：`wb_employee.user_id -> sys_user.user_name`，再对齐 Console/Altoc/Finance 的 `uid`。
   - 构建字典映射：`wb_contract_type`、`wb_income_type`、`wb_payment_type`、收付款渠道。
   - 准备兜底用户，如 `migration_bot`，承接无法映射的历史负责人/经办人。

4. **分批迁移**
   - Altoc 批次：客户 -> 客户父级回填 -> 联系人 -> 产品 -> 合同 -> 经营回款计划。
   - Finance 批次：银行账户 -> 发票 -> 合同收款 -> 非合同收入 -> 支出 -> 余额快照。
   - 每批写入对应模块的 migration map。
   - 所有插入按 `(legacy_source, legacy_id)` 幂等，支持失败后重跑。

5. **派生经营回款计划**
   - 源库没有合同级回款计划表，`wb_payment_plan` 是组织级付款计划，不直接映射。
   - Altoc 按合同生成经营 `receivable_plan`：计划金额 = 合同总额或付款条款拆分额。
   - `received_amount/status` 不由 Altoc 手工确认，而由 Finance 的收款汇总同步更新。
   - 如需精细付款节点，再从合同 `payment_term_summary` 人工拆分为 `contract_payment_term`。

6. **校验与对账**
   - Altoc 校验客户、联系人、产品、合同行数与引用完整性。
   - Finance 校验发票、合同收款、非合同收入、支出、银行账户行数。
   - 金额校验分口径：合同总额在 Altoc；发票金额、到账金额、支出金额在 Finance。
   - 联动校验：Finance 发票/收款均能通过 `contract_code` 找到 Altoc 合同。

7. **切换**
   - Altoc 页面隐藏财务事实编辑入口，只展示 Finance 回传摘要。
   - Finance 负责发票、到账、核销、支出和财务报表入口。
   - 确认对账通过后，把源系统营销/财务数据改为只读或停止入口。

## 6. 校验 SQL

源库基线：

```sql
SELECT COUNT(*) FROM wizbizdb.wb_organization;
SELECT COUNT(*) FROM wizbizdb.wb_contactman;
SELECT COUNT(*) FROM wizbizdb.wb_contract;
SELECT COUNT(*) FROM wizbizdb.wb_invoice;
SELECT COUNT(*) FROM wizbizdb.wb_project_income WHERE contract_id IS NOT NULL;
SELECT COUNT(*) FROM wizbizdb.wb_project_income WHERE contract_id IS NULL;
SELECT COUNT(*) FROM wizbizdb.wb_project_payment;
SELECT COUNT(*) FROM wizbizdb.wb_bank_account;

SELECT SUM(total_amount), SUM(prime_amount), SUM(invoice_amount), SUM(exec_amount)
FROM wizbizdb.wb_contract;

SELECT SUM(amount) FROM wizbizdb.wb_invoice;
SELECT SUM(amount) FROM wizbizdb.wb_project_income WHERE contract_id IS NOT NULL;
SELECT SUM(amount) FROM wizbizdb.wb_project_income WHERE contract_id IS NULL;
SELECT SUM(amount) FROM wizbizdb.wb_project_payment;
```

Altoc 目标校验：

```sql
SELECT COUNT(*) FROM hzy_altoc.customer WHERE legacy_source = 'wizbizdb';
SELECT COUNT(*) FROM hzy_altoc.contact WHERE legacy_source = 'wizbizdb';
SELECT COUNT(*) FROM hzy_altoc.product WHERE legacy_source = 'wizbizdb';
SELECT COUNT(*) FROM hzy_altoc.contract WHERE legacy_source = 'wizbizdb';

SELECT SUM(amount_tax_inclusive), SUM(prime_amount), SUM(invoiced_amount), SUM(executed_amount)
FROM hzy_altoc.contract
WHERE legacy_source = 'wizbizdb';

SELECT COUNT(*)
FROM hzy_altoc.contract c
LEFT JOIN hzy_altoc.customer cu ON cu.id = c.customer_id
WHERE c.legacy_source = 'wizbizdb' AND cu.id IS NULL;
```

Finance 目标校验（表名按最终 Finance schema 调整）：

```sql
SELECT COUNT(*) FROM hzy_finance.finance_invoice WHERE legacy_source = 'wizbizdb';
SELECT COUNT(*) FROM hzy_finance.finance_receipt WHERE legacy_source = 'wizbizdb';
SELECT COUNT(*) FROM hzy_finance.finance_unclassified_income WHERE legacy_source = 'wizbizdb';
SELECT COUNT(*) FROM hzy_finance.finance_expense WHERE legacy_source = 'wizbizdb';

SELECT SUM(invoice_amount)
FROM hzy_finance.finance_invoice
WHERE legacy_source = 'wizbizdb';

SELECT SUM(received_amount)
FROM hzy_finance.finance_receipt
WHERE legacy_source = 'wizbizdb';

SELECT SUM(amount)
FROM hzy_finance.finance_unclassified_income
WHERE legacy_source = 'wizbizdb';

SELECT SUM(expense_amount)
FROM hzy_finance.finance_expense
WHERE legacy_source = 'wizbizdb';
```

跨模块引用校验：

```sql
-- Finance 发票是否都能关联 Altoc 合同。
SELECT COUNT(*)
FROM hzy_finance.finance_invoice i
LEFT JOIN hzy_altoc.contract c
  ON c.code = i.contract_code
WHERE i.legacy_source = 'wizbizdb'
  AND i.contract_code IS NOT NULL
  AND c.id IS NULL;

-- Finance 合同收款是否都能关联 Altoc 合同。
SELECT COUNT(*)
FROM hzy_finance.finance_receipt r
LEFT JOIN hzy_altoc.contract c
  ON c.code = r.contract_code
WHERE r.legacy_source = 'wizbizdb'
  AND r.contract_code IS NOT NULL
  AND c.id IS NULL;
```

## 7. 风险与待确认事项

1. `wb_contactman.chief` 字段注释缺失且 1403 条为 `1`，不像“关键联系人”的常规分布。迁移时先保留，不建议直接全部设为关键联系人。
2. `wb_contract.invoice_amount` 与 `wb_invoice` 明细汇总差异较大。Altoc 合同字段只能作为源系统快照，财务报表必须以 Finance 发票明细为准。
3. `wb_project_income` 有 921 条不挂合同收入，包含利息、补贴、借款、费用分摊等类型，必须进入 Finance 待归类收入，不进入 Altoc 合同回款。
4. `wb_project_payment` 是财务支出数据，不能因为关联合同就迁入 Altoc；Altoc 最多展示合同成本/支出摘要，事实源仍是 Finance。
5. 负责人/经办人映射中有少量员工没有对应 `sys_user.user_name`，需要迁移前补 Console 用户或使用兜底账号。
6. `wb_system` 是有价值的客户已交付系统台账，但 Altoc 当前没有对应主表。本次先保真引用，建议二期新增“客户系统/交付资产”模块。
7. 如果 Finance 模块晚于 OA 数据迁移，需要明确 Altoc 过渡表的清退计划，避免 `invoice/payment_record` 在两个模块长期双写。
