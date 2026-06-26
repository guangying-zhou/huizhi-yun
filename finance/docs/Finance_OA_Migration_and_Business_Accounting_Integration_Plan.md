# Finance OA 迁移与业账一体化开发方案

## 1. 背景与目标

旧 OA 系统通过“项目”承接收入、支出、销售费用和个人贡献，实际混合了客户项目、内部项目、区域销售、客户销售、部门费用、非合同收入等多类经营对象。继续把这些对象迁移成一个万能项目表，会导致合同、交付、费用、核算和报表口径混杂。

汇智云 Finance 的迁移目标是把旧 OA 的项目挂接习惯升级为“业务事实 + 核算对象 + 会计科目 + 经营维度”的业账一体化模型：

- 业务事实：发票、到账、核销、支出、报销、付款、预算占用。
- 核算对象：客户项目、内部项目、部门、合同、客户、销售区域、商机、销售专项、员工、其他专项。
- 会计科目：按《小企业会计准则》维护标准科目，如 `5001 主营业务收入`、`5401 主营业务成本`、`5601 销售费用`。
- 经营维度：客户、合同、项目、部门、销售区域、销售人员、费用类型、收入类型等。

本方案不把 Finance 做成完整总账系统，也不替代专业财务软件。Finance 负责经营财务事实、核算归集、凭证草稿和对外财务软件导出准备。

## 2. 核心原则

1. 不照搬旧 OA 的万能项目模型。
2. 客户、合同、商机归 Altoc；交付项目、研发项目归 Aims；Finance 只引用业务键并保存核算快照。
3. 没有实际合同的回款继续保持不生成虚拟合同号，进入无合同收入单或非合同收入归类流程。
4. 区域销售、客户销售不默认建“销售项目”，改为销售费用归集维度；只有真正项目化管理的销售战役才建销售专项。
5. 会计科目和业务分类分离：会计科目服务账务口径，费用类型、收入类型和核算对象服务经营分析。
6. 迁移数据必须保留旧 OA 来源键，保证历史追溯和新旧报表对账。

## 3. 目标业务模型

### 3.1 核算对象

新增统一核算对象模型，承接旧 OA 项目的真实业务含义。

```text
accounting_object_type:
- customer_project    客户交付项目
- internal_project    内部研发/管理项目
- department          部门/成本中心
- contract            合同
- customer            客户
- sales_region        销售区域
- opportunity         商机
- sales_campaign      销售专项/战役
- employee            员工
- other               其他专项
```

建议新增表：

```sql
CREATE TABLE finance_accounting_object (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    code                VARCHAR(50) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    object_type         VARCHAR(50) NOT NULL,
    source_app          VARCHAR(30) DEFAULT NULL,
    source_code         VARCHAR(50) DEFAULT NULL,
    legacy_source       VARCHAR(50) DEFAULT NULL,
    legacy_id           VARCHAR(100) DEFAULT NULL,
    customer_code       VARCHAR(50) DEFAULT NULL,
    contract_code       VARCHAR(50) DEFAULT NULL,
    project_code        VARCHAR(50) DEFAULT NULL,
    department_code     VARCHAR(50) DEFAULT NULL,
    owner_uid           VARCHAR(50) DEFAULT NULL,
    status              VARCHAR(20) DEFAULT 'active',
    remark              VARCHAR(500) DEFAULT NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_accounting_object_code (code),
    UNIQUE KEY uk_accounting_object_legacy (legacy_source, legacy_id),
    INDEX idx_accounting_object_type (object_type),
    INDEX idx_accounting_object_customer (customer_code),
    INDEX idx_accounting_object_contract (contract_code),
    INDEX idx_accounting_object_project (project_code),
    INDEX idx_accounting_object_dept (department_code)
);
```

### 3.2 单据归集字段

Finance 的收入、支出、报销、付款、非合同收入等单据逐步增加统一字段：

```text
accounting_object_type
accounting_object_code
subject_id
income_type_id / expense_type_id
customer_code nullable
contract_code nullable
project_code nullable
department_code nullable
sales_region_code nullable
sales_owner_uid nullable
source_refs_json
```

