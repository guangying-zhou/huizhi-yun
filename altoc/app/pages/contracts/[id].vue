<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { resolveCurrentAppPath } = useAppUrls()
const id = computed(() => route.params.id)
const idNum = computed(() => Number(id.value) || 0)
const { isApprovalMode } = useApprovalMode()
const platformPermission = usePlatformPermission()
const SYSTEM_ADMIN_ROLES = ['super_admin', 'superadmin', 'platform:super_admin', 'altoc:admin']

onMounted(() => {
  void platformPermission.loadAuthorization()
})

const hasSystemAdminAccess = computed(() => {
  return platformPermission.hasPermission('admin', 'admin')
    || SYSTEM_ADMIN_ROLES.some(role => platformPermission.hasRole(role))
})

interface ApiResponse<T> {
  data: T
}

interface ContractReceivablePlan {
  id?: number
  code?: string
  plan_name?: string
  plan_type?: string
  status?: string
  amount?: number | string | null
  received_amount?: number | string | null
  unreceived_amount?: number | string | null
  planned_payment_date?: string | null
}

interface ContractPaymentRecord {
  received_amount?: number | string | null
}

interface ContractPaymentTerm {
  term_type?: string | null
  billing_mode?: string | null
  amount?: number | string | null
  ratio?: number | string | null
}

interface ContractLine {
  id?: number | string
  line_no?: number | string | null
  line_type?: string | null
  name?: string | null
  description?: string | null
  quantity?: number | string | null
  unit?: string | null
  unit_price?: number | string | null
  amount_tax_exclusive?: number | string | null
  amount_tax_inclusive?: number | string | null
  tax_rate?: number | string | null
  billing_method?: string | null
  fulfillment_method?: string | null
  product_origin?: string | null
  source_quotation_item_id?: number | string | null
}

interface ContractObligation {
  id?: number | string
  code?: string | null
  contract_line_id?: number | string | null
  obligation_type?: string | null
  name?: string | null
  description?: string | null
  planned_due_at?: string | null
  actual_completed_at?: string | null
  submitted_at?: string | null
  accepted_at?: string | null
  acceptance_required?: number | string | boolean | null
  acceptance_criteria?: string | null
  status?: string | null
  owner_user_id?: string | null
  evidence_document_uuid?: string | null
  evidence_note?: string | null
  reject_reason?: string | null
  source_type?: string | null
  source_ref_code?: string | null
}

interface ContractBillingSchedule {
  id?: number | string
  code?: string | null
  name?: string | null
  direction?: string | null
  trigger_type?: string | null
  trigger_ref_code?: string | null
  obligation_code?: string | null
  obligation_name?: string | null
  obligation_status?: string | null
  amount?: number | string | null
  ratio?: number | string | null
  currency_code?: string | null
  expected_date?: string | null
  invoice_required?: number | string | boolean | null
  status?: string | null
  finance_plan_code?: string | null
  source_type?: string | null
  source_ref_code?: string | null
}

interface ContractProjectLink {
  id?: number | string
  project_code?: string | null
  project_name_snapshot?: string | null
  project_role?: string | null
  link_mode?: string | null
  status?: string | null
  created_at?: string | null
}

interface AimsEligibleProject {
  id?: number | string
  project_code?: string | null
  name?: string | null
  short_name?: string | null
  internal_code?: string | null
  lifecycle_status?: string | null
  dept_code?: string | null
  leader_uid?: string | null
  contract_code?: string | null
  eligible_reason?: string | null
}

interface ContractDeliveryAssetPlan {
  id?: number | string
  code?: string | null
  name?: string | null
  product_code?: string | null
  external_asset_code?: string | null
  status?: string | null
  planned_delivery_at?: string | null
}

interface ServiceAgreementCoverage {
  id?: number | string
  coverage_code?: string | null
  target_type?: string | null
  source_plan_code?: string | null
  delivery_asset_code?: string | null
  environment_code?: string | null
  legacy_reference?: string | null
  resolution_status?: string | null
  coverage_status?: string | null
  effective_from?: string | null
  effective_to?: string | null
  included?: boolean | number | string | null
  exclusion_note?: string | null
}

interface ServiceAgreement {
  id?: number | string
  code?: string | null
  name?: string | null
  service_level?: string | null
  service_start_date?: string | null
  service_end_date?: string | null
  status?: string | null
  assets?: Array<Record<string, unknown>>
  coverages?: ServiceAgreementCoverage[]
  coverage_source?: string | null
}

interface ContractActivationStep {
  id?: number | string
  step_key?: string | null
  name?: string | null
  step_name?: string | null
  target_app?: string | null
  target_action?: string | null
  status?: string | null
  required?: boolean | number | string | null
  sort_no?: number | string | null
  last_error?: string | null
  retry_count?: number | string | null
  max_retries?: number | string | null
  depends_on_step_keys?: string[] | null
}

interface ContractActivationJob {
  id?: number | string
  code?: string | null
  status?: string | null
  requested_by?: string | null
  started_at?: string | null
  finished_at?: string | null
  cancel_reason?: string | null
  last_error?: string | null
  steps?: ContractActivationStep[]
}

interface ContractActivationPlan {
  warnings?: Array<{ code?: string, message?: string }>
  suggestions?: Record<string, unknown>
  steps?: ContractActivationStep[]
  latestJob?: ContractActivationJob | null
}

interface ContractRelationSummary {
  id?: number | string
  code?: string | null
  name?: string | null
  status?: string | null
  legal_status?: string | null
  agreement_form?: string | null
  amount_tax_inclusive?: number | string | null
  effective_date?: string | null
  end_date?: string | null
}

interface ContractBusinessTemplate {
  code: string
  name: string
  direction: string
  primary_type: string
}

interface ContractOption {
  id: number | string
  code?: string | null
  name?: string | null
  agreement_form?: string | null
  customer_name?: string | null
  is_master_contract?: number | string | boolean | null
}

interface ContractStage {
  id: number | string
  stage_type?: string | null
  stage_name?: string | null
  status?: string | null
  stage_date?: string | null
  handled_at?: string | null
  attachment_count?: number | string | null
  document_count?: number | string | null
  evidence_note?: string | null
  document_uuid?: string | null
  document_title?: string | null
  handled_by?: string | null
}

interface ContractDetail {
  id: number
  code: string
  name?: string
  status?: string
  legal_status?: string | null
  fulfillment_status?: string | null
  financial_status?: string | null
  activation_status?: string | null
  raw_status?: string | null
  amount_tax_inclusive?: number | string | null
  customer_id?: number | null
  customer_name?: string | null
  opportunity_id?: number | null
  opportunity_name?: string | null
  tender_id?: number | null
  tender_name?: string | null
  contact_name?: string | null
  sign_date?: string | null
  effective_date?: string | null
  end_date?: string | null
  direction?: string | null
  primary_type?: string | null
  agreement_form?: string | null
  template_code?: string | null
  source_type?: string | null
  source_code?: string | null
  parent_contract_id?: number | string | null
  parent_contract_code?: string | null
  parent_contract_name?: string | null
  parent_contract?: ContractRelationSummary | null
  is_master_contract?: number | string | boolean | null
  child_contracts?: ContractRelationSummary[]
  child_contract_count?: number | string | null
  invoice_type?: string | null
  retention_rate?: number | string | null
  owner_user_id?: string | null
  created_at?: string | null
  payment_term_summary?: string | null
  lines?: ContractLine[]
  line_summary?: {
    line_count?: number | string | null
    amount_tax_inclusive?: number | string | null
    amount_tax_exclusive?: number | string | null
    planned_cost?: number | string | null
    amount_difference?: number | string | null
    amount_matches_contract?: boolean
  }
  obligations?: ContractObligation[]
  obligation_summary?: {
    total_count?: number | string | null
    done_count?: number | string | null
    open_count?: number | string | null
    accepted_count?: number | string | null
    completed_count?: number | string | null
    rejected_count?: number | string | null
    blocked_count?: number | string | null
  }
  billing_schedules?: ContractBillingSchedule[]
  billing_schedule_summary?: {
    schedule_count?: number | string | null
    amount?: number | string | null
    planned_amount?: number | string | null
    billable_amount?: number | string | null
    amount_difference?: number | string | null
    amount_matches_contract?: boolean
  }
  project_links?: ContractProjectLink[]
  delivery_asset_plans?: ContractDeliveryAssetPlan[]
  service_agreements?: ServiceAgreement[]
  activation_jobs?: ContractActivationJob[]
  latest_activation_job?: ContractActivationJob | null
  payment_terms?: ContractPaymentTerm[]
  payment_records?: ContractPaymentRecord[]
  receivable_plans?: ContractReceivablePlan[]
  stats?: {
    plan_count?: number | string | null
    plan_total?: number | string | null
    received_total?: number | string | null
  }
  [key: string]: unknown
}

interface FinanceContractSummary {
  invoiceAmount?: number | string | null
  receivedAmount?: number | string | null
  reconciledAmount?: number | string | null
  unreconciledAmount?: number | string | null
  invoiceCount?: number
}

interface CustomerInvoiceInfo {
  id?: number
  taxpayer_name?: string | null
  taxpayer_no?: string | null
  registered_address?: string | null
  registered_phone?: string | null
  bank_name?: string | null
  bank_account?: string | null
  invoice_type?: string | null
  invoice_email?: string | null
  receiver_name?: string | null
  receiver_phone?: string | null
  receiver_address?: string | null
  remark?: string | null
}

interface InvoiceRequestResponse {
  data?: {
    invoiceRequest?: { code?: string }
    financeSubmitError?: unknown
  }
}

interface InvoiceFileViewResponse {
  data?: {
    url?: string
  }
}

function responseItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)) {
    return (payload as { items: T[] }).items
  }
  return []
}

function responseRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

function errorMessage(error: unknown, fallback: string) {
  const source = error && typeof error === 'object' ? error as { data?: { message?: string, statusMessage?: string } } : {}
  return source.data?.message || source.data?.statusMessage || fallback
}

const CONTRACT_STATUS: Record<string, { label: string, color: string }> = {
  draft: { label: '草稿', color: 'neutral' },
  pending_approval: { label: '审批中', color: 'warning' },
  approved: { label: '待生效', color: 'primary' },
  effective: { label: '履约中', color: 'success' },
  completed: { label: '已完成', color: 'success' },
  terminated: { label: '已终止', color: 'error' },
  invalid: { label: '无效', color: 'neutral' }
}

const LEGAL_STATUS: Record<string, { label: string, color: string }> = {
  draft: { label: '草稿', color: 'neutral' },
  under_review: { label: '评审中', color: 'warning' },
  pending_approval: { label: '审批中', color: 'warning' },
  approved: { label: '已审批', color: 'primary' },
  signing: { label: '签署中', color: 'primary' },
  effective: { label: '已生效', color: 'success' },
  suspended: { label: '已暂停', color: 'warning' },
  terminated: { label: '已终止', color: 'error' },
  expired: { label: '已到期', color: 'neutral' },
  closed: { label: '已关闭', color: 'success' },
  invalid: { label: '无效', color: 'neutral' }
}

const FULFILLMENT_STATUS: Record<string, { label: string, color: string }> = {
  not_started: { label: '未开始', color: 'neutral' },
  in_progress: { label: '履约中', color: 'primary' },
  partially_fulfilled: { label: '部分完成', color: 'info' },
  fulfilled: { label: '已完成', color: 'success' },
  blocked: { label: '受阻', color: 'warning' },
  cancelled: { label: '已取消', color: 'neutral' }
}

const FINANCIAL_STATUS: Record<string, { label: string, color: string }> = {
  unplanned: { label: '未计划', color: 'neutral' },
  planned: { label: '已计划', color: 'primary' },
  partially_invoiced: { label: '部分开票', color: 'info' },
  invoiced: { label: '已开票', color: 'success' },
  partially_received: { label: '部分回款', color: 'info' },
  received: { label: '已回款', color: 'success' },
  partially_paid: { label: '部分付款', color: 'info' },
  paid: { label: '已付款', color: 'success' },
  overdue: { label: '逾期', color: 'error' },
  written_off: { label: '已核销', color: 'neutral' }
}

const ACTIVATION_STATUS: Record<string, { label: string, color: string }> = {
  not_planned: { label: '未计划', color: 'neutral' },
  planned: { label: '已计划', color: 'primary' },
  planning: { label: '计划中', color: 'primary' },
  ready: { label: '就绪', color: 'success' },
  running: { label: '执行中', color: 'primary' },
  partially_failed: { label: '部分失败', color: 'warning' },
  completed: { label: '已完成', color: 'success' },
  cancelled: { label: '已取消', color: 'neutral' }
}

const ACTIVATION_STEP_STATUS: Record<string, { label: string, color: string }> = {
  planned: { label: '待执行', color: 'neutral' },
  running: { label: '执行中', color: 'primary' },
  succeeded: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
  skipped: { label: '已跳过', color: 'neutral' },
  cancelled: { label: '已取消', color: 'neutral' },
  needs_manual_action: { label: '待处理', color: 'warning' }
}

const DELIVERY_ASSET_STATUS: Record<string, { label: string, color: string }> = {
  planned: { label: '计划中', color: 'neutral' },
  provisioning: { label: '开通中', color: 'primary' },
  delivered: { label: '已交付', color: 'success' },
  online: { label: '已上线', color: 'success' },
  accepted: { label: '已验收', color: 'success' },
  suspended: { label: '已暂停', color: 'warning' },
  expired: { label: '已到期', color: 'neutral' },
  terminated: { label: '已终止', color: 'error' }
}

const SERVICE_AGREEMENT_STATUS: Record<string, { label: string, color: string }> = {
  planned: { label: '计划中', color: 'neutral' },
  active: { label: '生效中', color: 'success' },
  suspended: { label: '已暂停', color: 'warning' },
  expired: { label: '已到期', color: 'neutral' },
  terminated: { label: '已终止', color: 'error' },
  cancelled: { label: '已取消', color: 'neutral' }
}

const COVERAGE_TARGET_TYPE: Record<string, { label: string, color: string }> = {
  delivery_asset: { label: '交付资产', color: 'primary' },
  environment: { label: '环境', color: 'info' },
  delivery_asset_environment: { label: '资产+环境', color: 'success' },
  pending_plan: { label: '计划待解析', color: 'warning' },
  legacy: { label: '旧引用', color: 'warning' },
  legacy_asset: { label: '旧覆盖', color: 'warning' }
}

const COVERAGE_RESOLUTION_STATUS: Record<string, { label: string, color: string }> = {
  resolved: { label: 'resolved', color: 'success' },
  pending: { label: 'pending', color: 'warning' },
  needs_review: { label: 'needs_review', color: 'error' }
}

const COVERAGE_STATUS: Record<string, { label: string, color: string }> = {
  planned: { label: '计划中', color: 'neutral' },
  active: { label: '生效中', color: 'success' },
  suspended: { label: '已暂停', color: 'warning' },
  ended: { label: '已结束', color: 'neutral' },
  cancelled: { label: '已取消', color: 'neutral' }
}

