<script setup lang="ts">
import { CUSTOMER_STATUS_OPTIONS, DECISION_ROLE_OPTIONS, OPPORTUNITY_STATUS_OPTIONS } from '~/types/altoc'
import type { Contact, ContactForm, Customer, Industry, Region } from '~/types/altoc'
import { customerWorkflowActionConfigs } from '~/utils/customerWorkflow'
import type { CustomerWorkflowActionCode } from '~/utils/customerWorkflow'
import { unwrapApiList } from '~/utils/apiResponse'

type UnknownRecord = Record<string, unknown>
type RowKey = string | number

interface DisplayRow extends UnknownRecord {
  id?: RowKey
  code?: string | null
  name?: string | null
  status?: string | null
  amount?: number | string | null
  amount_tax_inclusive?: number | string | null
  sign_date?: string | null
  stage_name?: string | null
  expected_sign_date?: string | null
  contract_name?: string | null
  contract_code?: string | null
  maintenance_contract_code?: string | null
  delivery_code?: string | null
  delivery_name?: string | null
  project_code?: string | null
  service_start_date?: string | null
  service_end_date?: string | null
  service_level?: string | null
  response_minutes?: number | string | null
  resolution_minutes?: number | string | null
  consumed_quota?: number | string | null
  included_quota?: number | string | null
  quota_unit?: string | null
  renewal_remind_at?: string | null
  service_window?: string | null
  priority?: string | null
  expected_amount?: number | string | null
  go_live_at?: string | null
  accepted_at?: string | null
}

interface ServiceTicketRow extends DisplayRow {
  title?: string | null
  ticket_type?: string | null
  sla_status?: string | null
  entitlement_status?: string | null
  service_agreement_code?: string | null
  delivery_asset_code?: string | null
  aims_work_item_key?: string | null
  codocs_document_uuid?: string | null
}

type CustomerDetail = Customer & {
  telephone?: string | null
  stats?: {
    opportunity_active?: number | null
    opportunity_won_amount?: number | string | null
    contract_amount?: number | string | null
    total_received?: number | string | null
  }
  contacts?: Contact[]
}

interface AimsWorkItemResponse {
  data?: {
    created?: boolean
  }
}

interface ApiResponse<T> {
  data: T
}

interface ApiEnvelope<T> {
  data?: T
}

interface PageData<T> {
  items?: T[]
}

interface ServiceOperationsView {
  summary?: UnknownRecord
  maintenanceContracts?: DisplayRow[]
  serviceEntitlements?: DisplayRow[]
  serviceAgreements?: DisplayRow[]
  serviceTickets?: ServiceTicketRow[]
  renewalOpportunities?: DisplayRow[]
}

interface DeliveryPackageView {
  items?: DisplayRow[]
}

interface MaintenanceFinanceView {
  summary?: UnknownRecord
}

interface ApiErrorShape {
  data?: {
    message?: string
    statusMessage?: string
  }
  message?: string
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

interface CustomerInvoiceInfoForm {
  taxpayer_name: string
  taxpayer_no: string
  registered_address: string
  registered_phone: string
  bank_name: string
  bank_account: string
  invoice_type: string
  invoice_email: string
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  remark: string
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user: authUser } = useAuth()
const { isApprovalMode } = useApprovalMode()
const customerId = computed(() => String(route.params.id || ''))
const customerIdNumber = computed(() => Number(customerId.value) || 0)

function responseItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as PageData<T>).items)) {
    return (payload as PageData<T>).items || []
  }
  return []
}

function apiData<T>(payload: unknown): T | undefined {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data
  }
  return undefined
}

function unwrapDataOrSelf<T>(payload: unknown): T {
  return apiData<T>(payload) || payload as T
}

// 加载客户详情
const { data: customer, status, refresh } = useFetch(() => `/api/v1/customers/${customerId.value}`, {
  transform: (res: unknown) => apiData<CustomerDetail>(res)
})

// 行业/区域字典（来自 account 模块，通过 altoc 的 config 代理）
const { data: industries } = useFetch('/api/v1/config/industries', { transform: (res: unknown) => unwrapApiList<Industry>(res) })
const { data: regions } = useFetch('/api/v1/config/regions', { transform: (res: unknown) => unwrapApiList<Region>(res) })
const industryNameByCode = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const i of (industries.value || [])) m[i.code] = i.name
  return m
})
const regionNameByCode = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const r of (regions.value || [])) m[r.code] = r.name
  return m
})

// 加载关联商机
const { data: customerOpps } = useFetch(() => `/api/v1/opportunities?customer_id=${customerId.value}&pageSize=50`, {
  transform: (res: unknown) => responseItems<DisplayRow>(apiData<PageData<DisplayRow>>(res))
})

// 加载关联合同
const { data: customerContracts } = useFetch(() => `/api/v1/contracts?customer_id=${customerId.value}&pageSize=50`, {
  transform: (res: unknown) => responseItems<DisplayRow>(apiData<PageData<DisplayRow>>(res))
})

const customerCode = computed(() => String(customer.value?.code || ''))
const serviceLoading = ref(false)
const maintenanceView = ref<ServiceOperationsView | null>(null)
const deliveryPackage = ref<DeliveryPackageView | null>(null)
const maintenanceFinance = ref<MaintenanceFinanceView | null>(null)
const serviceLoadError = ref('')

