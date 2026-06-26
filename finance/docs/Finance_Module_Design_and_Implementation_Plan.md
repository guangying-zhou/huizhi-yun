# Finance 模块设计与实现计划

## 1. 目标范围

本文基于 `Finance_PRD.md` 和 `finance_schema.sql`，细化 Finance v0.1-v0.3 的工程模块设计和实施计划。

v0.1-v0.3 的核心目标：

- v0.1：建立财务事实源，覆盖发票、到账、核销、支出、银行账户和合同财务摘要。
- v0.2：接入审批，覆盖费用报销、项目支出、付款申请和开票申请。
- v0.3：形成项目核算和绩效金额财务口径，支撑项目毛利、人力成本、财务贡献归因和绩效金额计算快照；个人绩效主流程归 People。

非目标：

- 不实现完整总账、法定凭证、税务申报、多账套和复杂关账。
- 不跨模块直连数据库。
- 不在 Finance 本地保存钉钉、企业微信、People 或外部系统密钥。

## 2. 架构原则

1. Finance 是发票、到账、核销、支出和项目财务核算的事实源。
2. Altoc 是客户、合同和经营回款计划事实源；Finance 只引用 `customer_code`、`contract_code`、`receivable_plan_code`。
3. Aims 是项目执行事实源；Finance 只引用 `project_code`、工时、里程碑和验收摘要。
4. People 是员工业务事实、任职、职级设置、成本留档和个人绩效主流程事实源；Console Directory 是登录身份和目录基础能力事实源。Finance 项目核算只引用 `employee_uid`、`department_code`、员工职级和 M/P 职级设置，并结合 Aims 工时计算标准人力成本。
5. Workflow 是审批事实源；Finance 保存本模块单据状态和外部实例映射。
6. 跨模块调用统一使用 Console service token，不新增共享 secret 或静态 webhook key。
7. Finance 内部写操作必须写审计日志；审批回调、迁移导入、核销和绩效金额计算必须幂等。

## 3. 内部模块划分

| 子模块 | 版本 | 职责 | 主要表 |
| --- | --- | --- | --- |
| Runtime Foundation | P0 | 接入 Platform/Foundation、OIDC、权限、应用菜单、运行时配置 | 无业务表 |
| Finance Settings | v0.1-v0.3 | 财务科目、收入类型、费用类型、人力成本参数、基础配置 | `finance_subject`, `finance_income_type`, `finance_expense_type`, `finance_people_cost_parameter` |
| Bank Account | v0.1 | 银行账户、余额快照、账户脱敏展示 | `finance_bank_account`, `finance_account_balance_snapshot` |
| Invoice | v0.1/v0.2 | 开票申请、正式发票、合同/客户/项目关联 | `invoice_request`, `finance_invoice` |
| Receipt | v0.1 | 到账、收款确认、非合同收入归类 | `finance_receipt`, `finance_unclassified_income` |
| Reconciliation | v0.1 | 收款核销到合同、发票或回款计划，更新合同财务摘要 | `finance_reconciliation`, `finance_contract_summary` |
| Expense Ledger | v0.1/v0.2 | 支出台账、审批通过后的费用落账 | `finance_expense` |
| Approval Documents | v0.2 | 费用报销、项目支出、付款申请、审批状态追踪 | `expense_claim`, `expense_claim_item`, `project_expense_request`, `project_expense_request_item`, `payment_request` |
| Approval Integration | v0.2 | Workflow 动作同步、实例发起、回调落账、外部审批映射 | `external_approval_instance`, `approval_callback_log` |
| Project Accounting | v0.3 | 项目收入、支出、人力成本、成本分摊、毛利快照 | `project_finance_summary`, `project_cost_allocation`, `employee_cost_snapshot` |
| Performance Finance | v0.3 | 财务贡献归因、提成/奖金/绩效金额财务规则、金额计算快照，供 People 个人绩效流程引用 | `employee_finance_contribution`, `performance_rule`, `employee_finance_performance`, `performance_calculation_snapshot` |
| Migration | v0.1-v0.3 | `wizbizdb` 历史数据导入、源 ID 映射和校验 | `finance_migration_map` |
| Audit & Attachment | v0.1-v0.3 | 附件、审计日志、变更追踪 | `finance_attachment`, `finance_audit_log` |

## 4. 应用结构建议