这些字段允许一笔费用不必强行挂项目。例如银行手续费只挂银行账户和 `5603 财务费用`，客户招待费挂客户或商机，项目采购挂客户交付项目。

### 3.3 无合同收入

没有实际合同的项目回款继续保持不创建虚拟合同号。新增或增强无合同收入单：

```text
receipt_source_type:
- contract        合同回款
- no_contract     无合同收入
- pre_contract    合同前预收
- other           其他收入
```

落账建议：

```text
receipt_source_type = no_contract
contract_code = null
project_code = 可选
customer_code = 可选
income_type = project_no_contract_income / maintenance / subsidy / other
subject = 5001 主营业务收入 / 5051 其他业务收入 / 5301 营业外收入
accounting_object_type = customer_project / customer / other
```

需要系统编号时生成无合同收入单号，而不是合同号：

```text
income_order_code = NCI-YYYYMM-0001
```

后续补签合同后，支持把无合同收入单关联到正式 `contract_code`，保留原始无合同来源和调整记录。

### 3.4 销售费用归集

淡化“销售项目”作为默认挂账容器，把区域销售和客户销售改为销售费用归集维度。

```text
subject_code = 5601 销售费用
expense_type = travel / entertainment / bid_fee / marketing / channel_fee
sales_scope_type = region / customer / opportunity / contract / sales_campaign / general
sales_scope_code = 对应业务编码
sales_owner_uid = 销售负责人
department_code = 销售部门
```

销售专项仅用于确实需要项目化管理的事项，例如年度区域拓展、大客户攻坚、渠道招商、重大投标战役。

## 4. 旧 OA 项目迁移映射

### 4.1 映射规则

| 旧 OA 项目类别 | 迁移目标 | 说明 |
| --- | --- | --- |
| 客户项目 / 合同项目 | `customer_project` | 关联 Altoc 客户/合同，必要时关联 Aims 交付项目 |
| 无合同客户项目 | `customer_project` 或 `customer` | 收入走无合同收入单，不生成虚拟合同 |
| 内部研发项目 | `internal_project` | 关联 Aims 内部项目或研发专项 |
| 部门费用项目 | `department` | 按部门/成本中心归集 |
| 区域销售项目 | `sales_region` | 按区域维度承接销售费用 |
| 客户销售项目 | `customer` | 按客户维度承接销售费用 |
| 商机/投标项目 | `opportunity` 或 `sales_campaign` | 能关联 Altoc 商机则优先挂商机 |
| 行政专项 | `other` 或 `department` | 视是否有明确专项目标决定 |
| 员工借支/个人费用 | `employee` | 关联员工和费用报销 |

### 4.2 迁移步骤

1. 导出旧 OA 项目主数据、项目类别、客户、部门、负责人、启停状态、旧编号。
2. 建立 `finance_migration_project_mapping` 临时表，人工或规则化标注目标 `accounting_object_type`。
3. 对客户、合同、商机、项目、部门做主数据匹配。
4. 生成 `finance_accounting_object`。
5. 迁移 `wb_project_income`、`wb_project_payment`、`wb_project_contribution`，写入对应核算对象。
6. 生成迁移对账报表：按旧项目、目标核算对象、收入、支出、余额、单据数核对。
7. 冻结旧 OA 财务录入入口，只保留查询。

建议临时映射表：

```sql
CREATE TABLE finance_migration_project_mapping (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT,
    legacy_source               VARCHAR(50) NOT NULL,
    legacy_project_id           VARCHAR(100) NOT NULL,
    legacy_project_code         VARCHAR(100) DEFAULT NULL,
    legacy_project_name         VARCHAR(200) NOT NULL,
    legacy_project_category     VARCHAR(100) DEFAULT NULL,
    target_object_type          VARCHAR(50) NOT NULL,
    target_object_code          VARCHAR(50) DEFAULT NULL,
    matched_customer_code       VARCHAR(50) DEFAULT NULL,
    matched_contract_code       VARCHAR(50) DEFAULT NULL,
    matched_project_code        VARCHAR(50) DEFAULT NULL,
    matched_department_code     VARCHAR(50) DEFAULT NULL,
    matched_sales_region_code   VARCHAR(50) DEFAULT NULL,
    match_status                VARCHAR(30) DEFAULT 'pending',
    review_status               VARCHAR(30) DEFAULT 'pending',
    review_note                 VARCHAR(500) DEFAULT NULL,
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_migration_project (legacy_source, legacy_project_id),
    INDEX idx_migration_project_type (target_object_type),
    INDEX idx_migration_project_status (match_status, review_status)
);
```

