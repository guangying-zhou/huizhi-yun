<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import InvoiceEditPage from './invoices/[code]/edit.vue'

const route = useRoute()
const { resolveCurrentAppPath } = useAppUrls()

interface PageConfig {
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

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

type InvoiceFileViewResponse = RuntimeEnvelope<{
  url?: string
  expiresIn?: number
  legacy?: boolean
}>

interface CreateField {
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

interface IssueInvoiceForm {
  invoiceNo: string
  invoiceDate: string
  invoiceMedium: string
  invoiceAmount: string
}

interface BalanceSnapshotRow extends Record<string, unknown> {
  id: number
  snapshot_date: string
  balance_amount: string
  currency_code: string
  source_type: string
  created_by: string | null
  created_at: string
}

interface BalanceSnapshotDisplayRow {
  id: number
  snapshot_date: string
  balance_amount: string
  currency_code: string
  source_type: string
  created_by: string | null
  created_at: string
}

interface BalanceSnapshotResponse extends FinanceListResponse<BalanceSnapshotRow> {
  chartData: BalanceSnapshotRow[]
  range: BalanceRange
}

interface BalanceChangeRow extends Record<string, unknown> {
  balance_date: string
  previous_total_balance: string
  change_amount: string
  total_balance: string
  direction: 'increase' | 'decrease' | 'flat'
}

interface BankAccountSummary {
  account_count: number
  cash_balance: string
  loan_balance: string
  stock_fund_balance: string
}

interface BalanceChangeSummary {
  opening_balance: string
  closing_balance: string
  net_change: string
}

type BalanceRange = 'current_month' | 'last_30_days' | 'current_year' | 'last_1_year' | 'all'
type FundChangeRange = 'current_year' | 'current_month' | 'last_1_month' | 'last_3_months' | 'last_6_months'

const slug = computed(() => {
  const value = route.params.slug
  return Array.isArray(value) ? value.join('/') : String(value || '')
})

function extractInvoiceEditCode(value: unknown) {
  const normalized = (String(value || '').split(/[?#]/, 1)[0] || '').replace(/^\/+|\/+$/g, '')
  const match = /(?:^|\/)invoices\/([^/]+)\/edit$/.exec(normalized)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

const invoiceEditCode = computed(() => {
  return extractInvoiceEditCode(slug.value)
    || extractInvoiceEditCode(route.path)
    || extractInvoiceEditCode(route.fullPath)
})
const isInvoiceEditPage = computed(() => Boolean(invoiceEditCode.value))

const accountingObjectTypeLabels: Record<string, string> = {
  customer_project: '客户项目',
  internal_project: '内部项目',
  department: '部门',
  customer: '客户',
  sales_region: '销售区域',
  sales_campaign: '销售专项',
  opportunity: '商机',
  contract: '合同',
  general: '通用',
  other: '其他'
}

const statusLabels: Record<string, string> = {
  active: '启用',
  inactive: '停用',
  closed: '已关闭',
  draft: '草稿',
  pending_approval: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  issued: '已开票',
  confirmed: '已确认',
  partially_reconciled: '部分核销',
  reconciled: '已核销',
  paid: '已付款',
  pending_payment: '待付款',
  canceled: '已取消',
  red_reversed: '已红冲',
  completed: '已完成'
}

const projectLifecycleStatusLabels: Record<string, string> = {
  draft: '草稿',
  planned: '计划中',
  active: '进行中',
  delivering: '交付中',
  accepted: '已验收',
  completed: '已完成',
  suspended: '已暂停',
  archived: '已归档'
}

const balanceRangeOptions: Array<{ label: string, value: BalanceRange }> = [
  { label: '当月', value: 'current_month' },
  { label: '最近30天', value: 'last_30_days' },
  { label: '当年', value: 'current_year' },
  { label: '最近1年', value: 'last_1_year' },
  { label: '全部', value: 'all' }
]

const fundChangeRangeOptions: Array<{ label: string, value: FundChangeRange }> = [
  { label: '当年', value: 'current_year' },
  { label: '当月', value: 'current_month' },
  { label: '最近1个月', value: 'last_1_month' },
  { label: '最近3个月', value: 'last_3_months' },
  { label: '最近半年', value: 'last_6_months' }
]

const invoiceMediumOptions = [
  { label: '电子发票', value: 'electronic' },
  { label: '纸质发票', value: 'paper' }
]

const balanceSnapshotColumns: TableColumn<BalanceSnapshotDisplayRow>[] = [
  { accessorKey: 'snapshot_date', header: '日期' },
  { accessorKey: 'balance_amount', header: '余额' },
  { accessorKey: 'currency_code', header: '币种' },
  { accessorKey: 'source_type', header: '来源' }
]

const pageConfigs: Record<string, PageConfig> = {
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
      { id: 'invoice_actions', header: '操作' }
    ]
  },
  'invoices/requests': {
    title: '开票申请',
    description: '来自 Finance 或 Altoc 的开票申请，后续接入 Workflow 审批。',
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
      { key: 'requestedBy', label: '申请人' }
    ],
    columns: [
      { accessorKey: 'code', header: '申请编号' },
      { accessorKey: 'customer_name', header: '客户' },
      { accessorKey: 'contract_code', header: '合同编码' },
      { accessorKey: 'invoice_medium', header: '介质' },
      { accessorKey: 'requested_amount', header: '申请金额' },
      { accessorKey: 'requested_by', header: '申请人' },
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
      { key: 'payerName', label: '付款方' }
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
      { accessorKey: 'status', header: '状态' }
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
      { accessorKey: 'status', header: '状态' }
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
    description: '按项目和期间维护人力、共享费用、资产和其他成本分摊记录。',
    endpoint: '/project-cost-allocations',
    createEndpoint: '/project-cost-allocations',
    phase: 'v0.3',
    createFields: [
      { key: 'projectCode', label: '项目编码', required: true },
      { key: 'periodMonth', label: '期间月份', placeholder: 'YYYY-MM', required: true },
      { key: 'allocationType', label: '分摊类型', placeholder: 'labor/shared_expense/asset/other' },
      { key: 'employeeUid', label: '员工UID' },
      { key: 'amount', label: '分摊金额', type: 'number', required: true },
      { key: 'allocationBasis', label: '分摊依据' }
    ],
    columns: [
      { accessorKey: 'code', header: '分摊编号' },
      { accessorKey: 'project_code', header: '项目编码' },
      { accessorKey: 'period_month', header: '期间' },
      { accessorKey: 'allocation_type', header: '类型' },
      { accessorKey: 'employee_uid', header: '员工UID' },
      { accessorKey: 'amount', header: '金额' },
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

const config = computed(() => pageConfigs[slug.value] || pageConfigs[slug.value.split('/')[0] || ''] || {
  title: '财务功能',
  description: '该功能已纳入 Finance 模块实现计划。',
  phase: '规划中',
  columns: []
})

const keyword = ref('')
const page = ref(1)
const endpoint = computed(() => config.value.endpoint ? financeApiPath(config.value.endpoint) : '')
const showAllBankAccounts = ref(false)
const showArchivedProjects = ref(false)
const createFormOpen = ref(false)
const createForm = ref<Record<string, string>>({})
const createFiles = ref<Record<string, File | null>>({})
const createPending = ref(false)
const createError = ref('')
const editingCode = ref('')
const bankAccountOptions = ref<Array<{ label: string, value: string }>>([])
const currentUserId = ref('')
const submittingCode = ref('')
const recalculating = ref(false)
const peopleCostSyncPeriodMonth = ref(currentPeriodMonth())
const peopleCostSyncingProjectCode = ref('')
const balanceDrawerOpen = ref(false)
const selectedBankAccount = ref<Record<string, unknown> | null>(null)
const balanceRange = ref<BalanceRange>('current_month')
const fundChangeRange = ref<FundChangeRange>('current_year')
const waterfallChartContainer = ref<HTMLElement | null>(null)
const waterfallChartWidth = ref(1200)
const invoicePreviewOpen = ref(false)
const invoicePreviewUrl = ref('')
const invoicePreviewTitle = ref('发票预览')
const invoicePreviewMimeType = ref('')
const invoicePreviewLoadingUrl = ref('')
const selectedInvoiceAction = ref<Record<string, unknown> | null>(null)
const redReverseModalOpen = ref(false)
const redReverseReason = ref('')
const redReverseInvoiceNo = ref('')
const redReversePending = ref(false)
const deleteInvoiceModalOpen = ref(false)
const deleteInvoiceReason = ref('')
const deleteInvoicePending = ref(false)
const issueInvoiceModalOpen = ref(false)
const issueInvoicePending = ref(false)
const issueInvoiceError = ref('')
const issueInvoiceRequest = ref<Record<string, unknown> | null>(null)
const issueInvoiceFile = ref<File | null>(null)
const issueInvoiceForm = ref<IssueInvoiceForm>({
  invoiceNo: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  invoiceMedium: 'electronic',
  invoiceAmount: ''
})
const waterfallTooltip = ref({
  open: false,
  x: 0,
  y: 0,
  date: '',
  change: '',
  total: ''
})
const balanceStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const balanceResult = ref<BalanceSnapshotResponse>({
  data: [],
  chartData: [],
  range: 'current_month',
  total: 0,
  page: 1,
  pageSize: 100
})
const toast = useToast()

const result = ref<FinanceListResponse<Record<string, unknown>>>({
  data: [],
  total: 0,
  page: 1,
  pageSize: 20
})
const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const { loadAuthorization, getAuthorization } = useAuthorization()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
let waterfallResizeObserver: ResizeObserver | null = null

async function refresh() {
  if (!endpoint.value) {
    result.value = {
      data: [],
      total: 0,
      page: 1,
      pageSize: 20
    }
    status.value = 'idle'
    return
  }

  status.value = 'pending'
  try {
    const response = await $fetch<unknown>(endpoint.value, {
      query: {
        page: isProjectAccountingPage.value ? 1 : page.value,
        pageSize: isProjectAccountingPage.value ? 500 : (isBankAccountsPage.value || isBalanceChangesPage.value ? 1000 : 20),
        keyword: isBalanceChangesPage.value ? undefined : keyword.value || undefined,
        periodMonth: isProjectAccountingPage.value ? peopleCostSyncPeriodMonth.value || undefined : undefined,
        showArchivedProjects: isProjectAccountingPage.value && showArchivedProjects.value ? '1' : undefined,
        range: isBalanceChangesPage.value ? fundChangeRange.value : undefined,
        showAll: isBankAccountsPage.value && showAllBankAccounts.value ? '1' : undefined
      }
    })
    result.value = normalizeFinanceListResponse<Record<string, unknown>>(response)
    status.value = 'success'
  } catch (error) {
    status.value = 'error'
    throw error
  }
}

const rows = computed(() => result.value.data || [])
const displayRows = computed(() => rows.value.map(row => ({
  ...row,
  accounting_object_type: formatAccountingObjectType(row.accounting_object_type),
  object_type: formatAccountingObjectType(row.object_type),
  invoice_medium: formatInvoiceMedium(row.invoice_medium),
  status: formatStatus(row.status),
  lifecycle_status: formatProjectLifecycleStatus(row.lifecycle_status),
  snapshot_date: row.snapshot_date ? formatPlainDate(row.snapshot_date) : row.snapshot_date,
  balance_amount: row.balance_amount ? formatMoney(row.balance_amount) : row.balance_amount,
  balance_date: row.balance_date ? formatPlainDate(row.balance_date) : row.balance_date,
  previous_total_balance: row.previous_total_balance ? formatPlainMoney(row.previous_total_balance) : row.previous_total_balance,
  change_amount: row.change_amount ? formatSignedMoney(row.change_amount) : row.change_amount,
  total_balance: row.total_balance ? formatPlainMoney(row.total_balance) : row.total_balance,
  direction: formatChangeDirection(row.direction),
  latest_balance_amount: row.latest_balance_amount ? formatMoney(row.latest_balance_amount) : '-',
  latest_balance_date: formatPlainDate(row.latest_balance_date),
  period_month: row.period_month || '-',
  received_amount: formatOptionalMoney(row.received_amount),
  direct_expense_amount: formatOptionalMoney(row.direct_expense_amount),
  labor_cost_amount: formatOptionalMoney(row.labor_cost_amount),
  allocated_cost_amount: formatOptionalMoney(row.allocated_cost_amount),
  gross_profit_amount: formatOptionalMoney(row.gross_profit_amount),
  has_labor_cost: hasProjectLaborCost(row),
  base_salary: formatOptionalMoney(row.base_salary),
  resource_allocation_cost: formatOptionalMoney(row.resource_allocation_cost),
  welfare_cost_rate: formatRate(row.welfare_cost_rate),
  management_allocation_rate: formatRate(row.management_allocation_rate)
})))
const balanceRows = computed(() => (balanceResult.value.data || []).map(row => ({
  ...row,
  snapshot_date: formatPlainDate(row.snapshot_date),
  balance_amount: formatMoney(row.balance_amount)
})))
const balanceChartData = computed(() => balanceResult.value.chartData || [])
const balanceChart = computed(() => buildBalanceChart(balanceChartData.value))
const title = computed(() => config.value.title)
const hasEndpoint = computed(() => Boolean(config.value.endpoint))
const canCreate = computed(() => Boolean(config.value.createEndpoint && config.value.createFields?.length))
const canEdit = computed(() => Boolean(config.value.updateEndpoint && config.value.createFields?.length))
const isEditing = computed(() => Boolean(editingCode.value))
const canEditInvoices = computed(() => permissionsLoaded.value && hasPermission('invoices', 'edit'))
const canAdminInvoices = computed(() => permissionsLoaded.value && hasPermission('invoices', 'admin'))
const selectedInvoiceActionTitle = computed(() => {
  const row = selectedInvoiceAction.value
  if (!row) return ''
  return String(row.invoice_no || row.invoiceNo || row.code || '').trim()
})
const isProjectAccountingPage = computed(() => slug.value === 'project-accounting')
const isEmployeeCostsPage = computed(() => slug.value === 'project-accounting/employee-costs')
const isBankAccountsPage = computed(() => slug.value === 'bank-accounts')
const isBalanceChangesPage = computed(() => slug.value === 'bank-accounts/balance-changes')
const bankAccountSummary = computed<BankAccountSummary>(() => ({
  account_count: Number(result.value.summary?.account_count || result.value.total || 0),
  cash_balance: String(result.value.summary?.cash_balance || '0.00'),
  loan_balance: String(result.value.summary?.loan_balance || '0.00'),
  stock_fund_balance: String(result.value.summary?.stock_fund_balance || '0.00')
}))
const balanceChangeRows = computed(() => (result.value.chartData || result.value.data || []) as BalanceChangeRow[])
const balanceChangeSummary = computed<BalanceChangeSummary>(() => ({
  opening_balance: String(result.value.summary?.opening_balance || '0.00'),
  closing_balance: String(result.value.summary?.closing_balance || '0.00'),
  net_change: String(result.value.summary?.net_change || '0.00')
}))
const waterfallChart = computed(() => buildWaterfallChart(balanceChangeRows.value, waterfallChartWidth.value))
const { setRefresh, clearRefresh } = usePageActions()

usePageTitle(title)

onMounted(() => {
  setRefresh(() => {
    refresh()
  })
  loadCurrentUser()
  loadPermissions()
  nextTick(connectWaterfallResizeObserver)
})

onUnmounted(() => {
  clearRefresh()
  waterfallResizeObserver?.disconnect()
  waterfallResizeObserver = null
})

watch(() => slug.value, () => {
  page.value = 1
  keyword.value = ''
  showAllBankAccounts.value = false
  showArchivedProjects.value = false
  fundChangeRange.value = 'current_year'
  createFormOpen.value = false
  createForm.value = {}
  createError.value = ''
  editingCode.value = ''
  peopleCostSyncPeriodMonth.value = currentPeriodMonth()
})

watch([endpoint, page], () => {
  refresh()
}, { immediate: true })

watch(keyword, () => {
  page.value = 1
  refresh()
})

watch(peopleCostSyncPeriodMonth, () => {
  if (!isProjectAccountingPage.value) return
  page.value = 1
  refresh()
})

watch(showAllBankAccounts, () => {
  if (!isBankAccountsPage.value) return
  page.value = 1
  refresh()
})

watch(showArchivedProjects, () => {
  if (!isProjectAccountingPage.value) return
  page.value = 1
  refresh()
})

watch(fundChangeRange, () => {
  if (!isBalanceChangesPage.value) return
  page.value = 1
  refresh()
})

watch(isBalanceChangesPage, async () => {
  await nextTick()
  connectWaterfallResizeObserver()
})

async function submitCreate() {
  const editing = isEditing.value
  const targetEndpoint = editing ? config.value.updateEndpoint : config.value.createEndpoint
  if (!targetEndpoint) return
  if (slug.value === 'bank-accounts/balances') {
    applyBalanceSnapshotDefaults()
  }
  createPending.value = true
  createError.value = ''
  try {
    const path = editing ? `${targetEndpoint}/${encodeURIComponent(editingCode.value)}` : targetEndpoint
    const body = await buildCreatePayload(editing)
    await $fetch(financeApiPath(path), {
      method: editing ? 'PATCH' : 'POST',
      body
    })
    toast.add({
      title: editing ? '已更新' : '已保存',
      description: `${config.value.title}记录已${editing ? '更新' : '创建'}。`,
      color: 'success'
    })
    resetCreateForm()
    await refresh()
  } catch (error) {
    createError.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    createPending.value = false
  }
}

async function toggleCreateForm() {
  if (createFormOpen.value) {
    closeCreateForm()
    return
  }
  resetCreateForm()
  if (slug.value === 'bank-accounts/balances') {
    await loadBankAccountOptions()
    applyBalanceSnapshotDefaults()
  }
  createFormOpen.value = true
}

function closeCreateForm() {
  createFormOpen.value = false
  createError.value = ''
  editingCode.value = ''
  createFiles.value = {}
}

function resetCreateForm() {
  createForm.value = {}
  createFiles.value = {}
  closeCreateForm()
}

function startEdit(row: Record<string, unknown>) {
  if (!canEdit.value || !config.value.createFields) return
  const code = String(row.code || '').trim()
  if (!code) {
    toast.add({
      title: '无法编辑',
      description: '当前记录缺少编码。',
      color: 'warning'
    })
    return
  }

  const source = rows.value.find(item => String(item.code || '') === code) || row
  const nextForm: Record<string, string> = {}
  for (const field of config.value.createFields) {
    if (field.type === 'file') continue
    nextForm[field.key] = formValueFromRow(source, field.key)
  }
  createFiles.value = {}
  createForm.value = nextForm
  createError.value = ''
  editingCode.value = code
  createFormOpen.value = true
}

async function loadCurrentUser() {
  const auth = await loadAuthorization()
  currentUserId.value = auth?.uid || getAuthorization()?.uid || ''
  if (slug.value === 'bank-accounts/balances') {
    applyBalanceSnapshotDefaults()
  }
}

async function loadBankAccountOptions() {
  if (bankAccountOptions.value.length > 0) return
  const response = await $fetch<unknown>(financeApiPath('/bank-accounts'), {
    query: {
      showAll: '1'
    }
  })
  const list = normalizeFinanceListResponse<Record<string, unknown>>(response)
  bankAccountOptions.value = (list.data || []).map(account => ({
    label: formatBankAccountOptionLabel(account),
    value: String(account.code || '')
  }))
}

function applyBalanceSnapshotDefaults() {
  createForm.value = {
    ...createForm.value,
    snapshotDate: createForm.value.snapshotDate || yesterdayDate(),
    currencyCode: createForm.value.currencyCode || 'CNY',
    sourceType: 'manual',
    createdBy: currentUserId.value || createForm.value.createdBy || 'unknown'
  }
}

async function submitApproval(row: Record<string, unknown>) {
  const source = sourceRow(row)
  const code = String(source.code || row.code || '')
  if (!config.value.submitEndpointBase || !code) return
  submittingCode.value = code
  try {
    await $fetch(financeApiPath(`${config.value.submitEndpointBase}/${code}/submit`), {
      method: 'POST',
      body: {
        submittedBy: 'finance-ui'
      }
    })
    toast.add({
      title: '已提交审批',
      description: `${code} 已进入审批中。`,
      color: 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({
      title: '提交失败',
      description: error instanceof Error ? error.message : '审批提交失败',
      color: 'error'
    })
  } finally {
    submittingCode.value = ''
  }
}

function sourceRow(row: Record<string, unknown>) {
  const code = String(row.code || '').trim()
  return rows.value.find(item => String(item.code || '').trim() === code) || row
}

function sourceStatus(row: Record<string, unknown>) {
  return String(sourceRow(row).status || row.status || '').trim()
}

function isInvoiceRequestsPage() {
  return slug.value === 'invoices/requests'
}

function canIssueInvoiceRequest(row: Record<string, unknown>) {
  if (!isInvoiceRequestsPage()) return false
  const source = sourceRow(row)
  if (source.issued_invoice_id || source.issuedInvoiceId) return false
  return ['draft', 'pending_approval', 'approved'].includes(sourceStatus(row))
}

function openIssueInvoiceRequest(row: Record<string, unknown>) {
  const source = sourceRow(row)
  issueInvoiceRequest.value = source
  issueInvoiceForm.value = {
    invoiceNo: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    invoiceMedium: String(source.invoice_medium || source.invoiceMedium || 'electronic'),
    invoiceAmount: String(source.requested_amount || source.requestedAmount || '')
  }
  issueInvoiceFile.value = null
  issueInvoiceError.value = ''
  issueInvoiceModalOpen.value = true
}

function onIssueInvoiceFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  issueInvoiceFile.value = input.files?.[0] || null
}

async function submitIssueInvoiceRequest() {
  const request = issueInvoiceRequest.value
  const code = String(request?.code || '').trim()
  if (!code) return
  issueInvoicePending.value = true
  issueInvoiceError.value = ''
  try {
    const medium = String(issueInvoiceForm.value.invoiceMedium || 'electronic')
    const file = issueInvoiceFile.value
    if (!issueInvoiceForm.value.invoiceNo.trim()) {
      throw new Error('请输入发票号码')
    }
    if (!file) {
      throw new Error('请上传发票文件')
    }
    validateInvoiceFile(medium, file)
    const uploaded = await uploadInvoiceFile(medium, file)
    await $fetch(financeApiPath(`/invoice-requests/${encodeURIComponent(code)}/issue`), {
      method: 'POST',
      body: {
        invoiceNo: issueInvoiceForm.value.invoiceNo.trim(),
        invoiceDate: issueInvoiceForm.value.invoiceDate,
        invoiceMedium: medium,
        invoiceAmount: issueInvoiceForm.value.invoiceAmount,
        invoiceFileUrl: uploaded.url,
        invoiceFileName: uploaded.fileName,
        invoiceFileMimeType: uploaded.mimeType,
        invoiceFileSize: uploaded.size,
        issuedBy: currentUserId.value || 'finance-ui',
        updatedBy: currentUserId.value || 'finance-ui'
      }
    })
    toast.add({
      title: '开票成功',
      description: `${code} 已生成正式发票。`,
      color: 'success'
    })
    issueInvoiceModalOpen.value = false
    await refresh()
  } catch (error) {
    issueInvoiceError.value = error instanceof Error ? error.message : '开票确认失败'
  } finally {
    issueInvoicePending.value = false
  }
}

async function openBalanceDrawer(row: Record<string, unknown>) {
  selectedBankAccount.value = row
  balanceRange.value = 'current_month'
  balanceDrawerOpen.value = true
  await refreshBalanceSnapshots()
}

async function refreshBalanceSnapshots() {
  const code = String(selectedBankAccount.value?.code || '')
  if (!code) return
  balanceStatus.value = 'pending'
  try {
    const response = await $fetch<unknown>(financeApiPath(`/bank-accounts/${code}/balance-snapshots`), {
      query: {
        page: 1,
        pageSize: 100,
        range: balanceRange.value
      }
    })
    balanceResult.value = normalizeFinanceListResponse<BalanceSnapshotRow>(response) as BalanceSnapshotResponse
    balanceStatus.value = 'success'
  } catch (error) {
    balanceStatus.value = 'error'
    toast.add({
      title: '余额变动加载失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error'
    })
  }
}

async function recalculate() {
  if (!config.value.recalculateEndpoint) return
  recalculating.value = true
  try {
    const response = await $fetch<{ data?: { recalculated?: number, warning?: string } }>(financeApiPath(config.value.recalculateEndpoint), {
      method: 'POST',
      body: {}
    })
    toast.add({
      title: '重算完成',
      description: response.data?.warning || `已重算 ${response.data?.recalculated || 0} 条记录。`,
      color: response.data?.warning ? 'warning' : 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({
      title: '重算失败',
      description: error instanceof Error ? error.message : '重算任务执行失败',
      color: 'error'
    })
  } finally {
    recalculating.value = false
  }
}

async function syncPeopleCosts(row: Record<string, unknown>) {
  const projectCode = String(row.project_code || row.projectCode || '').trim()
  const periodMonth = peopleCostSyncPeriodMonth.value.trim()
  if (!projectCode) {
    toast.add({
      title: '缺少 Aims 项目',
      description: '当前行没有可用于核算的人力成本项目编码。',
      color: 'warning'
    })
    return
  }

  peopleCostSyncingProjectCode.value = projectCode
  try {
    const response = await $fetch<RuntimeEnvelope<{
      aimsTimeEntryRows?: number
      peopleStandardCostRows?: number
      employeeStandardCostsSynced?: number
      laborCostAllocationsSynced?: number
      totalAllocatedActualCost?: string
    }>>(financeApiPath('/project-accounting/sync-people-costs'), {
      method: 'POST',
      body: {
        projectCode,
        periodMonth
      }
    })
    const data = response.data || {}
    toast.add({
      title: '标准人力成本计算完成',
      description: `Aims 工时 ${data.aimsTimeEntryRows || 0} 条，People 职级 ${data.peopleStandardCostRows || 0} 条，员工成本 ${data.employeeStandardCostsSynced || 0} 条，分摊 ${data.laborCostAllocationsSynced || 0} 条。`,
      color: 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({
      title: '标准人力成本计算失败',
      description: error instanceof Error ? error.message : '请检查 Aims 项目工时、Finance 人力成本参数和 People 职级设置。',
      color: 'error'
    })
  } finally {
    if (peopleCostSyncingProjectCode.value === projectCode) {
      peopleCostSyncingProjectCode.value = ''
    }
  }
}

function hasProjectLaborCost(row: Record<string, unknown>) {
  return Number(row.labor_cost_amount || 0) > 0 || Number(row.allocated_cost_amount || 0) > 0
}

function canSubmitApproval(row: Record<string, unknown>) {
  return Boolean(config.value.submitEndpointBase && ['draft', 'rejected'].includes(sourceStatus(row)))
}

function setBalanceRange(value: BalanceRange) {
  balanceRange.value = value
  refreshBalanceSnapshots()
}

function formatAccountingObjectType(value: unknown) {
  const key = String(value || '').trim()
  if (!key) return ''
  return accountingObjectTypeLabels[key] || key
}

function formatInvoiceMedium(value: unknown) {
  const key = String(value || '').trim()
  if (key === 'electronic') return '电子'
  if (key === 'paper') return '纸质'
  return key || '-'
}

function formatStatus(value: unknown) {
  const key = String(value || '').trim()
  if (!key) return ''
  return statusLabels[key] || key
}

function onCreateFileChange(field: CreateField, event: Event) {
  const input = event.target as HTMLInputElement
  createFiles.value = {
    ...createFiles.value,
    [field.key]: input.files?.[0] || null
  }
}

function selectedCreateFileName(field: CreateField) {
  return createFiles.value[field.key]?.name || ''
}

function isInvoicesPage() {
  return slug.value === 'invoices'
}

async function buildCreatePayload(editing: boolean) {
  const body: Record<string, string | number> = { ...createForm.value }
  if (!isInvoicesPage()) return body

  body.invoiceMedium = String(body.invoiceMedium || 'electronic')
  const file = createFiles.value.invoiceFile
  if (!file) return body

  validateInvoiceFile(String(body.invoiceMedium), file)
  const uploaded = await uploadInvoiceFile(String(body.invoiceMedium), file)
  return {
    ...body,
    invoiceFileUrl: uploaded.url,
    invoiceFileName: uploaded.fileName,
    invoiceFileMimeType: uploaded.mimeType,
    invoiceFileSize: uploaded.size,
    updatedBy: editing ? currentUserId.value || body.updatedBy || 'finance-ui' : body.updatedBy
  }
}

function validateInvoiceFile(medium: string, file: File) {
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (medium === 'paper') {
    if (extension !== 'pdf' && file.type !== 'application/pdf') {
      throw new Error('纸质发票扫描件只支持 PDF 文件')
    }
    return
  }
  if (!['pdf', 'ofd'].includes(extension)) {
    throw new Error('电子发票只支持 PDF 或 OFD 文件')
  }
}

async function uploadInvoiceFile(medium: string, file: File) {
  const formData = new FormData()
  formData.append('invoiceMedium', medium)
  formData.append('file', file)
  const response = await $fetch<RuntimeEnvelope<{
    url: string
    fileName: string
    mimeType: string
    size: number
  }>>(financeApiPath('/invoices/files'), {
    method: 'POST',
    body: formData
  })
  if (!response.data?.url) {
    throw new Error('发票文件上传失败')
  }
  return response.data
}

function invoiceFileUrl(row: Record<string, unknown>) {
  return String(row.invoice_file_url || row.invoiceFileUrl || '').trim()
}

function invoiceFileName(row: Record<string, unknown>) {
  return String(row.invoice_file_name || row.invoiceFileName || row.invoice_no || row.invoiceNo || row.code || '发票文件').trim()
}

function invoiceFileMimeType(row: Record<string, unknown>) {
  return String(row.invoice_file_mime_type || row.invoiceFileMimeType || '').trim()
}

function invoiceFilePreviewUrl(row: Record<string, unknown>) {
  const params = new URLSearchParams()
  params.set('url', invoiceFileUrl(row))
  const name = invoiceFileName(row)
  const mimeType = invoiceFileMimeType(row)
  if (name) params.set('name', name)
  if (mimeType) params.set('mimeType', mimeType)
  params.set('format', 'json')
  return resolveCurrentAppPath(`${financeApiPath('/invoices/files/view')}?${params.toString()}`)
}

function errorText(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { message?: string, statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return String(candidate?.data?.message || candidate?.data?.statusMessage || candidate?.statusMessage || candidate?.message || fallback)
}

function previewFileExtension(url: string, name = '') {
  const source = (name || url).split(/[?#]/)[0] || ''
  const index = source.lastIndexOf('.')
  return index >= 0 ? source.slice(index + 1).toLowerCase() : ''
}

const invoicePreviewKind = computed(() => {
  const mimeType = invoicePreviewMimeType.value.toLowerCase()
  const extension = previewFileExtension(invoicePreviewUrl.value, invoicePreviewTitle.value)
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image'
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mimeType === 'application/ofd' || extension === 'ofd') return 'ofd'
  return 'other'
})

async function openInvoiceFile(row: Record<string, unknown>) {
  const url = invoiceFileUrl(row)
  if (!url) {
    toast.add({ title: '该发票尚未上传文件', color: 'warning' })
    return
  }

  invoicePreviewLoadingUrl.value = url
  try {
    const response = await $fetch<InvoiceFileViewResponse>(invoiceFilePreviewUrl(row))
    const previewUrl = String(response.data?.url || '').trim()
    if (!previewUrl) {
      throw new Error(response.message || '发票文件预览地址无效')
    }
    invoicePreviewUrl.value = previewUrl
    invoicePreviewTitle.value = invoiceFileName(row) || '发票预览'
    invoicePreviewMimeType.value = invoiceFileMimeType(row)
    invoicePreviewOpen.value = true
  } catch (error) {
    toast.add({ title: errorText(error, '发票文件预览失败'), color: 'error' })
  } finally {
    if (invoicePreviewLoadingUrl.value === url) {
      invoicePreviewLoadingUrl.value = ''
    }
  }
}

function openInvoiceFileExternal() {
  if (!invoicePreviewUrl.value) return
  window.open(invoicePreviewUrl.value, '_blank', 'noopener,noreferrer')
}

function invoiceActionRow(row: Record<string, unknown>) {
  return sourceRow(row)
}

function invoiceCode(row: Record<string, unknown>) {
  const source = invoiceActionRow(row)
  return String(source.code || row.code || '').trim()
}

function openInvoiceEditor(row: Record<string, unknown>) {
  const code = invoiceCode(row)
  if (!code) {
    toast.add({ title: '无法编辑', description: '当前发票缺少编码。', color: 'warning' })
    return
  }
  navigateTo({ path: `/invoices/${encodeURIComponent(code)}/edit` })
}

function isInvoiceActionDisabled(row: Record<string, unknown>) {
  const status = String(invoiceActionRow(row).status || '').trim()
  return status === 'red_reversed' || status === 'canceled'
}

function openRedReverseInvoice(row: Record<string, unknown>) {
  selectedInvoiceAction.value = invoiceActionRow(row)
  redReverseReason.value = ''
  redReverseInvoiceNo.value = ''
  redReverseModalOpen.value = true
}

async function submitRedReverseInvoice() {
  const row = selectedInvoiceAction.value
  const code = row ? invoiceCode(row) : ''
  if (!code) return
  if (!redReverseReason.value.trim()) {
    toast.add({ title: '请填写冲红原因', color: 'warning' })
    return
  }
  redReversePending.value = true
  try {
    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code)}/red-reverse`), {
      method: 'POST',
      body: {
        reason: redReverseReason.value.trim(),
        redInvoiceNo: redReverseInvoiceNo.value.trim(),
        redReversedBy: currentUserId.value || 'finance-ui'
      }
    })
    toast.add({ title: '已冲红', description: `${code} 已标记为已红冲。`, color: 'success' })
    redReverseModalOpen.value = false
    selectedInvoiceAction.value = null
    await refresh()
  } catch (error) {
    toast.add({ title: errorText(error, '冲红失败'), color: 'error' })
  } finally {
    redReversePending.value = false
  }
}

function openDeleteInvoice(row: Record<string, unknown>) {
  selectedInvoiceAction.value = invoiceActionRow(row)
  deleteInvoiceReason.value = ''
  deleteInvoiceModalOpen.value = true
}

async function submitDeleteInvoice() {
  const row = selectedInvoiceAction.value
  const code = row ? invoiceCode(row) : ''
  if (!code) return
  deleteInvoicePending.value = true
  try {
    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code)}/delete-with-file`), {
      method: 'POST',
      body: {
        reason: deleteInvoiceReason.value.trim(),
        deletedBy: currentUserId.value || 'finance-ui'
      }
    })
    toast.add({ title: '已删除', description: `${code} 已删除。`, color: 'success' })
    deleteInvoiceModalOpen.value = false
    selectedInvoiceAction.value = null
    await refresh()
  } catch (error) {
    toast.add({ title: errorText(error, '删除失败'), color: 'error' })
  } finally {
    deleteInvoicePending.value = false
  }
}

function formatProjectLifecycleStatus(value: unknown) {
  const key = String(value || '').trim()
  if (!key) return ''
  return projectLifecycleStatusLabels[key] || key
}

function camelToSnake(value: string) {
  return value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

function formValueFromRow(row: Record<string, unknown>, key: string) {
  const value = row[key] ?? row[camelToSnake(key)] ?? ''
  if (value === undefined || value === null) return ''
  if (key.toLowerCase().includes('date') || key.toLowerCase().includes('from') || key.toLowerCase().includes('to')) {
    return String(value).slice(0, 10)
  }
  return String(value)
}

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function formatOptionalMoney(value: unknown) {
  return hasDisplayValue(value) ? formatMoney(value) : '-'
}

function formatRate(value: unknown) {
  if (!hasDisplayValue(value)) return '-'
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return String(value)
  return `${(numberValue * 100).toFixed(2)}%`
}

function formatSignedMoney(value: unknown) {
  const numberValue = Number(value || 0)
  const formatted = formatPlainMoney(Math.abs(Number.isFinite(numberValue) ? numberValue : 0))
  if (numberValue > 0) return `+${formatted}`
  if (numberValue < 0) return `-${formatted}`
  return formatted
}

function formatPlainMoney(value: unknown) {
  const numberValue = Number(value || 0)
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(numberValue) ? numberValue : 0)
}

function formatAxisMoney(value: unknown) {
  const numberValue = Number(value || 0)
  const safeValue = Number.isFinite(numberValue) ? numberValue : 0
  const sign = safeValue < 0 ? '-' : ''
  const absoluteValue = Math.abs(safeValue)
  if (absoluteValue >= 100000000) return `${sign}${(absoluteValue / 100000000).toFixed(1)}亿`
  if (absoluteValue >= 10000) return `${sign}${(absoluteValue / 10000).toFixed(0)}万`
  return `${sign}${absoluteValue.toFixed(0)}`
}

function formatChangeDirection(value: unknown) {
  const key = String(value || '').trim()
  if (key === 'increase') return '增加'
  if (key === 'decrease') return '减少'
  if (key === 'flat') return '持平'
  return key
}

function getCreateFieldOptions(field: CreateField) {
  if (field.optionsKey === 'bankAccounts') return bankAccountOptions.value
  return field.options || []
}

function formatBankAccountOptionLabel(account: Record<string, unknown>) {
  const name = String(account.account_name || account.code || '')
  const bankName = String(account.bank_name || '').trim()
  const code = String(account.code || '').trim()
  const suffix = [bankName, code].filter(Boolean).join('，')
  return suffix ? `${name}（${suffix}）` : name
}

function yesterdayDate() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

function currentPeriodMonth() {
  return new Date().toISOString().slice(0, 7)
}

function isRuntimeEnvelope<T>(value: unknown): value is RuntimeEnvelope<T> {
  return Boolean(value && typeof value === 'object' && 'code' in value && 'data' in value)
}

function normalizeFinanceListResponse<T>(value: unknown): FinanceListResponse<T> {
  const payload = isRuntimeEnvelope<FinanceListResponse<T>>(value) ? value.data : value
  if (payload && typeof payload === 'object') {
    const record = payload as Partial<FinanceListResponse<T>>
    if (Array.isArray(record.data)) {
      return {
        data: record.data,
        chartData: record.chartData,
        total: Number(record.total || record.data.length || 0),
        page: Number(record.page || 1),
        pageSize: Number(record.pageSize || 20),
        summary: record.summary,
        warning: record.warning
      }
    }
  }
  return {
    data: [],
    total: 0,
    page: 1,
    pageSize: 20
  }
}

function updateWaterfallChartWidth() {
  const width = waterfallChartContainer.value?.clientWidth || 0
  if (width > 0) {
    waterfallChartWidth.value = Math.max(760, Math.round(width))
  }
}

function connectWaterfallResizeObserver() {
  waterfallResizeObserver?.disconnect()
  waterfallResizeObserver = null
  if (!isBalanceChangesPage.value || !waterfallChartContainer.value) return

  updateWaterfallChartWidth()
  if (typeof ResizeObserver === 'undefined') return

  waterfallResizeObserver = new ResizeObserver(() => {
    updateWaterfallChartWidth()
  })
  waterfallResizeObserver.observe(waterfallChartContainer.value)
}

function showWaterfallTooltip(
  bar: { date: string, change: number, total: number },
  event: MouseEvent
) {
  waterfallTooltip.value = {
    ...waterfallTooltip.value,
    open: true,
    date: bar.date,
    change: formatSignedMoney(bar.change),
    total: formatPlainMoney(bar.total)
  }
  moveWaterfallTooltip(event)
}

function moveWaterfallTooltip(event: MouseEvent) {
  const rect = waterfallChartContainer.value?.getBoundingClientRect()
  if (!rect) return
  const x = event.clientX - rect.left + 12
  const y = event.clientY - rect.top + 12
  waterfallTooltip.value = {
    ...waterfallTooltip.value,
    x: Math.min(Math.max(x, 8), rect.width - 168),
    y: Math.min(Math.max(y, 8), rect.height - 72)
  }
}

function hideWaterfallTooltip() {
  waterfallTooltip.value = {
    ...waterfallTooltip.value,
    open: false
  }
}

function buildBalanceChart(items: BalanceSnapshotRow[]) {
  const values = items
    .map((item, index) => ({
      index,
      date: formatPlainDate(item.snapshot_date),
      amount: Number(item.balance_amount || 0)
    }))
    .filter(item => Number.isFinite(item.amount))

  if (!values.length) {
    return {
      points: '',
      areaPoints: '',
      labels: [] as Array<{ x: number, date: string, amount: number }>,
      min: 0,
      max: 0,
      latest: null as null | { date: string, amount: number }
    }
  }

  const width = 640
  const height = 220
  const paddingX = 28
  const paddingY = 24
  const min = Math.min(...values.map(item => item.amount))
  const max = Math.max(...values.map(item => item.amount))
  const span = max - min || 1
  const denominator = Math.max(values.length - 1, 1)
  const points = values.map((item, index) => {
    const x = paddingX + (index / denominator) * (width - paddingX * 2)
    const y = height - paddingY - ((item.amount - min) / span) * (height - paddingY * 2)
    return { x, y, date: item.date, amount: item.amount }
  })
  const pointText = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const areaPoints = [
    `${paddingX},${height - paddingY}`,
    pointText,
    `${width - paddingX},${height - paddingY}`
  ].join(' ')
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]

  return {
    points: pointText,
    areaPoints,
    labels: labelIndexes.map(index => ({
      x: points[index]?.x || paddingX,
      date: values[index]?.date || '',
      amount: values[index]?.amount || 0
    })),
    min,
    max,
    latest: values[values.length - 1] || null
  }
}

function buildWaterfallChart(items: BalanceChangeRow[], chartWidthValue: number) {
  const values = items
    .map((item, index) => ({
      index,
      date: formatPlainDate(item.balance_date),
      previous: Number(item.previous_total_balance || 0),
      change: Number(item.change_amount || 0),
      total: Number(item.total_balance || 0),
      direction: item.direction
    }))
    .filter(item => Number.isFinite(item.previous) && Number.isFinite(item.change) && Number.isFinite(item.total))

  if (!values.length) {
    return {
      bars: [] as Array<{
        x: number
        y: number
        width: number
        height: number
        date: string
        change: number
        total: number
        direction: 'increase' | 'decrease' | 'flat'
        connectorX1: number
        connectorY1: number
        connectorX2: number
        connectorY2: number
        showValueLabel: boolean
      }>,
      labels: [] as Array<{ x: number, date: string }>,
      yTicks: [] as Array<{ y: number, amount: number }>,
      width: 760,
      height: 300,
      zeroY: 0,
      axisLeft: 0,
      axisRight: 0,
      axisTop: 0,
      axisBottom: 0,
      min: 0,
      max: 0
    }
  }

  const width = Math.max(760, Math.round(chartWidthValue || 1200))
  const height = 300
  const paddingLeft = 84
  const paddingRight = 18
  const paddingTop = 24
  const paddingBottom = 42
  const min = Math.min(0, ...values.map(item => Math.min(item.previous, item.total)))
  const max = Math.max(0, ...values.map(item => Math.max(item.previous, item.total)))
  const span = max - min || 1
  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom
  const step = chartWidth / values.length
  const barWidth = Math.max(16, Math.min(46, step * 0.48))
  const scaleY = (amount: number) => height - paddingBottom - ((amount - min) / span) * chartHeight
  const labelIndexes = values.length <= 6
    ? values.map((_, index) => index)
    : [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])]
  const significantLabelIndexes = new Set([
    ...labelIndexes,
    ...values
      .map((item, index) => ({ index, amount: Math.abs(item.change) }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, values.length > 30 ? 6 : 10)
      .map(item => item.index)
  ])

  const bars = values.map((item, index) => {
    const x = paddingLeft + index * step + (step - barWidth) / 2
    const previousY = scaleY(item.previous)
    const totalY = scaleY(item.total)
    return {
      x,
      y: Math.min(previousY, totalY),
      width: barWidth,
      height: Math.max(Math.abs(previousY - totalY), 2),
      date: item.date,
      change: item.change,
      total: item.total,
      direction: item.direction,
      connectorX1: x + barWidth,
      connectorY1: totalY,
      connectorX2: paddingLeft + (index + 1) * step + (step - barWidth) / 2,
      connectorY2: totalY,
      showValueLabel: values.length <= 18 || significantLabelIndexes.has(index)
    }
  })
  const yTickAmounts = Array.from({ length: 5 }, (_, index) => min + (span / 4) * index)

  return {
    bars,
    labels: labelIndexes.map(index => ({
      x: (bars[index]?.x ?? paddingLeft) + barWidth / 2,
      date: values[index]?.date || ''
    })),
    yTicks: yTickAmounts.map(amount => ({
      y: scaleY(amount),
      amount
    })),
    width,
    height,
    zeroY: scaleY(0),
    axisLeft: paddingLeft,
    axisRight: width - paddingRight,
    axisTop: paddingTop,
    axisBottom: height - paddingBottom,
    min,
    max
  }
}
</script>

<template>
  <div class="contents">
    <InvoiceEditPage
      v-if="isInvoiceEditPage"
      :code="invoiceEditCode"
    />
    <Teleport
      v-else-if="hasEndpoint"
      to="#finance-layout-header-actions"
    >
      <UButton
        v-if="canCreate"
        icon="i-lucide-plus"
        color="primary"
        @click="toggleCreateForm"
      >
        新建
      </UButton>
      <UButton
        v-if="config.recalculateEndpoint"
        icon="i-lucide-calculator"
        color="neutral"
        variant="soft"
        :loading="recalculating"
        @click="recalculate"
      >
        重算
      </UButton>
    </Teleport>

    <UDashboardPanel
      v-if="!isInvoiceEditPage"
      :id="slug || 'finance-page'"
      class="min-w-0 overflow-x-hidden"
      grow
    >
      <template
        v-if="hasEndpoint"
        #header
      >
        <UDashboardToolbar v-if="hasEndpoint">
          <template #left>
            <p class="truncate text-sm text-muted">
              {{ config.description }}
            </p>
          </template>

          <template #right>
            <div class="flex flex-wrap items-center justify-end gap-3">
              <UCheckbox
                v-if="isBankAccountsPage"
                v-model="showAllBankAccounts"
                label="显示全部账户"
              />
              <div
                v-if="isBalanceChangesPage"
                class="flex flex-wrap items-center justify-end gap-2"
              >
                <UButton
                  v-for="item in fundChangeRangeOptions"
                  :key="item.value"
                  size="sm"
                  :color="fundChangeRange === item.value ? 'primary' : 'neutral'"
                  :variant="fundChangeRange === item.value ? 'solid' : 'soft'"
                  @click="fundChangeRange = item.value"
                >
                  {{ item.label }}
                </UButton>
              </div>
              <UInput
                v-if="isProjectAccountingPage"
                v-model="peopleCostSyncPeriodMonth"
                type="month"
                icon="i-lucide-calendar"
                aria-label="核算期间"
                class="w-40 max-w-full"
              />
              <UCheckbox
                v-if="isProjectAccountingPage"
                v-model="showArchivedProjects"
                label="显示归档项目"
              />
              <UInput
                v-if="!isBalanceChangesPage"
                v-model="keyword"
                icon="i-lucide-search"
                placeholder="搜索编码、客户、合同、项目或说明"
                class="w-80 max-w-full"
              />
            </div>
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <div class="min-w-0 overflow-x-hidden p-2 space-y-2">
          <UAlert
            v-if="result?.warning"
            icon="i-lucide-database"
            color="warning"
            variant="subtle"
            :title="result.warning"
          />

          <!-- <UCard
            v-if="hasEndpoint"
            varient="soft"
            class="min-w-0 overflow-x-hidden"
            :ui="{}"
          > -->

          <div v-if="hasEndpoint">
            <div
              v-if="isBankAccountsPage"
              class="mb-4 grid gap-3 md:grid-cols-4"
            >
              <div class="rounded-lg border border-default p-3">
                <p class="text-xs text-muted">
                  账户数
                </p>
                <p class="mt-1 text-lg font-semibold text-highlighted">
                  {{ bankAccountSummary.account_count }}
                </p>
              </div>
              <div class="rounded-lg border border-default p-3">
                <p class="text-xs text-muted">
                  现金余额
                </p>
                <p class="mt-1 text-lg font-semibold text-highlighted">
                  {{ formatMoney(bankAccountSummary.cash_balance) }}
                </p>
              </div>
              <div class="rounded-lg border border-default p-3">
                <p class="text-xs text-muted">
                  贷款余额
                </p>
                <p class="mt-1 text-lg font-semibold text-highlighted">
                  {{ formatMoney(bankAccountSummary.loan_balance) }}
                </p>
              </div>
              <div class="rounded-lg border border-default p-3">
                <p class="text-xs text-muted">
                  存量资金
                </p>
                <p class="mt-1 text-lg font-semibold text-highlighted">
                  {{ formatMoney(bankAccountSummary.stock_fund_balance) }}
                </p>
              </div>
            </div>

            <div
              v-if="isBalanceChangesPage"
              class="mb-4 space-y-4"
            >
              <div class="grid gap-3 md:grid-cols-3">
                <div class="rounded-lg border border-default p-3">
                  <p class="text-xs text-muted">
                    期初余额
                  </p>
                  <p class="mt-1 text-lg font-semibold text-highlighted">
                    {{ formatPlainMoney(balanceChangeSummary.opening_balance) }}
                  </p>
                </div>
                <div class="rounded-lg border border-default p-3">
                  <p class="text-xs text-muted">
                    期末余额
                  </p>
                  <p class="mt-1 text-lg font-semibold text-highlighted">
                    {{ formatPlainMoney(balanceChangeSummary.closing_balance) }}
                  </p>
                </div>
                <div class="rounded-lg border border-default p-3">
                  <p class="text-xs text-muted">
                    净变动
                  </p>
                  <p class="mt-1 text-lg font-semibold text-highlighted">
                    {{ formatSignedMoney(balanceChangeSummary.net_change) }}
                  </p>
                </div>
              </div>

              <div
                ref="waterfallChartContainer"
                class="relative min-w-0 rounded-lg border border-default p-3"
              >
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p class="font-medium text-highlighted">
                      账户总余额阶梯图
                    </p>
                    <p class="text-sm text-muted">
                      {{ balanceChangeRows.length }} 个变动日期
                    </p>
                  </div>
                  <UButton
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="ghost"
                    :loading="status === 'pending'"
                    @click="refresh"
                  />
                </div>

                <div
                  v-if="waterfallChart.bars.length"
                  class="w-full"
                >
                  <svg
                    :viewBox="`0 0 ${waterfallChart.width} ${waterfallChart.height}`"
                    class="h-80 w-full"
                    role="img"
                    aria-label="账户总余额瀑布图"
                  >
                    <g
                      v-for="tick in waterfallChart.yTicks"
                      :key="tick.amount"
                    >
                      <line
                        :x1="waterfallChart.axisLeft"
                        :y1="tick.y"
                        :x2="waterfallChart.axisRight"
                        :y2="tick.y"
                        style="stroke: var(--ui-border);"
                        stroke-width="1"
                        stroke-dasharray="3 6"
                      />
                      <text
                        :x="waterfallChart.axisLeft - 10"
                        :y="tick.y + 4"
                        text-anchor="end"
                        class="text-[10px]"
                        style="fill: var(--ui-text-muted);"
                      >
                        {{ formatAxisMoney(tick.amount) }}
                      </text>
                    </g>
                    <line
                      :x1="waterfallChart.axisLeft"
                      :y1="waterfallChart.axisTop"
                      :x2="waterfallChart.axisLeft"
                      :y2="waterfallChart.axisBottom"
                      style="stroke: var(--ui-text-muted);"
                      stroke-width="1.5"
                    />
                    <line
                      :x1="waterfallChart.axisLeft"
                      :y1="waterfallChart.axisBottom"
                      :x2="waterfallChart.axisRight"
                      :y2="waterfallChart.axisBottom"
                      style="stroke: var(--ui-text-muted);"
                      stroke-width="1.5"
                    />
                    <line
                      :x1="waterfallChart.axisLeft"
                      :y1="waterfallChart.zeroY"
                      :x2="waterfallChart.axisRight"
                      :y2="waterfallChart.zeroY"
                      style="stroke: var(--ui-text-muted);"
                      stroke-width="1.25"
                    />
                    <g
                      v-for="(bar, index) in waterfallChart.bars"
                      :key="`${bar.date}-${index}`"
                    >
                      <line
                        v-if="index < waterfallChart.bars.length - 1"
                        :x1="bar.connectorX1"
                        :y1="bar.connectorY1"
                        :x2="bar.connectorX2"
                        :y2="bar.connectorY2"
                        style="stroke: var(--ui-text-muted);"
                        stroke-width="1"
                        stroke-dasharray="4 5"
                      />
                      <rect
                        :x="bar.x"
                        :y="bar.y"
                        :width="bar.width"
                        :height="bar.height"
                        rx="3"
                        class="cursor-pointer"
                        :class="{
                          'fill-success': bar.direction === 'increase',
                          'fill-error': bar.direction === 'decrease',
                          'fill-muted': bar.direction === 'flat'
                        }"
                        @mouseenter="showWaterfallTooltip(bar, $event)"
                        @mousemove="moveWaterfallTooltip"
                        @mouseleave="hideWaterfallTooltip"
                      />
                      <text
                        v-if="bar.showValueLabel"
                        :x="bar.x + bar.width / 2"
                        :y="bar.y - 7"
                        text-anchor="middle"
                        class="text-[10px]"
                        style="fill: var(--ui-text-muted);"
                      >
                        {{ formatSignedMoney(bar.change) }}
                      </text>
                    </g>
                    <g
                      v-for="label in waterfallChart.labels"
                      :key="label.date"
                    >
                      <line
                        :x1="label.x"
                        :y1="waterfallChart.axisTop"
                        :x2="label.x"
                        :y2="waterfallChart.axisBottom"
                        style="stroke: var(--ui-border);"
                        stroke-width="1"
                        stroke-dasharray="3 6"
                      />
                      <text
                        :x="label.x"
                        :y="waterfallChart.axisBottom + 20"
                        text-anchor="middle"
                        class="text-[11px]"
                        style="fill: var(--ui-text-muted);"
                      >
                        {{ label.date }}
                      </text>
                    </g>
                  </svg>
                  <div
                    v-if="waterfallTooltip.open"
                    class="pointer-events-none absolute z-10 rounded-md border border-default bg-default px-3 py-2 text-xs shadow-lg"
                    :style="{ left: `${waterfallTooltip.x}px`, top: `${waterfallTooltip.y}px` }"
                  >
                    <p class="font-medium text-highlighted">
                      {{ waterfallTooltip.date }}
                    </p>
                    <p class="mt-1 text-muted">
                      资金变动金额：{{ waterfallTooltip.change }}
                    </p>
                    <p class="mt-1 text-muted">
                      变动后余额：{{ waterfallTooltip.total }}
                    </p>
                  </div>
                </div>
                <UAlert
                  v-else
                  icon="i-lucide-chart-no-axes-combined"
                  color="neutral"
                  variant="subtle"
                  title="当前区间暂无余额变动"
                />
              </div>
            </div>

            <div
              v-if="createFormOpen && config.createFields"
              class="mb-4 rounded-lg border border-default bg-muted/20 p-4"
            >
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <UFormField
                  v-for="field in config.createFields"
                  :key="field.key"
                  :label="field.label"
                  :required="field.required"
                >
                  <USelect
                    v-if="field.type === 'select'"
                    v-model="createForm[field.key]"
                    :items="getCreateFieldOptions(field)"
                    value-key="value"
                    label-key="label"
                    :placeholder="field.placeholder || field.label"
                    :disabled="field.readonly"
                    class="w-full"
                  />
                  <div
                    v-else-if="field.type === 'file'"
                    class="space-y-1"
                  >
                    <UInput
                      type="file"
                      :accept="field.accept"
                      :disabled="field.readonly"
                      @change="onCreateFileChange(field, $event)"
                    />
                    <p
                      v-if="selectedCreateFileName(field)"
                      class="truncate text-xs text-muted"
                    >
                      {{ selectedCreateFileName(field) }}
                    </p>
                  </div>
                  <UInput
                    v-else
                    v-model="createForm[field.key]"
                    :type="field.type || 'text'"
                    :placeholder="field.placeholder || field.label"
                    :disabled="field.readonly || (isEditing && field.key === 'code')"
                  />
                </UFormField>
              </div>

              <UAlert
                v-if="createError"
                class="mt-3"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                :title="createError"
              />

              <div class="mt-4 flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="closeCreateForm"
                >
                  取消
                </UButton>
                <UButton
                  icon="i-lucide-save"
                  :loading="createPending"
                  @click="submitCreate"
                >
                  {{ isEditing ? '更新' : '保存' }}
                </UButton>
              </div>
            </div>

            <div
              class="min-w-0"
              :class="isProjectAccountingPage ? 'max-h-[calc(100vh-240px)] overflow-auto' : 'overflow-x-auto'"
            >
              <UTable
                :data="displayRows"
                :columns="config.columns"
                :loading="status === 'pending' || status === 'idle'"
                class="min-w-full"
              >
                <template #latest_balance_amount-cell="{ row }">
                  <div class="text-right font-medium text-highlighted">
                    {{ row.original.latest_balance_amount }}
                  </div>
                </template>

                <template #balance_amount-cell="{ row }">
                  <div class="text-right font-medium text-highlighted">
                    {{ row.original.balance_amount }}
                  </div>
                </template>

                <template #previous_total_balance-cell="{ row }">
                  <div class="text-right font-medium text-highlighted">
                    {{ row.original.previous_total_balance }}
                  </div>
                </template>

                <template #change_amount-cell="{ row }">
                  <div class="text-right font-medium text-highlighted">
                    {{ row.original.change_amount }}
                  </div>
                </template>

                <template #total_balance-cell="{ row }">
                  <div class="text-right font-medium text-highlighted">
                    {{ row.original.total_balance }}
                  </div>
                </template>

                <template #invoice_file_url-cell="{ row }">
                  <UButton
                    size="xs"
                    icon="i-lucide-file-text"
                    color="neutral"
                    variant="soft"
                    :loading="invoicePreviewLoadingUrl === invoiceFileUrl(row.original)"
                    :disabled="!invoiceFileUrl(row.original)"
                    @click="openInvoiceFile(row.original)"
                  >
                    {{ invoiceFileUrl(row.original) ? '查看' : '未上传' }}
                  </UButton>
                </template>

                <template #invoice_actions-cell="{ row }">
                  <div class="flex items-center gap-2">
                    <UButton
                      size="xs"
                      icon="i-lucide-pencil"
                      color="neutral"
                      variant="soft"
                      :disabled="!canEdit || !canEditInvoices"
                      @click="openInvoiceEditor(row.original)"
                    >
                      编辑
                    </UButton>
                    <UButton
                      size="xs"
                      icon="i-lucide-undo-2"
                      color="warning"
                      variant="soft"
                      :disabled="!canEditInvoices || isInvoiceActionDisabled(row.original)"
                      @click="openRedReverseInvoice(row.original)"
                    >
                      冲红
                    </UButton>
                    <UButton
                      v-if="canAdminInvoices"
                      size="xs"
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="soft"
                      @click="openDeleteInvoice(row.original)"
                    >
                      删除
                    </UButton>
                  </div>
                </template>

                <template #balance_actions-cell="{ row }">
                  <UButton
                    size="xs"
                    icon="i-lucide-chart-line"
                    color="neutral"
                    variant="soft"
                    @click="openBalanceDrawer(row.original)"
                  >
                    余额变动
                  </UButton>
                </template>

                <template #edit_actions-cell="{ row }">
                  <UButton
                    size="xs"
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="soft"
                    :disabled="!canEdit"
                    @click="startEdit(row.original)"
                  >
                    编辑
                  </UButton>
                </template>

                <template #project_labor_actions-cell="{ row }">
                  <div class="flex items-center gap-2">
                    <UBadge
                      v-if="row.original.has_labor_cost"
                      color="success"
                      variant="subtle"
                    >
                      已计算
                    </UBadge>
                    <UButton
                      size="xs"
                      icon="i-lucide-calculator"
                      color="primary"
                      variant="soft"
                      :loading="peopleCostSyncingProjectCode === row.original.project_code"
                      :disabled="Boolean(peopleCostSyncingProjectCode && peopleCostSyncingProjectCode !== row.original.project_code)"
                      @click="syncPeopleCosts(row.original)"
                    >
                      {{ row.original.has_labor_cost ? '重新计算' : '计算人力成本' }}
                    </UButton>
                  </div>
                </template>

                <template #actions-cell="{ row }">
                  <div class="flex items-center gap-2">
                    <UButton
                      v-if="canSubmitApproval(row.original)"
                      size="xs"
                      icon="i-lucide-send"
                      color="primary"
                      variant="soft"
                      :loading="submittingCode === row.original.code"
                      @click="submitApproval(row.original)"
                    >
                      提交
                    </UButton>
                    <UButton
                      v-if="canIssueInvoiceRequest(row.original)"
                      size="xs"
                      icon="i-lucide-receipt-text"
                      color="success"
                      variant="soft"
                      @click="openIssueInvoiceRequest(row.original)"
                    >
                      开具
                    </UButton>
                    <span
                      v-if="!canSubmitApproval(row.original) && !canIssueInvoiceRequest(row.original)"
                      class="text-xs text-muted"
                    >-</span>
                  </div>
                </template>
              </UTable>
              <UAlert
                v-if="status === 'success' && displayRows.length === 0 && isProjectAccountingPage"
                class="mt-3"
                icon="i-lucide-circle-info"
                color="neutral"
                variant="subtle"
                title="暂无可见 Aims 项目"
                description="项目清单来自 Aims。请确认当前用户在 Aims 中有项目访问权限，或先在 Aims 创建/关联项目。"
              />
              <UAlert
                v-else-if="status === 'success' && displayRows.length === 0 && isEmployeeCostsPage"
                class="mt-3"
                icon="i-lucide-circle-info"
                color="neutral"
                variant="subtle"
                title="暂无员工标准成本"
                description="请先在项目核算页选择 Aims 项目和期间，执行标准人力成本计算；缺少 Aims 工时、People 职级设置或 Finance 人力成本参数时不会生成成本。"
              />
              <UAlert
                v-if="result.warning"
                class="mt-3"
                icon="i-lucide-triangle-alert"
                color="warning"
                variant="subtle"
                title="部分数据暂不可用"
                :description="String(result.warning)"
              />
            </div>

            <!-- <template #footer> -->
            <div class="flex items-center justify-between gap-3 text-sm text-muted">
              <span>共 {{ result?.total || 0 }} 条</span>
              <UPagination
                v-if="!isProjectAccountingPage && !isBankAccountsPage && !isBalanceChangesPage"
                v-model:page="page"
                :total="result?.total || 0"
                :items-per-page="result?.pageSize || 20"
              />
            </div>
            <!-- </template> -->
          <!-- </UCard> -->
          </div>

          <UCard v-else>
            <p class="text-sm text-muted">
              {{ config.description }}
            </p>
          </UCard>
        </div>
      </template>
    </UDashboardPanel>

    <UModal
      v-model:open="issueInvoiceModalOpen"
      title="开具发票"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="font-semibold">
                  开具发票
                </div>
                <div class="text-xs text-muted mt-0.5">
                  {{ issueInvoiceRequest?.code }} · {{ issueInvoiceRequest?.customer_name || issueInvoiceRequest?.customerName || '-' }}
                </div>
              </div>
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                title="关闭"
                @click="issueInvoiceModalOpen = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UFormField
                label="发票号码"
                required
              >
                <UInput
                  v-model="issueInvoiceForm.invoiceNo"
                  placeholder="请输入发票号码"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="开票日期"
                required
              >
                <UInput
                  v-model="issueInvoiceForm.invoiceDate"
                  type="date"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="介质形式"
                required
              >
                <USelect
                  v-model="issueInvoiceForm.invoiceMedium"
                  :items="invoiceMediumOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="开票金额"
                required
              >
                <UInput
                  v-model="issueInvoiceForm.invoiceAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="发票文件"
                required
                class="md:col-span-2"
              >
                <UInput
                  type="file"
                  :accept="issueInvoiceForm.invoiceMedium === 'paper' ? '.pdf,application/pdf' : '.pdf,.ofd,application/pdf,application/ofd'"
                  class="w-full"
                  @change="onIssueInvoiceFileChange"
                />
                <div
                  v-if="issueInvoiceFile"
                  class="mt-1 text-xs text-muted"
                >
                  {{ issueInvoiceFile.name }}
                </div>
              </UFormField>
            </div>

            <UAlert
              v-if="issueInvoiceError"
              color="error"
              variant="soft"
              icon="i-lucide-circle-alert"
              :title="issueInvoiceError"
            />
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="issueInvoiceModalOpen = false"
              />
              <UButton
                label="确认开票"
                icon="i-lucide-check"
                color="success"
                :loading="issueInvoicePending"
                @click="submitIssueInvoiceRequest"
              />
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="invoicePreviewOpen"
      :title="invoicePreviewTitle"
      :ui="{ content: 'sm:max-w-6xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold truncate">{{ invoicePreviewTitle }}</span>
              <div class="flex items-center gap-1 shrink-0">
                <UButton
                  icon="i-lucide-external-link"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  title="新窗口打开"
                  @click="openInvoiceFileExternal"
                />
                <UButton
                  icon="i-lucide-x"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  title="关闭"
                  @click="invoicePreviewOpen = false"
                />
              </div>
            </div>
          </template>

          <img
            v-if="invoicePreviewKind === 'image'"
            :src="invoicePreviewUrl"
            :alt="invoicePreviewTitle"
            class="max-h-[75vh] w-full rounded border border-default bg-white object-contain"
          >
          <iframe
            v-else-if="invoicePreviewKind === 'pdf'"
            :src="invoicePreviewUrl"
            class="h-[75vh] w-full rounded border border-default bg-white"
            :title="invoicePreviewTitle"
          />
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-file-text"
            title="当前文件格式无法内嵌预览"
            description="请使用右上角按钮打开文件。"
          />
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="redReverseModalOpen"
      :title="selectedInvoiceActionTitle ? `冲红 ${selectedInvoiceActionTitle}` : '冲红发票'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">冲红发票</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="redReverseModalOpen = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="冲红后该发票不再计入开票金额统计"
            />
            <UFormField label="红字发票号码">
              <UInput
                v-model="redReverseInvoiceNo"
                placeholder="可选"
              />
            </UFormField>
            <UFormField
              label="冲红原因"
              required
            >
              <UTextarea
                v-model="redReverseReason"
                placeholder="请填写冲红原因"
                :rows="4"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="redReverseModalOpen = false"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-undo-2"
                color="warning"
                :loading="redReversePending"
                @click="submitRedReverseInvoice"
              >
                确认冲红
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteInvoiceModalOpen"
      :title="selectedInvoiceActionTitle ? `删除 ${selectedInvoiceActionTitle}` : '删除发票'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">删除发票</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="deleteInvoiceModalOpen = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UAlert
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="确认后将删除发票记录"
              description="属于默认对象存储 finance/invoices/ 目录的发票文件会同步删除；历史外部链接只删除台账记录。"
            />
            <UFormField label="删除原因">
              <UTextarea
                v-model="deleteInvoiceReason"
                placeholder="可选，建议填写业务原因"
                :rows="4"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="deleteInvoiceModalOpen = false"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                :loading="deleteInvoicePending"
                @click="submitDeleteInvoice"
              >
                确认删除
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <USlideover
      v-model:open="balanceDrawerOpen"
      side="right"
      :title="String(selectedBankAccount?.account_name || '余额变动')"
      :description="String(selectedBankAccount?.code || '')"
      :ui="{ content: 'sm:max-w-4xl', body: 'space-y-4' }"
    >
      <template #body>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-for="item in balanceRangeOptions"
            :key="item.value"
            size="sm"
            :color="balanceRange === item.value ? 'primary' : 'neutral'"
            :variant="balanceRange === item.value ? 'solid' : 'soft'"
            @click="setBalanceRange(item.value)"
          >
            {{ item.label }}
          </UButton>
        </div>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">
              最新余额
            </p>
            <p class="mt-1 text-lg font-semibold text-highlighted">
              {{ balanceChart.latest ? formatMoney(balanceChart.latest.amount) : '-' }}
            </p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">
              最高余额
            </p>
            <p class="mt-1 text-lg font-semibold text-highlighted">
              {{ balanceChartData.length ? formatMoney(balanceChart.max) : '-' }}
            </p>
          </div>
          <div class="rounded-lg border border-default p-3">
            <p class="text-xs text-muted">
              最低余额
            </p>
            <p class="mt-1 text-lg font-semibold text-highlighted">
              {{ balanceChartData.length ? formatMoney(balanceChart.min) : '-' }}
            </p>
          </div>
        </div>

        <div class="rounded-lg border border-default p-3">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <p class="font-medium text-highlighted">
                余额趋势
              </p>
              <p class="text-sm text-muted">
                {{ balanceChartData.length }} 个余额快照
              </p>
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="balanceStatus === 'pending'"
              @click="refreshBalanceSnapshots"
            />
          </div>

          <div
            v-if="balanceChart.points"
            class="overflow-x-auto"
          >
            <svg
              viewBox="0 0 640 220"
              class="h-64 min-w-[640px] w-full"
              role="img"
              aria-label="账户余额趋势折线图"
            >
              <line
                x1="28"
                y1="196"
                x2="612"
                y2="196"
                class="stroke-muted"
                stroke-width="1"
              />
              <polygon
                :points="balanceChart.areaPoints"
                class="fill-primary/10"
              />
              <polyline
                :points="balanceChart.points"
                fill="none"
                class="stroke-primary"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <g
                v-for="label in balanceChart.labels"
                :key="`${label.date}-${label.x}`"
              >
                <line
                  :x1="label.x"
                  y1="24"
                  :x2="label.x"
                  y2="196"
                  class="stroke-muted"
                  stroke-width="1"
                  stroke-dasharray="4 6"
                />
                <text
                  :x="label.x"
                  y="214"
                  text-anchor="middle"
                  class="fill-muted text-[11px]"
                >
                  {{ label.date }}
                </text>
              </g>
            </svg>
          </div>
          <UAlert
            v-else
            icon="i-lucide-chart-line"
            color="neutral"
            variant="subtle"
            title="当前区间暂无余额快照"
          />
        </div>

        <div class="rounded-lg border border-default">
          <UTable
            :data="balanceRows"
            :columns="balanceSnapshotColumns"
            :loading="balanceStatus === 'pending'"
          >
            <template #balance_amount-cell="{ row }">
              <span class="font-medium text-highlighted">
                {{ row.original.balance_amount }}
              </span>
            </template>
          </UTable>
        </div>
      </template>
    </USlideover>
  </div>
</template>