```text
finance/
  app/
    pages/
      index.vue
      invoices/
      receipts/
      reconciliation/
      expenses/
      bank-accounts/
      project-accounting/
      performance/
      reports/
      settings/
    components/
      finance/
    composables/
      useFinanceApi.ts
      useFinancePermissions.ts
  server/
    api/v1/finance/
      dashboard/
      invoices/
      invoice-requests/
      receipts/
      reconciliation/
      expenses/
      expense-claims/
      project-expense-requests/
      payment-requests/
      bank-accounts/
      project-accounting/
      performance/
      settings/
      integrations/
      migrations/
    utils/
      db.ts
      auth.ts
      permissions.ts
      audit.ts
      codes.ts
      workflow.ts
      financeSummary.ts
      money.ts
    repositories/
    services/
    jobs/
  docs/
```

实现时优先复用现有模块模式，例如 `altoc/server/utils/db.ts`、权限校验、审批动作同步和审计日志的实现方式，但不要把 Altoc 的经营概念复制到 Finance。

## 5. 页面设计

| 页面 | 版本 | 主要能力 |
| --- | --- | --- |
| 财务工作台 `/finance/` | v0.1 | 收款、开票、支出、待处理核销、审批待办摘要 |
| 发票管理 `/finance/invoices` | v0.1/v0.2 | 发票列表、发票详情、开票申请、发票状态 |
| 收款管理 `/finance/receipts` | v0.1 | 到账列表、收款确认、非合同收入归类 |
| 核销管理 `/finance/reconciliation` | v0.1 | 收款核销、合同/发票/回款计划关联、核销撤销 |
| 费用支出 `/finance/expenses` | v0.1/v0.2 | 支出台账、费用报销、项目支出、付款申请 |
| 银行账户 `/finance/bank-accounts` | v0.1 | 账户资料、余额快照、账户启停 |
| 项目核算 `/finance/project-accounting` | v0.3 | 项目收入、支出、人力成本、毛利和毛利率 |
| 绩效金额 `/finance/performance` | v0.3 | 财务贡献归因、提成/奖金/绩效金额规则、计算快照 |
| 财务报表 `/finance/reports` | v0.1-v0.3 | 收支、回款、支出、项目毛利、人员贡献报表 |
| 财务设置 `/finance/settings` | v0.1-v0.3 | 科目、收入类型、费用类型、人力成本参数、绩效规则、集成状态 |

## 6. API 设计

### 6.1 通用约定

- Base path：`/api/v1/finance`
- 列表接口统一支持 `page`、`pageSize`、`keyword`、`status`、日期范围和业务键筛选。
- 写操作返回业务 `code`，跨模块只暴露业务键，不暴露内部自增 ID。
- 金额字段使用 decimal 字符串返回，前端不使用浮点数计算金额。
- 删除采用软删除；关键财务事实更推荐冲销、撤销或调整记录。

### 6.2 v0.1 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/dashboard/summary` | GET | 财务工作台摘要 |
| `/settings/subjects` | GET/POST/PATCH | 科目维护 |
| `/settings/income-types` | GET/POST/PATCH | 收入类型维护 |
| `/settings/expense-types` | GET/POST/PATCH | 费用类型维护 |
| `/settings/people-cost-parameters` | GET/POST/PATCH | People 职级成本公式参数维护 |
| `/service/people-cost-parameters?effective_date=` | GET | 提供给 People 的当前有效人力成本参数 |
| `/bank-accounts` | GET/POST/PATCH | 银行账户维护 |
| `/bank-accounts/{code}/balance-snapshots` | GET/POST | 账户余额快照 |
| `/invoices` | GET/POST/PATCH | 正式发票台账 |
| `/receipts` | GET/POST/PATCH | 到账/收款记录 |
| `/receipts/{code}/classify` | POST | 非合同收入归类 |
| `/reconciliation` | GET/POST | 新增核销记录 |
| `/reconciliation/{code}/void` | POST | 撤销核销 |
| `/expenses` | GET/POST/PATCH | 支出台账 |
| `/contracts/{contractCode}/summary` | GET | 合同财务摘要，供 Altoc 查询 |
| `/migrations/wizbizdb/import` | POST | 迁移导入任务入口 |
| `/migrations/wizbizdb/status` | GET | 迁移状态和校验结果 |
| `/audit-logs` | GET | 财务审计日志查询 |

### 6.3 v0.2 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/invoice-requests` | GET/POST/PATCH | 开票申请 |
| `/invoice-requests/{code}/submit` | POST | 发起开票审批 |
| `/expense-claims` | GET/POST/PATCH | 费用报销单 |
| `/expense-claims/{code}/submit` | POST | 发起报销审批 |
| `/project-expense-requests` | GET/POST/PATCH | 项目支出申请 |
| `/project-expense-requests/{code}/submit` | POST | 发起项目支出审批 |
| `/payment-requests` | GET/POST/PATCH | 付款申请 |
| `/payment-requests/{code}/submit` | POST | 发起付款审批 |
| `/workflow/actions/sync` | POST | 同步 Finance 审批动作 |
| `/workflow/callback` | POST | 接收 Workflow 审批回调 |
| `/integrations/approval-instances` | GET | 外部审批实例查询 |