## 5. 科目与业务类型映射

### 5.1 收入映射

| 业务场景 | 默认会计科目 | 核算对象 |
| --- | --- | --- |
| 合同软件开发/服务收入 | `5001 主营业务收入` | `contract` / `customer_project` |
| 无合同主营业务收入 | `5001 主营业务收入` | `customer_project` / `customer` |
| 维护费 | `5001 主营业务收入` | `contract` / `customer` |
| 材料或非主营业务收入 | `5051 其他业务收入` | `customer` / `other` |
| 利息收入 | `5111 投资收益` | `other` |
| 政府补助 | `5301 营业外收入` | `other` |

### 5.2 支出映射

| 业务场景 | 默认会计科目 | 核算对象 |
| --- | --- | --- |
| 项目采购、外协 | `5401 主营业务成本` | `customer_project` |
| 项目退款 | `5401 主营业务成本` 或冲减收入 | `customer_project` / `contract` |
| 销售差旅、招待、投标 | `5601 销售费用` | `sales_region` / `customer` / `opportunity` / `sales_campaign` |
| 行政办公、管理差旅 | `5602 管理费用` | `department` |
| 银行手续费、融资费用 | `5603 财务费用` | `other` / `bank_account` |
| 日常税费 | `5403 营业税金及附加` | `department` / `other` |
| 偶发损失 | `5711 营业外支出` | `other` |

### 5.3 映射表

新增业务类型到科目和核算对象策略的配置表：

```sql
CREATE TABLE finance_subject_mapping (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT,
    biz_type                    VARCHAR(50) NOT NULL,
    biz_subtype                 VARCHAR(50) DEFAULT NULL,
    income_type_code            VARCHAR(50) DEFAULT NULL,
    expense_type_code           VARCHAR(50) DEFAULT NULL,
    default_subject_code        VARCHAR(50) NOT NULL,
    object_strategy             VARCHAR(50) NOT NULL,
    required_dimensions_json    JSON DEFAULT NULL,
    status                      VARCHAR(20) DEFAULT 'active',
    sort_no                     INT DEFAULT 0,
    remark                      VARCHAR(500) DEFAULT NULL,
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_subject_mapping (biz_type, biz_subtype, income_type_code, expense_type_code),
    INDEX idx_subject_mapping_subject (default_subject_code),
    INDEX idx_subject_mapping_status (status)
);
```

## 6. 开发实施计划

### P0：迁移准备与对账基线

目标：摸清旧 OA 项目类别和财务数据现状，形成可审计迁移清单。

工作项：

1. 导出旧 OA 项目、收入、支出、贡献、银行账户、余额快照。
2. 生成项目类别分布和异常项目清单。
3. 定义旧项目到核算对象类型的映射规则。
4. 建立迁移临时表和校验 SQL。
5. 输出迁移前基线报表。

验收：

- 旧 OA 项目 100% 有目标类型。
- 未匹配客户、合同、部门、项目的记录进入人工处理清单。
- 旧系统收入、支出、余额汇总可复算。

### P1：核算对象与基础映射

目标：让 Finance 支持非项目化归集。

工作项：

1. 新增 `finance_accounting_object`。
2. 新增 `finance_subject_mapping`。
3. 扩展收入、支出、报销、付款、非合同收入单据的核算对象字段。
4. 增加核算对象列表、详情和选择 API。
5. 在财务设置增加核算对象、科目映射配置页。

验收：

- 一笔费用可以挂客户、区域、部门、商机或项目。
- 新增单据时可以根据业务类型自动带出默认科目。
- 不选择项目也能完成合法支出归集。

