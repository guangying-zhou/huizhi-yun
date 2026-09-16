<script setup lang="ts">
import InvoiceEditPage from './invoices/[code]/edit.vue'
import BankAccountBalanceSlideover from '~/components/bank-accounts/BankAccountBalanceSlideover.vue'
import BalanceChangesOverview from '~/components/bank-accounts/BalanceChangesOverview.vue'
import FinanceEntityFormSlideover from '~/components/FinanceEntityFormSlideover.vue'
import InvoiceFilePreview from '~/components/invoices/InvoiceFilePreview.vue'
import InvoiceLifecycleDialogs from '~/components/invoices/InvoiceLifecycleDialogs.vue'
import InvoiceRequestDialogs from '~/components/invoices/InvoiceRequestDialogs.vue'
import { pageConfigs, type CreateField } from '~/config/pageConfigs'
import type { BalanceChangeRow, BalanceChangeSummary } from '~/utils/bankAccountCharts'
import { formatPlainMoney, formatSignedMoney } from '~/utils/bankAccountCharts'
import { isInvoiceReceiptReconcileDisabled as invoiceReconcileDisabled } from '~/utils/invoiceActions'
import { invoiceFileUrl } from '~/utils/invoiceFiles'

definePageMeta({ hidePageNavbar: true })

const route = useRoute()

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

type InstanceConflictAction = 'approve' | 'confirm'
type InstanceConflictTargetType
  = | 'expense_claim'
    | 'project_expense_request'
    | 'payment_request'
    | 'finance_expense'

interface InstanceConflictPageTarget {
  targetType: InstanceConflictTargetType
  action: InstanceConflictAction
  label: string
}

interface InstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor?: boolean
}

interface InstanceConflictRule {
  ruleCode?: string
  ruleName?: string
  enforcement?: string
  status?: string
  reasonCode?: string
  message?: string
  sameActorPrincipals?: InstanceConflictPrincipal[]
}

interface InstanceConflictExplanation {
  tenantCode?: string
  uid?: string
  requested?: {
    appCode?: string
    resourceCode?: string
    action?: string
  }
  principals?: InstanceConflictPrincipal[]
  hasViolation?: boolean
  hasBlockingViolation?: boolean
  hasWarningViolation?: boolean
  rules?: InstanceConflictRule[]
}

interface FinanceInstanceConflictExplainData {
  targetType: InstanceConflictTargetType
  code: string
  action: InstanceConflictAction
  principals: InstanceConflictPrincipal[]
  explanation: InstanceConflictExplanation
}

interface BankAccountSummary {
  account_count: number
  cash_balance: string
  loan_balance: string
  stock_fund_balance: string
}

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
  unreconciled: '未核销',
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

const fundChangeRangeOptions: Array<{ label: string, value: FundChangeRange }> = [
  { label: '当年', value: 'current_year' },
  { label: '当月', value: 'current_month' },
  { label: '最近1个月', value: 'last_1_month' },
  { label: '最近3个月', value: 'last_3_months' },
  { label: '最近半年', value: 'last_6_months' }
]

const instanceConflictTargetsBySlug: Record<string, InstanceConflictPageTarget> = {
  'expenses': { targetType: 'finance_expense', action: 'confirm', label: '付款确认' },
  'expenses/projects': { targetType: 'finance_expense', action: 'confirm', label: '付款确认' },
  'expenses/claims': { targetType: 'expense_claim', action: 'approve', label: '报销审批' },
  'expenses/project-requests': { targetType: 'project_expense_request', action: 'approve', label: '项目支出审批' },
  'payments/requests': { targetType: 'payment_request', action: 'approve', label: '付款审批' }
}

const config = computed(() => pageConfigs[slug.value] || pageConfigs[slug.value.split('/')[0] || ''] || {
  title: '财务功能',
  description: '该功能已纳入 Finance 模块实现计划。',
  phase: '规划中',
  columns: []
})

function routeKeyword() {
  const value = route.query.keyword
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim()
}