const OBLIGATION_STATUS: Record<string, { label: string, color: string }> = {
  not_started: { label: '未开始', color: 'neutral' },
  in_progress: { label: '进行中', color: 'primary' },
  submitted: { label: '待验收', color: 'warning' },
  accepted: { label: '已验收', color: 'success' },
  rejected: { label: '已驳回', color: 'error' },
  completed: { label: '已完成', color: 'success' },
  waived: { label: '已豁免', color: 'neutral' },
  blocked: { label: '受阻', color: 'warning' },
  cancelled: { label: '已取消', color: 'neutral' }
}

const BILLING_STATUS: Record<string, { label: string, color: string }> = {
  planned: { label: '计划中', color: 'neutral' },
  billable: { label: '可结算', color: 'warning' },
  invoicing: { label: '开票中', color: 'primary' },
  invoiced: { label: '已开票', color: 'success' },
  received: { label: '已回款', color: 'success' },
  paid: { label: '已付款', color: 'success' },
  cancelled: { label: '已取消', color: 'neutral' }
}

const LEGACY_CONTRACT_STATUS: Record<string, string> = {
  rejected: 'draft',
  executing: 'effective',
  delivering: 'effective',
  accepted: 'effective',
  service_ended: 'effective',
  expired: 'effective'
}

const RP_STATUS: Record<string, { label: string, color: string }> = {
  pending: { label: '待开始', color: 'neutral' },
  to_invoice: { label: '待开票', color: 'warning' },
  to_receive: { label: '待回款', color: 'primary' },
  partially_received: { label: '部分回款', color: 'info' },
  received: { label: '已回款', color: 'success' },
  overdue: { label: '已逾期', color: 'error' },
  bad_debt: { label: '坏账', color: 'error' }
}

const directionLabels: Record<string, string> = {
  sales: '销售合同',
  purchase: '采购合同'
}

const agreementFormLabels: Record<string, string> = {
  single: '标准合同',
  standard_contract: '标准合同',
  framework: '框架协议',
  master: '框架协议',
  quantity_framework: '框架协议',
  value_framework: '框架协议',
  supplement: '补充协议',
  change_order: '补充协议',
  renewal: '续签合同',
  tripartite: '三方协议'
}

const contractDirectionOptions = Object.entries(directionLabels).map(([value, label]) => ({ label, value }))
const agreementFormOptions = [
  { label: '标准合同', value: 'standard_contract' },
  { label: '框架协议', value: 'framework' },
  { label: '补充协议', value: 'supplement' },
  { label: '三方协议', value: 'tripartite' },
  { label: '续签合同', value: 'renewal' }
]

interface ContractBasicEditForm {
  name: string
  direction: string
  agreement_form: string
  parent_contract_id: number | null
  is_master_contract: boolean
  template_code: string
  primary_type: string
  amount_tax_inclusive: number | string | undefined
  invoice_type: string
  sign_date: string
  effective_date: string
  end_date: string
  retention_rate: number | string | undefined
  owner_user_id: string
}

const contractBasicEditOpen = ref(false)
const contractBasicEditSubmitting = ref(false)
const contractBasicEditHydrating = ref(false)
const contractBasicEditForm = reactive<ContractBasicEditForm>({
  name: '',
  direction: 'sales',
  agreement_form: 'standard_contract',
  parent_contract_id: null,
  is_master_contract: true,
  template_code: '',
  primary_type: '',
  amount_tax_inclusive: undefined,
  invoice_type: 'special_vat',
  sign_date: '',
  effective_date: '',
  end_date: '',
  retention_rate: undefined,
  owner_user_id: ''
})

const { data: contractTemplates } = useFetch('/api/v1/config/contract-business-templates', {
  server: false,
  transform: (res: ApiResponse<unknown>) => responseItems<ContractBusinessTemplate>(res.data),
  default: () => [] as ContractBusinessTemplate[]
})
const contractTemplateOptions = computed(() => (contractTemplates.value || [])
  .filter(tpl => !contractBasicEditForm.direction || tpl.direction === contractBasicEditForm.direction)
  .map(tpl => ({ label: tpl.name, value: tpl.code })))

const parentContractKeyword = ref('')
const parentContractCustomerId = ref<number | undefined>(undefined)
const { data: parentContractResult } = useFetch('/api/v1/contracts', {
  server: false,
  query: computed(() => ({
    keyword: parentContractKeyword.value,
    pageSize: 20,
    master_only: 1,
    exclude_id: idNum.value || undefined,
    customer_id: parentContractCustomerId.value,
    direction: contractBasicEditForm.direction || undefined
  })),
  transform: (res: ApiResponse<unknown>) => responseItems<ContractOption>(res.data),
  default: () => [] as ContractOption[]
})
const parentContractOptions = computed(() => (parentContractResult.value || [])
  .filter(item => Number(item.id) !== idNum.value)
  .map(item => ({
    label: `${item.code || item.id} · ${item.name || '未命名合同'}`,
    value: Number(item.id),
    description: [item.customer_name, agreementFormLabels[String(item.agreement_form || '')]].filter(Boolean).join(' · ')
  })))

watch(() => contractBasicEditForm.template_code, (code) => {
  if (contractBasicEditHydrating.value) return
  const template = (contractTemplates.value || []).find(item => item.code === code)
  if (!template) return
  contractBasicEditForm.direction = template.direction || contractBasicEditForm.direction
  contractBasicEditForm.primary_type = template.primary_type || contractBasicEditForm.primary_type
})

watch(() => contractBasicEditForm.parent_contract_id, (parentContractId) => {
  if (parentContractId) {
    contractBasicEditForm.is_master_contract = false
  }
})

const lineTypeLabels: Record<string, string> = {
  own_software_license: '软件许可',
  own_saas_subscription: 'SaaS订阅',
  third_party_software: '第三方软件',
  hardware: '硬件',
  cloud_resource: '云资源',
  custom_development: '定制开发',
  implementation: '实施服务',
  system_integration: '系统集成',
  maintenance_support: '运维支持',
  managed_service: '托管服务',
  consulting_training: '咨询培训',
  other_fee: '其他费用',
  legacy_summary: '历史汇总'
}

const { data: contract, status, error: contractError, refresh } = useFetch(() => `/api/v1/contracts/${id.value}`, {
  server: false,
  transform: (res: ApiResponse<ContractDetail>) => res.data
})

const { data: invoiceData, status: invoiceStatus, refresh: refreshInvoices } = useFetch(() => `/api/v1/contracts/${id.value}/invoices`, {
  server: false,
  transform: (res: ApiResponse<unknown>) => {
    const data = responseRecord(res.data)
    return {
      items: responseItems<Record<string, unknown>>(res.data),
      total: Number(data.total || 0),
      warning: String(data.warning || ''),
      summary: data.summary && typeof data.summary === 'object' ? data.summary as FinanceContractSummary : null
    }
  },
  default: () => ({ items: [], total: 0, warning: '', summary: null })
})

const { data: stageData, status: stageStatus, refresh: refreshStages } = useFetch(() => `/api/v1/contracts/${id.value}/stages`, {
  server: false,
  transform: (res: ApiResponse<ContractStage[] | { items?: ContractStage[] }>) => responseItems<ContractStage>(res.data),
  default: () => [] as ContractStage[]
})

const { data: activationPlan, status: activationPlanStatus, refresh: refreshActivationPlan } = useFetch(() => `/api/v1/contracts/${id.value}/activation-plan`, {
  server: false,
  transform: (res: ApiResponse<ContractActivationPlan>) => res.data,
  default: () => ({ warnings: [], steps: [], latestJob: null }) as ContractActivationPlan
})

const contractInvoices = computed<Record<string, unknown>[]>(() => invoiceData.value?.items || [])
const invoiceSummary = computed(() => invoiceData.value?.summary || null)
const contractAmount = computed(() => Number(contract.value?.amount_tax_inclusive || 0))
const receivablePlanCount = computed(() => {
  if (contract.value?.stats?.plan_count != null) {
    return Number(contract.value.stats.plan_count || 0)
  }
  return Array.isArray(contract.value?.receivable_plans) ? contract.value.receivable_plans.length : 0
})
const planReceivableTotal = computed(() => Number(contract.value?.stats?.plan_total || 0))
const invoiceTotal = computed(() => {
  const summaryTotal = Number(invoiceSummary.value?.invoiceAmount || 0)
  if (summaryTotal > 0) return summaryTotal
  return contractInvoices.value.reduce((sum, item) => sum + Number(item.invoice_amount || 0), 0)
})
const invoiceBalance = computed(() => {
  return (contractAmount.value - invoiceTotal.value).toFixed(2)
})
const receivedTotal = computed(() => {
  return Number(contract.value?.stats?.received_total || 0)
})
const receivableBaseTotal = computed(() => {
  return receivablePlanCount.value > 0 ? planReceivableTotal.value : invoiceTotal.value
})
const uncollectedReceivableAmount = computed(() => Math.max(receivableBaseTotal.value - receivedTotal.value, 0))
const unreceivedContractAmount = computed(() => Math.max(contractAmount.value - receivedTotal.value, 0))
const terminationBadDebtAmount = computed(() => Math.max(uncollectedReceivableAmount.value, unreceivedContractAmount.value, 0))
const childContractCount = computed(() => Number(contract.value?.child_contract_count || contract.value?.child_contracts?.length || 0))

const activeTab = ref('info')
const contractInfoAccordionItems = [
  { label: '基本信息', value: 'basic', icon: 'i-lucide-info', slot: 'basic' as const },
  { label: '合同标的', value: 'lines', icon: 'i-lucide-package', slot: 'lines' as const },
  { label: '付款条款', value: 'terms', icon: 'i-lucide-list', slot: 'terms' as const },
  { label: '合同文本与扫描件', value: 'documents', icon: 'i-lucide-file-text', slot: 'documents' as const }
]
const contractInfoAccordionDefault = ['basic']
const isPurchaseContract = computed(() => String(contract.value?.direction || '') === 'purchase')
const settlementTabLabel = computed(() => isPurchaseContract.value ? '结算与付款' : '结算与回款')
const receivableNodeLabel = computed(() => isPurchaseContract.value ? '付款节点' : '回款节点')
const paymentRecordLabel = computed(() => isPurchaseContract.value ? '付款记录' : '到账记录')
const baseTabs = computed(() => [
  { label: '合同信息', value: 'info', icon: 'i-lucide-info' },
  { label: '合同执行', value: 'fulfillment', icon: 'i-lucide-route' },
  { label: settlementTabLabel.value, value: 'settlement', icon: 'i-lucide-wallet' }
])
const auditTab = { label: '操作', value: 'audit', icon: 'i-lucide-history' }
const managementTab = { label: '管理', value: 'management', icon: 'i-lucide-shield-alert' }
const tabs = computed(() => {
  return [...baseTabs.value, managementTab, auditTab]
})

const legacyTabRedirects: Record<string, string> = {
  lines: 'info',
  terms: 'info',
  documents: 'info',
  billing: 'settlement',
  receivables: 'settlement',
  invoices: 'settlement',
  activation: 'fulfillment',
  obligations: 'fulfillment',
  stages: 'fulfillment'
}

watch(activeTab, (value) => {
  const redirected = legacyTabRedirects[value]
  if (redirected) {
    activeTab.value = redirected
  }
})

function formatMoney(val: number | string | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(Number(val) || 0)
}

const contractErrorMessage = computed(() => errorMessage(contractError.value, '合同详情加载失败，请稍后重试'))

function normalizeContractStatus(status: string | null | undefined) {
  const value = String(status || '')
  return LEGACY_CONTRACT_STATUS[value] || value
}

function contractStatusMeta(status: string | null | undefined) {
  const normalized = normalizeContractStatus(status)
  return CONTRACT_STATUS[normalized] || { label: status || '-', color: 'neutral' }
}

function statusMeta(map: Record<string, { label: string, color: string }>, status: string | null | undefined) {
  const value = String(status || '')
  return map[value] || { label: value || '-', color: 'neutral' }
}

function serviceAgreementCoverages(agreement: ServiceAgreement) {
  if (Array.isArray(agreement.coverages)) return agreement.coverages
  if (Array.isArray(agreement.assets)) return agreement.assets as ServiceAgreementCoverage[]
  return []
}

function coveragePrimaryRef(coverage: ServiceAgreementCoverage) {
  const targetType = String(coverage.target_type || '')
  if (targetType === 'delivery_asset_environment') {
    return [coverage.delivery_asset_code, coverage.environment_code].filter(Boolean).join(' / ') || '-'
  }
  if (targetType === 'delivery_asset') return coverage.delivery_asset_code || '-'
  if (targetType === 'environment') return coverage.environment_code || '-'
  if (targetType === 'pending_plan') return coverage.source_plan_code || '-'
  if (targetType === 'legacy' || targetType === 'legacy_asset') return coverage.legacy_reference || coverage.delivery_asset_code || '-'
  return coverage.delivery_asset_code || coverage.environment_code || coverage.source_plan_code || coverage.legacy_reference || '-'
}

function coverageReviewNote(coverage: ServiceAgreementCoverage) {
  if (coverage.resolution_status === 'needs_review') {
    return coverage.legacy_reference ? `旧引用待处理：${coverage.legacy_reference}` : '该覆盖需要人工处理'
  }
  if (coverage.resolution_status === 'pending') {
    return coverage.source_plan_code ? `等待正式标识回写：${coverage.source_plan_code}` : '等待正式覆盖对象解析'
  }
  return ''
}

function invoiceTypeLabel(value: string | null | undefined) {
  return invoiceTypeLabels[String(value || '')] || value || '-'
}

function dateInputValue(value: string | null | undefined) {
  return String(value || '').slice(0, 10)
}