const maintenanceContracts = computed(() => maintenanceView.value?.maintenanceContracts || [])
const serviceAgreements = computed(() => maintenanceView.value?.serviceAgreements || [])
const serviceEntitlements = computed(() => maintenanceView.value?.serviceEntitlements || [])
const serviceTickets = computed(() => maintenanceView.value?.serviceTickets || [])
const renewalOpportunities = computed(() => maintenanceView.value?.renewalOpportunities || [])
const deliveryItems = computed(() => deliveryPackage.value?.items || [])
const financeSummary = computed(() => maintenanceFinance.value?.summary || {})
const syncingTicketCodes = ref<Record<string, boolean>>({})
const serviceLoadedCode = ref('')

async function loadServiceOperations(code: string) {
  if (!code) return
  serviceLoadedCode.value = code
  serviceLoading.value = true
  serviceLoadError.value = ''
  try {
    const [maintenance, deliveries, finance] = await Promise.allSettled([
      $fetch<unknown>(`/api/v1/customers/${encodeURIComponent(code)}/maintenance-summary`),
      $fetch<unknown>(`/api/v1/customers/${encodeURIComponent(code)}/delivery-package`),
      $fetch<unknown>(`/api/v1/customers/${encodeURIComponent(code)}/maintenance-financial-summary`)
    ])
    if (maintenance.status === 'fulfilled') maintenanceView.value = unwrapDataOrSelf<ServiceOperationsView>(maintenance.value)
    if (deliveries.status === 'fulfilled') deliveryPackage.value = unwrapDataOrSelf<DeliveryPackageView>(deliveries.value)
    if (finance.status === 'fulfilled') maintenanceFinance.value = unwrapDataOrSelf<MaintenanceFinanceView>(finance.value)
    const rejected = [maintenance, deliveries, finance].find(item => item.status === 'rejected') as PromiseRejectedResult | undefined
    if (rejected) {
      const reason = rejected.reason as ApiErrorShape
      serviceLoadError.value = reason?.data?.message || reason?.message || '部分服务运营数据加载失败'
    }
  } finally {
    serviceLoading.value = false
  }
}

// Tab 管理
const activeTab = ref('opportunities')
const tabs = [
  { label: '基本信息', value: 'info', icon: 'i-lucide-info' },
  { label: '联系人', value: 'contacts', icon: 'i-lucide-users' },
  { label: '开票信息', value: 'invoice-info', icon: 'i-lucide-receipt-text' },
  { label: '商机', value: 'opportunities', icon: 'i-lucide-trending-up' },
  { label: '合同', value: 'contracts', icon: 'i-lucide-file-signature' },
  { label: '服务运营', value: 'service', icon: 'i-lucide-headphones' },
  { label: '操作历史', value: 'audit', icon: 'i-lucide-history' }
]

watch([activeTab, customerCode], ([tab, code]) => {
  if (tab === 'service' && code && serviceLoadedCode.value !== code) {
    loadServiceOperations(code)
  }
}, { immediate: true })