const keyword = ref(routeKeyword())
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
const balanceDrawerOpen = ref(false)
const selectedBankAccount = ref<Record<string, unknown> | null>(null)
const fundChangeRange = ref<FundChangeRange>('current_year')
const invoiceFilePreview = ref<InstanceType<typeof InvoiceFilePreview> | null>(null)
const invoiceLifecycleDialogs = ref<InstanceType<typeof InvoiceLifecycleDialogs> | null>(null)
const invoiceRequestDialogs = ref<InstanceType<typeof InvoiceRequestDialogs> | null>(null)
const instanceConflictOpen = ref(false)
const instanceConflictPendingCode = ref('')
const instanceConflictResult = ref<FinanceInstanceConflictExplainData | null>(null)
const selectedInstanceConflictTarget = ref<InstanceConflictPageTarget | null>(null)
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
        page: isBalanceChangesPage.value ? undefined : page.value,
        pageSize: isBalanceChangesPage.value ? undefined : 20,
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
  reconciliation_status: formatStatus(row.reconciliation_status),
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
const title = computed(() => config.value.title)
const hasEndpoint = computed(() => Boolean(config.value.endpoint))
const canCreate = computed(() => Boolean(config.value.createEndpoint && config.value.createFields?.length))
const canEdit = computed(() => Boolean(config.value.updateEndpoint && config.value.createFields?.length))
const isEditing = computed(() => Boolean(editingCode.value))
const canEditInvoices = computed(() => permissionsLoaded.value && hasPermission('invoices', 'edit'))
const canIssueInvoices = computed(() => permissionsLoaded.value && hasPermission('invoices', 'issue'))
const canAdminInvoices = computed(() => permissionsLoaded.value && hasPermission('invoices', 'admin'))
const canReceiptReconcileInvoices = computed(() => permissionsLoaded.value && hasPermission('receipts', 'confirm') && hasPermission('reconciliation', 'confirm'))
const isReportsPage = computed(() => slug.value === 'reports')
const canExportReports = computed(() => isReportsPage.value && permissionsLoaded.value && hasPermission('reports', 'export'))
const {
  syncingProjectCode: peopleCostSyncingProjectCode,
  syncPeopleCosts
} = useProjectAccountingOperations({
  periodMonth: peopleCostSyncPeriodMonth,
  refresh
})
const {
  exporting: reportsExporting,
  download: downloadReportsExport
} = useFinanceReportExport(canExportReports)
const instanceConflictRules = computed(() => instanceConflictResult.value?.explanation?.rules || [])
const instanceConflictPrincipals = computed(() => (
  instanceConflictResult.value?.explanation?.principals?.length
    ? instanceConflictResult.value.explanation.principals
    : instanceConflictResult.value?.principals || []
))
const instanceConflictModalTitle = computed(() => {
  const code = instanceConflictResult.value?.code || ''
  const label = selectedInstanceConflictTarget.value?.label || '职责冲突解释'
  return code ? `${label} · ${code}` : label
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
usePageTitle(title)

onMounted(() => {
  loadCurrentUser()
  loadPermissions()
})

watch(() => slug.value, () => {
  page.value = 1
  keyword.value = routeKeyword()
  showAllBankAccounts.value = false
  showArchivedProjects.value = false
  fundChangeRange.value = 'current_year'
  createFormOpen.value = false
  createForm.value = {}
  createError.value = ''
  editingCode.value = ''
  peopleCostSyncPeriodMonth.value = currentPeriodMonth()
})

watch(() => route.query.keyword, () => {
  keyword.value = routeKeyword()
})

watch([endpoint, page], () => {
  refresh()
}, { immediate: true })

watchDebounced(keyword, () => {
  page.value = 1
  refresh()
}, { debounce: 300 })

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
  const accounts: Record<string, unknown>[] = []
  for (let optionPage = 1; optionPage <= 100; optionPage++) {
    const response = await $fetch<unknown>(financeApiPath('/bank-accounts'), {
      query: { page: optionPage, pageSize: 100, showAll: '1' }
    })
    const list = normalizeFinanceListResponse<Record<string, unknown>>(response)
    accounts.push(...(list.data || []))
    if (!list.data.length || accounts.length >= list.total) break
  }
  bankAccountOptions.value = accounts.map(account => ({
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

function currentInstanceConflictTarget() {
  return instanceConflictTargetsBySlug[slug.value] || null
}

function instanceConflictCode(row: Record<string, unknown>) {
  const source = sourceRow(row)
  return String(source.code || row.code || '').trim()
}

function canExplainInstanceConflict(row: Record<string, unknown>) {
  return Boolean(currentInstanceConflictTarget() && instanceConflictCode(row))
}

async function openInstanceConflictExplanation(row: Record<string, unknown>) {
  const target = currentInstanceConflictTarget()
  const code = instanceConflictCode(row)
  if (!target || !code) {
    toast.add({
      title: '无法解释',
      description: '当前记录缺少可解释的业务类型或编码。',
      color: 'warning'
    })
    return
  }

  instanceConflictPendingCode.value = code
  selectedInstanceConflictTarget.value = target
  try {
    const response = await $fetch<RuntimeEnvelope<FinanceInstanceConflictExplainData>>(
      financeApiPath('/authorization/instance-conflict-explain'),
      {
        method: 'POST',
        body: {
          targetType: target.targetType,
          code,
          action: target.action,
          includeBaseline: true
        }
      }
    )
    if (!response.data?.explanation) {
      throw new Error('职责冲突解释结果为空。')
    }
    instanceConflictResult.value = response.data
    instanceConflictOpen.value = true
  } catch (error) {
    toast.add({
      title: '职责冲突解释失败',
      description: errorText(error, '请稍后重试。'),
      color: 'error'
    })
  } finally {
    if (instanceConflictPendingCode.value === code) {
      instanceConflictPendingCode.value = ''
    }
  }
}

function instanceConflictRiskColor(explanation: InstanceConflictExplanation | null | undefined) {
  if (explanation?.hasBlockingViolation) return 'error'
  if (explanation?.hasWarningViolation || explanation?.hasViolation) return 'warning'
  return 'success'
}

function instanceConflictRiskTitle(explanation: InstanceConflictExplanation | null | undefined) {
  if (explanation?.hasBlockingViolation) return '存在阻断级职责冲突'
  if (explanation?.hasWarningViolation || explanation?.hasViolation) return '存在预警级职责冲突'
  return '未发现实例级职责冲突'
}

function instanceConflictActionLabel(action: unknown) {
  const value = String(action || '').trim()
  if (value === 'approve') return '审批'
  if (value === 'confirm') return '确认'
  return value || '-'
}

function instanceConflictRuleColor(rule: InstanceConflictRule) {
  if (rule.status === 'violated' && rule.enforcement === 'enforce') return 'error'
  if (rule.status === 'violated') return 'warning'
  if (rule.status === 'satisfied') return 'success'
  return 'neutral'
}

function instanceConflictRuleStatusLabel(value: unknown) {
  const status = String(value || '').trim()
  if (status === 'violated') return '已触发'
  if (status === 'satisfied') return '未触发'
  if (status === 'not_applicable') return '不适用'
  return status || '-'
}

function instanceConflictRuleTitle(rule: InstanceConflictRule) {
  return String(rule.ruleName || rule.ruleCode || '职责冲突规则')
}

function instanceConflictRuleDescription(rule: InstanceConflictRule) {
  return String(rule.message || rule.reasonCode || rule.status || '')
}

function instanceConflictPrincipalKindLabel(value: unknown) {
  const kind = String(value || '').trim()
  const labels: Record<string, string> = {
    applicant: '申请人',
    requester: '发起人',
    maker: '制单人',
    handler: '经办人'
  }
  return labels[kind] || kind || '-'
}

function isInvoiceRequestsPage() {
  return slug.value === 'invoices/requests'
}

function canIssueInvoiceRequest(row: Record<string, unknown>) {
  if (!isInvoiceRequestsPage()) return false
  const source = sourceRow(row)
  if (source.issued_invoice_id || source.issuedInvoiceId) return false
  return sourceStatus(row) === 'approved'
}

function openIssuanceAssignment(row: Record<string, unknown>) {
  invoiceRequestDialogs.value?.openAssignment(sourceRow(row))
}

function openIssueInvoiceRequest(row: Record<string, unknown>) {
  invoiceRequestDialogs.value?.openIssue(sourceRow(row))
}
function openBalanceDrawer(row: Record<string, unknown>) {
  selectedBankAccount.value = row
  balanceDrawerOpen.value = true
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

function hasProjectLaborCost(row: Record<string, unknown>) {
  return String(row.cost_readiness_status || row.costReadinessStatus || '') === 'ready'
}

function canSubmitApproval(row: Record<string, unknown>) {
  return Boolean(config.value.submitEndpointBase && ['draft', 'rejected'].includes(sourceStatus(row)))
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

function errorText(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { message?: string, statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return String(candidate?.data?.message || candidate?.data?.statusMessage || candidate?.statusMessage || candidate?.message || fallback)
}

function openInvoiceFile(row: Record<string, unknown>) {
  invoiceFilePreview.value?.show(row)
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

function isInvoiceReceiptReconcileDisabled(row: Record<string, unknown>) {
  return invoiceReconcileDisabled(invoiceActionRow(row))
}

function openReceiptReconcileInvoice(row: Record<string, unknown>) {
  if (!canReceiptReconcileInvoices.value) {
    toast.add({ title: '权限不足', description: '需要收款确认和核销确认权限。', color: 'warning' })
    return
  }
  invoiceLifecycleDialogs.value?.openReceipt(invoiceActionRow(row))
}

function openRedReverseInvoice(row: Record<string, unknown>) {
  invoiceLifecycleDialogs.value?.openRedReverse(invoiceActionRow(row))
}

function openDeleteInvoice(row: Record<string, unknown>) {
  invoiceLifecycleDialogs.value?.openDelete(invoiceActionRow(row))
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
</script>

<template>
  <div class="contents">
    <InvoiceEditPage
      v-if="isInvoiceEditPage"
      :code="invoiceEditCode"
    />
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
              <div
                v-if="canCreate || config.recalculateEndpoint || canExportReports"
                class="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto"
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
                <UButton
                  v-if="canExportReports"
                  icon="i-lucide-download"
                  color="neutral"
                  variant="soft"
                  :loading="reportsExporting"
                  @click="downloadReportsExport"
                >
                  导出
                </UButton>
              </div>
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

            <BalanceChangesOverview
              v-if="isBalanceChangesPage"
              :rows="balanceChangeRows"
              :summary="balanceChangeSummary"
              :loading="status === 'pending'"
              @refresh="refresh"
            />

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
                    :loading="invoiceFilePreview?.isLoading(row.original) || false"
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
                      icon="i-lucide-circle-dollar-sign"
                      color="success"
                      variant="soft"
                      :disabled="!canReceiptReconcileInvoices || isInvoiceReceiptReconcileDisabled(row.original)"
                      @click="openReceiptReconcileInvoice(row.original)"
                    >
                      核销
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

                <template #conflict_actions-cell="{ row }">
                  <UButton
                    v-if="canExplainInstanceConflict(row.original)"
                    size="xs"
                    icon="i-lucide-shield-alert"
                    color="warning"
                    variant="soft"
                    :loading="instanceConflictPendingCode === instanceConflictCode(row.original)"
                    @click="openInstanceConflictExplanation(row.original)"
                  >
                    冲突
                  </UButton>
                  <span
                    v-else
                    class="text-xs text-muted"
                  >-</span>
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
                      v-if="canIssueInvoices && canIssueInvoiceRequest(row.original)"
                      size="xs"
                      icon="i-lucide-user-round-cog"
                      color="neutral"
                      variant="soft"
                      @click="openIssuanceAssignment(row.original)"
                    >
                      责任
                    </UButton>
                    <UButton
                      v-if="canIssueInvoices && canIssueInvoiceRequest(row.original)"
                      size="xs"
                      icon="i-lucide-receipt-text"
                      color="success"
                      variant="soft"
                      @click="openIssueInvoiceRequest(row.original)"
                    >
                      开具
                    </UButton>
                    <UButton
                      v-if="canExplainInstanceConflict(row.original)"
                      size="xs"
                      icon="i-lucide-shield-alert"
                      color="warning"
                      variant="soft"
                      :loading="instanceConflictPendingCode === instanceConflictCode(row.original)"
                      @click="openInstanceConflictExplanation(row.original)"
                    >
                      冲突
                    </UButton>
                    <span
                      v-if="!canSubmitApproval(row.original) && !(canIssueInvoices && canIssueInvoiceRequest(row.original)) && !canExplainInstanceConflict(row.original)"
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
                v-if="!isBalanceChangesPage"
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

    <FinanceEntityFormSlideover
      v-model:open="createFormOpen"
      v-model:form="createForm"
      :title="config.title"
      :description="config.description"
      :fields="config.createFields || []"
      :pending="createPending"
      :error="createError"
      :editing="isEditing"
      :get-field-options="getCreateFieldOptions"
      :get-selected-file-name="selectedCreateFileName"
      @cancel="closeCreateForm"
      @submit="submitCreate"
      @file-change="onCreateFileChange"
    />

    <InvoiceRequestDialogs
      ref="invoiceRequestDialogs"
      :validate-file="validateInvoiceFile"
      :upload-file="uploadInvoiceFile"
      @updated="refresh"
    />

    <UModal
      v-model:open="instanceConflictOpen"
      :title="instanceConflictModalTitle"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="font-semibold">
                  职责冲突解释
                </div>
                <div class="text-xs text-muted mt-0.5">
                  {{ instanceConflictResult?.code || '-' }} · {{ selectedInstanceConflictTarget?.label || '-' }}
                </div>
              </div>
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                title="关闭"
                @click="instanceConflictOpen = false"
              />
            </div>
          </template>

          <div
            v-if="instanceConflictResult"
            class="space-y-4"
          >
            <UAlert
              :icon="instanceConflictResult.explanation.hasViolation ? 'i-lucide-shield-alert' : 'i-lucide-shield-check'"
              :color="instanceConflictRiskColor(instanceConflictResult.explanation)"
              variant="subtle"
              :title="instanceConflictRiskTitle(instanceConflictResult.explanation)"
              :description="`当前动作：${instanceConflictActionLabel(instanceConflictResult.action)}，请求权限：${instanceConflictResult.explanation.requested?.appCode || 'finance'}:${instanceConflictResult.explanation.requested?.resourceCode || 'expenses'}:${instanceConflictResult.explanation.requested?.action || instanceConflictResult.action}`"
            />

            <div class="grid gap-3 md:grid-cols-3">
              <div class="rounded-lg border border-default p-3">
                <p class="text-xs text-muted">
                  当前用户
                </p>
                <p class="mt-1 truncate font-medium text-highlighted">
                  {{ instanceConflictResult.explanation.uid || '-' }}
                </p>
              </div>
              <div class="rounded-lg border border-default p-3">
                <p class="text-xs text-muted">
                  对象类型
                </p>
                <p class="mt-1 truncate font-medium text-highlighted">
                  {{ selectedInstanceConflictTarget?.label || instanceConflictResult.targetType }}
                </p>
              </div>
              <div class="rounded-lg border border-default p-3">
                <p class="text-xs text-muted">
                  规则数
                </p>
                <p class="mt-1 font-medium text-highlighted">
                  {{ instanceConflictRules.length }}
                </p>
              </div>
            </div>

            <div class="rounded-lg border border-default p-3">
              <div class="mb-2 flex items-center justify-between gap-3">
                <p class="font-medium text-highlighted">
                  实例主体
                </p>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ instanceConflictPrincipals.length }} 个
                </UBadge>
              </div>
              <div
                v-if="instanceConflictPrincipals.length"
                class="flex flex-wrap gap-2"
              >
                <UBadge
                  v-for="principal in instanceConflictPrincipals"
                  :key="`${principal.kind}-${principal.uid}`"
                  :color="principal.matchesActor ? 'warning' : 'neutral'"
                  variant="soft"
                >
                  {{ instanceConflictPrincipalKindLabel(principal.kind) }}: {{ principal.uid }}
                </UBadge>
              </div>
              <p
                v-else
                class="text-sm text-muted"
              >
                当前对象未返回申请人、发起人或经办人主体。
              </p>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between gap-3">
                <p class="font-medium text-highlighted">
                  规则解释
                </p>
                <UBadge
                  :color="instanceConflictRiskColor(instanceConflictResult.explanation)"
                  variant="soft"
                >
                  {{ instanceConflictRiskTitle(instanceConflictResult.explanation) }}
                </UBadge>
              </div>
              <div
                v-if="instanceConflictRules.length"
                class="space-y-2"
              >
                <div
                  v-for="rule in instanceConflictRules"
                  :key="rule.ruleCode || rule.ruleName"
                  class="rounded-lg border border-default p-3"
                >
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate font-medium text-highlighted">
                        {{ instanceConflictRuleTitle(rule) }}
                      </p>
                      <p class="mt-1 text-sm text-muted">
                        {{ instanceConflictRuleDescription(rule) }}
                      </p>
                    </div>
                    <UBadge
                      :color="instanceConflictRuleColor(rule)"
                      variant="soft"
                    >
                      {{ instanceConflictRuleStatusLabel(rule.status) }}
                    </UBadge>
                  </div>
                  <div
                    v-if="rule.sameActorPrincipals?.length"
                    class="mt-2 flex flex-wrap gap-2"
                  >
                    <UBadge
                      v-for="principal in rule.sameActorPrincipals"
                      :key="`${rule.ruleCode || rule.ruleName}-${principal.kind}-${principal.uid}`"
                      color="warning"
                      variant="subtle"
                    >
                      同人：{{ instanceConflictPrincipalKindLabel(principal.kind) }} {{ principal.uid }}
                    </UBadge>
                  </div>
                </div>
              </div>
              <UAlert
                v-else
                icon="i-lucide-circle-info"
                color="neutral"
                variant="subtle"
                title="当前动作没有适用的职责冲突规则"
              />
            </div>
          </div>

          <template #footer>
            <div class="flex justify-end">
              <UButton
                color="neutral"
                variant="ghost"
                @click="instanceConflictOpen = false"
              >
                关闭
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <InvoiceFilePreview ref="invoiceFilePreview" />

    <InvoiceLifecycleDialogs
      ref="invoiceLifecycleDialogs"
      :current-user-id="currentUserId"
      @updated="refresh"
    />

    <BankAccountBalanceSlideover
      v-model:open="balanceDrawerOpen"
      :account="selectedBankAccount"
    />
  </div>
</template>