function nullableText(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function nullableNumber(value: number | string | null | undefined) {
  if (value === '' || value == null) return null
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function truthyFlag(value: unknown) {
  if (value === true) return true
  if (typeof value === 'number') return value !== 0
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase())
}

function openContractBasicEditModal() {
  if (!contract.value) return
  const current = contract.value
  contractBasicEditHydrating.value = true
  contractBasicEditForm.name = current.name || ''
  contractBasicEditForm.direction = current.direction || 'sales'
  contractBasicEditForm.agreement_form = current.agreement_form || 'standard_contract'
  contractBasicEditForm.parent_contract_id = current.parent_contract_id ? Number(current.parent_contract_id) : null
  contractBasicEditForm.is_master_contract = truthyFlag(current.is_master_contract)
  if (contractBasicEditForm.parent_contract_id) {
    contractBasicEditForm.is_master_contract = false
  }
  contractBasicEditForm.template_code = current.template_code || ''
  contractBasicEditForm.primary_type = current.primary_type || ''
  contractBasicEditForm.amount_tax_inclusive = current.amount_tax_inclusive == null ? undefined : Number(current.amount_tax_inclusive)
  contractBasicEditForm.invoice_type = current.invoice_type || 'special_vat'
  contractBasicEditForm.sign_date = dateInputValue(current.sign_date)
  contractBasicEditForm.effective_date = dateInputValue(current.effective_date)
  contractBasicEditForm.end_date = dateInputValue(current.end_date)
  contractBasicEditForm.retention_rate = current.retention_rate == null ? undefined : Number(current.retention_rate)
  contractBasicEditForm.owner_user_id = current.owner_user_id || ''
  parentContractCustomerId.value = current.customer_id ? Number(current.customer_id) : undefined
  parentContractKeyword.value = current.parent_contract_code || current.parent_contract_name || ''
  contractBasicEditOpen.value = true
  void nextTick(() => {
    contractBasicEditHydrating.value = false
  })
}

async function submitContractBasicEdit() {
  if (!contract.value) return
  const name = contractBasicEditForm.name.trim()
  if (!name) {
    toast.add({ title: '请输入合同名称', color: 'warning' })
    return
  }
  if (contractBasicEditForm.parent_contract_id && Number(contractBasicEditForm.parent_contract_id) === idNum.value) {
    toast.add({ title: '主合同不能选择当前合同', color: 'warning' })
    return
  }
  if (contractBasicEditForm.parent_contract_id && contractBasicEditForm.is_master_contract) {
    toast.add({ title: '已选择主合同时不能标记为主合同', color: 'warning' })
    return
  }
  if (!contractBasicEditForm.is_master_contract && childContractCount.value > 0) {
    toast.add({ title: '已有附属合同，不能取消主合同标识', color: 'warning' })
    return
  }

  const relationBody = {
    parent_contract_id: contractBasicEditForm.parent_contract_id || null,
    is_master_contract: contractBasicEditForm.is_master_contract ? 1 : 0
  }
  const requestBody = {
    name,
    direction: contractBasicEditForm.direction,
    agreement_form: contractBasicEditForm.agreement_form,
    ...relationBody,
    template_code: nullableText(contractBasicEditForm.template_code),
    primary_type: nullableText(contractBasicEditForm.primary_type),
    amount_tax_inclusive: nullableNumber(contractBasicEditForm.amount_tax_inclusive),
    invoice_type: contractBasicEditForm.invoice_type,
    sign_date: contractBasicEditForm.sign_date || null,
    effective_date: contractBasicEditForm.effective_date || null,
    end_date: contractBasicEditForm.end_date || null,
    retention_rate: nullableNumber(contractBasicEditForm.retention_rate),
    owner_user_id: nullableText(contractBasicEditForm.owner_user_id)
  }

  contractBasicEditSubmitting.value = true
  try {
    await $fetch(`/api/v1/contracts/${id.value}/draft`, {
      method: 'PUT',
      body: requestBody
    })
    toast.add({ title: '基本信息已更新', color: 'success' })
    contractBasicEditOpen.value = false
    await refresh()
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '基本信息保存失败'), color: 'error' })
  } finally {
    contractBasicEditSubmitting.value = false
  }
}

function billingTriggerLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    contract_effective: '合同生效',
    fixed_date: '固定日期',
    obligation_completed: '义务完成',
    obligation_accepted: '义务验收',
    manual_approval: '人工确认',
    service_period: '服务周期'
  }
  return labels[String(value || '')] || value || '-'
}

function sourceTypeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    contract_line: '合同行生成',
    legacy_contract_stage: '旧履约环节迁移',
    legacy_payment_term: '旧付款条款迁移',
    manual: '人工维护'
  }
  return labels[String(value || '')] || value || '-'
}

function stageLabel(stage: ContractStage) {
  return STAGE_LABELS[String(stage.stage_type || '')] || stage.stage_name || '-'
}

function stageStatusMeta(status: string | null | undefined) {
  return STAGE_STATUS_LABELS[String(status || '')]
}

const invoiceRequestLoadingCode = ref('')
const contractInvoiceRequestOpen = ref(false)
const contractInvoiceRequestSubmitting = ref(false)
const contractInvoiceInfoLoading = ref(false)
const contractInvoiceInfoSaving = ref(false)
const contractInvoiceInfo = ref<CustomerInvoiceInfo | null>(null)
const contractInvoiceRequestForm = reactive({
  invoiceType: 'general_vat',
  invoiceMedium: 'electronic',
  requestedAmount: '',
  invoiceItem: '',
  remark: ''
})
const contractInvoiceInfoForm = reactive({
  taxpayer_name: '',
  taxpayer_no: '',
  registered_address: '',
  registered_phone: '',
  bank_name: '',
  bank_account: '',
  invoice_type: 'special_vat',
  invoice_email: '',
  receiver_name: '',
  receiver_phone: '',
  receiver_address: '',
  remark: ''
})

function canRequestInvoiceForPlan(plan: ContractReceivablePlan) {
  return !!plan?.code && ['to_invoice', 'to_receive', 'partially_received'].includes(String(plan.status || ''))
}

const canRequestInvoiceForContract = computed(() => Number(invoiceBalance.value || 0) > 0)

function resetContractInvoiceInfoForm(info: CustomerInvoiceInfo | null | undefined) {
  contractInvoiceInfoForm.taxpayer_name = info?.taxpayer_name || contract.value?.customer_name || ''
  contractInvoiceInfoForm.taxpayer_no = info?.taxpayer_no || ''
  contractInvoiceInfoForm.registered_address = info?.registered_address || ''
  contractInvoiceInfoForm.registered_phone = info?.registered_phone || ''
  contractInvoiceInfoForm.bank_name = info?.bank_name || ''
  contractInvoiceInfoForm.bank_account = info?.bank_account || ''
  contractInvoiceInfoForm.invoice_type = info?.invoice_type || 'special_vat'
  contractInvoiceInfoForm.invoice_email = info?.invoice_email || ''
  contractInvoiceInfoForm.receiver_name = info?.receiver_name || ''
  contractInvoiceInfoForm.receiver_phone = info?.receiver_phone || ''
  contractInvoiceInfoForm.receiver_address = info?.receiver_address || ''
  contractInvoiceInfoForm.remark = info?.remark || ''
}

function contractInvoiceInfoPayload() {
  return {
    taxpayerName: contractInvoiceInfoForm.taxpayer_name.trim(),
    taxpayerNo: contractInvoiceInfoForm.taxpayer_no.trim(),
    registeredAddress: contractInvoiceInfoForm.registered_address.trim(),
    registeredPhone: contractInvoiceInfoForm.registered_phone.trim(),
    bankName: contractInvoiceInfoForm.bank_name.trim(),
    bankAccount: contractInvoiceInfoForm.bank_account.trim(),
    invoiceType: contractInvoiceInfoForm.invoice_type,
    invoiceEmail: contractInvoiceInfoForm.invoice_email.trim(),
    receiverName: contractInvoiceInfoForm.receiver_name.trim(),
    receiverPhone: contractInvoiceInfoForm.receiver_phone.trim(),
    receiverAddress: contractInvoiceInfoForm.receiver_address.trim(),
    remark: contractInvoiceInfoForm.remark.trim()
  }
}

function contractBillingInfo() {
  return {
    taxpayer_name: contractInvoiceInfoForm.taxpayer_name.trim(),
    taxpayer_no: contractInvoiceInfoForm.taxpayer_no.trim(),
    registered_address: contractInvoiceInfoForm.registered_address.trim(),
    registered_phone: contractInvoiceInfoForm.registered_phone.trim(),
    bank_name: contractInvoiceInfoForm.bank_name.trim(),
    bank_account: contractInvoiceInfoForm.bank_account.trim(),
    invoice_type: contractInvoiceInfoForm.invoice_type,
    invoice_email: contractInvoiceInfoForm.invoice_email.trim(),
    receiver_name: contractInvoiceInfoForm.receiver_name.trim(),
    receiver_phone: contractInvoiceInfoForm.receiver_phone.trim(),
    receiver_address: contractInvoiceInfoForm.receiver_address.trim(),
    remark: contractInvoiceInfoForm.remark.trim()
  }
}

async function loadContractInvoiceInfo() {
  const customerId = contract.value?.customer_id
  if (!customerId) {
    contractInvoiceInfo.value = null
    resetContractInvoiceInfoForm(null)
    return
  }
  contractInvoiceInfoLoading.value = true
  try {
    const response = await $fetch<ApiResponse<unknown>>(`/api/v1/customers/${customerId}/invoice-infos`, {
      query: { pageSize: 1 }
    })
    const info = responseItems<CustomerInvoiceInfo>(response.data)[0] || null
    contractInvoiceInfo.value = info
    resetContractInvoiceInfoForm(info)
  } catch (error: unknown) {
    contractInvoiceInfo.value = null
    resetContractInvoiceInfoForm(null)
    toast.add({ title: errorMessage(error, '客户开票信息加载失败'), color: 'warning' })
  } finally {
    contractInvoiceInfoLoading.value = false
  }
}

async function saveContractInvoiceInfo() {
  const customerId = contract.value?.customer_id
  if (!customerId) {
    throw new Error('当前合同未关联客户')
  }
  if (!contractInvoiceInfoForm.taxpayer_name.trim()) {
    throw new Error('请输入发票抬头')
  }
  if (!contractInvoiceInfoForm.taxpayer_no.trim()) {
    throw new Error('请输入纳税人识别号')
  }
  contractInvoiceInfoSaving.value = true
  try {
    const response = await $fetch<ApiResponse<{ invoiceInfo?: CustomerInvoiceInfo }>>(`/api/v1/customers/${customerId}/invoice-info:save`, {
      method: 'POST',
      body: contractInvoiceInfoPayload()
    })
    contractInvoiceInfo.value = response.data?.invoiceInfo || null
    resetContractInvoiceInfoForm(contractInvoiceInfo.value)
    return contractInvoiceInfo.value
  } finally {
    contractInvoiceInfoSaving.value = false
  }
}

async function saveContractInvoiceInfoFromModal() {
  try {
    await saveContractInvoiceInfo()
    toast.add({ title: '开票信息已保存', color: 'success' })
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '保存开票信息失败'), color: 'error' })
  }
}

async function openContractInvoiceRequest() {
  if (!canRequestInvoiceForContract.value) return
  contractInvoiceRequestForm.invoiceType = contract.value?.invoice_type || 'general_vat'
  contractInvoiceRequestForm.invoiceMedium = 'electronic'
  contractInvoiceRequestForm.requestedAmount = String(invoiceBalance.value || '')
  contractInvoiceRequestForm.invoiceItem = contract.value?.name || '合同开票'
  contractInvoiceRequestForm.remark = ''
  contractInvoiceRequestOpen.value = true
  await loadContractInvoiceInfo()
}

async function submitContractInvoiceRequest() {
  if (!contract.value) return
  const amount = Number(contractInvoiceRequestForm.requestedAmount || 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    toast.add({ title: '请输入有效开票金额', color: 'warning' })
    return
  }
  if (amount > Number(invoiceBalance.value || 0) + 0.01) {
    toast.add({ title: '开票金额不能超过发票余额', color: 'warning' })
    return
  }
  contractInvoiceRequestSubmitting.value = true
  try {
    await saveContractInvoiceInfo()
    const requestKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}`
    const response = await $fetch<InvoiceRequestResponse>(`/api/v1/contracts/${id.value}/invoice-request`, {
      method: 'POST',
      headers: {
        'idempotency-key': `altoc:contract:${contract.value.code}:invoice-request:${requestKey}`
      },
      body: {
        requestedAmount: contractInvoiceRequestForm.requestedAmount,
        invoiceType: contractInvoiceRequestForm.invoiceType,
        invoiceMedium: contractInvoiceRequestForm.invoiceMedium,
        invoiceItem: contractInvoiceRequestForm.invoiceItem,
        remark: contractInvoiceRequestForm.remark,
        taxpayerName: contractInvoiceInfoForm.taxpayer_name,
        taxpayerNo: contractInvoiceInfoForm.taxpayer_no,
        billingInfo: contractBillingInfo()
      }
    })
    const invoiceRequestCode = response?.data?.invoiceRequest?.code
    toast.add({
      title: invoiceRequestCode ? `开票申请 ${invoiceRequestCode} 已提交` : '开票申请已提交',
      color: 'success'
    })
    contractInvoiceRequestOpen.value = false
    await Promise.all([refresh(), refreshInvoices()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '开票申请失败'), color: 'error' })
  } finally {
    contractInvoiceRequestSubmitting.value = false
  }
}

async function requestInvoiceForPlan(plan: ContractReceivablePlan) {
  if (!plan?.code) return
  invoiceRequestLoadingCode.value = plan.code
  try {
    const response = await $fetch<InvoiceRequestResponse>(`/api/v1/receivable-plans/${encodeURIComponent(plan.code)}/invoice-request`, {
      method: 'POST',
      body: {
        requestedAmount: plan.unreceived_amount || plan.amount,
        invoiceItem: plan.plan_name,
        submit: true
      }
    })
    const invoiceRequestCode = response?.data?.invoiceRequest?.code
    const submitError = response?.data?.financeSubmitError
    toast.add({
      title: invoiceRequestCode ? `开票申请 ${invoiceRequestCode} 已创建` : '开票申请已创建',
      description: submitError ? '审批提交暂未完成，请到 Finance 检查。' : undefined,
      color: submitError ? 'warning' : 'success'
    })
    await Promise.all([refresh(), refreshInvoices()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '开票申请失败'), color: 'error' })
  } finally {
    invoiceRequestLoadingCode.value = ''
  }
}

type ContractStatusCommandAction = 'submit' | 'approve' | 'reject' | 'complete'

async function contractStatusCommand(action: ContractStatusCommandAction, successTitle: string, color: 'success' | 'warning' = 'success') {
  const path = action === 'approve' || action === 'reject'
    ? `/api/v1/contracts/${id.value}/approve`
    : `/api/v1/contracts/${id.value}/status`
  try {
    await $fetch(path, { method: 'POST', body: { action } })
    toast.add({ title: successTitle, color })
    await Promise.all([refresh(), refreshStages()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '操作失败'), color: 'error' })
  }
}

type ContractLifecycleCommand = 'submit' | 'withdraw' | 'mark-signed' | 'suspend' | 'terminate' | 'fulfillment/close'
type ObligationCommand = 'start' | 'submit' | 'accept' | 'reject'

const lifecycleLoadingAction = ref<ContractLifecycleCommand | ''>('')
const obligationLoadingKey = ref('')
const activationLoading = ref(false)
const activationJobActionLoading = ref<'retry' | 'cancel' | ''>('')

const latestActivationJob = computed<ContractActivationJob | null>(() => {
  return activationPlan.value?.latestJob
    || contract.value?.latest_activation_job
    || contract.value?.activation_jobs?.[0]
    || null
})
const activationSteps = computed<ContractActivationStep[]>(() => {
  const jobSteps = latestActivationJob.value?.steps
  if (Array.isArray(jobSteps) && jobSteps.length > 0) return jobSteps
  return activationPlan.value?.steps || []
})
const activationWarnings = computed(() => activationPlan.value?.warnings || [])
const projectLinks = computed(() => contract.value?.project_links || [])
const deliveryAssetPlans = computed(() => contract.value?.delivery_asset_plans || [])
const serviceAgreements = computed(() => contract.value?.service_agreements || [])
const projectLinkModalOpen = ref(false)
const eligibleProjectLoading = ref(false)
const eligibleProjects = ref<AimsEligibleProject[]>([])
const selectedProjectCode = ref('')
const projectLinkSearch = ref('')
const projectLinkRole = ref('delivery')
const projectLinkSubmitting = ref(false)
const projectLinkRoleOptions = [
  { label: '交付项目', value: 'delivery' },
  { label: '主项目', value: 'primary' },
  { label: '实施项目', value: 'implementation' },
  { label: '开发项目', value: 'development' },
  { label: '维护项目', value: 'maintenance' }
]
const eligibleProjectOptions = computed(() => eligibleProjects.value.map((project) => {
  const code = String(project.project_code || '')
  const name = String(project.name || project.short_name || code)
  return {
    label: code ? `${code} · ${name}` : name,
    value: code
  }
}).filter(item => item.value))
const selectedEligibleProject = computed(() => {
  return eligibleProjects.value.find(project => String(project.project_code || '') === selectedProjectCode.value) || null
})
const canStartActivation = computed(() => {
  return !!contract.value?.code && !activationLoading.value && !['terminated', 'invalid'].includes(normalizedContractStatus.value)
})

async function loadEligibleAimsProjects() {
  if (!contract.value?.id) return
  eligibleProjectLoading.value = true
  try {
    const response = await $fetch<ApiResponse<{ items?: AimsEligibleProject[] }>>(`/api/v1/contracts/${id.value}/eligible-aims-projects`, {
      query: {
        search: projectLinkSearch.value.trim(),
        limit: 30
      }
    })
    eligibleProjects.value = response.data?.items || []
    if (!eligibleProjects.value.some(project => String(project.project_code || '') === selectedProjectCode.value)) {
      selectedProjectCode.value = eligibleProjects.value[0]?.project_code || ''
    }
  } catch (error: unknown) {
    eligibleProjects.value = []
    selectedProjectCode.value = ''
    toast.add({ title: errorMessage(error, 'Aims 候选项目加载失败'), color: 'error' })
  } finally {
    eligibleProjectLoading.value = false
  }
}

async function openProjectLinkModal() {
  projectLinkSearch.value = ''
  projectLinkRole.value = 'delivery'
  selectedProjectCode.value = ''
  projectLinkModalOpen.value = true
  await loadEligibleAimsProjects()
}

async function submitExistingProjectLink() {
  const selected = selectedEligibleProject.value
  if (!selected?.project_code) {
    toast.add({ title: '请选择 Aims 项目', color: 'warning' })
    return
  }
  const duplicate = projectLinks.value.some(link =>
    String(link.project_code || '') === String(selected.project_code || '')
    && String(link.project_role || 'delivery') === projectLinkRole.value
    && String(link.status || 'active') === 'active'
  )
  if (duplicate) {
    toast.add({ title: '该项目已按当前角色关联', color: 'warning' })
    return
  }
  projectLinkSubmitting.value = true
  try {
    await $fetch(String(`/api/v1/contracts/${id.value}/project-links`), {
      method: 'POST',
      body: {
        project_code: selected.project_code,
        project_name_snapshot: selected.name || selected.short_name || selected.project_code,
        project_role: projectLinkRole.value,
        link_mode: 'linked_existing',
        status: 'active'
      }
    })
    toast.add({ title: '项目已关联', color: 'success' })
    projectLinkModalOpen.value = false
    await Promise.all([refresh(), refreshActivationPlan()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '关联项目失败'), color: 'error' })
  } finally {
    projectLinkSubmitting.value = false
  }
}

function activationStepName(step: ContractActivationStep) {
  return step.step_name || step.name || step.step_key || '-'
}

function activationStepStatusMeta(status: string | null | undefined) {
  return statusMeta(ACTIVATION_STEP_STATUS, status)
}

function activationJobID(job: ContractActivationJob | null | undefined) {
  return String(job?.id || job?.code || '').trim()
}

async function startActivation() {
  if (!contract.value?.code || !canStartActivation.value) return
  activationLoading.value = true
  try {
    const requestKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}`
    await $fetch(`/api/v1/service/contracts/${encodeURIComponent(contract.value.code)}/activate-delivery`, {
      method: 'POST',
      headers: {
        'idempotency-key': `altoc:contract:${contract.value.code}:activate-delivery:${requestKey}`
      }
    })
    toast.add({ title: '履约启动已执行', color: 'success' })
    await Promise.all([refresh(), refreshActivationPlan(), refreshStages(), refreshInvoices()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '履约启动失败'), color: 'error' })
    await Promise.all([refresh(), refreshActivationPlan()])
  } finally {
    activationLoading.value = false
  }
}