### P2：无合同收入流程

目标：延续“不生成虚拟合同号”的原则，建立无合同收入闭环。

工作项：

1. 扩展 `finance_receipt`：增加 `receipt_source_type`。
2. 增强 `finance_unclassified_income`：支持无合同收入单号和归集对象。
3. 增加无合同收入确认、归类、补关联合同功能。
4. 报表中区分合同收入、无合同主营收入、其他收入。

验收：

- 无合同回款不需要填写合同号。
- 能挂客户、项目或其他专项。
- 后续补签合同后可关联正式合同并保留历史轨迹。

### P3：销售费用维度化

目标：淡化销售项目，建立销售费用多维分析。

工作项：

1. 增加销售费用归集字段：`sales_scope_type`、`sales_scope_code`、`sales_region_code`、`sales_owner_uid`。
2. 维护销售区域主数据，来源优先 Console/Altoc。
3. 报销、支出、付款单据支持按区域、客户、商机、合同、销售专项归集。
4. 建立销售费用报表：按区域、客户、商机、销售、费用类型汇总。

验收：

- 旧“区域销售项目”迁为 `sales_region`。
- 旧“客户销售项目”迁为 `customer`。
- 日常销售费用不再要求创建销售项目。

### P4：旧 OA 财务数据迁移

目标：导入旧 OA 历史收入、支出、贡献，并完成对账。

工作项：

1. 扩展 `financeMigration.ts`，支持项目映射和核算对象写入。
2. 迁移 `wb_project_income` 到到账/非合同收入。
3. 迁移 `wb_project_payment` 到支出台账。
4. 迁移 `wb_project_contribution` 到个人贡献记录。
5. 写入 `finance_migration_map`，保留旧来源。
6. 输出差异报表。

验收：

- 按旧项目汇总金额与新核算对象汇总金额一致。
- 迁移记录支持从新单据追溯到旧 OA 单据。
- 异常数据有人工处理状态。

### P5：经营财务报表与项目核算

目标：形成业账一体化看板。

工作项：

1. 项目毛利：收入、直接支出、人力成本、分摊成本。
2. 客户贡献：收入、销售费用、交付成本、毛利。
3. 区域销售费用：按区域、销售、客户、商机分析。
4. 部门费用：按部门、费用类型、预算周期分析。
5. 无合同收入：按客户、项目、来源、科目分析。

验收：

- 管理层可按项目、客户、区域、部门查看收入、费用、毛利。
- 财务可按会计科目核对经营台账。
- 项目负责人可查看授权项目的收入和成本。

## 7. API 与页面建议

### 7.1 API

```text
GET/POST/PATCH /api/v1/finance/accounting-objects
GET/POST/PATCH /api/v1/finance/settings/subject-mappings
POST          /api/v1/finance/migrations/oa-projects/preview
POST          /api/v1/finance/migrations/oa-projects/import
GET           /api/v1/finance/migrations/oa-projects/status
POST          /api/v1/finance/receipts/{code}/classify-no-contract
POST          /api/v1/finance/unclassified-income/{code}/link-contract
GET           /api/v1/finance/reports/sales-expenses
GET           /api/v1/finance/reports/accounting-objects/{code}
```

### 7.2 页面

```text
财务设置 / 核算对象
财务设置 / 科目映射
迁移工具 / OA 项目映射
迁移工具 / 迁移对账
收款管理 / 无合同收入归类
报表 / 销售费用分析
报表 / 核算对象收支
报表 / 客户贡献
```

## 8. 数据质量与风控

| 风险 | 表现 | 处理 |
| --- | --- | --- |
| 旧项目语义不清 | 一个项目同时承接销售、交付、部门费用 | 迁移前人工确认目标类型 |
| 误把无合同收入当作正式合同 | 无合同收入被误认为合同收入，污染合同台账 | 使用无合同收入单号，不生成合同号 |
| 销售费用归集失真 | 区域、客户、商机混挂 | 使用 `sales_scope_type/code` 并增加必填规则 |
| 历史外键断裂 | 删除旧科目或旧项目导致历史单据不可查 | 旧数据标记 inactive，不物理删除 |
| 报表口径变化 | 迁移后金额和旧 OA 报表不一致 | 建立迁移前后对账报表和差异清单 |
| 权限过宽 | 项目、客户、人员财务数据泄露 | 按部门、项目、客户、角色做数据范围控制 |

