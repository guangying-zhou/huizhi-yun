import type { TableColumn } from '@nuxt/ui'

export interface CreateField {
  key: string
  label: string
  type?: string
  required?: boolean
  placeholder?: string
  readonly?: boolean
  optionsKey?: 'bankAccounts'
  options?: Array<{ label: string, value: string }>
  accept?: string
}

export interface PageConfig {
  title: string
  description: string
  endpoint?: string
  createEndpoint?: string
  updateEndpoint?: string
  submitEndpointBase?: string
  recalculateEndpoint?: string
  phase: string
  columns: TableColumn<Record<string, unknown>>[]
  createFields?: CreateField[]
}

export const invoiceMediumOptions = [
  { label: '电子发票', value: 'electronic' },
  { label: '纸质发票', value: 'paper' }
]

export const pageConfigs: Record<string, PageConfig> = {
  'invoices': {
    title: '发票管理',
    description: '正式发票台账，按客户、合同、项目和开票日期追踪真实开票事实。',
    endpoint: '/invoices',
    createEndpoint: '/invoices',
    updateEndpoint: '/invoices',
    phase: 'v0.1',
    createFields: [
      { key: 'invoiceNo', label: '发票号码' },
      { key: 'invoiceMedium', label: '介质形式', type: 'select', required: true, options: invoiceMediumOptions, placeholder: '选择发票介质' },
      { key: 'customerName', label: '客户名称' },
      { key: 'contractCode', label: '合同编码' },
      { key: 'invoiceAmount', label: '开票金额', type: 'number', required: true },
      { key: 'invoiceDate', label: '开票日期', type: 'date' },
      { key: 'invoiceItem', label: '开票内容' },
      { key: 'invoiceFile', label: '发票文件', type: 'file', accept: '.pdf,.ofd,application/pdf,application/ofd' }
    ],
    columns: [
      { accessorKey: 'code', header: '发票编码' },
      { accessorKey: 'invoice_no', header: '发票号码' },
      { accessorKey: 'invoice_medium', header: '介质' },
      { accessorKey: 'customer_name', header: '客户' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'invoice_amount', header: '金额' },
      { accessorKey: 'invoice_date', header: '开票日期' },
      { accessorKey: 'invoice_file_url', header: '文件' },
      { accessorKey: 'status', header: '状态' },
      { accessorKey: 'reconciliation_status', header: '核销状态' },
      { id: 'invoice_actions', header: '操作' }
    ]
  },
  'invoices/requests': {
    title: '开票申请',
    description: 'Workflow 审批通过后进入待开票，由明确责任人在截止时间前完成正式开票。',
    endpoint: '/invoice-requests',
    createEndpoint: '/invoice-requests',
    submitEndpointBase: '/invoice-requests',
    phase: 'v0.2',
    createFields: [
      { key: 'customerName', label: '客户名称' },
      { key: 'contractCode', label: '合同编码' },
      { key: 'requestedAmount', label: '申请金额', type: 'number', required: true },
      { key: 'invoiceMedium', label: '介质形式', type: 'select', required: true, options: invoiceMediumOptions, placeholder: '选择发票介质' },
      { key: 'invoiceItem', label: '开票内容' },
      { key: 'requestedBy', label: '申请人' },
      { key: 'issuanceResponsibleUid', label: '开票责任人 UID' },
      { key: 'issuanceDueAt', label: '开票截止时间', type: 'datetime-local' }
    ],
    columns: [
      { accessorKey: 'code', header: '申请编号' },
      { accessorKey: 'customer_name', header: '客户' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'invoice_medium', header: '介质' },
      { accessorKey: 'requested_amount', header: '申请金额' },
      { accessorKey: 'requested_by', header: '申请人' },
      { accessorKey: 'issuance_responsible_uid', header: '开票责任人' },
      { accessorKey: 'issuance_due_at', header: '开票截止时间' },
      { accessorKey: 'status', header: '状态' },
      { id: 'actions', header: '操作' }
    ]
  },
  'receipts': {
    title: '收款管理',
    description: '到账、收款确认和未核销余额，是 Finance 的资金事实源。',
    endpoint: '/receipts',
    createEndpoint: '/receipts',
    phase: 'v0.1',
    createFields: [
      { key: 'customerName', label: '客户名称' },
      { key: 'contractCode', label: '合同编码' },
      { key: 'receivedAmount', label: '到账金额', type: 'number', required: true },
      { key: 'receivedAt', label: '到账日期', type: 'date', required: true },
      { key: 'payerName', label: '付款方' },
      { key: 'reconciliationResponsibleUid', label: '核销责任人 UID' },
      { key: 'reconciliationDueAt', label: '核销截止时间', type: 'datetime-local' }
    ],
    columns: [
      { accessorKey: 'code', header: '收款编号' },
      { accessorKey: 'receipt_no', header: '外部流水' },
      { accessorKey: 'customer_name', header: '客户' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'receipt_source_type', header: '来源' },
      { accessorKey: 'accounting_object_code', header: '核算对象' },
      { accessorKey: 'received_amount', header: '到账金额' },
      { accessorKey: 'unreconciled_amount', header: '未核销' },
      { accessorKey: 'received_at', header: '到账日期' },
      { accessorKey: 'reconciliation_responsible_uid', header: '核销责任人' },
      { accessorKey: 'reconciliation_due_at', header: '核销截止时间' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'reconciliation': {
    title: '核销管理',
    description: '将收款核销到发票、合同或经营回款计划，并驱动合同财务摘要。',
    endpoint: '/reconciliation',
    createEndpoint: '/reconciliation',
    phase: 'v0.1',
    createFields: [
      { key: 'receiptCode', label: '收款编号', required: true },
      { key: 'invoiceCode', label: '发票编码' },
      { key: 'contractCode', label: '合同编码' },
      { key: 'reconciledAmount', label: '核销金额', type: 'number', required: true }
    ],
    columns: [
      { accessorKey: 'code', header: '核销编号' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'receivable_plan_code', header: '回款计划' },
      { accessorKey: 'reconciled_amount', header: '核销金额' },
      { accessorKey: 'reconciled_at', header: '核销时间' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'expenses': {
    title: '支出台账',
    description: '项目支出、销售费用、采购、退款、手续费等真实支出记录。',
    endpoint: '/expenses',
    createEndpoint: '/expenses',
    phase: 'v0.1',
    createFields: [
      { key: 'expenseAmount', label: '支出金额', type: 'number', required: true },
      { key: 'expenseDate', label: '支出日期', type: 'date', required: true },
      { key: 'payeeName', label: '收款方' },
      { key: 'projectCode', label: '项目编码' },
      { key: 'contractCode', label: '合同编码' },
      { key: 'description', label: '事由' }
    ],
    columns: [
      { accessorKey: 'code', header: '支出编号' },
      { accessorKey: 'expense_date', header: '支出日期' },
      { accessorKey: 'expense_amount', header: '金额' },
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'accounting_object_code', header: '核算对象' },
      { accessorKey: 'sales_scope_code', header: '销售归集' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'payee_name', header: '收款方' },
      { accessorKey: 'status', header: '状态' },
      { id: 'conflict_actions', header: '风险' }
    ]
  },
  'expenses/claims': {
    title: '费用报销',
    description: '员工费用报销单，v0.2 接入 Workflow 后审批通过自动落账。',
    endpoint: '/expense-claims',
    createEndpoint: '/expense-claims',
    submitEndpointBase: '/expense-claims',
    phase: 'v0.2',
    createFields: [
      { key: 'title', label: '标题', required: true },
      { key: 'applicantUserId', label: '申请人', required: true },
      { key: 'projectCode', label: '项目编码' },
      { key: 'totalAmount', label: '报销金额', type: 'number', required: true },
      { key: 'remark', label: '备注' }
    ],
    columns: [
      { accessorKey: 'code', header: '报销编号' },
      { accessorKey: 'title', header: '标题' },
      { accessorKey: 'applicant_user_id', header: '申请人' },
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'total_amount', header: '金额' },
      { accessorKey: 'status', header: '状态' },
      { id: 'actions', header: '操作' }
    ]
  },
  'expenses/projects': {
    title: '项目支出',
    description: '已发生的项目支出、销售费用、采购、退款和手续费，包含旧 OA 项目付款迁移数据。',
    endpoint: '/expenses',
    createEndpoint: '/expenses',
    phase: 'v0.1',
    createFields: [
      { key: 'expenseAmount', label: '支出金额', type: 'number', required: true },
      { key: 'expenseDate', label: '支出日期', type: 'date', required: true },
      { key: 'payeeName', label: '收款方' },
      { key: 'projectCode', label: '项目编码' },
      { key: 'contractCode', label: '合同编码' },
      { key: 'description', label: '事由' }
    ],
    columns: [
      { accessorKey: 'code', header: '支出编号' },
      { accessorKey: 'expense_date', header: '支出日期' },
      { accessorKey: 'expense_amount', header: '金额' },
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'accounting_object_type', header: '核算类型' },
      { accessorKey: 'accounting_object_code', header: '核算对象' },
      { accessorKey: 'sales_scope_code', header: '销售归集' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'customer_code', header: '客户编码' },
      { accessorKey: 'payee_name', header: '收款方' },
      { accessorKey: 'status', header: '状态' },
      { id: 'conflict_actions', header: '风险' }
    ]
  },
  'expenses/project-requests': {
    title: '项目支出审批',
    description: '项目采购、外协、销售费用、项目费用等项目支出申请，审批通过后生成支出台账。',
    endpoint: '/project-expense-requests',
    createEndpoint: '/project-expense-requests',
    submitEndpointBase: '/project-expense-requests',
    phase: 'v0.2',
    createFields: [
      { key: 'title', label: '标题', required: true },
      { key: 'applicantUserId', label: '申请人', required: true },
      { key: 'projectCode', label: '项目编码', required: true },
      { key: 'supplierCode', label: '供应商' },
      { key: 'totalAmount', label: '申请金额', type: 'number', required: true }
    ],
    columns: [
      { accessorKey: 'code', header: '申请编号' },
      { accessorKey: 'title', header: '标题' },
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'supplier_code', header: '供应商' },
      { accessorKey: 'total_amount', header: '申请金额' },
      { accessorKey: 'status', header: '状态' },
      { id: 'actions', header: '操作' }
    ]
  },
  'payments/requests': {
    title: '付款申请',
    description: '供应商付款、客户退款、借款和其他付款申请。',
    endpoint: '/payment-requests',
    createEndpoint: '/payment-requests',
    submitEndpointBase: '/payment-requests',
    phase: 'v0.2',
    createFields: [
      { key: 'title', label: '标题', required: true },
      { key: 'paymentType', label: '付款类型' },
      { key: 'applicantUserId', label: '申请人', required: true },
      { key: 'payeeName', label: '收款方', required: true },
      { key: 'requestedAmount', label: '申请金额', type: 'number', required: true },
      { key: 'plannedPayDate', label: '计划付款日期', type: 'date' }
    ],
    columns: [
      { accessorKey: 'code', header: '申请编号' },
      { accessorKey: 'title', header: '标题' },
      { accessorKey: 'payment_type', header: '类型' },
      { accessorKey: 'payee_name', header: '收款方' },
      { accessorKey: 'requested_amount', header: '申请金额' },
      { accessorKey: 'planned_pay_date', header: '计划付款' },
      { accessorKey: 'status', header: '状态' },
      { id: 'actions', header: '操作' }
    ]
  },
  'bank-accounts': {
    title: '银行账户',
    description: '银行账户资料和余额快照，敏感账号只展示脱敏值。',
    endpoint: '/bank-accounts',
    createEndpoint: '/bank-accounts',
    phase: 'v0.1',
    createFields: [
      { key: 'accountName', label: '账户名称', required: true },
      { key: 'bankName', label: '开户行' },
      { key: 'accountNoMasked', label: '脱敏账号' },
      { key: 'ownerDeptCode', label: '归属部门' }
    ],
    columns: [
      { accessorKey: 'code', header: '账户编码' },
      { accessorKey: 'account_name', header: '账户名称' },
      { accessorKey: 'bank_name', header: '开户行' },
      { accessorKey: 'account_no_masked', header: '账号' },
      { accessorKey: 'currency_code', header: '币种' },
      { accessorKey: 'latest_balance_amount', header: '最新余额' },
      { accessorKey: 'latest_balance_date', header: '余额日期' },
      { accessorKey: 'status', header: '状态' },
      { id: 'balance_actions', header: '操作' }
    ]
  },
  'bank-accounts/balances': {
    title: '余额快照',
    description: '查看和维护银行账户余额快照，支持按账户编码、账户名称、开户行和来源搜索。',
    endpoint: '/bank-accounts/balances',
    createEndpoint: '/bank-accounts/balances',
    phase: 'v0.1',
    createFields: [
      { key: 'accountCode', label: '账户', type: 'select', required: true, optionsKey: 'bankAccounts' },
      { key: 'snapshotDate', label: '快照日期', type: 'date', required: true },
      { key: 'balanceAmount', label: '账户余额', type: 'number', required: true },
      { key: 'currencyCode', label: '币种', placeholder: 'CNY' },
      { key: 'sourceType', label: '来源', type: 'select', readonly: true, options: [{ label: '手工录入', value: 'manual' }] },
      { key: 'createdBy', label: '创建人', readonly: true }
    ],
    columns: [
      { accessorKey: 'account_code', header: '账户编码' },
      { accessorKey: 'account_name', header: '账户名称' },
      { accessorKey: 'bank_name', header: '开户行' },
      { accessorKey: 'account_no_masked', header: '账号' },
      { accessorKey: 'snapshot_date', header: '快照日期' },
      { accessorKey: 'balance_amount', header: '余额' },
      { accessorKey: 'currency_code', header: '币种' },
      { accessorKey: 'source_type', header: '来源' },
      { accessorKey: 'created_by', header: '创建人' }
    ]
  },
  'bank-accounts/balance-changes': {
    title: '余额变动',
    description: '以阶梯瀑布图展示账户总余额在所选期间内的变化。',
    endpoint: '/bank-accounts/balance-changes',
    phase: 'v0.1',
    columns: [
      { accessorKey: 'balance_date', header: '日期' },
      { accessorKey: 'previous_total_balance', header: '变动前余额' },
      { accessorKey: 'change_amount', header: '变动金额' },
      { accessorKey: 'total_balance', header: '变动后余额' },
      { accessorKey: 'direction', header: '方向' }
    ]
  },
  'project-accounting': {
    title: '项目核算',
    description: '以 Aims 项目清单为底表，合并 Finance 已有收入、支出、人力成本和毛利快照。',
    endpoint: '/project-accounting/aims-projects',
    recalculateEndpoint: '/project-accounting/recalculate',
    phase: 'v0.3',
    columns: [
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'project_name', header: '项目名称' },
      { accessorKey: 'customer_name', header: '客户' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'lifecycle_status', header: '项目状态' },
      { accessorKey: 'finance_status_label', header: '财务摘要' },
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'received_amount', header: '收款' },
      { accessorKey: 'direct_expense_amount', header: '直接支出' },
      { accessorKey: 'labor_cost_amount', header: '人力成本' },
      { accessorKey: 'gross_profit_amount', header: '毛利' },
      { id: 'project_labor_actions', header: '操作' }
    ]
  },
  'project-accounting/allocations': {
    title: '项目成本分摊',
    description: '按项目和期间维护成本分摊。币种填写三位大写代码；未知可留空，但该期间产品成本将保持未就绪。',
    endpoint: '/project-cost-allocations',
    createEndpoint: '/project-cost-allocations',
    phase: 'v0.3',
    createFields: [
      { key: 'projectCode', label: '项目编码', required: true },
      { key: 'periodMonth', label: '期间月份', placeholder: 'YYYY-MM', required: true },
      { key: 'allocationType', label: '分摊类型', placeholder: 'labor/shared_expense/asset/other' },
      { key: 'employeeUid', label: '员工UID' },
      { key: 'amount', label: '分摊金额', type: 'number', required: true },
      { key: 'currencyCode', label: '币种', placeholder: '如 CNY、USD；未知留空' },
      { key: 'allocationBasis', label: '分摊依据' }
    ],
    columns: [
      { accessorKey: 'code', header: '分摊编号' },
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'allocation_type', header: '类型' },
      { accessorKey: 'employee_uid', header: '员工UID' },
      { accessorKey: 'amount', header: '金额' },
      { accessorKey: 'currency_code', header: '币种' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'project-accounting/employee-costs': {
    title: '员工标准成本',
    description: 'Finance 按 Aims 工时和 People 职级设置计算员工期间标准成本。',
    endpoint: '/employee-costs',
    createEndpoint: '/employee-costs',
    phase: 'v0.3',
    createFields: [
      { key: 'employeeUid', label: '员工UID', required: true },
      { key: 'employeeName', label: '员工姓名' },
      { key: 'deptCode', label: '部门编码' },
      { key: 'periodMonth', label: '期间月份', placeholder: 'YYYY-MM', required: true },
      { key: 'standardCostAmount', label: '标准成本', type: 'number' },
      { key: 'actualCostAmount', label: '实际成本', type: 'number' }
    ],
    columns: [
      { accessorKey: 'employee_uid', header: '员工UID' },
      { accessorKey: 'employee_name', header: '姓名' },
      { accessorKey: 'dept_code', header: '部门' },
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'standard_cost_amount', header: '标准成本' },
      { accessorKey: 'actual_cost_amount', header: '实际成本' },
      { accessorKey: 'cost_source', header: '来源' }
    ]
  },
  'performance': {
    title: '绩效金额快照',
    description: '基于财务贡献归因和金额规则生成可追溯的绩效金额、提成和奖金快照，供 People 绩效周期引用。',
    endpoint: '/performance',
    recalculateEndpoint: '/performance/recalculate',
    phase: 'v0.3',
    columns: [
      { accessorKey: 'code', header: '绩效编号' },
      { accessorKey: 'employee_name', header: '员工' },
      { accessorKey: 'dept_code', header: '部门' },
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'performance_type', header: '类型' },
      { accessorKey: 'performance_amount', header: '绩效金额' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'performance/contributions': {
    title: '财务贡献归因',
    description: '维护销售、回款、交付、售前和管理贡献，作为绩效金额财务口径输入。',
    endpoint: '/employee-contributions',
    createEndpoint: '/employee-contributions',
    phase: 'v0.3',
    createFields: [
      { key: 'employeeUid', label: '员工UID', required: true },
      { key: 'employeeName', label: '员工姓名' },
      { key: 'deptCode', label: '部门编码' },
      { key: 'periodMonth', label: '期间月份', placeholder: 'YYYY-MM', required: true },
      { key: 'contributionType', label: '贡献类型', placeholder: 'sales/delivery/collection/other' },
      { key: 'contributionAmount', label: '贡献金额', type: 'number' },
      { key: 'contributionRatio', label: '贡献占比', type: 'number' }
    ],
    columns: [
      { accessorKey: 'code', header: '贡献编号' },
      { accessorKey: 'employee_name', header: '员工' },
      { accessorKey: 'dept_code', header: '部门' },
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'project_code', header: '项目' },
      { accessorKey: 'contribution_type', header: '类型' },
      { accessorKey: 'contribution_amount', header: '金额' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'performance/rules': {
    title: '绩效规则',
    description: '维护提成、奖金、绩效分和成本分摊规则。',
    endpoint: '/performance-rules',
    createEndpoint: '/performance-rules',
    phase: 'v0.3',
    createFields: [
      { key: 'name', label: '规则名称', required: true },
      { key: 'ruleType', label: '规则类型', placeholder: 'commission/bonus/performance_score' },
      { key: 'scopeType', label: '适用范围', placeholder: 'company/dept/project/role/user' },
      { key: 'scopeCode', label: '范围编码' },
      { key: 'effectiveFrom', label: '生效日期', type: 'date' },
      { key: 'effectiveTo', label: '失效日期', type: 'date' }
    ],
    columns: [
      { accessorKey: 'code', header: '规则编码' },
      { accessorKey: 'name', header: '规则名称' },
      { accessorKey: 'rule_type', header: '类型' },
      { accessorKey: 'scope_type', header: '范围' },
      { accessorKey: 'scope_code', header: '范围编码' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'performance/snapshots': {
    title: '绩效计算快照',
    description: '保留每次绩效计算的输入摘要、目标对象和结果快照，用于追溯计算依据。',
    endpoint: '/performance/snapshots',
    phase: 'v0.3',
    columns: [
      { accessorKey: 'code', header: '快照编号' },
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'calculation_type', header: '计算类型' },
      { accessorKey: 'target_type', header: '目标类型' },
      { accessorKey: 'target_code', header: '目标编码' },
      { accessorKey: 'calculated_by', header: '计算人' },
      { accessorKey: 'calculated_at', header: '计算时间' }
    ]
  },
  'settings': {
    title: '财务设置',
    description: '财务科目、收入类型、费用类型、审批动作和绩效规则配置。',
    endpoint: '/settings/subjects',
    createEndpoint: '/settings/subjects',
    phase: 'v0.1-v0.3',
    createFields: [
      { key: 'code', label: '编码', required: true },
      { key: 'name', label: '名称', required: true },
      { key: 'subjectType', label: '类型', placeholder: 'asset/liability/equity/cost/profit_loss', required: true },
      { key: 'sortNo', label: '排序', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    columns: [
      { accessorKey: 'code', header: '编码' },
      { accessorKey: 'name', header: '名称' },
      { accessorKey: 'subject_type', header: '类型' },
      { accessorKey: 'parent_id', header: '上级ID' },
      { accessorKey: 'sort_no', header: '排序' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'accounting-objects': {
    title: '核算对象',
    description: '维护客户项目、内部项目、部门、客户、销售区域、商机、销售专项等经营核算对象。',
    endpoint: '/accounting-objects',
    createEndpoint: '/accounting-objects',
    phase: 'v0.1-v0.3',
    createFields: [
      { key: 'code', label: '编码', required: true },
      { key: 'name', label: '名称', required: true },
      { key: 'objectType', label: '类型', placeholder: 'customer_project/internal_project/department/customer/sales_region', required: true },
      { key: 'customerCode', label: '客户编码' },
      { key: 'projectCode', label: '项目编码' },
      { key: 'departmentCode', label: '部门编码' },
      { key: 'salesRegionCode', label: '销售区域' },
      { key: 'ownerUid', label: '负责人' }
    ],
    columns: [
      { accessorKey: 'code', header: '编码' },
      { accessorKey: 'name', header: '名称' },
      { accessorKey: 'object_type', header: '类型' },
      { accessorKey: 'customer_code', header: '客户' },
      { accessorKey: 'contract_code', header: '合同' },
      { accessorKey: 'project_code', header: '项目' },
      { accessorKey: 'department_code', header: '部门' },
      { accessorKey: 'sales_region_code', header: '销售区域' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'settings/subject-mappings': {
    title: '科目映射',
    description: '维护业务类型到小企业会计准则科目和核算对象策略的默认映射。',
    endpoint: '/settings/subject-mappings',
    createEndpoint: '/settings/subject-mappings',
    phase: 'v0.1-v0.3',
    createFields: [
      { key: 'bizType', label: '业务类型', required: true },
      { key: 'bizSubtype', label: '业务子类型' },
      { key: 'incomeTypeCode', label: '收入类型' },
      { key: 'expenseTypeCode', label: '费用类型' },
      { key: 'defaultSubjectCode', label: '默认科目编码', required: true },
      { key: 'objectStrategy', label: '核算对象策略', required: true },
      { key: 'sortNo', label: '排序', type: 'number' }
    ],
    columns: [
      { accessorKey: 'biz_type', header: '业务类型' },
      { accessorKey: 'biz_subtype', header: '子类型' },
      { accessorKey: 'income_type_code', header: '收入类型' },
      { accessorKey: 'expense_type_code', header: '费用类型' },
      { accessorKey: 'default_subject_code', header: '默认科目' },
      { accessorKey: 'object_strategy', header: '对象策略' },
      { accessorKey: 'sort_no', header: '排序' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'settings/income-types': {
    title: '收入类型',
    description: '维护合同收入、非合同收入等收入分类及默认财务科目。',
    endpoint: '/settings/income-types',
    createEndpoint: '/settings/income-types',
    phase: 'v0.1',
    createFields: [
      { key: 'code', label: '编码', required: true },
      { key: 'name', label: '名称', required: true },
      { key: 'defaultSubjectId', label: '默认科目ID', type: 'number' },
      { key: 'sortNo', label: '排序', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    columns: [
      { accessorKey: 'code', header: '编码' },
      { accessorKey: 'name', header: '名称' },
      { accessorKey: 'default_subject_id', header: '默认科目' },
      { accessorKey: 'is_contract_income', header: '合同收入' },
      { accessorKey: 'sort_no', header: '排序' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'settings/expense-types': {
    title: '费用类型',
    description: '维护项目、销售、管理、财务、人力和资产类费用分类。',
    endpoint: '/settings/expense-types',
    createEndpoint: '/settings/expense-types',
    phase: 'v0.1',
    createFields: [
      { key: 'code', label: '编码', required: true },
      { key: 'name', label: '名称', required: true },
      { key: 'defaultSubjectId', label: '默认科目ID', type: 'number' },
      { key: 'costCategory', label: '成本类别' },
      { key: 'sortNo', label: '排序', type: 'number' }
    ],
    columns: [
      { accessorKey: 'code', header: '编码' },
      { accessorKey: 'name', header: '名称' },
      { accessorKey: 'default_subject_id', header: '默认科目' },
      { accessorKey: 'cost_category', header: '成本类别' },
      { accessorKey: 'reimbursable', header: '可报销' },
      { accessorKey: 'status', header: '状态' }
    ]
  },
  'settings/people-cost-parameters': {
    title: '人力成本参数',
    description: '维护 People 职级成本计算公式中的基本工资、福利费率、管理分摊系数和固定资源分摊。',
    endpoint: '/settings/people-cost-parameters',
    createEndpoint: '/settings/people-cost-parameters',
    updateEndpoint: '/settings/people-cost-parameters',
    phase: 'v0.3',
    createFields: [
      { key: 'code', label: '参数编码', required: true, placeholder: 'PCP-YYYYMM' },
      { key: 'name', label: '参数名称', required: true },
      { key: 'effectiveFrom', label: '生效日期', type: 'date', required: true },
      { key: 'baseSalary', label: '基本工资', type: 'number', required: true },
      { key: 'welfareCostRate', label: '福利成本费率', type: 'number', placeholder: '0.30' },
      { key: 'managementAllocationRate', label: '管理分摊系数', type: 'number', placeholder: '0.20' },
      { key: 'resourceAllocationCost', label: '资源分摊固定值', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    columns: [
      { accessorKey: 'code', header: '参数编码' },
      { accessorKey: 'name', header: '参数名称' },
      { accessorKey: 'effective_from', header: '生效日期' },
      { accessorKey: 'base_salary', header: '基本工资' },
      { accessorKey: 'welfare_cost_rate', header: '福利费率' },
      { accessorKey: 'management_allocation_rate', header: '管理系数' },
      { accessorKey: 'resource_allocation_cost', header: '资源分摊' },
      { accessorKey: 'status', header: '状态' },
      { id: 'edit_actions', header: '操作' }
    ]
  },
  'settings/approval-instances': {
    title: '审批实例',
    description: '查看 Finance 单据与 Workflow、钉钉或企业微信审批实例的映射及同步状态。',
    endpoint: '/integrations/approval-instances',
    phase: 'v0.2',
    columns: [
      { accessorKey: 'biz_type', header: '业务类型' },
      { accessorKey: 'biz_code', header: '业务编码' },
      { accessorKey: 'workflow_instance_id', header: 'Workflow实例' },
      { accessorKey: 'external_platform', header: '平台' },
      { accessorKey: 'external_instance_id', header: '外部实例' },
      { accessorKey: 'status', header: '状态' },
      { accessorKey: 'submitted_by', header: '提交人' },
      { accessorKey: 'last_synced_at', header: '最近同步' }
    ]
  },
  'settings/audit-logs': {
    title: '审计日志',
    description: '查看 Finance 写操作、审批回调、迁移和重算任务的审计记录。',
    endpoint: '/audit-logs',
    phase: 'v0.1-v0.3',
    columns: [
      { accessorKey: 'entity_type', header: '实体类型' },
      { accessorKey: 'entity_code', header: '实体编码' },
      { accessorKey: 'action', header: '动作' },
      { accessorKey: 'operator_id', header: '操作人' },
      { accessorKey: 'operator_ip', header: 'IP' },
      { accessorKey: 'request_id', header: '请求ID' },
      { accessorKey: 'created_at', header: '时间' }
    ]
  },
  'reports': {
    title: '财务报表',
    description: '首期报表基于发票、收款、支出、项目核算和绩效快照聚合。',
    endpoint: '/reports',
    phase: 'v0.1-v0.3',
    columns: [
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'invoice_amount', header: '开票金额' },
      { accessorKey: 'receipt_amount', header: '收款金额' },
      { accessorKey: 'expense_amount', header: '支出金额' },
      { accessorKey: 'net_cash_amount', header: '现金净额' },
      { accessorKey: 'project_gross_profit_amount', header: '项目毛利' },
      { accessorKey: 'performance_amount', header: '绩效金额' }
    ]
  }
}