async function activationJobCommand(action: 'retry' | 'cancel') {
  const jobId = activationJobID(latestActivationJob.value)
  if (!jobId) return
  const reason = action === 'cancel' ? window.prompt('请输入取消原因')?.trim() : ''
  if (action === 'cancel' && !reason) return
  activationJobActionLoading.value = action
  try {
    await $fetch<unknown>(String(`/api/v1/contracts/${id.value}/activation/jobs/${encodeURIComponent(jobId)}/${action}`), {
      method: 'POST',
      body: action === 'cancel' ? { reason } : {}
    })
    toast.add({ title: action === 'retry' ? '失败步骤已重置' : '履约启动已取消', color: action === 'retry' ? 'success' : 'warning' })
    await Promise.all([refresh(), refreshActivationPlan()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, action === 'retry' ? '重试失败' : '取消失败'), color: 'error' })
  } finally {
    activationJobActionLoading.value = ''
  }
}

async function contractLifecycleCommand(action: ContractLifecycleCommand, successTitle: string, body: Record<string, unknown> = {}) {
  lifecycleLoadingAction.value = action
  try {
    await $fetch<unknown>(String(`/api/v1/contracts/${id.value}/${action}`), { method: 'POST', body })
    toast.add({ title: successTitle, color: 'success' })
    await Promise.all([refresh(), refreshStages(), refreshInvoices()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '操作失败'), color: 'error' })
  } finally {
    lifecycleLoadingAction.value = ''
  }
}

function obligationActionAllowed(obligation: ContractObligation, action: ObligationCommand) {
  const statusValue = String(obligation.status || '')
  if (action === 'start') return ['not_started', 'rejected', 'blocked'].includes(statusValue)
  if (action === 'submit') return ['in_progress', 'rejected'].includes(statusValue)
  if (action === 'accept') return ['submitted', 'completed'].includes(statusValue)
  if (action === 'reject') return statusValue === 'submitted'
  return false
}

async function obligationCommand(obligation: ContractObligation, action: ObligationCommand) {
  if (!obligation.id) return
  let reason = ''
  if (action === 'reject') {
    reason = window.prompt('请输入驳回原因')?.trim() || ''
    if (!reason) return
  }
  obligationLoadingKey.value = `${obligation.id}:${action}`
  try {
    await $fetch<unknown>(String(`/api/v1/contract-obligations/${obligation.id}/${action}`), {
      method: 'POST',
      body: {
        reason,
        evidence_note: action === 'submit' ? '页面提交履约结果' : undefined
      }
    })
    const labels: Record<ObligationCommand, string> = {
      start: '义务已开始',
      submit: '义务已提交',
      accept: '义务已验收',
      reject: '义务已驳回'
    }
    toast.add({ title: labels[action], color: action === 'reject' ? 'warning' : 'success' })
    await refresh()
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '义务操作失败'), color: 'error' })
  } finally {
    obligationLoadingKey.value = ''
  }
}

type ContractManagementAction = 'force_complete' | 'terminate' | 'invalidate'

const managementLoadingAction = ref<ContractManagementAction | ''>('')
const managementReason = reactive({
  terminate: '',
  invalidate: ''
})

const canForceCompleteByAdmin = computed(() => {
  return !!contract.value && normalizedContractStatus.value !== 'completed'
})
function managementDisabledReason(action: ContractManagementAction) {
  if (!contract.value) return '合同数据未加载'
  if (action === 'force_complete') {
    return canForceCompleteByAdmin.value ? '' : '合同已完成'
  }
  if (action === 'terminate') {
    if (['terminated', 'invalid'].includes(normalizedContractStatus.value)) return '当前状态不允许终止'
    if (receivedTotal.value <= 0) return '尚未回款的合同不能终止，可使用作废'
    if (terminationBadDebtAmount.value <= 0) return '没有未回款金额'
    return ''
  }
  if (['terminated', 'invalid', 'completed'].includes(normalizedContractStatus.value)) return '当前状态不允许作废'
  if (receivedTotal.value > 0) return '已有回款记录，不能作废'
  if (invoiceTotal.value > 0) return '已有开票记录，不能作废'
  return ''
}

async function submitContractManagement(action: ContractManagementAction) {
  if (!hasSystemAdminAccess.value) {
    toast.add({ title: '只有系统管理员可以执行该操作', color: 'error' })
    return
  }

  const reason = action === 'terminate'
    ? managementReason.terminate.trim()
    : action === 'invalidate'
      ? managementReason.invalidate.trim()
      : ''
  if ((action === 'terminate' || action === 'invalidate') && !reason) {
    toast.add({ title: '请填写原因', color: 'error' })
    return
  }

  const disabledReason = managementDisabledReason(action)
  if (disabledReason) {
    toast.add({ title: disabledReason, color: 'warning' })
    return
  }

  const confirmText = action === 'force_complete'
    ? '确认强制完成该合同？系统会按到期日期补齐未收款和未开票余额。'
    : action === 'terminate'
      ? '确认终止该合同？未回款部分会记为坏账。'
      : '确认作废该合同？关联回款计划会从有效列表移除。'
  if (!confirm(confirmText)) return

  managementLoadingAction.value = action
  try {
    await $fetch(`/api/v1/contracts/${id.value}/management`, {
      method: 'POST',
      body: { action, reason }
    })
    toast.add({
      title: action === 'force_complete' ? '合同已强制完成' : action === 'terminate' ? '合同已终止' : '合同已作废',
      color: 'success'
    })
    if (action === 'terminate') managementReason.terminate = ''
    if (action === 'invalidate') managementReason.invalidate = ''
    await Promise.all([refresh(), refreshInvoices(), refreshStages()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '管理操作失败'), color: 'error' })
  } finally {
    managementLoadingAction.value = ''
  }
}

const STAGE_LABELS: Record<string, string> = {
  contract_signed: '签订生效',
  delivery: '交付完成',
  acceptance: '验收完成',
  service_end: '服务结束'
}

const STAGE_STATUS_LABELS: Record<string, { label: string, color: string }> = {
  pending: { label: '待处理', color: 'neutral' },
  completed: { label: '已完成', color: 'success' }
}

const IMPLIED_COMPLETED_STAGES: Record<string, string[]> = {
  effective: ['contract_signed'],
  executing: ['contract_signed'],
  delivering: ['contract_signed', 'delivery'],
  accepted: ['contract_signed', 'delivery', 'acceptance'],
  service_ended: ['contract_signed', 'delivery', 'acceptance', 'service_end'],
  expired: ['contract_signed']
}

const normalizedContractStatus = computed(() => normalizeContractStatus(contract.value?.status))
const legalStatus = computed(() => String(contract.value?.legal_status || normalizedContractStatus.value || ''))
const fulfillmentStatus = computed(() => String(contract.value?.fulfillment_status || 'not_started'))
const canMarkSigned = computed(() => !!contract.value && ['approved', 'signing'].includes(legalStatus.value))
const canCloseFulfillmentByObligations = computed(() => {
  const summary = contract.value?.obligation_summary
  return !!contract.value
    && ['effective', 'suspended'].includes(legalStatus.value)
    && Number(summary?.total_count || 0) > 0
    && Number(summary?.open_count || 0) === 0
    && fulfillmentStatus.value !== 'fulfilled'
})
const contractNextStepHint = computed(() => {
  if (!contract.value) return ''
  if (legalStatus.value === 'draft') return '完善合同信息并提交审批'
  if (legalStatus.value === 'pending_approval') return '等待审批结果'
  if (legalStatus.value === 'approved') return '登记签署并生成履约义务与结算计划'
  if (legalStatus.value === 'effective' && Number(contract.value.obligation_summary?.open_count || 0) > 0) return '推进未完成履约义务'
  if (canCloseFulfillmentByObligations.value) return '所有义务已完成，可关闭履约'
  if (legalStatus.value === 'closed') return '履约已关闭，财务状态独立跟踪'
  if (legalStatus.value === 'terminated') return '合同已终止，剩余结算需走财务处理'
  return ''
})
const rawContractStatus = computed(() => String(contract.value?.raw_status || contract.value?.status || ''))
const completedStageTypes = computed(() => {
  const stages = Array.isArray(stageData.value) ? stageData.value : []
  const completed = new Set(stages
    .filter(stage => stage.status === 'completed')
    .map(stage => String(stage.stage_type || '')))
  for (const stageType of IMPLIED_COMPLETED_STAGES[rawContractStatus.value] || []) {
    completed.add(stageType)
  }
  return completed
})

function hasCompletedStage(stageType: string) {
  return completedStageTypes.value.has(stageType)
}

const nextStage = computed(() => {
  const statusValue = normalizedContractStatus.value
  if (statusValue === 'approved' && !hasCompletedStage('contract_signed')) return 'contract_signed'
  if (statusValue !== 'effective') return ''
  if (!hasCompletedStage('delivery')) return 'delivery'
  if (!hasCompletedStage('acceptance')) return 'acceptance'
  if (!hasCompletedStage('service_end')) return 'service_end'
  return ''
})

const isServiceEndedStage = computed(() => normalizedContractStatus.value === 'effective' && hasCompletedStage('service_end'))
const canCompleteContract = computed(() => isServiceEndedStage.value && receivablePlanCount.value > 0 && uncollectedReceivableAmount.value <= 0)
const isServiceEndedWithOutstandingReceivable = computed(() => isServiceEndedStage.value && uncollectedReceivableAmount.value > 0)

const stageModalOpen = ref(false)
const stageSubmitting = ref(false)
const stageForm = reactive({
  stage_type: '',
  stage_date: '',
  evidence_note: '',
  document_uuid: '',
  document_title: ''
})

function openStageModal(stageType = nextStage.value) {
  if (!stageType) return
  stageForm.stage_type = stageType
  stageForm.stage_date = new Date().toISOString().slice(0, 10)
  stageForm.evidence_note = ''
  stageForm.document_uuid = ''
  stageForm.document_title = ''
  stageModalOpen.value = true
}

async function submitStage() {
  if (!stageForm.stage_type) return
  if (!stageForm.document_uuid.trim() && !stageForm.evidence_note.trim()) {
    toast.add({ title: '请填写证明文档 UUID 或证明说明', color: 'error' })
    return
  }

  stageSubmitting.value = true
  try {
    await $fetch(`/api/v1/contracts/${id.value}/stages`, {
      method: 'POST',
      body: {
        stage_type: stageForm.stage_type,
        stage_date: stageForm.stage_date,
        evidence_note: stageForm.evidence_note.trim(),
        document_uuid: stageForm.document_uuid.trim(),
        document_title: stageForm.document_title.trim()
      }
    })
    toast.add({ title: '合同环节已处理', color: 'success' })
    stageModalOpen.value = false
    await Promise.all([refresh(), refreshStages()])
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '处理失败'), color: 'error' })
  } finally {
    stageSubmitting.value = false
  }
}

// ========================
// 平台审批流程（usePageWorkflow 单动作模式）
// ========================
const approvalIssues = computed<string[]>(() => {
  const issues: string[] = []
  if (!contract.value) return issues
  if (!contract.value.amount_tax_inclusive || Number(contract.value.amount_tax_inclusive) <= 0) {
    issues.push('合同金额必须大于 0')
  }
  if (!contract.value.customer_id) issues.push('请关联客户')
  if (!contract.value.sign_date) issues.push('请填写签约日期')
  return issues
})

const canSubmitApproval = computed(() => {
  return !!contract.value && normalizedContractStatus.value === 'draft' && approvalIssues.value.length === 0
})