## 9. 里程碑

| 里程碑 | 内容 | 交付物 |
| --- | --- | --- |
| M1 | 旧 OA 数据盘点 | 项目类别分布、异常清单、迁移映射规则 |
| M2 | 核算对象模型 | Schema、API、基础页面 |
| M3 | 无合同收入 | 无合同收入单、归类、补关联合同 |
| M4 | 销售费用维度化 | 销售费用归集字段和报表 |
| M5 | OA 数据迁移 | 导入工具、迁移日志、对账报表 |
| M6 | 业账一体报表 | 项目、客户、区域、部门经营财务看板 |

## 10. 已确认决策

1. 停止把“区域销售”“客户销售”作为默认项目类别继续扩展。
2. 对无合同回款采用无合同收入单，延续旧系统“不生成虚拟合同号”的做法。
3. 旧 OA 项目迁移前必须先完成核算对象分类评审。
4. 先做核算对象与科目映射，再做历史数据导入。
5. 第一版报表以经营核算为主，不承诺完整法定总账。

## 11. 2026-05-18 迁移执行记录

已实现迁移入口：

```text
POST /api/v1/finance/migrations/wizbizdb/import
GET  /api/v1/finance/migrations/wizbizdb/status
```

导入参数：

- `dryRun=true`：只预览，不写入。
- `cleanTargetData=true`：导入前清理带迁移标记的测试数据。
- `cleanOnly=true`：仅清理，不导入。
- `targets=["finance","altoc","aims"]`：按需选择目标库。

实际批次：`MIG_FULL_20260518_FIX1`。

| 来源表 | 目标库表 | 导入 | 跳过 | 说明 |
| --- | --- | ---: | ---: | --- |
| `wb_organization` | `hzy_altoc.customer` | 746 | 0 | 只导入客户组织，不导入本公司组织 |
| `wb_contract` | `hzy_altoc.contract` | 1525 | 5 | 无法匹配客户的合同跳过 |
| `wb_invoice` | `hzy_altoc.invoice` | 1860 | 7 | 无法匹配合同的发票跳过 |
| `wb_project_income` | `hzy_altoc.payment_record` | 2061 | 932 | 仅合同收入进入 Altoc 到账记录，无合同收入不生成合同 |
| `wb_project` | `hzy_aims.aims_projects` | 137 | 112 | 仅内部研发、客户交付、运维和运营项目进入 Aims |
| `wb_project` | `finance_accounting_object` | 249 | 0 | 全部旧项目生成 Finance 核算对象 |
| `wb_invoice` | `finance_invoice` | 1867 | 0 | Finance 保留完整发票台账 |
| `wb_project_income` | `finance_receipt / finance_unclassified_income` | 2993 | 0 | 合同收入 2072，无合同收入 921 |
| `wb_project_payment` | `finance_expense` | 3930 | 0 | 全量迁移支出台账 |
| `wb_bank_account` | `finance_bank_account` | 22 | 0 | 全量迁移银行账户 |
| `wb_account_balance` | `finance_account_balance_snapshot` | 2455 | 106 | 按账户、日期、来源去重 |

金额对账：

| 口径 | 源金额 | 目标金额 | 结果 |
| --- | ---: | ---: | --- |
| 项目收入 | 201,947,059.08 | 201,947,059.08 | 一致 |
| 项目支出 | 21,322,232.96 | 21,322,232.96 | 一致 |
| 发票 | 188,668,532.93 | 188,668,532.93 | 一致 |

核算对象分类结果：

| 类型 | 数量 |
| --- | ---: |
| `customer` | 48 |
| `customer_project` | 115 |
| `department` | 31 |
| `internal_project` | 22 |
| `other` | 3 |
| `sales_campaign` | 7 |
| `sales_region` | 23 |