### 6.4 v0.3 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/project-accounting` | GET | Finance 项目财务摘要列表 |
| `/project-accounting/aims-projects` | GET | Finance BFF 读取 Aims 项目清单并合并 Finance 财务摘要，供项目核算页使用 |
| `/project-accounting/recalculate` | POST | 重算项目财务摘要 |
| `/project-cost-allocations` | GET/POST | 成本分摊记录 |
| `/employee-costs` | GET/POST | 员工成本快照 |
| `/employee-contributions` | GET/POST | 员工财务贡献归因记录 |
| `/performance-rules` | GET/POST | 绩效金额/提成奖金财务规则 |
| `/performance/recalculate` | POST | 执行绩效金额财务口径计算 |
| `/performance` | GET | 绩效金额财务口径结果 |
| `/performance/snapshots` | GET | 绩效金额计算快照 |
| `/service/performance-amounts` | GET | 供 People 绩效周期读取绩效金额财务口径快照 |
| `/reports` | GET | 月度财务报表聚合 |
| `/project-accounting/{projectCode}` | GET | 项目财务详情、成本分摊、员工成本与贡献记录 |

### 6.5 Phase 4 运维服务 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/service/customers/{customerCode}/maintenance-financial-summary?contract_codes=&project_codes=&period_month=` | GET | 维保收入、到账、核销、服务成本和毛利摘要；维保范围由 Altoc 提供的合同 / 项目编码限定 |

## 7. 跨模块集成

### 7.1 Altoc

Finance 从 Altoc 获取：

- 客户、合同、合同金额、销售负责人。
- 经营回款计划和开票申请来源。

Finance 提供给 Altoc：

- `GET /api/v1/finance/contracts/{contractCode}/summary`
- 发票、到账、核销、未收金额、最近到账日期、风险状态。

约束：

- Altoc 不直接写 Finance 发票和收款台账。
- Altoc 如需发起开票，只创建 Finance `invoice_request` 或调用 Finance API。

### 7.2 Workflow

审批动作：

- `finance.invoice.request`
- `finance.expense.claim`
- `finance.project_expense.request`
- `finance.payment.request`

回调处理：

1. 校验 Console service token。
2. 根据 `workflow_instance_id` 和 `biz_type` 查找本地单据。
3. 幂等写入 `approval_callback_log`。
4. 更新本地单据状态。
5. 审批通过后按单据类型落账到 `finance_invoice` 或 `finance_expense`。

### 7.3 Aims

Finance 消费：

- Aims 项目清单作为 Finance 项目核算页底表。
- `project_code`、项目负责人、成员、工时、里程碑、验收状态。

Finance 输出：

- 项目收入、支出、人力成本、毛利、成本异常提醒。

v0.3 首期可以采用按需查询 + 本地快照，不要求实时同步所有项目执行数据。
没有 Aims 工时、People 员工职级/M/P 职级设置或 Finance 人力成本参数时，项目核算页只展示 Aims 项目和 Finance 已有收支摘要，成本状态应标记为未就绪。People 成本快照只作为成本留档和未来实际成本接入基础，不作为项目核算主路径。

### 7.4 People / Console Directory

Finance 消费：

- 员工、部门、岗位、职级、入离职状态。
- M/P 职级设置、员工有效职级和可用于后续校准的成本留档。
- 绩效周期、贡献快照和必要的绩效评分输入仅用于个人绩效金额口径。

Finance 提供：

- `finance_people_cost_parameter` 中的人力成本计算参数，供 Finance 项目核算计算标准人力成本，并供 People 生成月度标准成本快照留档。

Finance 保存：

- `employee_cost_snapshot`，作为某个核算周期的成本事实快照。
- `employee_finance_contribution`、`employee_finance_performance` 和 `performance_calculation_snapshot`，作为绩效金额财务口径快照。

约束：

- 不在 Finance 维护员工主数据。
- 绩效金额计算必须引用快照，避免 People 后续员工事实或绩效规则变更影响历史财务结果。
- 个人绩效周期创建、评分、确认、申诉和归档归 People；Finance 只提供金额、成本和财务计算依据。

### 7.5 Console/Integration

Finance 需要：

- 钉钉/企业微信审批通知能力。
- 外部集成状态展示。
- service token 获取。
- vault secret 引用展示。