const workflowActions = computed(() => {
  if (!contract.value) return []
  if (normalizedContractStatus.value === 'draft') {
    return [{
      actionCode: 'approve',
      actionName: '合同审批',
      icon: 'i-lucide-file-signature',
      canSubmit: canSubmitApproval,
      completenessIssues: approvalIssues,
      async onSubmitted() {
        await contractStatusCommand('submit', '已提交审批')
      },
      async onApproved() {
        await contractStatusCommand('approve', '审批通过')
      },
      async onRejected() {
        await contractStatusCommand('reject', '审批已驳回，可修改后重新提交', 'warning')
      }
    }]
  }
  return []
})

usePageWorkflow({
  appCode: 'altoc',
  resourceCode: 'contract',
  bizId: computed(() => idNum.value ? String(idNum.value) : ''),
  bizTitle: computed(() => contract.value ? `${contract.value.code} ${contract.value.name || ''}` : ''),
  bizUrl: computed(() => {
    if (!contract.value || !import.meta.client) return ''
    return `${window.location.origin}/contracts/${idNum.value}`
  }),
  actions: workflowActions
})

const lineColumns = [
  { accessorKey: 'line_no', header: '行号' },
  { accessorKey: 'name', header: '产品/服务' },
  { accessorKey: 'line_type', header: '类型' },
  { accessorKey: 'quantity', header: '数量' },
  { accessorKey: 'unit_price', header: '单价' },
  { accessorKey: 'amount_tax_inclusive', header: '含税金额' },
  { accessorKey: 'tax_rate', header: '税率' },
  { accessorKey: 'billing_method', header: '计费方式' },
  { accessorKey: 'fulfillment_method', header: '履约方式' }
]

const obligationColumns = [
  { accessorKey: 'name', header: '义务' },
  { accessorKey: 'obligation_type', header: '类型' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'planned_due_at', header: '计划完成' },
  { accessorKey: 'source_type', header: '来源' },
  { accessorKey: 'actions', header: '操作' }
]

const billingScheduleColumns = [
  { accessorKey: 'name', header: '结算节点' },
  { accessorKey: 'trigger_type', header: '触发条件' },
  { accessorKey: 'obligation_name', header: '绑定义务' },
  { accessorKey: 'amount', header: '金额' },
  { accessorKey: 'expected_date', header: '预计日期' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'source_type', header: '来源' }
]

const termColumns = [
  { accessorKey: 'term_name', header: '条款名称' },
  { accessorKey: 'term_type', header: '类型' },
  { accessorKey: 'billing_mode', header: '计费模式' },
  { accessorKey: 'amount', header: '金额' },
  { accessorKey: 'ratio', header: '比例' },
  { accessorKey: 'trigger_stage_type', header: '触发环节' },
  { accessorKey: 'expected_date', header: '预计日期' },
  { accessorKey: 'condition_desc', header: '触发条件' }
]

const rpColumns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'plan_name', header: '名称' },
  { accessorKey: 'plan_type', header: '类型' },
  { accessorKey: 'amount', header: '计划金额' },
  { accessorKey: 'received_amount', header: '已回款' },
  { accessorKey: 'unreceived_amount', header: '未回款' },
  { accessorKey: 'planned_payment_date', header: '计划日期' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '操作' }
]

const paymentRecordColumns = [
  { accessorKey: 'code', header: '到账编号' },
  { accessorKey: 'received_at', header: '到账日期' },
  { accessorKey: 'received_amount', header: '到账金额' },
  { accessorKey: 'payer_name', header: '付款方' },
  { accessorKey: 'note', header: '备注' }
]

const invoiceColumns = [
  { accessorKey: 'code', header: '记录编号' },
  { accessorKey: 'invoice_no', header: '发票号码' },
  { accessorKey: 'invoice_type', header: '发票类型' },
  { accessorKey: 'invoice_medium', header: '介质' },
  { accessorKey: 'invoice_amount', header: '开票金额' },
  { accessorKey: 'tax_amount', header: '税额' },
  { accessorKey: 'invoice_date', header: '开票日期' },
  { accessorKey: 'invoice_file_url', header: '文件' },
  { accessorKey: 'status', header: '状态' }
]

const termTypeLabels: Record<string, string> = {
  one_time: '一次性付款',
  advance: '预付款',
  milestone: '里程碑款',
  acceptance: '验收款',
  retention: '质保金',
  annual_service: '年度服务费'
}

const billingModeLabels: Record<string, string> = {
  one_time: '一次性',
  ratio: '按比例',
  stage: '按环节',
  annual: '年度周期'
}

const invoiceTypeLabels: Record<string, string> = {
  special_vat: '专用发票',
  general_vat: '普通发票',
  electronic: '电子发票'
}

const invoiceTypeOptions = [
  { label: '专用发票', value: 'special_vat' },
  { label: '普通发票', value: 'general_vat' },
  { label: '电子发票', value: 'electronic' },
  { label: '其他', value: 'other' }
]

const invoiceMediumLabels: Record<string, string> = {
  electronic: '电子',
  paper: '纸质'
}

const invoiceMediumOptions = [
  { label: '电子发票', value: 'electronic' },
  { label: '纸质发票', value: 'paper' }
]

const invoiceStatusLabels: Record<string, { label: string, color: string }> = {
  draft: { label: '草稿', color: 'neutral' },
  issued: { label: '已开具', color: 'success' },
  red_reversed: { label: '已红冲', color: 'warning' },
  canceled: { label: '已作废', color: 'error' }
}

const invoicePreviewOpen = ref(false)
const invoicePreviewUrl = ref('')
const invoicePreviewTitle = ref('发票预览')
const invoicePreviewMimeType = ref('')
const invoicePreviewLoadingUrl = ref('')

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
  return resolveCurrentAppPath(`/api/v1/contracts/invoice-files/view?${params.toString()}`)
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
    const signedUrl = String(response.data?.url || '').trim()
    if (!signedUrl) {
      throw new Error('未获取到发票文件预览地址')
    }
    invoicePreviewUrl.value = signedUrl
    invoicePreviewTitle.value = invoiceFileName(row) || '发票预览'
    invoicePreviewMimeType.value = invoiceFileMimeType(row)
    invoicePreviewOpen.value = true
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '发票文件预览失败'), color: 'error' })
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
</script>