const invoiceInfoForm = reactive<CustomerInvoiceInfoForm>({
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

const invoiceInfoSaving = ref(false)
const invoiceTypeOptions = [
  { label: '专用发票', value: 'special_vat' },
  { label: '普通发票', value: 'general_vat' },
  { label: '电子发票', value: 'electronic' }
]

const { data: invoiceInfo, status: invoiceInfoStatus, refresh: refreshInvoiceInfo } = useFetch(() => `/api/v1/customers/${customerId.value}/invoice-infos?pageSize=1`, {
  transform: (res: ApiResponse<PageData<CustomerInvoiceInfo> | CustomerInvoiceInfo[]>) => responseItems<CustomerInvoiceInfo>(res.data)[0] || null,
  default: () => null
})

function resetInvoiceInfoForm(info: CustomerInvoiceInfo | null | undefined) {
  invoiceInfoForm.taxpayer_name = info?.taxpayer_name || customer.value?.name || ''
  invoiceInfoForm.taxpayer_no = info?.taxpayer_no || ''
  invoiceInfoForm.registered_address = info?.registered_address || customer.value?.address || ''
  invoiceInfoForm.registered_phone = info?.registered_phone || customer.value?.telephone || ''
  invoiceInfoForm.bank_name = info?.bank_name || ''
  invoiceInfoForm.bank_account = info?.bank_account || ''
  invoiceInfoForm.invoice_type = info?.invoice_type || 'special_vat'
  invoiceInfoForm.invoice_email = info?.invoice_email || ''
  invoiceInfoForm.receiver_name = info?.receiver_name || ''
  invoiceInfoForm.receiver_phone = info?.receiver_phone || ''
  invoiceInfoForm.receiver_address = info?.receiver_address || customer.value?.address || ''
  invoiceInfoForm.remark = info?.remark || ''
}

watch([invoiceInfo, customer], ([info]) => {
  resetInvoiceInfoForm(info)
}, { immediate: true })

function invoiceInfoErrorMessage(error: unknown, fallback: string) {
  const source = error as ApiErrorShape
  return source?.data?.message || source?.data?.statusMessage || source?.message || fallback
}

function invoiceInfoPayload() {
  return {
    ...invoiceInfoForm,
    taxpayer_name: invoiceInfoForm.taxpayer_name.trim(),
    taxpayer_no: invoiceInfoForm.taxpayer_no.trim(),
    is_default: 1,
    status: 'active',
    updated_by: authUser.value || undefined,
    created_by: authUser.value || undefined
  }
}

async function saveInvoiceInfo() {
  if (!invoiceInfoForm.taxpayer_name.trim()) {
    toast.add({ title: '请输入发票抬头', color: 'error' })
    return
  }
  if (!invoiceInfoForm.taxpayer_no.trim()) {
    toast.add({ title: '请输入纳税人识别号', color: 'error' })
    return
  }

  invoiceInfoSaving.value = true
  try {
    const currentId = invoiceInfo.value?.id
    if (currentId) {
      await $fetch<unknown>(`/api/v1/customers/${customerId.value}/invoice-infos/${currentId}` as string, {
        method: 'PUT',
        body: invoiceInfoPayload()
      })
    } else {
      await $fetch<unknown>(`/api/v1/customers/${customerId.value}/invoice-infos` as string, {
        method: 'POST',
        body: invoiceInfoPayload()
      })
    }
    toast.add({ title: '开票信息已保存', color: 'success' })
    await refreshInvoiceInfo()
  } catch (error: unknown) {
    toast.add({ title: invoiceInfoErrorMessage(error, '保存开票信息失败'), color: 'error' })
  } finally {
    invoiceInfoSaving.value = false
  }
}

// 联系人弹窗
const showContactModal = ref(false)
const contactLoading = ref(false)
const contactForm = reactive<ContactForm>({
  customer_id: customerIdNumber.value,
  name: '',
  gender: 0,
  dept_name: '',
  job_title: '',
  mobile: '',
  phone: '',
  email: '',
  wechat: '',
  decision_role: '',
  influence_level: '',
  is_key_contact: 0,
  remark: ''
})

watch(customerIdNumber, (value) => {
  contactForm.customer_id = value
}, { immediate: true })

function resetContactForm() {
  contactForm.name = ''
  contactForm.gender = 0
  contactForm.dept_name = ''
  contactForm.job_title = ''
  contactForm.mobile = ''
  contactForm.phone = ''
  contactForm.email = ''
  contactForm.wechat = ''
  contactForm.decision_role = ''
  contactForm.influence_level = ''
  contactForm.is_key_contact = 0
  contactForm.remark = ''
}

async function createContact() {
  if (!contactForm.name.trim()) {
    toast.add({ title: '请输入联系人姓名', color: 'error' })
    return
  }
  contactLoading.value = true
  try {
    await $fetch<unknown>(`/api/v1/customers/${customerId.value}/contacts` as string, {
      method: 'POST',
      body: contactForm
    })
    toast.add({ title: '联系人添加成功', color: 'success' })
    showContactModal.value = false
    resetContactForm()
    refresh()
  } catch (err: unknown) {
    toast.add({ title: invoiceInfoErrorMessage(err, '添加失败'), color: 'error' })
  } finally {
    contactLoading.value = false
  }
}

function getStatusColor(s: string) {
  return CUSTOMER_STATUS_OPTIONS.find(o => o.value === s)?.color || 'neutral'
}
function getStatusLabel(s: string) {
  return CUSTOMER_STATUS_OPTIONS.find(o => o.value === s)?.label || s
}
function getRoleLabel(role: string) {
  return DECISION_ROLE_OPTIONS.find(o => o.value === role)?.label || role || '-'
}

function buildWorkflowAction(actionCode: CustomerWorkflowActionCode) {
  const config = customerWorkflowActionConfigs[actionCode]
  return {
    actionCode,
    actionName: config.name,
    canSubmit: computed(() => !!customer.value && customer.value.status === 'draft'),
    completenessIssues: computed(() => [] as string[]),
    async onSubmitted() {
      await $fetch(`/api/v1/customers/${customerId.value}`, {
        method: 'PUT',
        body: { status: 'approval_pending' }
      })
      toast.add({ title: `${config.submitLabel}已提交`, color: 'success' })
      await refresh()
    },
    async onApproved() {
      await $fetch(`/api/v1/customers/${customerId.value}`, {
        method: 'PUT',
        body: { status: 'approved' }
      })
      toast.add({ title: `${config.successLabel}已通过`, color: 'success' })
      await refresh()
    },
    async onRejected() {
      await $fetch(`/api/v1/customers/${customerId.value}`, {
        method: 'PUT',
        body: { status: 'draft' }
      })
      toast.add({ title: `${config.successLabel}已驳回`, color: 'warning' })
      await refresh()
    }
  }
}

const workflowActions = computed(() => {
  const currentStatus = customer.value?.status
  if (!currentStatus) return []
  if (currentStatus === 'draft' || currentStatus === 'approval_pending') {
    return [buildWorkflowAction('approve')]
  }
  return []
})

const canEditCustomer = computed(() => {
  return !!customer.value && !isApprovalMode.value && customer.value.status !== 'approval_pending'
})

function openCustomerEdit() {
  router.push(`/customers/${customerId.value}/edit`)
}

usePageWorkflow({
  appCode: 'altoc',
  resourceCode: 'customer',
  bizId: computed(() => customer.value ? String(customer.value.id) : ''),
  bizTitle: computed(() => customer.value?.name || ''),
  bizUrl: computed(() => {
    if (!import.meta.client || !customer.value) return ''
    return `${window.location.origin}/customers/${customer.value.id}`
  }),
  actions: workflowActions
})

async function syncCustomerStatusFromWorkflow() {
  if (!customer.value || customer.value.status !== 'approval_pending') return

  try {
    const workflowRes = await fetchInstanceByBiz({
      app_code: 'altoc',
      resource_code: 'customer',
      action_code: 'approve',
      biz_id: String(customer.value.id),
      include_history: true
    })

    const workflowStatus = workflowRes?.data?.status
    if (workflowStatus === 'approved') {
      await $fetch(`/api/v1/customers/${customerId.value}`, {
        method: 'PUT',
        body: { status: 'approved' }
      })
      await refresh()
    } else if (workflowStatus === 'rejected') {
      await $fetch(`/api/v1/customers/${customerId.value}`, {
        method: 'PUT',
        body: { status: 'draft' }
      })
      await refresh()
    }
  } catch {
    // 工作流状态同步失败不阻断页面显示
  }
}

onMounted(() => {
  syncCustomerStatusFromWorkflow()
})

watch(() => customer.value?.status, (value) => {
  if (value === 'approval_pending') {
    syncCustomerStatusFromWorkflow()
  }
})

function formatMoney(val: unknown) {
  if (val == null || val === '') return '--'
  const amount = Number(val)
  if (!Number.isFinite(amount)) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(amount)
}
function formatMoneyValue(val: unknown) {
  const number = Number(val ?? 0)
  if (!Number.isFinite(number)) return '--'
  return formatMoney(number)
}
function dateRange(start?: unknown, end?: unknown) {
  const left = String(start || '').slice(0, 10)
  const right = String(end || '').slice(0, 10)
  return [left, right].filter(Boolean).join(' ~ ') || '-'
}
function statusText(value: unknown) {
  return String(value || '-')
}
function rowKey(row: DisplayRow, fallback: RowKey) {
  return row.id ?? row.code ?? fallback
}
function documentCount(delivery: DisplayRow) {
  return Array.isArray(delivery.documents) ? delivery.documents.length : 0
}
function environmentCount(delivery: DisplayRow) {
  return Array.isArray(delivery.environments) ? delivery.environments.length : 0
}

function ticketCode(ticket: ServiceTicketRow) {
  return String(ticket?.code || ticket?.id || '').trim()
}

function isTicketSyncing(ticket: ServiceTicketRow) {
  return !!syncingTicketCodes.value[ticketCode(ticket)]
}

function syncErrorMessage(error: unknown) {
  const err = error as { data?: { message?: string, statusMessage?: string } }
  return err?.data?.message || err?.data?.statusMessage || '回流 Aims 失败'
}

async function syncTicketToAims(ticket: ServiceTicketRow) {
  const code = ticketCode(ticket)
  if (!code) {
    toast.add({ title: '服务工单缺少编号', color: 'error' })
    return
  }

  syncingTicketCodes.value = { ...syncingTicketCodes.value, [code]: true }
  try {
    const result = await $fetch<AimsWorkItemResponse>(`/api/v1/service-tickets/${encodeURIComponent(code)}/aims-work-item`, {
      method: 'POST',
      body: {
        ticket,
        customerCode: customerCode.value,
        customerName: customer.value?.name
      }
    })
    const created = result?.data?.created === true
    toast.add({
      title: created ? '已生成 Aims 工作项' : '已关联 Aims 工作项',
      color: 'success'
    })
    await loadServiceOperations(customerCode.value)
  } catch (err: unknown) {
    toast.add({
      title: syncErrorMessage(err),
      color: 'error'
    })
  } finally {
    syncingTicketCodes.value = Object.fromEntries(
      Object.entries(syncingTicketCodes.value).filter(([key]) => key !== code)
    )
  }
}

// 联系人表格列
const contactColumns = [
  { accessorKey: 'name', header: '姓名' },
  { accessorKey: 'job_title', header: '职位' },
  { accessorKey: 'mobile', header: '手机/电话' },
  { accessorKey: 'email', header: '邮箱' },
  { accessorKey: 'decision_role', header: '角色' },
  { accessorKey: 'is_key_contact', header: '关键人' }
]

const genderOptions = [
  { label: '未知', value: 0 },
  { label: '男', value: 1 },
  { label: '女', value: 2 }
]

const decisionRoleOptions = DECISION_ROLE_OPTIONS.map(o => ({ label: o.label, value: o.value }))

const influenceOptions = [
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' }
]
</script>

<template>
  <UDashboardPanel id="customer-detail">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/customers')"
        />
        <div v-if="customer" class="flex items-center gap-2">
          <span class="font-semibold">{{ customer.name }}</span>
          <UBadge :color="getStatusColor(customer.status)" variant="subtle" size="sm">
            {{ getStatusLabel(customer.status) }}
          </UBadge>
          <span class="text-xs text-muted font-mono">{{ customer.code }}</span>
        </div>
        <USkeleton v-else class="h-6 w-48" />
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          v-if="canEditCustomer"
          label="编辑"
          icon="i-lucide-pencil"
          variant="soft"
          color="primary"
          @click="openCustomerEdit"
        />
        <UButton
          v-if="customer && !isApprovalMode"
          label="新建商机"
          icon="i-lucide-plus"
          color="primary"
          @click="router.push(`/opportunities/new?customer_id=${customerId}`)"
        />
      </Teleport>

      <div v-if="status === 'pending'" class="p-6 space-y-4">
        <USkeleton class="h-32 w-full" />
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else-if="customer" class="p-4 space-y-4">
        <!-- 统计摘要 -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <UCard>
            <div class="text-center">
              <div class="text-2xl font-bold">
                {{ customer.stats?.opportunity_active || 0 }}
              </div>
              <div class="text-xs text-muted mt-1">
                进行中商机
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-2xl font-bold text-success">
                {{ formatMoney(customer.stats?.opportunity_won_amount) }}
              </div>
              <div class="text-xs text-muted mt-1">
                赢单金额
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-2xl font-bold">
                {{ formatMoney(customer.stats?.contract_amount) }}
              </div>
              <div class="text-xs text-muted mt-1">
                合同总额
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-2xl font-bold text-primary">
                {{ formatMoney(customer.stats?.total_received) }}
              </div>
              <div class="text-xs text-muted mt-1">
                累计回款
              </div>
            </div>
          </UCard>
        </div>

        <!-- Tabs -->
        <UTabs v-model="activeTab" :items="tabs" class="w-full" />

        <!-- 基本信息 -->
        <UCard v-if="activeTab === 'info'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
            <div class="flex">
              <span class="text-muted w-24 shrink-0">客户类型</span><span>{{ customer.customer_type_name || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">所属行业</span><span>{{ (customer.industry_code && industryNameByCode[customer.industry_code]) || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">所属区域</span><span>{{ (customer.region_code && regionNameByCode[customer.region_code]) || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">所在省市</span><span>{{ [customer.province, customer.city].filter(Boolean).join(' / ') || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">客户等级</span><span>{{ customer.customer_level_name || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">来源渠道</span><span>{{ customer.source_type || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">信用等级</span><span>{{ customer.credit_level || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">负责人</span><UserName :uid="customer.owner_user_id" />
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">官网</span>
              <a
                v-if="customer.website"
                :href="customer.website"
                target="_blank"
                class="text-primary hover:underline"
              >{{ customer.website }}</a>
              <span v-else>-</span>
            </div>
            <div class="flex md:col-span-2">
              <span class="text-muted w-24 shrink-0">地址</span><span>{{ customer.address || '-' }}</span>
            </div>
            <div class="flex md:col-span-2">
              <span class="text-muted w-24 shrink-0">描述</span><span>{{ customer.description || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">创建时间</span><span class="text-xs">{{ customer.created_at }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">更新时间</span><span class="text-xs">{{ customer.updated_at }}</span>
            </div>
          </div>
        </UCard>

        <!-- 联系人 -->
        <UCard v-if="activeTab === 'contacts'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">联系人 ({{ customer.contacts?.length || 0 }})</span>
              <UButton
                label="新增联系人"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="showContactModal = true"
              />
            </div>
          </template>
          <UTable
            :data="customer.contacts || []"
            :columns="contactColumns"
          >
            <template #name-cell="{ row }">
              <div class="flex items-center gap-1">
                <span>{{ row.original.name }}</span>
                <UBadge
                  v-if="row.original.is_key_contact"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  关键人
                </UBadge>
              </div>
            </template>
            <template #decision_role-cell="{ row }">
              {{ getRoleLabel(String(row.original.decision_role || '')) }}
            </template>
            <template #is_key_contact-cell="{ row }">
              <UIcon v-if="row.original.is_key_contact" name="i-lucide-star" class="text-warning" />
            </template>
            <template #mobile-cell="{ row }">
              <div class="space-y-0.5">
                <div>{{ row.original.mobile || '-' }}</div>
                <div v-if="row.original.phone" class="text-xs text-muted">
                  {{ row.original.phone }}
                </div>
              </div>
            </template>
            <template #email-cell="{ row }">
              {{ row.original.email || '-' }}
            </template>
            <template #empty>
              <div class="text-center py-8 text-muted text-sm">
                <p>暂无联系人</p>
              </div>
            </template>
          </UTable>
        </UCard>

        <!-- 开票信息 -->
        <UCard v-if="activeTab === 'invoice-info'">
          <template #header>
            <div class="flex items-center justify-between">
              <div>
                <div class="font-semibold text-sm">
                  客户开票信息
                </div>
              </div>
              <UButton
                label="保存"
                icon="i-lucide-check"
                size="sm"
                color="primary"
                :loading="invoiceInfoSaving"
                :disabled="invoiceInfoStatus === 'pending'"
                @click="saveInvoiceInfo"
              />
            </div>
          </template>

          <div v-if="invoiceInfoStatus === 'pending'" class="space-y-3">
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-24 w-full" />
          </div>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="发票抬头" required>
              <UInput
                v-model="invoiceInfoForm.taxpayer_name"
                placeholder="请输入购方名称/发票抬头"
                class="w-full"
              />
            </UFormField>
            <UFormField label="纳税人识别号" required>
              <UInput
                v-model="invoiceInfoForm.taxpayer_no"
                placeholder="统一社会信用代码/税号"
                class="w-full"
              />
            </UFormField>
            <UFormField label="默认发票类型">
              <USelect
                v-model="invoiceInfoForm.invoice_type"
                :items="invoiceTypeOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="收票邮箱">
              <UInput
                v-model="invoiceInfoForm.invoice_email"
                placeholder="用于接收电子发票"
                class="w-full"
              />
            </UFormField>
            <UFormField label="注册地址">
              <UInput
                v-model="invoiceInfoForm.registered_address"
                placeholder="税务登记地址"
                class="w-full"
              />
            </UFormField>
            <UFormField label="注册电话">
              <UInput
                v-model="invoiceInfoForm.registered_phone"
                placeholder="税务登记电话"
                class="w-full"
              />
            </UFormField>
            <UFormField label="开户行">
              <UInput
                v-model="invoiceInfoForm.bank_name"
                placeholder="开户银行"
                class="w-full"
              />
            </UFormField>
            <UFormField label="银行账号">
              <UInput
                v-model="invoiceInfoForm.bank_account"
                placeholder="银行账号"
                class="w-full"
              />
            </UFormField>
            <UFormField label="收票人">
              <UInput
                v-model="invoiceInfoForm.receiver_name"
                placeholder="收票联系人"
                class="w-full"
              />
            </UFormField>
            <UFormField label="收票电话">
              <UInput
                v-model="invoiceInfoForm.receiver_phone"
                placeholder="收票联系电话"
                class="w-full"
              />
            </UFormField>
            <UFormField label="收票地址" class="md:col-span-2">
              <UInput
                v-model="invoiceInfoForm.receiver_address"
                placeholder="纸票邮寄地址"
                class="w-full"
              />
            </UFormField>
            <UFormField label="备注" class="md:col-span-2">
              <UTextarea
                v-model="invoiceInfoForm.remark"
                placeholder="其他开票要求"
                :rows="3"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>

        <!-- 商机 -->
        <UCard v-if="activeTab === 'opportunities'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">关联商机 ({{ customerOpps?.length || 0 }})</span>
              <UButton
                label="新建商机"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="router.push(`/opportunities/new?customer_id=${customerId}`)"
              />
            </div>
          </template>
          <div v-if="customerOpps?.length" class="divide-y divide-default">
            <NuxtLink
              v-for="opp in customerOpps"
              :key="opp.id"
              :to="`/opportunities/${opp.id}`"
              class="flex items-center justify-between py-2.5 hover:bg-elevated/50 -mx-4 px-4 transition-colors"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ opp.name }}</span>
                  <UBadge :color="OPPORTUNITY_STATUS_OPTIONS.find(o => o.value === opp.status)?.color || 'neutral'" variant="subtle" size="xs">
                    {{ opp.stage_name }}
                  </UBadge>
                </div>
                <span class="text-xs text-muted font-mono">{{ opp.code }}</span>
              </div>
              <div class="text-right ml-3 shrink-0">
                <div class="font-mono text-sm">{{ formatMoney(opp.amount_tax_inclusive) }}</div>
                <div class="text-xs text-muted">{{ opp.expected_sign_date || '-' }}</div>
              </div>
            </NuxtLink>
          </div>
          <div v-else class="text-center py-6 text-muted text-sm">
            暂无关联商机
          </div>
        </UCard>

        <!-- 合同 -->
        <UCard v-if="activeTab === 'contracts'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">关联合同 ({{ customerContracts?.length || 0 }})</span>
              <UButton
                label="新建合同"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="router.push(`/contracts/new?customer_id=${customerId}`)"
              />
            </div>
          </template>
          <div v-if="customerContracts?.length" class="divide-y divide-default">
            <NuxtLink
              v-for="ct in customerContracts"
              :key="ct.id"
              :to="`/contracts/${ct.id}`"
              class="flex items-center justify-between py-2.5 hover:bg-elevated/50 -mx-4 px-4 transition-colors"
            >
              <div class="min-w-0 flex-1">
                <div class="font-medium text-sm">{{ ct.name }}</div>
                <span class="text-xs text-muted font-mono">{{ ct.code }}</span>
              </div>
              <div class="text-right ml-3 shrink-0">
                <div class="font-mono text-sm">{{ formatMoney(ct.amount_tax_inclusive) }}</div>
                <div class="text-xs text-muted">{{ ct.sign_date || '-' }}</div>
              </div>
            </NuxtLink>
          </div>
          <div v-else class="text-center py-6 text-muted text-sm">
            暂无关联合同
          </div>
        </UCard>

        <div v-if="activeTab === 'service'" class="space-y-4">
          <UAlert
            v-if="serviceLoadError"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="serviceLoadError"
          />

          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UCard>
              <div class="text-center">
                <div class="text-2xl font-bold">
                  {{ maintenanceView?.summary?.activeMaintenanceContracts || 0 }}
                </div>
                <div class="text-xs text-muted mt-1">
                  生效维保
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-2xl font-bold text-warning">
                  {{ maintenanceView?.summary?.openServiceTickets || 0 }}
                </div>
                <div class="text-xs text-muted mt-1">
                  未关闭工单
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-2xl font-bold text-error">
                  {{ maintenanceView?.summary?.breachedServiceTickets || 0 }}
                </div>
                <div class="text-xs text-muted mt-1">
                  SLA 超期
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-2xl font-bold text-primary">
                  {{ formatMoneyValue(financeSummary.receivedAmount) }}
                </div>
                <div class="text-xs text-muted mt-1">
                  维保回款
                </div>
              </div>
            </UCard>
          </div>

          <div v-if="serviceLoading" class="space-y-3">
            <USkeleton class="h-36 w-full" />
            <USkeleton class="h-36 w-full" />
          </div>

          <template v-else>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-sm">维保合同 ({{ maintenanceContracts.length }})</span>
                    <UBadge variant="subtle" color="primary">
                      {{ formatMoneyValue(maintenanceView?.summary?.maintenanceAmount) }}
                    </UBadge>
                  </div>
                </template>
                <div v-if="maintenanceContracts.length" class="divide-y divide-default">
                  <div
                    v-for="(item, index) in maintenanceContracts"
                    :key="rowKey(item, `maintenance-${index}`)"
                    class="py-2.5"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium text-sm truncate">
                          {{ item.name || item.contract_name || item.code }}
                        </div>
                        <div class="text-xs text-muted font-mono">
                          {{ item.code }} · {{ item.contract_code || '-' }}
                        </div>
                      </div>
                      <UBadge size="xs" variant="subtle" color="neutral">
                        {{ statusText(item.status) }}
                      </UBadge>
                    </div>
                    <div class="mt-1 text-xs text-muted">
                      {{ dateRange(item.service_start_date, item.service_end_date) }} · {{ item.service_level || 'standard' }}
                    </div>
                  </div>
                </div>
                <div v-else class="text-center py-6 text-muted text-sm">
                  暂无维保合同
                </div>
              </UCard>

              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-sm">客户交付系统 ({{ deliveryItems.length }})</span>
                    <UBadge variant="subtle" color="neutral">
                      Assets
                    </UBadge>
                  </div>
                </template>
                <div v-if="deliveryItems.length" class="divide-y divide-default">
                  <div
                    v-for="(delivery, index) in deliveryItems"
                    :key="rowKey(delivery, `delivery-${index}`)"
                    class="py-2.5"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium text-sm truncate">
                          {{ delivery.delivery_name || delivery.delivery_code }}
                        </div>
                        <div class="text-xs text-muted font-mono">
                          {{ delivery.delivery_code }} · {{ delivery.project_code || '-' }}
                        </div>
                      </div>
                      <UBadge size="xs" variant="subtle" color="neutral">
                        {{ statusText(delivery.status) }}
                      </UBadge>
                    </div>
                    <div class="mt-1 text-xs text-muted">
                      环境 {{ environmentCount(delivery) }} · 文档 {{ documentCount(delivery) }} · {{ dateRange(delivery.go_live_at, delivery.accepted_at) }}
                    </div>
                  </div>
                </div>
                <div v-else class="text-center py-6 text-muted text-sm">
                  暂无交付系统台账
                </div>
              </UCard>
            </div>

            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-sm">服务工单 ({{ serviceTickets.length }})</span>
                  <UBadge variant="subtle" color="neutral">
                    Aims / Codocs 引用
                  </UBadge>
                </div>
              </template>
              <div v-if="serviceTickets.length" class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="text-xs text-muted border-b border-default">
                    <tr>
                      <th class="text-left font-medium py-2 pr-4">
                        工单
                      </th>
                      <th class="text-left font-medium py-2 pr-4">
                        类型
                      </th>
                      <th class="text-left font-medium py-2 pr-4">
                        状态
                      </th>
                      <th class="text-left font-medium py-2 pr-4">
                        SLA
                      </th>
                      <th class="text-left font-medium py-2 pr-4">
                        权益
                      </th>
                      <th class="text-left font-medium py-2 pr-4">
                        执行/知识
                      </th>
                      <th class="text-right font-medium py-2">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-default">
                    <tr v-for="(ticket, index) in serviceTickets" :key="rowKey(ticket, `ticket-${index}`)">
                      <td class="py-2 pr-4">
                        <div class="font-medium">
                          {{ ticket.title || ticket.code }}
                        </div>
                        <div class="text-xs text-muted font-mono">
                          {{ ticket.code }}
                        </div>
                      </td>
                      <td class="py-2 pr-4">
                        {{ statusText(ticket.ticket_type) }}
                      </td>
                      <td class="py-2 pr-4">
                        <UBadge size="xs" variant="subtle" color="neutral">
                          {{ statusText(ticket.status) }}
                        </UBadge>
                      </td>
                      <td class="py-2 pr-4">
                        <UBadge
                          size="xs"
                          variant="subtle"
                          :color="ticket.sla_status === 'breached' ? 'error' : 'success'"
                        >
                          {{ statusText(ticket.sla_status) }}
                        </UBadge>
                      </td>
                      <td class="py-2 pr-4">
                        <UBadge
                          size="xs"
                          variant="subtle"
                          :color="ticket.entitlement_status === 'in_service' ? 'success' : ticket.entitlement_status === 'over_quota' ? 'warning' : 'neutral'"
                        >
                          {{ statusText(ticket.entitlement_status || 'unknown') }}
                        </UBadge>
                        <div class="mt-1 text-xs font-mono text-muted">
                          {{ ticket.service_agreement_code || ticket.delivery_asset_code || '-' }}
                        </div>
                      </td>
                      <td class="py-2 pr-4">
                        <div class="text-xs font-mono text-muted">
                          {{ ticket.aims_work_item_key || '-' }}
                        </div>
                        <div class="text-xs font-mono text-muted">
                          {{ ticket.codocs_document_uuid || '-' }}
                        </div>
                      </td>
                      <td class="py-2 text-right">
                        <UBadge
                          v-if="ticket.aims_work_item_key"
                          size="xs"
                          variant="subtle"
                          color="success"
                        >
                          已回流
                        </UBadge>
                        <UButton
                          v-else
                          label="回流 Aims"
                          icon="i-lucide-list-plus"
                          size="xs"
                          variant="soft"
                          color="primary"
                          :loading="isTicketSyncing(ticket)"
                          @click="syncTicketToAims(ticket)"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="text-center py-6 text-muted text-sm">
                暂无服务工单
              </div>
            </UCard>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-sm">服务协议 ({{ serviceAgreements.length }})</span>
                    <UBadge variant="subtle" color="primary">
                      P1
                    </UBadge>
                  </div>
                </template>
                <div v-if="serviceAgreements.length" class="divide-y divide-default">
                  <div
                    v-for="(item, index) in serviceAgreements"
                    :key="rowKey(item, `agreement-${index}`)"
                    class="py-2.5"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium text-sm truncate">
                          {{ item.name || item.code }}
                        </div>
                        <div class="text-xs text-muted font-mono">
                          {{ item.code }} · {{ item.contract_code || '-' }}
                        </div>
                      </div>
                      <UBadge size="xs" variant="subtle" color="neutral">
                        {{ statusText(item.status) }}
                      </UBadge>
                    </div>
                    <div class="mt-1 text-xs text-muted">
                      {{ dateRange(item.service_start_date, item.service_end_date) }} · {{ item.service_level || 'standard' }}
                    </div>
                    <div class="mt-1 text-xs text-muted">
                      SLA {{ item.response_minutes || '-' }}/{{ item.resolution_minutes || '-' }} 分钟 · 额度 {{ item.consumed_quota || 0 }}/{{ item.included_quota || '-' }} {{ item.quota_unit || 'ticket' }} · 续约 {{ item.renewal_remind_at || '-' }}
                    </div>
                  </div>
                </div>
                <div v-else class="text-center py-6 text-muted text-sm">
                  暂无服务协议
                </div>
              </UCard>

              <UCard>
                <template #header>
                  <span class="font-semibold text-sm">SLA / 服务权益 ({{ serviceEntitlements.length }})</span>
                </template>
                <div v-if="serviceEntitlements.length" class="divide-y divide-default">
                  <div
                    v-for="(item, index) in serviceEntitlements"
                    :key="rowKey(item, `entitlement-${index}`)"
                    class="py-2.5 flex items-center justify-between gap-3"
                  >
                    <div class="min-w-0">
                      <div class="font-medium text-sm truncate">
                        {{ item.name || item.code }}
                      </div>
                      <div class="text-xs text-muted">
                        {{ item.priority || 'P3' }} · 响应 {{ item.response_minutes || '-' }} 分钟 · 解决 {{ item.resolution_minutes || '-' }} 分钟
                      </div>
                    </div>
                    <UBadge size="xs" variant="subtle" color="neutral">
                      {{ item.service_window || 'standard' }}
                    </UBadge>
                  </div>
                </div>
                <div v-else class="text-center py-6 text-muted text-sm">
                  暂无服务权益
                </div>
              </UCard>

              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-sm">续约机会 ({{ renewalOpportunities.length }})</span>
                    <UBadge variant="subtle" color="neutral">
                      Altoc
                    </UBadge>
                  </div>
                </template>
                <div v-if="renewalOpportunities.length" class="divide-y divide-default">
                  <div
                    v-for="(item, index) in renewalOpportunities"
                    :key="rowKey(item, `renewal-${index}`)"
                    class="py-2.5"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium text-sm truncate">
                          {{ item.name || item.code }}
                        </div>
                        <div class="text-xs text-muted font-mono">
                          {{ item.code }} · {{ item.maintenance_contract_code || '-' }}
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <div class="font-mono text-sm">
                          {{ formatMoneyValue(item.expected_amount) }}
                        </div>
                        <div class="text-xs text-muted">
                          {{ item.expected_sign_date || '-' }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="text-center py-6 text-muted text-sm">
                  暂无续约机会
                </div>
              </UCard>
            </div>

            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-sm">维保财务摘要</span>
                  <UBadge variant="subtle" color="neutral">
                    Finance
                  </UBadge>
                </div>
              </template>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div class="text-muted text-xs">
                    开票金额
                  </div>
                  <div class="font-mono mt-1">
                    {{ formatMoneyValue(financeSummary.invoiceAmount) }}
                  </div>
                </div>
                <div>
                  <div class="text-muted text-xs">
                    已核销
                  </div>
                  <div class="font-mono mt-1">
                    {{ formatMoneyValue(financeSummary.reconciledAmount) }}
                  </div>
                </div>
                <div>
                  <div class="text-muted text-xs">
                    服务成本
                  </div>
                  <div class="font-mono mt-1">
                    {{ formatMoneyValue(financeSummary.serviceCostAmount) }}
                  </div>
                </div>
                <div>
                  <div class="text-muted text-xs">
                    维保毛利
                  </div>
                  <div class="font-mono mt-1">
                    {{ formatMoneyValue(financeSummary.grossProfitAmount) }}
                  </div>
                </div>
              </div>
            </UCard>
          </template>
        </div>

        <UCard v-if="activeTab === 'audit'">
          <template #header>
            <span class="font-semibold text-sm">操作历史</span>
          </template>
          <AuditTimeline entity-type="customer" :entity-id="Number(customerId)" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <!-- 新增联系人弹窗 -->
  <UModal v-model:open="showContactModal">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">新增联系人</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showContactModal = false"
            />
          </div>
        </template>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField label="姓名" required>
            <UInput v-model="contactForm.name" placeholder="请输入姓名" class="w-full" />
          </UFormField>
          <UFormField label="性别">
            <USelect v-model="contactForm.gender" :items="genderOptions" class="w-full" />
          </UFormField>
          <UFormField label="部门">
            <UInput v-model="contactForm.dept_name" placeholder="所在部门" class="w-full" />
          </UFormField>
          <UFormField label="职位">
            <UInput v-model="contactForm.job_title" placeholder="职位/岗位" class="w-full" />
          </UFormField>
          <UFormField label="手机">
            <UInput v-model="contactForm.mobile" placeholder="手机号码" class="w-full" />
          </UFormField>
          <UFormField label="邮箱">
            <UInput v-model="contactForm.email" placeholder="邮箱地址" class="w-full" />
          </UFormField>
          <UFormField label="决策角色">
            <USelect
              v-model="contactForm.decision_role"
              :items="decisionRoleOptions"
              placeholder="请选择"
              class="w-full"
            />
          </UFormField>
          <UFormField label="影响力">
            <USelect
              v-model="contactForm.influence_level"
              :items="influenceOptions"
              placeholder="请选择"
              class="w-full"
            />
          </UFormField>
          <UFormField label="是否关键人" class="md:col-span-2">
            <USwitch :model-value="!!contactForm.is_key_contact" @update:model-value="(v: boolean) => contactForm.is_key_contact = v ? 1 : 0" />
          </UFormField>
          <UFormField label="备注" class="md:col-span-2">
            <UTextarea
              v-model="contactForm.remark"
              placeholder="备注"
              :rows="2"
              class="w-full"
            />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showContactModal = false"
            />
            <UButton
              label="保存"
              color="primary"
              :loading="contactLoading"
              @click="createContact"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