约束：

- Finance 只保存 `secret_ref` 或 `integration_code`。
- 不直接 resolve 外部密钥。

## 8. 关键业务规则

### 8.1 金额与状态

- 发票、收款、核销、支出金额均使用 decimal，禁止浮点数计算。
- 收款核销金额不能超过收款未核销余额。
- 发票核销金额不能超过发票未核销金额。
- 合同财务摘要由发票、收款、核销事件驱动更新，也支持后台重算。
- 已核销或已审批落账的财务事实不直接硬删除。

### 8.2 审批落账

- 草稿单据可以编辑。
- 已提交单据只能通过撤回、驳回、审批通过等流程改变状态。
- 审批通过后生成正式财务事实，必须写来源单据类型和来源单据编码。
- 回调重复到达时不得重复生成发票或支出。

### 8.3 项目核算

- 项目收入优先来自合同收款和非合同项目收入。
- 项目支出来自 `finance_expense` 和审批落账支出。
- 人力成本来自 People 员工职级/M/P 职级设置和 Aims 月度工时，Finance 按标准成本公式计算后落入 `employee_cost_snapshot` 和 `project_cost_allocation`。
- 成本分摊必须保存分摊规则、来源和计算周期。
- 项目毛利快照必须可重算、可追溯。

### 8.4 绩效金额财务口径

- 贡献记录可以来自销售、项目、回款、交付等多种贡献类型。
- 绩效金额/提成奖金财务规则必须有生效期和版本。
- 绩效金额结果保存计算快照，历史结果不随规则变更自动改变。
- Finance 不关闭 People 绩效周期，不写个人绩效终态，只输出可追溯财务依据。

## 9. 实现计划

### P0：工程基础

目标：让 Finance 具备可开发、可运行、可授权、可接入平台的基础。

任务：

1. 将 `finance` 正式纳入 `pnpm-workspace.yaml`。
2. 补齐 Foundation/Platform runtime 接入，确认 `/finance/` base path、应用菜单、OIDC 登录和权限 bundle。
3. 建立 `server/utils/db.ts`、权限校验、审计日志、编码生成和金额工具。
4. 建立数据库迁移执行方式，首版落地 `finance_schema.sql`。
5. 补齐基础布局、导航、空状态、错误状态和权限不可见状态。

验收：

- `pnpm --filter finance typecheck` 通过。
- 访问 `/finance/` 可看到财务工作台。
- 当前用户权限能正确控制菜单和页面入口。

### P1：v0.1 财务台账与核销

目标：先形成财务事实源和 Altoc 可用的合同财务摘要。

任务：

1. 实现基础配置：科目、收入类型、费用类型。
2. 实现银行账户和余额快照。
3. 实现发票台账：列表、详情、新增、编辑、状态变更。
4. 实现到账台账：列表、详情、新增、确认、非合同收入归类。
5. 实现支出台账：列表、详情、新增、编辑。
6. 实现收款核销：按收款核销到合同、发票或回款计划，支持撤销。
7. 实现合同财务摘要投影和 `GET /contracts/{contractCode}/summary`。
8. 实现 `wizbizdb` v0.1 数据迁移：`wb_invoice`、`wb_project_income`、`wb_project_payment`、`wb_bank_account`、`wb_account_balance`。
9. 实现财务工作台摘要。

验收：

- 发票、到账、支出、核销可独立维护。
- 同一笔收款重复核销被拦截。
- 合同财务摘要可被 Altoc 查询。
- 迁移数据保留 `legacy_source`、`legacy_id` 和迁移映射。

### P2：v0.2 审批单据与 Workflow 集成

目标：把报销、项目支出、付款和开票纳入审批，并在审批通过后自动落账。

任务：

1. 实现开票申请 `invoice_request`，支持从 Altoc 创建或 Finance 本地创建。
2. 实现费用报销单和报销明细。
3. 实现项目支出申请和支出明细。
4. 实现付款申请。
5. 同步 Finance 审批动作到 Workflow。
6. 实现提交审批：优先创建 Workflow instance，保存 `workflow_instance_id`；Workflow 不可用、未登录或未匹配路由时保留本地 `pending_approval` 降级状态，并把错误写入 `external_approval_instance.error_message`。
7. 实现 Workflow 回调：接收 `instance_id/biz_id/resource_code/action_code` 回调字段，幂等记录、更新单据状态；service token 校验接入 Console token verification 后补齐。
8. 实现审批通过落账：开票申请生成发票，报销/项目支出/付款生成支出记录。
9. 展示外部审批实例和钉钉/企业微信通知状态。

验收：