<template>
  <UDashboardPanel
    id="contract-detail"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-y-auto !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/contracts')"
        />
        <div v-if="contract" class="flex items-center gap-2">
          <span class="font-semibold">{{ contract.name }}</span>
          <UBadge :color="(contractStatusMeta(contract.status)?.color || 'neutral') as any" variant="subtle" size="sm">
            {{ contractStatusMeta(contract.status)?.label || contract.status }}
          </UBadge>
          <span class="text-xs text-muted font-mono">{{ contract.code }}</span>
        </div>
        <USkeleton v-else class="h-6 w-48" />
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <template v-if="contract && !isApprovalMode">
          <!-- 审批相关按钮已下放到右侧 WorkflowPanel；这里仅保留非审批的业务流转 -->
          <UButton
            v-if="canMarkSigned"
            label="登记签署"
            color="primary"
            icon="i-lucide-pen-line"
            :loading="lifecycleLoadingAction === 'mark-signed'"
            @click="contractLifecycleCommand('mark-signed', '合同已签署生效')"
          />
          <UButton
            v-if="canCloseFulfillmentByObligations"
            label="关闭履约"
            variant="soft"
            color="success"
            :loading="lifecycleLoadingAction === 'fulfillment/close'"
            @click="contractLifecycleCommand('fulfillment/close', '合同履约已关闭')"
          />
          <UButton
            v-else-if="canCompleteContract"
            label="关闭履约"
            variant="soft"
            color="success"
            @click="contractStatusCommand('complete', '合同履约已关闭')"
          />
          <UButton
            v-else-if="isServiceEndedWithOutstandingReceivable"
            label="未结清"
            variant="soft"
            color="warning"
            icon="i-lucide-lock"
            disabled
          />
        </template>
      </Teleport>

      <div v-if="status === 'pending' || status === 'idle'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else-if="status === 'error'" class="p-6">
        <UAlert
          color="error"
          variant="soft"
          title="合同详情加载失败"
          :description="contractErrorMessage"
          icon="i-lucide-circle-alert"
        />
        <div class="mt-4">
          <UButton
            label="重试"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            @click="refresh()"
          />
        </div>
      </div>

      <div v-else-if="contract" class="flex h-full min-h-0">
        <div class="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
          <!-- 统计 -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold font-mono">
                  {{ formatMoney(contractAmount) }}
                </div>
                <div class="text-xs text-muted mt-1">
                  合同金额
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold font-mono" :class="uncollectedReceivableAmount > 0 ? 'text-warning' : ''">
                  {{ formatMoney(uncollectedReceivableAmount) }}
                </div>
                <div class="text-xs text-muted mt-1">
                  应收未收
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold font-mono text-success">
                  {{ formatMoney(receivedTotal) }}
                </div>
                <div class="text-xs text-muted mt-1">
                  已回款
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold font-mono" :class="unreceivedContractAmount > 0 ? 'text-warning' : ''">
                  {{ formatMoney(unreceivedContractAmount) }}
                </div>
                <div class="text-xs text-muted mt-1">
                  未回款
                </div>
              </div>
            </UCard>
          </div>

          <UTabs v-model="activeTab" :items="tabs" class="w-full" />

          <!-- 合同信息 -->
          <div v-if="activeTab === 'info'" class="space-y-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div class="font-semibold text-sm">
                  合同信息
                </div>
                <div class="text-xs text-muted mt-0.5">
                  {{ contract.code }} · {{ contract.customer_name || '-' }}
                </div>
              </div>
              <UButton
                label="编辑"
                icon="i-lucide-pencil"
                color="primary"
                variant="soft"
                size="sm"
                @click="openContractBasicEditModal"
              />
            </div>
            <UAccordion
              type="multiple"
              :items="contractInfoAccordionItems"
              :default-value="contractInfoAccordionDefault"
              :unmount-on-hide="false"
              :ui="{
                item: 'rounded-md border border-default !border-b px-4 mb-3 last:mb-0',
                trigger: 'py-3.5',
                body: 'pb-4'
              }"
            >
              <template #basic>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">客户</span>
                    <NuxtLink :to="`/customers/${contract.customer_id}`" class="text-primary hover:underline">{{ contract.customer_name }}</NuxtLink>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">商机</span>
                    <NuxtLink v-if="contract.opportunity_id" :to="`/opportunities/${contract.opportunity_id}`" class="text-primary hover:underline">{{ contract.opportunity_name }}</NuxtLink>
                    <span v-else>-</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">投标</span>
                    <span v-if="contract.tender_id">{{ contract.tender_name || contract.tender_id }}</span>
                    <span v-else>-</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">合同方向</span><span>{{ directionLabels[String(contract.direction || '')] || contract.direction || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">协议形式</span><span>{{ agreementFormLabels[String(contract.agreement_form || '')] || contract.agreement_form || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">合同角色</span>
                    <UBadge :color="truthyFlag(contract.is_master_contract) ? 'primary' : 'neutral'" variant="subtle">
                      {{ truthyFlag(contract.is_master_contract) ? '主合同' : '附属合同' }}
                    </UBadge>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">主合同</span>
                    <NuxtLink
                      v-if="contract.parent_contract?.id || contract.parent_contract_id"
                      :to="`/contracts/${contract.parent_contract?.id || contract.parent_contract_id}`"
                      class="text-primary hover:underline truncate"
                    >
                      {{ contract.parent_contract?.code || contract.parent_contract_code || contract.parent_contract_id }}
                      <span v-if="contract.parent_contract?.name || contract.parent_contract_name"> · {{ contract.parent_contract?.name || contract.parent_contract_name }}</span>
                    </NuxtLink>
                    <span v-else>-</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">合同类型</span><span>{{ contract.template_code || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">来源</span><span>{{ contract.source_code || contract.source_type || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">法律状态</span>
                    <UBadge :color="statusMeta(LEGAL_STATUS, contract.legal_status).color as any" variant="subtle">
                      {{ statusMeta(LEGAL_STATUS, contract.legal_status).label }}
                    </UBadge>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">履约状态</span>
                    <UBadge :color="statusMeta(FULFILLMENT_STATUS, contract.fulfillment_status).color as any" variant="subtle">
                      {{ statusMeta(FULFILLMENT_STATUS, contract.fulfillment_status).label }}
                    </UBadge>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">财务状态</span>
                    <UBadge :color="statusMeta(FINANCIAL_STATUS, contract.financial_status).color as any" variant="subtle">
                      {{ statusMeta(FINANCIAL_STATUS, contract.financial_status).label }}
                    </UBadge>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">启动状态</span>
                    <UBadge :color="statusMeta(ACTIVATION_STATUS, contract.activation_status).color as any" variant="subtle">
                      {{ statusMeta(ACTIVATION_STATUS, contract.activation_status).label }}
                    </UBadge>
                  </div>
                  <div v-if="contractNextStepHint" class="flex md:col-span-2">
                    <span class="text-muted w-24 shrink-0">下一步</span><span>{{ contractNextStepHint }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">客户联系人</span><span>{{ contract.contact_name || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">签约日期</span><span>{{ contract.sign_date || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">生效日期</span><span>{{ contract.effective_date || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">到期日期</span><span>{{ contract.end_date || '-' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">发票类型</span><span>{{ invoiceTypeLabel(contract.invoice_type) }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">负责人</span><UserName :uid="contract.owner_user_id" />
                  </div>
                  <div class="flex">
                    <span class="text-muted w-24 shrink-0">创建时间</span><span class="text-xs">{{ contract.created_at }}</span>
                  </div>
                  <div v-if="contract.child_contracts?.length" class="md:col-span-2 border-t border-muted pt-3 mt-1">
                    <div class="text-muted mb-2">
                      附属合同
                    </div>
                    <div class="space-y-2">
                      <NuxtLink
                        v-for="item in contract.child_contracts"
                        :key="item.id"
                        :to="`/contracts/${item.id}`"
                        class="flex items-center justify-between gap-3 rounded-md border border-muted px-3 py-2 hover:bg-elevated"
                      >
                        <span class="min-w-0 truncate">
                          <span class="font-medium">{{ item.code || item.id }}</span>
                          <span class="text-muted"> · {{ item.name || '-' }}</span>
                        </span>
                        <span class="flex shrink-0 items-center gap-2">
                          <UBadge color="neutral" variant="subtle">
                            {{ agreementFormLabels[String(item.agreement_form || '')] || item.agreement_form || '-' }}
                          </UBadge>
                          <span>{{ formatMoney(item.amount_tax_inclusive) }}</span>
                        </span>
                      </NuxtLink>
                    </div>
                  </div>
                </div>
              </template>

              <template #lines>
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <div class="rounded-md border border-default p-3">
                      <div class="text-xs text-muted">
                        行数
                      </div>
                      <div class="mt-1 text-lg font-semibold">
                        {{ contract.line_summary?.line_count ?? (contract.lines || []).length }}
                      </div>
                    </div>
                    <div class="rounded-md border border-default p-3">
                      <div class="text-xs text-muted">
                        合行含税金额
                      </div>
                      <div class="mt-1 font-mono text-lg font-semibold">
                        {{ formatMoney(contract.line_summary?.amount_tax_inclusive) }}
                      </div>
                    </div>
                    <div class="rounded-md border border-default p-3">
                      <div class="text-xs text-muted">
                        合行不含税金额
                      </div>
                      <div class="mt-1 font-mono text-lg font-semibold">
                        {{ formatMoney(contract.line_summary?.amount_tax_exclusive) }}
                      </div>
                    </div>
                    <div class="rounded-md border border-default p-3">
                      <div class="text-xs text-muted">
                        与合同头差额
                      </div>
                      <div class="mt-1 flex items-center gap-2">
                        <span class="font-mono text-lg font-semibold">{{ formatMoney(contract.line_summary?.amount_difference) }}</span>
                        <UBadge
                          v-if="contract.line_summary"
                          :color="contract.line_summary.amount_matches_contract ? 'success' : 'warning'"
                          variant="subtle"
                          size="sm"
                        >
                          {{ contract.line_summary.amount_matches_contract ? '一致' : '需核对' }}
                        </UBadge>
                      </div>
                    </div>
                  </div>

                  <UTable :data="contract.lines || []" :columns="lineColumns">
                    <template #name-cell="{ row }">
                      <div class="min-w-48">
                        <div class="font-medium">
                          {{ (row.original as any).name || '-' }}
                        </div>
                        <div v-if="(row.original as any).description" class="text-xs text-muted mt-1 line-clamp-2">
                          {{ (row.original as any).description }}
                        </div>
                      </div>
                    </template>
                    <template #line_type-cell="{ row }">
                      {{ lineTypeLabels[(row.original as any).line_type] || (row.original as any).line_type || '-' }}
                    </template>
                    <template #quantity-cell="{ row }">
                      {{ (row.original as any).quantity || '-' }} {{ (row.original as any).unit || '' }}
                    </template>
                    <template #unit_price-cell="{ row }">
                      <span class="font-mono">{{ formatMoney((row.original as any).unit_price) }}</span>
                    </template>
                    <template #amount_tax_inclusive-cell="{ row }">
                      <span class="font-mono">{{ formatMoney((row.original as any).amount_tax_inclusive) }}</span>
                    </template>
                    <template #tax_rate-cell="{ row }">
                      {{ (row.original as any).tax_rate ? `${(row.original as any).tax_rate}%` : '-' }}
                    </template>
                    <template #billing_method-cell="{ row }">
                      {{ (row.original as any).billing_method || '-' }}
                    </template>
                    <template #fulfillment_method-cell="{ row }">
                      {{ (row.original as any).fulfillment_method || '-' }}
                    </template>
                    <template #empty>
                      <div class="text-center py-6 text-muted text-sm">
                        暂无产品与服务
                      </div>
                    </template>
                  </UTable>
                </div>
              </template>

              <template #terms>
                <div class="space-y-4">
                  <div v-if="contract.payment_term_summary" class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted mb-1">
                      付款条款摘要
                    </div>
                    <div class="text-sm whitespace-pre-wrap">
                      {{ contract.payment_term_summary }}
                    </div>
                  </div>

                  <UTable :data="contract.payment_terms || []" :columns="termColumns">
                    <template #term_type-cell="{ row }">
                      {{ termTypeLabels[(row.original as any).term_type] || (row.original as any).term_type }}
                    </template>
                    <template #billing_mode-cell="{ row }">
                      {{ billingModeLabels[(row.original as any).billing_mode] || (row.original as any).billing_mode || '-' }}
                    </template>
                    <template #amount-cell="{ row }">
                      <span class="font-mono">{{ formatMoney((row.original as any).amount) }}</span>
                    </template>
                    <template #ratio-cell="{ row }">
                      {{ (row.original as any).ratio ? (row.original as any).ratio + '%' : '-' }}
                    </template>
                    <template #trigger_stage_type-cell="{ row }">
                      {{ STAGE_LABELS[(row.original as any).trigger_stage_type] || '-' }}
                    </template>
                    <template #expected_date-cell="{ row }">
                      {{ (row.original as any).expected_date || '-' }}
                    </template>
                    <template #empty>
                      <div class="text-center py-6 text-muted text-sm">
                        {{ contract.payment_term_summary ? '暂无付款条款明细' : '暂无付款条款' }}
                      </div>
                    </template>
                  </UTable>
                </div>
              </template>

              <template #documents>
                <DocumentsPanel entity-type="contract" :entity-id="Number(id)" />
              </template>
            </UAccordion>
          </div>

          <!-- 合同执行 -->
          <UCard v-if="activeTab === 'fulfillment'">
            <div class="space-y-6">
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-sm">启动计划</span>
                    <UBadge :color="statusMeta(ACTIVATION_STATUS, latestActivationJob?.status || contract.activation_status).color as any" variant="subtle" size="sm">
                      {{ statusMeta(ACTIVATION_STATUS, latestActivationJob?.status || contract.activation_status).label }}
                    </UBadge>
                  </div>
                  <div class="text-xs text-muted mt-1">
                    {{ latestActivationJob?.code || latestActivationJob?.id ? `作业 ${latestActivationJob.code || latestActivationJob.id}` : '按合同行策略生成项目、资产、服务协议和结算步骤' }}
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <UButton
                    label="启动履约"
                    icon="i-lucide-play"
                    color="primary"
                    size="sm"
                    :loading="activationLoading"
                    :disabled="!canStartActivation"
                    @click="startActivation"
                  />
                  <UButton
                    v-if="latestActivationJob"
                    label="重试失败步骤"
                    icon="i-lucide-refresh-cw"
                    color="warning"
                    variant="soft"
                    size="sm"
                    :loading="activationJobActionLoading === 'retry'"
                    @click="activationJobCommand('retry')"
                  />
                  <UButton
                    v-if="latestActivationJob && !['completed', 'cancelled'].includes(String(latestActivationJob.status || ''))"
                    label="取消"
                    icon="i-lucide-ban"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    :loading="activationJobActionLoading === 'cancel'"
                    @click="activationJobCommand('cancel')"
                  />
                </div>
              </div>

              <UAlert
                v-if="activationWarnings.length"
                color="warning"
                variant="soft"
                title="存在后置依赖"
                :description="activationWarnings.map(item => item.message || item.code).filter(Boolean).join('；')"
              />

              <div v-if="activationPlanStatus === 'pending'" class="space-y-2">
                <USkeleton class="h-16 w-full" />
                <USkeleton class="h-16 w-full" />
              </div>
              <div v-else class="divide-y divide-default rounded-md border border-default">
                <div
                  v-for="step in activationSteps"
                  :key="String(step.id || step.step_key || step.sort_no || 'activation-step')"
                  class="flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium text-sm">{{ activationStepName(step) }}</span>
                      <UBadge :color="activationStepStatusMeta(step.status).color as any" variant="subtle" size="xs">
                        {{ activationStepStatusMeta(step.status).label }}
                      </UBadge>
                      <UBadge
                        v-if="step.required"
                        color="primary"
                        variant="subtle"
                        size="xs"
                      >
                        必需
                      </UBadge>
                    </div>
                    <div class="mt-1 text-xs text-muted">
                      {{ step.target_app || '-' }} · {{ step.target_action || '-' }}
                      <span v-if="Number(step.retry_count || 0) > 0"> · 重试 {{ step.retry_count }}</span>
                    </div>
                    <div v-if="step.last_error" class="mt-2 text-xs text-warning line-clamp-2">
                      {{ step.last_error }}
                    </div>
                  </div>
                  <div class="text-xs text-muted md:text-right">
                    {{ step.step_key || '-' }}
                  </div>
                </div>
                <div v-if="!activationSteps.length" class="p-6 text-center text-sm text-muted">
                  暂无启动计划
                </div>
              </div>

              <section>
                <div class="mb-2 flex items-center justify-between gap-3">
                  <div class="text-sm font-medium text-highlighted">
                    关联项目
                  </div>
                  <UButton
                    label="关联已有项目"
                    icon="i-lucide-link"
                    color="neutral"
                    variant="soft"
                    size="xs"
                    @click="openProjectLinkModal"
                  />
                </div>
                <div v-if="projectLinks.length" class="divide-y divide-default rounded-md border border-default">
                  <div
                    v-for="link in projectLinks"
                    :key="String(link.id || link.project_code || 'project-link')"
                    class="flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    <div class="min-w-0">
                      <div class="font-mono text-xs text-primary">
                        {{ link.project_code }}
                      </div>
                      <div class="mt-1 truncate">
                        {{ link.project_name_snapshot || '-' }}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <UBadge color="neutral" variant="subtle" size="sm">
                        {{ link.project_role || '-' }}
                      </UBadge>
                      <UBadge :color="link.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="sm">
                        {{ link.status || '-' }}
                      </UBadge>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-md border border-dashed border-muted p-6 text-center text-sm text-muted">
                  尚未关联 Aims 项目
                </div>
              </section>

              <section>
                <div class="mb-2 text-sm font-medium text-highlighted">
                  计划交付资产
                </div>
                <div v-if="deliveryAssetPlans.length" class="divide-y divide-default rounded-md border border-default">
                  <div
                    v-for="asset in deliveryAssetPlans"
                    :key="String(asset.id || asset.code || 'delivery-asset')"
                    class="flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-medium truncate">{{ asset.name || asset.code }}</span>
                        <UBadge :color="statusMeta(DELIVERY_ASSET_STATUS, asset.status).color as any" variant="subtle" size="xs">
                          {{ statusMeta(DELIVERY_ASSET_STATUS, asset.status).label }}
                        </UBadge>
                      </div>
                      <div class="mt-1 text-xs text-muted">
                        {{ asset.product_code || '-' }}
                        <span v-if="asset.external_asset_code"> · Assets {{ asset.external_asset_code }}</span>
                      </div>
                    </div>
                    <div class="shrink-0 text-xs text-muted">
                      {{ String(asset.planned_delivery_at || '').slice(0, 10) || '-' }}
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-md border border-dashed border-muted p-6 text-center text-sm text-muted">
                  尚未生成计划交付资产
                </div>
              </section>

              <section>
                <div class="mb-2 text-sm font-medium text-highlighted">
                  服务协议
                </div>
                <div v-if="serviceAgreements.length" class="divide-y divide-default rounded-md border border-default">
                  <div
                    v-for="agreement in serviceAgreements"
                    :key="String(agreement.id || agreement.code || 'service-agreement')"
                    class="p-3 text-sm"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-medium truncate">{{ agreement.name || agreement.code }}</span>
                          <UBadge :color="statusMeta(SERVICE_AGREEMENT_STATUS, agreement.status).color as any" variant="subtle" size="xs">
                            {{ statusMeta(SERVICE_AGREEMENT_STATUS, agreement.status).label }}
                          </UBadge>
                        </div>
                        <div class="mt-1 text-xs text-muted">
                          {{ agreement.code || '-' }} · 覆盖 {{ serviceAgreementCoverages(agreement).length }}
                          <span v-if="agreement.coverage_source === 'legacy_service_agreement_asset'"> · 旧表回退</span>
                        </div>
                      </div>
                      <div class="shrink-0 text-xs text-muted">
                        {{ agreement.service_start_date || '-' }} 至 {{ agreement.service_end_date || '-' }}
                      </div>
                    </div>
                    <div
                      v-if="serviceAgreementCoverages(agreement).length"
                      class="mt-3 space-y-2"
                    >
                      <div
                        v-for="coverage in serviceAgreementCoverages(agreement)"
                        :key="String(coverage.id || coverage.coverage_code || coveragePrimaryRef(coverage))"
                        class="rounded-md border border-default px-3 py-2"
                      >
                        <div class="flex flex-wrap items-center gap-1.5">
                          <UBadge :color="statusMeta(COVERAGE_TARGET_TYPE, coverage.target_type).color as any" variant="subtle" size="xs">
                            {{ statusMeta(COVERAGE_TARGET_TYPE, coverage.target_type).label }}
                          </UBadge>
                          <span class="font-mono text-xs font-semibold break-all">{{ coveragePrimaryRef(coverage) }}</span>
                          <UBadge :color="statusMeta(COVERAGE_RESOLUTION_STATUS, coverage.resolution_status).color as any" variant="subtle" size="xs">
                            {{ statusMeta(COVERAGE_RESOLUTION_STATUS, coverage.resolution_status).label }}
                          </UBadge>
                          <UBadge :color="statusMeta(COVERAGE_STATUS, coverage.coverage_status).color as any" variant="outline" size="xs">
                            {{ statusMeta(COVERAGE_STATUS, coverage.coverage_status).label }}
                          </UBadge>
                        </div>
                        <div
                          v-if="coverage.source_plan_code || coverageReviewNote(coverage)"
                          class="mt-1 text-xs text-muted"
                        >
                          <span v-if="coverage.source_plan_code">计划 {{ coverage.source_plan_code }}</span>
                          <span
                            v-if="coverageReviewNote(coverage)"
                            class="text-warning"
                          >
                            {{ coverage.source_plan_code ? ' · ' : '' }}{{ coverageReviewNote(coverage) }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-md border border-dashed border-muted p-6 text-center text-sm text-muted">
                  尚未生成服务协议
                </div>
              </section>

              <div class="border-t border-muted" />

              <section class="space-y-4">
                <div>
                  <div class="font-semibold text-sm">
                    履约义务
                  </div>
                  <div class="text-xs text-muted mt-0.5">
                    按合同行生成的交付、验收、服务覆盖等义务
                  </div>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      义务总数
                    </div>
                    <div class="mt-1 text-lg font-semibold">
                      {{ contract.obligation_summary?.total_count ?? (contract.obligations || []).length }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      已完成
                    </div>
                    <div class="mt-1 text-lg font-semibold text-success">
                      {{ contract.obligation_summary?.done_count ?? 0 }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      未完成
                    </div>
                    <div class="mt-1 text-lg font-semibold" :class="Number(contract.obligation_summary?.open_count || 0) > 0 ? 'text-warning' : ''">
                      {{ contract.obligation_summary?.open_count ?? 0 }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      驳回 / 受阻
                    </div>
                    <div class="mt-1 text-lg font-semibold">
                      {{ Number(contract.obligation_summary?.rejected_count || 0) + Number(contract.obligation_summary?.blocked_count || 0) }}
                    </div>
                  </div>
                </div>

                <UTable :data="contract.obligations || []" :columns="obligationColumns">
                  <template #name-cell="{ row }">
                    <div class="min-w-52">
                      <div class="font-medium">
                        {{ (row.original as ContractObligation).name || '-' }}
                      </div>
                      <div v-if="(row.original as ContractObligation).acceptance_criteria" class="text-xs text-muted mt-1 line-clamp-2">
                        {{ (row.original as ContractObligation).acceptance_criteria }}
                      </div>
                    </div>
                  </template>
                  <template #status-cell="{ row }">
                    <UBadge :color="statusMeta(OBLIGATION_STATUS, (row.original as ContractObligation).status).color as any" variant="subtle">
                      {{ statusMeta(OBLIGATION_STATUS, (row.original as ContractObligation).status).label }}
                    </UBadge>
                  </template>
                  <template #planned_due_at-cell="{ row }">
                    {{ String((row.original as ContractObligation).planned_due_at || '').slice(0, 10) || '-' }}
                  </template>
                  <template #source_type-cell="{ row }">
                    {{ sourceTypeLabel((row.original as ContractObligation).source_type) }}
                  </template>
                  <template #actions-cell="{ row }">
                    <div class="flex items-center gap-1">
                      <UButton
                        v-if="obligationActionAllowed(row.original as ContractObligation, 'start')"
                        icon="i-lucide-play"
                        size="xs"
                        variant="soft"
                        color="primary"
                        :loading="obligationLoadingKey === `${(row.original as ContractObligation).id}:start`"
                        @click="obligationCommand(row.original as ContractObligation, 'start')"
                      />
                      <UButton
                        v-if="obligationActionAllowed(row.original as ContractObligation, 'submit')"
                        icon="i-lucide-send"
                        size="xs"
                        variant="soft"
                        color="warning"
                        :loading="obligationLoadingKey === `${(row.original as ContractObligation).id}:submit`"
                        @click="obligationCommand(row.original as ContractObligation, 'submit')"
                      />
                      <UButton
                        v-if="obligationActionAllowed(row.original as ContractObligation, 'accept')"
                        icon="i-lucide-check"
                        size="xs"
                        variant="soft"
                        color="success"
                        :loading="obligationLoadingKey === `${(row.original as ContractObligation).id}:accept`"
                        @click="obligationCommand(row.original as ContractObligation, 'accept')"
                      />
                      <UButton
                        v-if="obligationActionAllowed(row.original as ContractObligation, 'reject')"
                        icon="i-lucide-x"
                        size="xs"
                        variant="soft"
                        color="error"
                        :loading="obligationLoadingKey === `${(row.original as ContractObligation).id}:reject`"
                        @click="obligationCommand(row.original as ContractObligation, 'reject')"
                      />
                    </div>
                  </template>
                  <template #empty>
                    <div class="text-center py-6 text-muted text-sm">
                      合同签署后将按合同行生成履约义务
                    </div>
                  </template>
                </UTable>
              </section>

              <div class="border-t border-muted" />

              <section class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="font-semibold text-sm">
                      履约环节
                    </div>
                    <div class="text-xs text-muted mt-0.5">
                      合同生效、交付、验收和服务结束的证明材料
                    </div>
                  </div>
                  <UButton
                    v-if="nextStage"
                    :label="`处理${STAGE_LABELS[nextStage]}`"
                    icon="i-lucide-upload"
                    size="sm"
                    color="primary"
                    @click="openStageModal()"
                  />
                </div>

                <div v-if="stageStatus === 'pending'" class="space-y-2">
                  <USkeleton class="h-16 w-full" />
                  <USkeleton class="h-16 w-full" />
                </div>
                <div v-else-if="stageData?.length" class="divide-y divide-default">
                  <div v-for="stage in stageData" :key="stage.id" class="py-3 flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-medium">{{ stageLabel(stage) }}</span>
                        <UBadge :color="(stageStatusMeta(stage.status)?.color || 'neutral') as any" variant="subtle" size="xs">
                          {{ stageStatusMeta(stage.status)?.label || stage.status }}
                        </UBadge>
                      </div>
                      <div class="text-xs text-muted mt-1">
                        {{ stage.stage_date || stage.handled_at || '-' }}
                        <span v-if="stage.attachment_count"> · 附件 {{ stage.attachment_count }}</span>
                        <span v-if="stage.document_count"> · 文档 {{ stage.document_count }}</span>
                      </div>
                      <div v-if="stage.evidence_note" class="text-sm mt-2 whitespace-pre-wrap">
                        {{ stage.evidence_note }}
                      </div>
                      <div v-if="stage.document_uuid" class="text-xs text-primary mt-1 font-mono">
                        {{ stage.document_title || stage.document_uuid }}
                      </div>
                    </div>
                    <UserName :uid="stage.handled_by" />
                  </div>
                </div>
                <div v-else class="text-center py-8 text-muted text-sm">
                  暂无履约环节记录
                </div>
              </section>
            </div>
          </UCard>

          <!-- 结算与回款 / 结算与付款 -->
          <UCard v-if="activeTab === 'settlement'">
            <div class="space-y-6">
              <section class="space-y-4">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="font-semibold text-sm">
                      结算条件
                    </div>
                    <div class="text-xs text-muted mt-0.5">
                      {{ contract.code }} · {{ settlementTabLabel }}
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      节点数
                    </div>
                    <div class="mt-1 text-lg font-semibold">
                      {{ contract.billing_schedule_summary?.schedule_count ?? (contract.billing_schedules || []).length }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      计划金额
                    </div>
                    <div class="mt-1 font-mono text-lg font-semibold">
                      {{ formatMoney(contract.billing_schedule_summary?.amount) }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      可结算金额
                    </div>
                    <div class="mt-1 font-mono text-lg font-semibold text-warning">
                      {{ formatMoney(contract.billing_schedule_summary?.billable_amount) }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      与合同头差额
                    </div>
                    <div class="mt-1 flex items-center gap-2">
                      <span class="font-mono text-lg font-semibold">{{ formatMoney(contract.billing_schedule_summary?.amount_difference) }}</span>
                      <UBadge
                        v-if="contract.billing_schedule_summary"
                        :color="contract.billing_schedule_summary.amount_matches_contract ? 'success' : 'warning'"
                        variant="subtle"
                        size="sm"
                      >
                        {{ contract.billing_schedule_summary.amount_matches_contract ? '一致' : '需核对' }}
                      </UBadge>
                    </div>
                  </div>
                </div>

                <UTable :data="contract.billing_schedules || []" :columns="billingScheduleColumns">
                  <template #trigger_type-cell="{ row }">
                    <div>
                      <div class="text-sm">
                        {{ billingTriggerLabel((row.original as ContractBillingSchedule).trigger_type) }}
                      </div>
                      <div v-if="(row.original as ContractBillingSchedule).trigger_ref_code" class="text-xs text-muted">
                        {{ (row.original as ContractBillingSchedule).trigger_ref_code }}
                      </div>
                    </div>
                  </template>
                  <template #obligation_name-cell="{ row }">
                    <div class="min-w-44">
                      <div>{{ (row.original as ContractBillingSchedule).obligation_name || '-' }}</div>
                      <div v-if="(row.original as ContractBillingSchedule).obligation_status" class="text-xs text-muted mt-1">
                        {{ statusMeta(OBLIGATION_STATUS, (row.original as ContractBillingSchedule).obligation_status).label }}
                      </div>
                    </div>
                  </template>
                  <template #amount-cell="{ row }">
                    <span class="font-mono">{{ formatMoney((row.original as ContractBillingSchedule).amount) }}</span>
                  </template>
                  <template #status-cell="{ row }">
                    <UBadge :color="statusMeta(BILLING_STATUS, (row.original as ContractBillingSchedule).status).color as any" variant="subtle">
                      {{ statusMeta(BILLING_STATUS, (row.original as ContractBillingSchedule).status).label }}
                    </UBadge>
                  </template>
                  <template #source_type-cell="{ row }">
                    {{ sourceTypeLabel((row.original as ContractBillingSchedule).source_type) }}
                  </template>
                  <template #empty>
                    <div class="text-center py-6 text-muted text-sm">
                      合同签署后将按合同行和旧付款条款生成结算条件
                    </div>
                  </template>
                </UTable>
              </section>

              <section class="space-y-3 border-t border-muted pt-5">
                <div class="text-sm font-medium text-highlighted">
                  {{ receivableNodeLabel }}
                </div>
                <UTable :data="contract.receivable_plans || []" :columns="rpColumns">
                  <template #code-cell="{ row }">
                    <NuxtLink :to="`/payments/${(row.original as any).id}`" class="font-mono text-xs text-primary hover:underline">
                      {{ (row.original as any).code }}
                    </NuxtLink>
                  </template>
                  <template #plan_type-cell="{ row }">
                    {{ termTypeLabels[(row.original as any).plan_type] || (row.original as any).plan_type || '-' }}
                  </template>
                  <template #amount-cell="{ row }">
                    <span class="font-mono">{{ formatMoney((row.original as any).amount) }}</span>
                  </template>
                  <template #received_amount-cell="{ row }">
                    <span class="font-mono text-success">{{ formatMoney((row.original as any).received_amount) }}</span>
                  </template>
                  <template #unreceived_amount-cell="{ row }">
                    <span class="font-mono">{{ formatMoney((row.original as any).unreceived_amount) }}</span>
                  </template>
                  <template #status-cell="{ row }">
                    <UBadge :color="(RP_STATUS[(row.original as any).status]?.color || 'neutral') as any" variant="subtle" size="sm">
                      {{ RP_STATUS[(row.original as any).status]?.label || (row.original as any).status }}
                    </UBadge>
                  </template>
                  <template #actions-cell="{ row }">
                    <UButton
                      v-if="canRequestInvoiceForPlan(row.original)"
                      label="开票申请"
                      icon="i-lucide-file-plus-2"
                      size="xs"
                      variant="soft"
                      color="warning"
                      :loading="invoiceRequestLoadingCode === (row.original as any).code"
                      @click="requestInvoiceForPlan(row.original)"
                    />
                    <span v-else class="text-xs text-muted">-</span>
                  </template>
                  <template #empty>
                    <div class="text-center py-6 text-muted text-sm">
                      {{ normalizedContractStatus === 'effective' ? `合同生效后自动生成${receivableNodeLabel}` : `合同生效后将自动生成${receivableNodeLabel}` }}
                    </div>
                  </template>
                </UTable>
              </section>

              <section class="space-y-3 border-t border-muted pt-5">
                <div class="text-sm font-medium text-highlighted">
                  {{ paymentRecordLabel }}
                </div>
                <UTable :data="contract.payment_records || []" :columns="paymentRecordColumns">
                  <template #code-cell="{ row }">
                    <span class="font-mono text-xs">{{ (row.original as any).code }}</span>
                  </template>
                  <template #received_amount-cell="{ row }">
                    <span class="font-mono text-success">{{ formatMoney((row.original as any).received_amount) }}</span>
                  </template>
                  <template #received_at-cell="{ row }">
                    <span class="text-xs">{{ (row.original as any).received_at || '-' }}</span>
                  </template>
                  <template #empty>
                    <div class="text-center py-6 text-muted text-sm">
                      暂无{{ paymentRecordLabel }}
                    </div>
                  </template>
                </UTable>
              </section>

              <section class="space-y-4 border-t border-muted pt-5">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="font-semibold text-sm">
                      发票记录
                    </div>
                    <div class="text-xs text-muted mt-0.5">
                      {{ contract.code }} · {{ contract.customer_name || '-' }}
                    </div>
                  </div>
                  <UButton
                    v-if="canRequestInvoiceForContract"
                    label="申请发票"
                    icon="i-lucide-file-plus-2"
                    color="warning"
                    size="sm"
                    @click="openContractInvoiceRequest"
                  />
                </div>

                <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      已开票金额
                    </div>
                    <div class="mt-1 text-lg font-bold font-mono">
                      {{ formatMoney(invoiceSummary?.invoiceAmount) }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      发票余额
                    </div>
                    <div class="mt-1 text-lg font-bold font-mono" :class="Number(invoiceBalance) > 0 ? 'text-warning' : ''">
                      {{ formatMoney(invoiceBalance) }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      已到账金额
                    </div>
                    <div class="mt-1 text-lg font-bold font-mono">
                      {{ formatMoney(invoiceSummary?.receivedAmount) }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      已核销金额
                    </div>
                    <div class="mt-1 text-lg font-bold font-mono">
                      {{ formatMoney(invoiceSummary?.reconciledAmount) }}
                    </div>
                  </div>
                  <div class="rounded-md border border-default p-3">
                    <div class="text-xs text-muted">
                      未核销金额
                    </div>
                    <div class="mt-1 text-lg font-bold font-mono" :class="Number(invoiceSummary?.unreconciledAmount || 0) > 0 ? 'text-warning' : ''">
                      {{ formatMoney(invoiceSummary?.unreconciledAmount) }}
                    </div>
                  </div>
                </div>

                <UAlert
                  v-if="invoiceData?.warning"
                  color="warning"
                  variant="soft"
                  title="Finance 发票数据暂不可用"
                  :description="invoiceData.warning"
                />

                <div class="overflow-x-auto">
                  <UTable
                    :data="contractInvoices"
                    :columns="invoiceColumns"
                    :loading="invoiceStatus === 'pending'"
                    class="min-w-[860px]"
                  >
                    <template #code-cell="{ row }">
                      <span class="font-mono text-xs">{{ (row.original as any).code }}</span>
                    </template>
                    <template #invoice_no-cell="{ row }">
                      <span class="font-mono text-xs">{{ (row.original as any).invoice_no || '-' }}</span>
                    </template>
                    <template #invoice_type-cell="{ row }">
                      {{ invoiceTypeLabels[(row.original as any).invoice_type] || (row.original as any).invoice_type || '-' }}
                    </template>
                    <template #invoice_medium-cell="{ row }">
                      {{ invoiceMediumLabels[(row.original as any).invoice_medium] || (row.original as any).invoice_medium || '-' }}
                    </template>
                    <template #invoice_amount-cell="{ row }">
                      <div class="text-right font-mono">
                        {{ formatMoney((row.original as any).invoice_amount) }}
                      </div>
                    </template>
                    <template #tax_amount-cell="{ row }">
                      <div class="text-right font-mono">
                        {{ formatMoney((row.original as any).tax_amount) }}
                      </div>
                    </template>
                    <template #invoice_date-cell="{ row }">
                      <span class="text-xs">{{ (row.original as any).invoice_date || '-' }}</span>
                    </template>
                    <template #invoice_file_url-cell="{ row }">
                      <UButton
                        size="xs"
                        icon="i-lucide-file-text"
                        color="neutral"
                        variant="soft"
                        :loading="invoicePreviewLoadingUrl === invoiceFileUrl(row.original as any)"
                        @click="openInvoiceFile(row.original as any)"
                      >
                        {{ invoiceFileUrl(row.original as any) ? '查看' : '未上传' }}
                      </UButton>
                    </template>
                    <template #status-cell="{ row }">
                      <UBadge :color="(invoiceStatusLabels[(row.original as any).status]?.color || 'neutral') as any" variant="subtle" size="sm">
                        {{ invoiceStatusLabels[(row.original as any).status]?.label || (row.original as any).status || '-' }}
                      </UBadge>
                    </template>
                    <template #empty>
                      <div class="text-center py-6 text-muted text-sm">
                        暂无已开具发票
                      </div>
                    </template>
                  </UTable>
                </div>
              </section>
            </div>
          </UCard>

          <!-- 管理 -->
          <UCard v-if="activeTab === 'management' && hasSystemAdminAccess">
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="font-semibold text-sm">
                    合同管理
                  </div>
                  <div class="text-xs text-muted mt-0.5">
                    仅系统管理员可见，操作会写入合同操作记录。
                  </div>
                </div>
                <UBadge color="warning" variant="subtle" size="sm">
                  管理员
                </UBadge>
              </div>
            </template>

            <div class="space-y-5">
              <UAlert
                color="warning"
                variant="soft"
                title="谨慎操作"
                description="以下动作会直接变更合同、回款计划、到账记录或发票记录，请确认业务事实后执行。"
                icon="i-lucide-triangle-alert"
              />

              <section class="rounded-md border border-default p-4">
                <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div class="min-w-0">
                    <div class="font-medium text-sm">
                      强制设置为完成
                    </div>
                    <div class="text-xs text-muted mt-1 leading-5">
                      如存在应收未收，按合同到期日期补记一条回款记录；如存在发票余额，按合同到期日期补记一条开票记录，并将合同状态改为已完成。
                    </div>
                    <div class="mt-2 grid grid-cols-1 gap-2 text-xs text-muted md:grid-cols-3">
                      <span>到期日期：{{ contract.end_date || '未设置，将使用当前日期' }}</span>
                      <span>应收未收：{{ formatMoney(uncollectedReceivableAmount) }}</span>
                      <span>发票余额：{{ formatMoney(invoiceBalance) }}</span>
                    </div>
                    <div v-if="managementDisabledReason('force_complete')" class="mt-2 text-xs text-warning">
                      {{ managementDisabledReason('force_complete') }}
                    </div>
                  </div>
                  <UButton
                    label="强制完成"
                    icon="i-lucide-check-check"
                    color="success"
                    variant="soft"
                    :disabled="!!managementDisabledReason('force_complete')"
                    :loading="managementLoadingAction === 'force_complete'"
                    @click="submitContractManagement('force_complete')"
                  />
                </div>
              </section>

              <section class="rounded-md border border-default p-4">
                <div class="space-y-3">
                  <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div class="min-w-0">
                      <div class="font-medium text-sm">
                        终止合同
                      </div>
                      <div class="text-xs text-muted mt-1 leading-5">
                        仅适用于已部分回款且仍有未回款金额的合同。执行后合同状态变为已终止，未回款部分记为坏账。
                      </div>
                      <div class="mt-2 grid grid-cols-1 gap-2 text-xs text-muted md:grid-cols-2">
                        <span>已回款：{{ formatMoney(receivedTotal) }}</span>
                        <span>坏账金额：{{ formatMoney(terminationBadDebtAmount) }}</span>
                      </div>
                      <div v-if="managementDisabledReason('terminate')" class="mt-2 text-xs text-warning">
                        {{ managementDisabledReason('terminate') }}
                      </div>
                    </div>
                    <UButton
                      label="终止合同"
                      icon="i-lucide-ban"
                      color="warning"
                      variant="soft"
                      :disabled="!!managementDisabledReason('terminate')"
                      :loading="managementLoadingAction === 'terminate'"
                      @click="submitContractManagement('terminate')"
                    />
                  </div>
                  <UFormField label="终止原因" required>
                    <UTextarea
                      v-model="managementReason.terminate"
                      :rows="3"
                      placeholder="请填写终止原因"
                      class="w-full"
                      :disabled="!!managementDisabledReason('terminate')"
                    />
                  </UFormField>
                </div>
              </section>

              <section class="rounded-md border border-default p-4">
                <div class="space-y-3">
                  <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div class="min-w-0">
                      <div class="font-medium text-sm">
                        作废合同
                      </div>
                      <div class="text-xs text-muted mt-1 leading-5">
                        仅适用于未回款且未开发票的合同。执行后合同状态变为无效，并清理仍有效的回款计划。
                      </div>
                      <div class="mt-2 grid grid-cols-1 gap-2 text-xs text-muted md:grid-cols-2">
                        <span>已回款：{{ formatMoney(receivedTotal) }}</span>
                        <span>已开票：{{ formatMoney(invoiceTotal) }}</span>
                      </div>
                      <div v-if="managementDisabledReason('invalidate')" class="mt-2 text-xs text-warning">
                        {{ managementDisabledReason('invalidate') }}
                      </div>
                    </div>
                    <UButton
                      label="作废合同"
                      icon="i-lucide-file-x-2"
                      color="error"
                      variant="soft"
                      :disabled="!!managementDisabledReason('invalidate')"
                      :loading="managementLoadingAction === 'invalidate'"
                      @click="submitContractManagement('invalidate')"
                    />
                  </div>
                  <UFormField label="作废原因" required>
                    <UTextarea
                      v-model="managementReason.invalidate"
                      :rows="3"
                      placeholder="请填写作废原因"
                      class="w-full"
                      :disabled="!!managementDisabledReason('invalidate')"
                    />
                  </UFormField>
                </div>
              </section>
            </div>
          </UCard>

          <UCard v-else-if="activeTab === 'management'">
            <UAlert
              color="warning"
              variant="soft"
              title="暂无管理权限"
              description="合同管理操作仅系统管理员可用。"
              icon="i-lucide-shield-alert"
            />
          </UCard>

          <UCard v-if="activeTab === 'audit'">
            <template #header>
              <span class="font-semibold text-sm">操作</span>
            </template>
            <AuditTimeline entity-type="contract" :entity-id="Number(id)" />
          </UCard>
        </div>
      </div>

      <div v-else class="p-6">
        <UAlert
          color="warning"
          variant="soft"
          title="未找到合同"
          description="当前合同不存在，或你暂时没有访问权限。"
          icon="i-lucide-file-question"
        />
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="contractBasicEditOpen" title="编辑基本信息" :ui="{ content: 'sm:max-w-4xl overflow-visible' }">
    <template #content>
      <UCard :ui="{ root: 'overflow-visible', body: 'overflow-visible' }">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-semibold">
                编辑基本信息
              </div>
              <div class="text-xs text-muted mt-0.5">
                {{ contract?.code }} · {{ contract?.customer_name || '-' }}
              </div>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              title="关闭"
              @click="contractBasicEditOpen = false"
            />
          </div>
        </template>

        <form class="space-y-5" @submit.prevent="submitContractBasicEdit">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="合同名称" required class="md:col-span-2">
              <UInput v-model="contractBasicEditForm.name" placeholder="合同名称" class="w-full" />
            </UFormField>
            <UFormField label="合同方向">
              <USelect v-model="contractBasicEditForm.direction" :items="contractDirectionOptions" class="w-full" />
            </UFormField>
            <UFormField label="协议形式">
              <USelect v-model="contractBasicEditForm.agreement_form" :items="agreementFormOptions" class="w-full" />
            </UFormField>
            <UFormField label="合同角色">
              <UCheckbox
                v-model="contractBasicEditForm.is_master_contract"
                label="设为主合同"
                :disabled="!!contractBasicEditForm.parent_contract_id"
              />
            </UFormField>
            <UFormField label="主合同">
              <div class="space-y-2">
                <USelect
                  :model-value="contractBasicEditForm.parent_contract_id ?? undefined"
                  :items="parentContractOptions"
                  searchable
                  placeholder="选择主合同"
                  class="w-full"
                  @update:model-value="(value: number | string | undefined) => { contractBasicEditForm.parent_contract_id = value == null ? null : Number(value) }"
                  @update:search-term="(value: string) => parentContractKeyword = value"
                />
                <UButton
                  v-if="contractBasicEditForm.parent_contract_id"
                  label="清除主合同"
                  icon="i-lucide-unlink"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="contractBasicEditForm.parent_contract_id = null"
                />
              </div>
            </UFormField>

            <UFormField label="合同类型">
              <USelect
                v-model="contractBasicEditForm.template_code"
                :items="contractTemplateOptions"
                placeholder="选择合同类型"
                class="w-full"
              />
            </UFormField>
            <UFormField label="合同金额(含税/元)">
              <UInput
                v-model.number="contractBasicEditForm.amount_tax_inclusive"
                type="number"
                placeholder="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="发票类型">
              <USelect v-model="contractBasicEditForm.invoice_type" :items="invoiceTypeOptions" class="w-full" />
            </UFormField>
            <UFormField label="签约日期">
              <UInput v-model="contractBasicEditForm.sign_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="生效日期">
              <UInput v-model="contractBasicEditForm.effective_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="到期日期">
              <UInput v-model="contractBasicEditForm.end_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="负责人">
              <UserPicker v-model="contractBasicEditForm.owner_user_id" />
            </UFormField>
          </div>

          <div class="flex justify-end gap-2 border-t border-muted pt-4">
            <UButton
              label="取消"
              color="neutral"
              variant="soft"
              :disabled="contractBasicEditSubmitting"
              @click="contractBasicEditOpen = false"
            />
            <UButton
              type="submit"
              label="保存"
              icon="i-lucide-check"
              color="primary"
              :loading="contractBasicEditSubmitting"
            />
          </div>
        </form>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="projectLinkModalOpen" title="关联已有 Aims 项目" :ui="{ content: 'sm:max-w-3xl' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-semibold">
                关联已有 Aims 项目
              </div>
              <div class="text-xs text-muted mt-0.5">
                {{ contract?.code }} · {{ contract?.customer_name || '-' }}
              </div>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              title="关闭"
              @click="projectLinkModalOpen = false"
            />
          </div>
        </template>

        <div class="space-y-4">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-[1fr_9rem_auto]">
            <UInput
              v-model="projectLinkSearch"
              icon="i-lucide-search"
              placeholder="项目编码、名称"
              class="w-full"
              @keyup.enter="loadEligibleAimsProjects"
            />
            <USelect
              v-model="projectLinkRole"
              :items="projectLinkRoleOptions"
              class="w-full"
            />
            <UButton
              label="查询"
              icon="i-lucide-search"
              color="neutral"
              variant="soft"
              :loading="eligibleProjectLoading"
              @click="loadEligibleAimsProjects"
            />
          </div>

          <div v-if="eligibleProjectLoading" class="space-y-2">
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-10 w-full" />
          </div>
          <div v-else class="space-y-3">
            <UFormField label="项目">
              <USelect
                v-model="selectedProjectCode"
                :items="eligibleProjectOptions"
                class="w-full"
                placeholder="选择项目"
              />
            </UFormField>

            <div v-if="selectedEligibleProject" class="rounded-md border border-default p-3 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs text-primary">{{ selectedEligibleProject.project_code }}</span>
                <span class="font-medium">{{ selectedEligibleProject.name || selectedEligibleProject.short_name || '-' }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ selectedEligibleProject.lifecycle_status || '-' }}
                </UBadge>
              </div>
              <div class="mt-2 grid grid-cols-1 gap-2 text-xs text-muted md:grid-cols-3">
                <span>部门：{{ selectedEligibleProject.dept_code || '-' }}</span>
                <span>负责人：{{ selectedEligibleProject.leader_uid || '-' }}</span>
                <span>原因：{{ selectedEligibleProject.eligible_reason || '-' }}</span>
              </div>
            </div>
            <div v-else class="rounded-md border border-dashed border-muted p-6 text-center text-sm text-muted">
              暂无可关联项目
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              color="neutral"
              variant="ghost"
              @click="projectLinkModalOpen = false"
            />
            <UButton
              label="关联项目"
              icon="i-lucide-link"
              color="primary"
              :loading="projectLinkSubmitting"
              :disabled="!selectedProjectCode"
              @click="submitExistingProjectLink"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="contractInvoiceRequestOpen" title="申请发票" :ui="{ content: 'sm:max-w-4xl overflow-hidden' }">
    <template #content>
      <UCard
        :ui="{
          root: 'flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-h-[calc(100dvh-4rem)]',
          header: 'shrink-0',
          body: 'min-h-0 flex-1 overflow-y-auto',
          footer: 'shrink-0 bg-default'
        }"
      >
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-semibold">
                申请发票
              </div>
              <div class="text-xs text-muted mt-0.5">
                {{ contract?.code }} · 发票余额 {{ formatMoney(invoiceBalance) }}
              </div>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              title="关闭"
              @click="contractInvoiceRequestOpen = false"
            />
          </div>
        </template>

        <div class="space-y-5">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <UFormField label="发票类型" required>
              <USelect
                v-model="contractInvoiceRequestForm.invoiceType"
                :items="invoiceTypeOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="介质形式" required>
              <USelect
                v-model="contractInvoiceRequestForm.invoiceMedium"
                :items="invoiceMediumOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="开票金额" required>
              <UInput
                v-model="contractInvoiceRequestForm.requestedAmount"
                type="number"
                min="0"
                step="0.01"
                class="w-full"
              />
            </UFormField>
            <UFormField label="开票内容" required>
              <UInput
                v-model="contractInvoiceRequestForm.invoiceItem"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="申请备注">
            <UTextarea
              v-model="contractInvoiceRequestForm.remark"
              :rows="2"
              class="w-full"
            />
          </UFormField>

          <div class="rounded-md border border-default p-4">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <div class="font-medium text-sm">
                  客户开票信息
                </div>
                <div class="text-xs text-muted mt-0.5">
                  {{ contract?.customer_name || '-' }}
                </div>
              </div>
              <UButton
                label="保存开票信息"
                icon="i-lucide-save"
                size="sm"
                color="neutral"
                variant="soft"
                :loading="contractInvoiceInfoSaving"
                :disabled="contractInvoiceInfoLoading"
                @click="saveContractInvoiceInfoFromModal"
              />
            </div>

            <div v-if="contractInvoiceInfoLoading" class="space-y-3">
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-20 w-full" />
            </div>
            <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UFormField label="发票抬头" required>
                <UInput
                  v-model="contractInvoiceInfoForm.taxpayer_name"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="纳税人识别号" required>
                <UInput
                  v-model="contractInvoiceInfoForm.taxpayer_no"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="默认发票类型">
                <USelect
                  v-model="contractInvoiceInfoForm.invoice_type"
                  :items="invoiceTypeOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="收票邮箱">
                <UInput
                  v-model="contractInvoiceInfoForm.invoice_email"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="注册地址">
                <UInput
                  v-model="contractInvoiceInfoForm.registered_address"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="注册电话">
                <UInput
                  v-model="contractInvoiceInfoForm.registered_phone"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="开户行">
                <UInput
                  v-model="contractInvoiceInfoForm.bank_name"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="银行账号">
                <UInput
                  v-model="contractInvoiceInfoForm.bank_account"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="收票人">
                <UInput
                  v-model="contractInvoiceInfoForm.receiver_name"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="收票电话">
                <UInput
                  v-model="contractInvoiceInfoForm.receiver_phone"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="收票地址" class="md:col-span-2">
                <UInput
                  v-model="contractInvoiceInfoForm.receiver_address"
                  class="w-full"
                />
              </UFormField>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              color="neutral"
              variant="ghost"
              @click="contractInvoiceRequestOpen = false"
            />
            <UButton
              label="提交申请"
              icon="i-lucide-send"
              color="warning"
              :loading="contractInvoiceRequestSubmitting"
              @click="submitContractInvoiceRequest"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="invoicePreviewOpen" :title="invoicePreviewTitle" :ui="{ content: 'sm:max-w-6xl' }">
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

  <UModal v-model:open="stageModalOpen" :title="STAGE_LABELS[stageForm.stage_type] || '处理合同环节'">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">{{ STAGE_LABELS[stageForm.stage_type] || '处理合同环节' }}</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="stageModalOpen = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="处理日期">
            <UInput v-model="stageForm.stage_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="证明文档 UUID">
            <UInput v-model="stageForm.document_uuid" placeholder="Codocs 文档 UUID" class="w-full" />
          </UFormField>
          <UFormField label="证明文档标题">
            <UInput v-model="stageForm.document_title" placeholder="如：验收报告" class="w-full" />
          </UFormField>
          <UFormField label="说明">
            <UTextarea
              v-model="stageForm.evidence_note"
              :rows="3"
              placeholder="补充说明"
              class="w-full"
            />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              color="neutral"
              variant="ghost"
              @click="stageModalOpen = false"
            />
            <UButton
              label="提交"
              color="primary"
              icon="i-lucide-check"
              :loading="stageSubmitting"
              @click="submitStage"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