- 四类审批单据均可创建、提交、追踪状态。
- 审批回调重复投递不会重复落账。
- 审批通过后的财务事实能追溯到来源单据。
- 外部平台凭证不写入 Finance env。

### P3：v0.3 项目核算与绩效金额财务口径

目标：把 Finance 台账、Altoc 合同、Aims 项目、People 员工成本聚合为项目财务结果、人员成本分摊和绩效金额财务口径；个人绩效主流程归 People。

任务：

1. 实现项目财务汇总列表和详情。
2. 实现项目收入归集：合同收款、非合同项目收入。
3. 实现项目支出归集：支出台账、审批落账、项目费用。
4. 实现标准人力成本核算：Finance 维护人力成本参数，从 People 读取员工职级和 M/P 职级设置，从 Aims 读取月度工时，按标准成本公式计算并写入项目成本分摊；People 成本快照用于留档。
5. 实现成本分摊：按工时、人员、比例或手工分摊。
6. 实现项目毛利重算任务，写入 `project_finance_summary`。
7. 实现财务贡献归因记录：销售、回款、项目、交付贡献。
8. 实现绩效金额/提成奖金财务规则配置和计算任务。
9. 实现绩效金额计算快照和结果查询，供 People 绩效周期引用。

验收：

- 项目维度可查看收入、支出、人力成本、毛利和毛利率。
- 人员维度可查看财务贡献、绩效金额快照和计算依据。
- 项目毛利和绩效金额计算可重算且保留快照。
- People/Aims/Altoc 引用关系可追溯。

### P4：质量、权限和运维收口

任务：

1. 为金额计算、核销、审批回调、合同摘要和绩效计算补单元测试。
2. 为关键 API 补集成测试，覆盖权限、幂等和异常输入。
3. 为迁移任务补 dry-run、数据校验和回滚说明。
4. 为工作台、发票、收款、核销、审批和项目核算做浏览器 QA。
5. 补充运行手册：环境变量、数据库初始化、迁移执行、常见故障。
6. 更新 `docs/MODULE_CONTRACTS.md` 中 Finance 已实现 API。

验收：

- 核心测试通过。
- 关键页面在桌面宽度下可用。
- 迁移任务可 dry-run，失败可定位到源表和源 ID。
- 跨模块契约文档与实现一致。

## 10. 推荐开发顺序

1. P0 工程基础。
2. v0.1 基础配置、银行账户、发票、收款、支出。
3. v0.1 核销和合同财务摘要。
4. v0.1 迁移导入和数据校验。
5. v0.2 审批单据模型和页面。
6. v0.2 Workflow 提交、回调和审批落账。
7. v0.3 项目核算。
8. v0.3 绩效金额财务口径。
9. 测试、QA、文档和运维收口。

## 11. 首批里程碑

| 里程碑 | 交付物 | 建议完成标准 |
| --- | --- | --- |
| M1 Finance 可运行 | 应用入口、权限、DB、基础布局 | `/finance/` 可访问，权限可控 |
| M2 财务台账 MVP | 发票、收款、支出、银行账户 | 可手工维护核心财务事实 |
| M3 核销和合同摘要 | 核销、合同摘要 API、Altoc 查询 | Altoc 可展示 Finance 财务摘要 |
| M4 OA 财务迁移 | 迁移脚本、映射、校验报表 | v0.1 源表可导入并校验 |
| M5 审批 MVP | 开票、报销、项目支出、付款审批 | Workflow 回调后自动落账 |
| M6 项目核算 MVP | 项目毛利、成本分摊、人力成本 | 项目财务详情可用于管理看板 |
| M7 绩效金额 MVP | 财务贡献、规则、计算快照 | 绩效金额快照可被 People 追溯引用 |

## 12. 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 历史数据字段口径不一致 | 迁移后报表不可信 | 保留源字段快照，迁移前做字段口径表和 dry-run 报告 |
| 审批回调重复或乱序 | 重复落账或状态错误 | 以 `workflow_instance_id + callback_event_id` 幂等处理 |
| 跨模块业务键不稳定 | Finance 摘要无法关联 | 所有引用使用稳定 code，迁移阶段维护 `finance_migration_map` |
| People 职级或 Aims 工时数据不足 | v0.3 毛利不准确 | 项目核算页标识人力成本未就绪，先补齐职级设置、员工职级和月度工时 |
| 核销撤销影响合同摘要 | Altoc 展示错误 | 核销和撤销都触发摘要重算，支持后台全量重算 |
| 财务权限过宽 | 敏感数据泄露 | 按资源动作和部门/项目范围控制，默认最小权限 |
