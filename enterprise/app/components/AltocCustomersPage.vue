<script setup lang="ts">
import UserTreeSelector from '../../../foundation/app/components/UserTreeSelector.vue'
import AltocReceivablesPage from './AltocReceivablesPage.vue'
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import AltocCustomerContacts from './AltocCustomerContacts.vue'
import AltocCustomerContracts from './AltocCustomerContracts.vue'
import { customerTabs, customerTab, customerTimeline, customerStatusColor, customerListState, customerListQuery, customerSortOptions } from '../utils/altocCustomerWorkspace'
import { formatMoney } from '../../../foundation/app/utils/format'
import W3CustomerOverview from './W3CustomerOverview.vue'
import W3CustomerHierarchy from './W3CustomerHierarchy.vue'
import W3CustomerActions from './W3CustomerActions.vue'
import W3SourceInfo from './W3SourceInfo.vue'
import { w3OwnerLabel, type W3Record } from '../utils/w3Presentation'
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import { apfServerFieldErrors } from '../utils/apfFormPresentation'
import AltocFinancialSummaryPanel from './AltocFinancialSummaryPanel.vue'
import AltocKnowledgePanel from './AltocKnowledgePanel.vue'
import { SOURCE_TYPE_OPTIONS, CREDIT_LEVEL_OPTIONS } from '../../../altoc/app/types/altoc'
import { customerFieldLimit, validateCustomerFields, altocValidationMessage } from '../utils/altocHostForms'
import type { TableColumn } from '@nuxt/ui'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{
  detail?: boolean
}>()
type Row = W3Record
const route = useRoute()
const router = useRouter()
const initial = customerListState(route.query)
let restoringList = false
const detailTab = ref(customerTab(route.query.tab))
const detailTabs = customerTabs
const contractSummary = ref<Row | null>(null)
const contractState = ref('正在加载合同汇总')
const summaryAmounts = computed(() => Array.isArray(contractSummary.value?.amounts) ? contractSummary.value.amounts as Row[] : [])
const timeline = computed(() => customer.value ? customerTimeline(customer.value) : [])
const filtersOpen = ref(false)
const activeFilterCount = computed(() => [statusFilter.value !== 'all', rootsOnly.value, ownerUnassigned.value, Boolean(ownerFilter.value), Boolean(industryFilter.value.trim()), Boolean(regionFilter.value.trim()), Boolean(updatedDateFrom.value), Boolean(updatedDateTo.value)].filter(Boolean).length)
const hasListFilters = computed(() => Boolean(debounced.value.trim()) || activeFilterCount.value > 0)
const customerSort = ref(initial.customerSort)
const ownerFilter = ref(initial.ownerUid), industryFilter = ref(initial.industryCode), regionFilter = ref(initial.regionCode)
const updatedDateFrom = ref(initial.updatedDateFrom), updatedDateTo = ref(initial.updatedDateTo)
const selectedFilterOwner = computed({ get: () => ownerFilter.value ? [ownerFilter.value] : [], set: (uids: string[]) => {
  ownerFilter.value = uids[0] || ''
  if (uids.length)
    ownerUnassigned.value = false
} })
const dateError = computed(() => updatedDateFrom.value && updatedDateTo.value && updatedDateFrom.value > updatedDateTo.value ? '开始日期不能晚于结束日期' : '')
watch(() => route.query.tab, (value) => {
  detailTab.value = customerTab(value)
})
watch(detailTab, (value) => {
  if (props.detail && value !== customerTab(route.query.tab))
    void router.replace({ query: { ...route.query, tab: value } })
})
const { user: currentUser } = useAuth()
const { hasPermission, loaded, error: permissionError, loadPermissions } = usePermissions()
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('customer', 'edit'))
// Host composition skips the standalone Altoc permission middleware.
onMounted(() => {
  void loadPermissions()
})
const { status: accessStatus } = useEnterpriseNavigationAccess()
const scopeKey = useState<string>('enterprise-cache-scope', () => '')
const toast = useToast()
const { confirm } = useConfirm()
const page = ref(initial.page)
const { search, debounced, flush } = useDebouncedSearch({
  initial: initial.search,
  onChange: () => {
    if (!restoringList) page.value = 1
  }
})
const pending = ref(false)
const error = ref('')
const rows = ref<Row[]>([])
const customer = ref<Row | null>(null)
const contacts = ref<Row[]>([])
const profiles = ref<Row[]>([])
const total = ref(0)
const view = ref('list')
const customerActions = ref<InstanceType<typeof W3CustomerActions> | null>(null)
watch(search, (value) => {
  if (value.trim())
    view.value = 'list'
}, { flush: 'sync' })
watch(view, () => {
  if (!restoringList) page.value = 1
}, { flush: 'sync' })
const rootsOnly = ref(initial.rootsOnly)
const ownerUnassigned = ref(initial.ownerUnassigned)
const statusFilter = ref(initial.status)
watch([rootsOnly, ownerUnassigned, statusFilter, customerSort, ownerFilter, industryFilter, regionFilter, updatedDateFrom, updatedDateTo], () => {
  if (!restoringList) page.value = 1
}, { flush: 'sync' })
const ownerUids = computed(() => [...rows.value.map(r => String(r.owner_uid || '')), String(customer.value?.owner_uid || ''), String(currentUser.value || '')])
const { userName, departmentName, directoryError, refresh: refreshDirectory } = useAltocDirectoryLabels(ownerUids)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref('')
const showOptional = ref(false)
function optionsFor(key: string) {
  return key === 'source_type' ? SOURCE_TYPE_OPTIONS : key === 'credit_level' ? CREDIT_LEVEL_OPTIONS : key === 'invoice_type' ? [{ label: '增值税专用发票', value: 'special_vat' }, { label: '增值税普通发票', value: 'general_vat' }, { label: '电子发票', value: 'electronic' }] : key === 'status' ? [{ label: '有效', value: 'active' }, { label: '停用', value: 'inactive' }] : []
}
function selectOptions(key: string) {
  const options = optionsFor(key)
  return draft[key] && !options.some(o => o.value === draft[key]) ? [...options, { label: '其他（保留原值）', value: draft[key]! }] : options
}
function displayValue(key: string, value: unknown) {
  if (key === 'owner_uid')
    return w3OwnerLabel(value, userName(value))
  if (key === 'owner_dept_code')
    return departmentName(value)
  if (optionsFor(key).length)
    return optionsFor(key).find(o => o.value === value)?.label || '其他（未登记）'
  return String(value || '')
}
let epoch = 0
const base = '/altoc/api/v1/customers'
const id = computed(() => String(route.params.customerId || ''))
const labels: Record<string, string> = { name: '名称', short_name: '简称', unified_social_credit_code: '统一社会信用代码', organization_domain: '组织域名', industry_code: '行业编码', region_code: '地区编码', source_type: '来源', credit_level: '信用等级', website: '网站', telephone: '电话', province: '省份', city: '城市', address: '地址', wechat_official_account: '公众号', description: '说明', remark: '备注', owner_uid: '负责人', owner_dept_code: '负责部门', dept_name: '联系人部门', job_title: '职务', mobile: '手机', alternate_mobile: '备用手机', phone: '固定电话', email: '邮箱', wechat: '微信', mailing_address: '邮寄地址', decision_role: '决策角色', influence_level: '影响程度', taxpayer_name: '发票抬头', taxpayer_no: '纳税人识别号', registered_address: '注册地址', registered_phone: '注册电话', bank_name: '开户行', bank_account: '银行账号', invoice_type: '发票类型', invoice_email: '收票邮箱', receiver_name: '收件人', receiver_phone: '收件电话', receiver_address: '收件地址', status: '状态', sort_no: '排序号' }
const baseColumns: TableColumn<Row>[] = [{ accessorKey: 'name', header: '客户名称 / 编码' }, { id: 'parent', header: '上级客户' }, { accessorKey: 'owner_uid', header: '负责人' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'industry_code', header: '行业' }, { accessorKey: 'region_code', header: '地区' }, { accessorKey: 'primary_contact_name', header: '主联系人' }, { id: 'actions', header: '操作' }]
const optionalColumns = [{ key: 'short_name', label: '简称' }, { key: 'unified_social_credit_code', label: '统一社会信用代码' }, { key: 'credit_level', label: '信用等级' }, { key: 'customer_level_name', label: '客户等级' }, { key: 'owner_dept_code', label: '负责部门' }, { key: 'updated_at', label: '更新时间' }]
const visibleColumns = ref<string[]>([])
const columns = computed<TableColumn<Row>[]>(() => [...baseColumns.slice(0, -1), ...optionalColumns.filter(column => visibleColumns.value.includes(column.key)).map(column => ({ accessorKey: column.key, header: column.label })), baseColumns.at(-1)!])
const customerView = ref(initial.rootsOnly ? 'roots' : initial.ownerUnassigned ? 'unassigned' : 'all')
watch(customerView, (value) => {
  rootsOnly.value = value === 'roots'
  ownerUnassigned.value = value === 'unassigned'
  if (value === 'mine')
    ownerFilter.value = String(currentUser.value || '')
  else
    ownerFilter.value = ''
})
function saveColumns() {
  if (typeof window === 'undefined' || !scopeKey.value || permissionError.value || accessStatus.value !== 'ready')
    return
  try {
    window.localStorage.setItem(`apf-customer-columns:v1:${scopeKey.value}`, JSON.stringify(visibleColumns.value))
  } catch { /* Local preferences are optional. */ }
}
watch(scopeKey, (value, previous) => {
  visibleColumns.value = []
  if (typeof window === 'undefined')
    return
  try {
    if (previous)
      window.localStorage.removeItem(`apf-customer-columns:v1:${previous}`)
    const saved = JSON.parse(window.localStorage.getItem(`apf-customer-columns:v1:${value}`) || '[]')
    if (Array.isArray(saved))
      visibleColumns.value = saved.filter(key => optionalColumns.some(column => column.key === key))
  } catch { /* Keep safe defaults. */ }
}, { immediate: true })
const listQuery = computed(() => customerListQuery({ page: page.value, search: debounced.value.trim(), status: statusFilter.value, rootsOnly: rootsOnly.value, ownerUnassigned: ownerUnassigned.value, ownerUid: ownerFilter.value, industryCode: industryFilter.value.trim(), regionCode: regionFilter.value.trim(), updatedDateFrom: updatedDateFrom.value, updatedDateTo: updatedDateTo.value, customerSort: customerSort.value }))
const listReturnQuery = computed(() => Object.fromEntries(Object.entries(listQuery.value).filter(([key]) => key !== 'pageSize').map(([key, value]) => [key, String(value)])))
function clearFilters() {
  customerView.value = 'all'
  search.value = ''
  rootsOnly.value = ownerUnassigned.value = false
  statusFilter.value = 'all'
  ownerFilter.value = industryFilter.value = regionFilter.value = updatedDateFrom.value = updatedDateTo.value = ''
  page.value = 1
  flush()
}
watch(() => route.query, (query) => {
  if (props.detail) return
  const restored = customerListState(query)
  if (JSON.stringify(customerListQuery(restored)) === JSON.stringify(listQuery.value)) return
  restoringList = true
  search.value = restored.search
  flush()
  statusFilter.value = restored.status
  rootsOnly.value = restored.rootsOnly
  ownerUnassigned.value = restored.ownerUnassigned
  ownerFilter.value = restored.ownerUid
  industryFilter.value = restored.industryCode
  regionFilter.value = restored.regionCode
  updatedDateFrom.value = restored.updatedDateFrom
  updatedDateTo.value = restored.updatedDateTo
  customerSort.value = restored.customerSort
  page.value = restored.page
  restoringList = false
}, { flush: 'sync' })
watch(listReturnQuery, (query) => {
  if (!props.detail && view.value === 'list')
    void router.replace({ query })
})
watch(ownerUnassigned, (value) => {
  if (value)
    ownerFilter.value = ''
}, { flush: 'sync' })
const statusLabels: Record<string, string> = { draft: '草稿', approval_pending: '审批中', approved: '已批准', active: '有效', inactive: '停用', archived: '归档' }
const customerFields = ['name', 'short_name', 'unified_social_credit_code', 'organization_domain', 'industry_code', 'region_code', 'source_type', 'credit_level', 'website', 'telephone', 'province', 'city', 'address', 'wechat_official_account', 'description', 'remark']
const contactFields = ['name', 'dept_name', 'job_title', 'mobile', 'alternate_mobile', 'phone', 'email', 'wechat', 'mailing_address', 'decision_role', 'influence_level', 'remark', 'status']
const invoiceFields = ['taxpayer_name', 'taxpayer_no', 'registered_address', 'registered_phone', 'bank_name', 'bank_account', 'invoice_type', 'invoice_email', 'receiver_name', 'receiver_phone', 'receiver_address', 'remark', 'status']
async function load() {
  const current = ++epoch
  if (!scopeKey.value || !loaded.value || permissionError.value || !hasPermission('customer', 'view') || dateError.value || accessStatus.value !== 'ready' || (!props.detail && view.value === 'hierarchy')) {
    pending.value = false
    total.value = 0
    error.value = ''
    rows.value = []
    customer.value = null
    contacts.value = []
    profiles.value = []
    return
  }
  pending.value = true
  if (props.detail) {
    customer.value = null
    contacts.value = []
    profiles.value = []
    contractSummary.value = null
  }
  error.value = ''
  try {
    const response = await $fetch<{
      code: number
      data: Record<string, unknown>
    }>(`${base}${props.detail ? `/${encodeURIComponent(id.value)}` : ''}`, { query: props.detail ? { workspace: true } : listQuery.value })
    if (current !== epoch)
      return
    if (props.detail) {
      customer.value = response.data as Row
      contacts.value = response.data.contacts as Row[]
      profiles.value = response.data.invoice_profiles as Row[]
    } else {
      rows.value = response.data.items as Row[]
      total.value = Number(response.data.total)
    }
  } catch (e) {
    if (current === epoch) {
      rows.value = []
      customer.value = null
      error.value = Number((e as {
        statusCode?: number
      }).statusCode) === 403
        ? '无查看权限'
        : '客户资料暂不可用，请重试'
    }
  } finally {
    if (current === epoch)
      pending.value = false
  }
}
watch([id, listQuery, view, scopeKey, accessStatus, loaded, permissionError], load, { immediate: true })
watch([id, scopeKey, accessStatus, permissionError], () => {
  epoch++
  rows.value = []
  customer.value = null
  contacts.value = []
  profiles.value = []
  contractSummary.value = null
  if (accessStatus.value !== 'ready' || permissionError.value) visibleColumns.value = []
}, { flush: 'sync' })
onScopeDispose(() => {
  epoch++
})
const open = ref(false)
const editing = ref<Row | null>(null)
const mode = ref<'customer' | 'owner' | 'contact' | 'invoice'>('customer')
const draft = reactive<Record<string, string>>({})
const fields = computed(() => mode.value === 'owner' ? ['owner_uid', 'owner_dept_code'] : mode.value === 'contact' ? contactFields : mode.value === 'invoice' ? invoiceFields : editing.value ? customerFields : [...customerFields, 'owner_uid', 'owner_dept_code'])
const intent = createConsoleMutationIntent('altoc-customer')
const saving = ref(false)
const selectedOwner = computed({ get: () => draft.owner_uid ? [draft.owner_uid] : [], set: (uids: string[]) => {
  draft.owner_uid = uids[0] || ''
} })
const editorTitle = computed(() => mode.value === 'owner' ? '调整负责人' : `${editing.value ? '编辑' : '新建'}${mode.value === 'contact' ? '联系人' : mode.value === 'invoice' ? '开票资料' : '客户'}`)
const fieldGroups = computed(() => {
  const contacts = ['telephone', 'website', 'wechat_official_account', 'province', 'city', 'address', 'mobile', 'alternate_mobile', 'phone', 'email', 'wechat', 'mailing_address', 'receiver_name', 'receiver_phone', 'receiver_address', 'invoice_email', 'registered_phone']
  return [
    { title: '基本信息', fields: fields.value.filter(k => !contacts.includes(k) && !['owner_uid', 'owner_dept_code', 'description', 'remark'].includes(k)) },
    { title: '联系方式', fields: fields.value.filter(k => contacts.includes(k)) },
    { title: '归属', fields: fields.value.filter(k => ['owner_uid', 'owner_dept_code'].includes(k)) },
    { title: '补充说明', fields: fields.value.filter(k => ['description', 'remark'].includes(k)) }
  ].filter(g => g.fields.length)
})
const detailGroups = computed(() => [
  { title: '基本信息', fields: ['name', 'short_name', 'unified_social_credit_code', 'source_type', 'credit_level', 'sort_no'] },
  { title: '联系方式', fields: ['telephone', 'website', 'wechat_official_account', 'province', 'city', 'address'] },
  { title: '归属', fields: ['owner_uid', 'owner_dept_code'] },
  { title: '补充资料', fields: ['organization_domain', 'industry_code', 'region_code', 'description', 'remark'] }
].map(g => ({ ...g, fields: g.fields.filter(k => customer.value?.[k] !== null && customer.value?.[k] !== '' && customer.value?.[k] !== undefined) })).filter(g => g.fields.length && (g.title !== '补充资料' || showOptional.value)))
function begin(kind: typeof mode.value, row: Row | null = null) {
  if (!intent.reset()) {
    toast.add({ title: '请先重试未完成的操作', color: 'warning' })
    return
  }
  fieldErrors.value = {}
  formError.value = ''
  mode.value = kind
  editing.value = row
  for (const key of Object.keys(draft))
    Reflect.deleteProperty(draft, key)
  for (const key of fields.value)
    draft[key] = String(row?.[key] ?? (key === 'invoice_type' ? 'special_vat' : key === 'status' ? 'active' : ''))
  if (kind === 'customer' && !row)
    draft.owner_uid = String(currentUser.value || '')
  open.value = true
}
async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  saving.value = true
  try {
    const done = await intent.submit({ path, method, body }, (request, key) => $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } }))
    if (done) {
      open.value = false
      toast.add({ title: '已保存', color: 'success' })
      await load()
    }
  } catch (e) {
    formError.value = String((e as {
      data?: {
        code?: string
      }
    }).data?.code) === 'altoc_contact_is_primary'
      ? '请先更换或清空主联系人，再删除此联系人'
      : altocValidationMessage(e)
    fieldErrors.value = { ...validateCustomerFields(mode.value, fields.value, draft), ...apfServerFieldErrors(e, Object.keys(body)) }
    toast.add({ title: '保存失败', description: formError.value, color: 'error' })
  } finally {
    saving.value = false
  }
}
async function save() {
  fieldErrors.value = validateCustomerFields(mode.value, fields.value, draft)
  formError.value = ''
  if (Object.keys(fieldErrors.value).length)
    return
  const body: Record<string, unknown> = Object.fromEntries(fields.value.map(key => [key, draft[key]?.trim() || (['name', 'taxpayer_name', 'owner_uid', 'invoice_type', 'status'].includes(key) ? '' : null)]))
  if (editing.value)
    body.expectedVersion = editing.value.row_version
  const parent = `${base}/${encodeURIComponent(id.value)}`
  const path = mode.value === 'customer' ? editing.value ? parent : base : mode.value === 'owner' ? `${parent}/owner` : `${parent}/${mode.value === 'contact' ? 'contacts' : 'invoice-profiles'}${editing.value ? `/${encodeURIComponent(String(editing.value.code))}` : ''}`
  await send(path, editing.value ? 'PATCH' : 'POST', body)
}
async function remove(kind: 'contacts' | 'invoice-profiles', row: Row) {
  if (kind === 'contacts' && String(customer.value?.primary_contact_id) === String(row.id)) {
    toast.add({ title: '请先更换或清空主联系人，再删除此联系人', color: 'warning' })
    return
  }
  if (!await confirm({ title: '删除客户资料', message: `将删除“${row.name || row.taxpayer_name}”引用记录，历史审计仍保留。`, tone: 'danger' }))
    return
  await send(`${base}/${id.value}/${kind}/${encodeURIComponent(String(row.code))}`, 'DELETE', { expectedVersion: row.row_version })
}
async function makeDefault(row: Row) {
  if (!await confirm({ title: '设为默认开票资料', message: `将“${row.taxpayer_name}”设为默认，原默认资料将取消默认。`, tone: 'warning' }))
    return
  await send(`${base}/${id.value}/invoice-profiles/${encodeURIComponent(String(row.code))}/default`, 'POST', { expectedVersion: row.row_version })
}
</script>

<template>
  <UDashboardPanel id="altoc-customers">
    <template #header>
      <ContentPageHeader
        class="px-4 pt-4 sm:px-6 sm:pt-6"
        :title="detail ? String(customer?.name || '客户详情') : '客户'"
        hosted
        breadcrumb="销售 / 客户经营 / 客户"
        description="维护客户、联系人与开票资料。"
      >
        <template #actions>
          <UButton
            v-if="detail"
            :to="{ path: '/altoc/customers', query: route.query.returnPage ? { ...route.query, page: route.query.returnPage, tab: undefined, returnPage: undefined } : {} }"
            color="neutral"
            variant="outline"
          >
            返回列表
          </UButton><UButton
            v-if="canEdit && (!detail || customer)"
            @click="begin('customer', detail ? customer : null)"
          >
            {{ detail ? '编辑客户' : '新建客户' }}
          </UButton><UButton
            v-if="canEdit && customer"
            color="neutral"
            variant="outline"
            @click="begin('owner', customer)"
          >
            调整负责人
          </UButton><UButton
            color="neutral"
            variant="outline"
            :loading="pending"
            @click="load"
          >
            刷新
          </UButton>
        </template>
      </ContentPageHeader>
    </template>
    <template #body>
      <UAlert
        v-if="permissionError"
        color="error"
        title="权限信息加载失败"
        description="无法确认可用操作，请重试加载权限。"
      >
        <template #actions>
          <UButton
            color="neutral"
            variant="outline"
            @click="loadPermissions({ force: true })"
          >
            重试
          </UButton>
        </template>
      </UAlert>
      <UAlert
        v-else-if="error"
        color="error"
        :title="error"
      />
      <CommonEmptyState
        v-else-if="!loaded || accessStatus !== 'ready'"
        title="正在加载权限"
      />
      <CommonEmptyState
        v-else-if="loaded && !hasPermission('customer', 'view')"
        title="无客户查看权限"
        description="请联系管理员确认客户访问权限。"
      />
      <template v-else-if="!detail">
        <div
          class="flex min-w-0 items-center gap-2"
          aria-label="客户列表工具栏"
        >
          <UInput
            v-model="search"
            placeholder="搜索客户名称或编号"
            aria-label="搜索客户"
            icon="i-lucide-search"
            class="min-w-0 flex-1 sm:max-w-64"
            @keyup.enter="flush"
          />
          <div class="hidden w-28 shrink-0 lg:block">
            <USelect
              v-model="statusFilter"
              :items="[{ label: '全部状态', value: 'all' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]"
              aria-label="客户状态"
              class="w-full"
            />
          </div>
          <UPopover v-model:open="filtersOpen">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-list-filter"
              class="shrink-0"
            >
              <span class="hidden sm:inline">更多筛选</span><span class="sm:hidden">筛选</span><span v-if="activeFilterCount"> · {{ activeFilterCount }}</span>
            </UButton>
            <template #content>
              <div class="max-h-[75vh] w-[min(36rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-4">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <UFormField label="客户视图">
                    <USelect
                      v-model="customerView"
                      :items="[{ label: '全部客户', value: 'all' }, { label: '根客户', value: 'roots' }, { label: '待匹配', value: 'unassigned' }, { label: '我的负责', value: 'mine' }]"
                      aria-label="客户视图"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    label="状态"
                    class="lg:hidden"
                  >
                    <USelect
                      v-model="statusFilter"
                      :items="[{ label: '全部状态', value: 'all' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]"
                      aria-label="客户状态"
                      class="w-full"
                    />
                  </UFormField>
                  <UCheckbox
                    v-model="rootsOnly"
                    label="仅顶级客户"
                  />
                  <UCheckbox
                    v-model="ownerUnassigned"
                    label="负责人待匹配"
                  />
                  <UFormField label="负责人">
                    <UserTreeSelector
                      v-model="selectedFilterOwner"
                      selection-mode="single"
                      hide-committees
                      width-class="w-full"
                      placeholder="选择负责人"
                    />
                  </UFormField><UFormField label="行业编码">
                    <UInput
                      v-model="industryFilter"
                      class="w-full"
                    />
                  </UFormField><UFormField label="地区编码">
                    <UInput
                      v-model="regionFilter"
                      class="w-full"
                    />
                  </UFormField><UFormField label="更新日期起（北京时间）">
                    <UInput
                      v-model="updatedDateFrom"
                      type="date"
                      class="w-full"
                    />
                  </UFormField><UFormField
                    label="更新日期止（北京时间）"
                    :error="dateError || undefined"
                  >
                    <UInput
                      v-model="updatedDateTo"
                      type="date"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <div class="space-y-3 sm:hidden">
                  <UFieldGroup>
                    <UButton
                      v-for="item in [{ value: 'list', label: '列表' }, { value: 'hierarchy', label: '层级' }]"
                      :key="item.value"
                      color="neutral"
                      :variant="view === item.value ? 'solid' : 'outline'"
                      :disabled="item.value === 'hierarchy' && Boolean(search.trim() || ownerFilter || industryFilter || regionFilter || updatedDateFrom || updatedDateTo)"
                      @click="view = item.value"
                    >
                      {{ item.label }}
                    </UButton>
                  </UFieldGroup>
                  <USelect
                    v-model="customerSort"
                    :items="customerSortOptions"
                    aria-label="客户排序"
                    class="w-full"
                  />
                  <p class="text-sm font-medium">
                    显示列
                  </p><UCheckbox
                    v-for="column in optionalColumns"
                    :key="column.key"
                    :model-value="visibleColumns.includes(column.key)"
                    :label="column.label"
                    @update:model-value="value => visibleColumns = value ? [...visibleColumns, column.key] : visibleColumns.filter(key => key !== column.key)"
                  />
                  <UButton
                    color="neutral"
                    variant="outline"
                    :disabled="!scopeKey || accessStatus !== 'ready'"
                    @click="saveColumns"
                  >
                    保存本机视图
                  </UButton>
                  <UButton
                    v-if="hasListFilters"
                    color="neutral"
                    variant="ghost"
                    @click="clearFilters"
                  >
                    清除筛选
                  </UButton>
                </div>
              </div>
            </template>
          </UPopover>
          <div class="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
            <UFieldGroup>
              <UButton
                v-for="item in [{ value: 'list', label: '列表' }, { value: 'hierarchy', label: '层级' }]"
                :key="item.value"
                color="neutral"
                :variant="view === item.value ? 'solid' : 'outline'"
                :disabled="item.value === 'hierarchy' && Boolean(search.trim() || ownerFilter || industryFilter || regionFilter || updatedDateFrom || updatedDateTo)"
                @click="view = item.value"
              >
                {{ item.label }}
              </UButton>
            </UFieldGroup>
            <USelect
              v-model="customerSort"
              :items="customerSortOptions"
              aria-label="客户排序"
              class="w-32"
            />
            <UPopover>
              <UButton
                color="neutral"
                variant="outline"
                label="显示列"
              />
              <template #content>
                <div class="space-y-3 p-4">
                  <div class="flex items-center justify-between gap-4">
                    <p class="text-sm font-medium">
                      显示列
                    </p><UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      :disabled="!scopeKey || accessStatus !== 'ready'"
                      @click="saveColumns"
                    >
                      保存本机视图
                    </UButton>
                  </div><UCheckbox
                    v-for="column in optionalColumns"
                    :key="column.key"
                    :model-value="visibleColumns.includes(column.key)"
                    :label="column.label"
                    @update:model-value="value => visibleColumns = value ? [...visibleColumns, column.key] : visibleColumns.filter(key => key !== column.key)"
                  />
                </div>
              </template>
            </UPopover>
            <UButton
              v-if="hasListFilters"
              color="neutral"
              variant="ghost"
              icon="i-lucide-filter-x"
              aria-label="清除筛选"
              @click="clearFilters"
            />
          </div>
        </div>
        <W3CustomerHierarchy
          v-if="view === 'hierarchy'"
          :status-filter="statusFilter"
          :owner-unassigned="ownerUnassigned"
        />
        <template v-else>
          <div class="min-w-0 max-w-full overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
              :loading="pending || (!loaded && !permissionError)"
              class="w-full"
            >
              <template #code-cell="{ row }">
                <span class="block max-w-32 truncate font-mono text-xs">{{ row.original.code }}</span>
              </template>
              <template #name-cell="{ row }">
                <NuxtLink
                  :to="{ path: `/altoc/customers/${row.original.id}`, query: { ...listReturnQuery, returnPage: String(page), tab: 'basic' } }"
                  class="block max-w-40 truncate text-primary sm:max-w-64"
                >{{ row.original.name }}</NuxtLink>
                <p class="max-w-40 truncate text-xs text-muted">
                  {{ row.original.code }} · {{ w3OwnerLabel(row.original.owner_uid, userName(row.original.owner_uid)) }}
                </p>
                <p
                  v-if="row.original.parentHidden"
                  class="text-xs text-muted"
                >
                  部分上级无权查看
                </p>
                <p
                  v-if="debounced && row.original.ancestors"
                  class="text-xs text-muted break-words"
                >
                  {{ (row.original.ancestors as W3Record[]).map(parent => parent.name).join(' / ') }}
                </p>
                <p
                  v-if="row.original.parent"
                  class="max-w-40 truncate text-xs text-muted sm:hidden"
                >
                  上级：{{ (row.original.parent as W3Record).name }}
                </p>
              </template>
              <template #childCount-cell="{ row }">
                {{ row.original.childCount ?? '—' }}
              </template>
              <template #parent-cell="{ row }">
                <NuxtLink
                  v-if="row.original.parent"
                  :to="`/altoc/customers/${(row.original.parent as W3Record).id}`"
                  class="block max-w-48 truncate text-primary"
                >{{ (row.original.parent as W3Record).name }}</NuxtLink><span v-else>—</span>
              </template>
              <template #owner_uid-cell="{ row }">
                {{ w3OwnerLabel(row.original.owner_uid, userName(row.original.owner_uid)) }}
              </template>
              <template #status-cell="{ row }">
                <UBadge
                  :color="customerStatusColor(row.original.status)"
                  variant="subtle"
                >
                  {{ statusLabels[String(row.original.status)] || '未知状态' }}
                </UBadge>
              </template>
              <template #actions-cell="{ row }">
                <UButton
                  :to="{ path: `/altoc/customers/${row.original.id}`, query: { ...listReturnQuery, returnPage: String(page), tab: 'basic' } }"
                  color="neutral"
                  variant="ghost"
                  class="min-h-11"
                >
                  查看
                </UButton>
              </template>
              <template #primary_contact_name-cell="{ row }">
                <span>{{ row.original.primary_contact_name || '尚未指定' }}</span>
              </template>
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-users"
                  :title="debounced || statusFilter !== 'all' || rootsOnly || ownerUnassigned || ownerFilter || industryFilter || regionFilter || updatedDateFrom || updatedDateTo ? '没有符合条件的客户' : '暂无客户'"
                  :description="canEdit ? '调整搜索条件，或新建客户。' : '调整搜索条件后重试。'"
                >
                  <UButton
                    v-if="canEdit"
                    @click="begin('customer')"
                  >
                    新建客户
                  </UButton>
                </CommonEmptyState>
              </template>
            </UTable>
          </div>
          <p>共 {{ total }} 条</p><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
          />
        </template>
      </template>
      <template v-else-if="customer">
        <UAlert
          v-if="directoryError"
          color="warning"
          title="目录信息加载失败"
          description="姓名或部门暂不可用，不影响客户资料读取。"
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              @click="refreshDirectory()"
            >
              重试
            </UButton>
          </template>
        </UAlert>
        <div class="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <UCard class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="break-all font-mono text-sm text-muted">{{ customer.code }}</span><UBadge
                :color="customerStatusColor(customer.status)"
                variant="subtle"
              >
                {{ statusLabels[String(customer.status)] || '其他状态' }}
              </UBadge>
            </div>
            <dl class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div class="min-w-0">
                <dt class="text-xs text-muted">
                  负责人
                </dt><dd class="break-words text-sm">
                  {{ w3OwnerLabel(customer.owner_uid, userName(customer.owner_uid)) }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-muted">
                  上级客户
                </dt><dd class="break-words text-sm">
                  <NuxtLink
                    v-if="customer.parent"
                    :to="`/altoc/customers/${(customer.parent as Row).id}`"
                    class="text-primary"
                  >{{ (customer.parent as Row).name }}</NuxtLink><span v-else>{{ customer.parentHidden ? '上级受限' : '无上级客户' }}</span>
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-muted">
                  行业 / 地区
                </dt><dd class="break-words text-sm">
                  {{ customer.industry_code || '未记录' }} / {{ customer.region_code || '未记录' }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-muted">
                  负责部门
                </dt><dd class="break-words text-sm">
                  {{ departmentName(customer.owner_dept_code) || '未记录' }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-muted">
                  主联系人
                </dt><dd class="break-words text-sm">
                  {{ customer.primary_contact_name || '尚未指定' }}
                </dd>
              </div>
            </dl>
            <W3CustomerActions
              ref="customerActions"
              class="mt-3"
              :customer="customer"
              :contacts="contacts"
              @changed="load"
            />
          </UCard>
          <UCard class="min-w-0">
            <h2 class="text-sm text-muted">
              本客户可见销售合同额
            </h2>
            <p
              v-if="contractState"
              role="status"
              class="mt-2 text-sm text-muted"
            >
              {{ contractState }}
            </p>
            <template v-else-if="contractSummary">
              <p
                v-for="amount in summaryAmounts"
                :key="String(amount.currency_code)"
                class="mt-2 break-words text-xl tabular-nums"
              >
                {{ formatMoney(String(amount.amount), { currency: String(amount.currency_code) }) }}
              </p><p
                v-if="!summaryAmounts.length"
                class="mt-2 text-sm text-muted"
              >
                暂无可汇总的合同金额
              </p><p class="mt-2 text-xs text-muted">
                可见销售合同 {{ contractSummary.count }} 份；仅本客户，不含下属。按币种显示，排除中止、取消及采购合同。
              </p>
            </template>
          </UCard>
        </div>
        <div class="min-w-0 max-w-full overflow-x-auto">
          <UTabs
            v-model="detailTab"
            :items="detailTabs"
            :content="false"
            class="min-w-max"
          />
        </div>
        <section
          v-if="detailTab === 'basic'"
          class="min-w-0 space-y-4"
        >
          <div class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <UCard
              v-for="group in detailGroups"
              :key="group.title"
              class="min-w-0"
            >
              <h2 class="mb-3 font-semibold">
                {{ group.title }}
              </h2><dl class="grid grid-cols-1 gap-3">
                <div
                  v-for="key in group.fields"
                  :key="key"
                  class="min-w-0"
                >
                  <dt class="text-sm text-muted">
                    {{ labels[key] }}
                  </dt><dd class="break-words text-sm">
                    {{ displayValue(key, customer[key]) }}
                  </dd>
                </div>
              </dl>
            </UCard>
          </div>
          <p class="text-sm text-muted">
            客户等级：{{ !Object.hasOwn(customer, 'customer_level_id') ? '等级信息未提供' : customer.customer_level_id == null ? '未定级' : (customer.customer_level_name || '等级字典未提供') }} · 排序号：{{ customer.sort_no ?? '—' }}
          </p>
          <p
            v-if="customer.contact_name_text"
            class="break-words text-sm"
          >
            联系人（原系统手填，未关联档案）：{{ customer.contact_name_text }}
          </p>
          <UButton
            color="neutral"
            variant="ghost"
            @click="showOptional = !showOptional"
          >
            {{ showOptional ? '收起补充资料' : '查看补充资料' }}
          </UButton>
          <details class="min-w-0 rounded-lg border border-muted p-4">
            <summary class="cursor-pointer font-medium">
              客户层级与历史经营快照
            </summary><W3CustomerOverview
              :customer="customer"
              class="mt-4"
            />
          </details>
          <section class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold">
                开票资料
              </h2><UButton
                v-if="canEdit"
                color="neutral"
                variant="outline"
                @click="begin('invoice')"
              >
                新增开票资料
              </UButton>
            </div><div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <UCard
                v-for="row in profiles"
                :key="String(row.code)"
                class="min-w-0"
              >
                <p class="break-words">
                  {{ row.taxpayer_name }} <UBadge
                    v-if="row.is_default"
                    variant="subtle"
                  >
                    默认
                  </UBadge>
                </p><p class="mt-1 break-all text-sm text-muted">
                  {{ row.taxpayer_no || '未记录' }}
                </p><div
                  v-if="canEdit"
                  class="mt-3 flex flex-wrap gap-2"
                >
                  <UButton
                    color="neutral"
                    variant="outline"
                    @click="begin('invoice', row)"
                  >
                    编辑
                  </UButton><UButton
                    v-if="!row.is_default && row.status === 'active'"
                    color="neutral"
                    variant="outline"
                    @click="makeDefault(row)"
                  >
                    设为默认
                  </UButton><UButton
                    color="error"
                    variant="ghost"
                    @click="remove('invoice-profiles', row)"
                  >
                    删除
                  </UButton>
                </div>
              </UCard>
            </div><CommonEmptyState
              v-if="!profiles.length"
              title="暂无开票资料"
              description="可由有权用户维护客户开票资料。"
            />
          </section>
        </section>
        <section
          v-if="detailTab === 'contacts'"
          class="min-w-0 space-y-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">
              联系人
            </h2><UButton
              v-if="canEdit"
              @click="begin('contact')"
            >
              新增联系人
            </UButton>
          </div><AltocCustomerContacts
            :customer="customer"
            :can-edit="canEdit"
            @edit="begin('contact', $event)"
            @star="customerActions?.begin('star', $event)"
            @remove="remove('contacts', $event)"
          />
        </section>
        <AltocReceivablesPage
          v-if="detailTab === 'receivables'"
          :customer-id="String(customer.id)"
          embedded
        />
        <AltocCustomerContracts
          :customer-id="String(customer.id)"
          :active="detailTab === 'contracts'"
          @summary="contractSummary = $event"
          @state="contractState = $event"
        />
        <section
          v-if="detailTab === 'source'"
          class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
        >
          <UCard class="min-w-0">
            <h2 class="mb-3 font-semibold">
              来源与审计
            </h2><W3SourceInfo
              v-if="customer.source_info"
              :source="customer.source_info as Row"
            /><p
              v-else
              class="text-sm text-muted"
            >
              未记录迁移来源。
            </p><p
              v-if="customer.source_owner_name"
              class="mt-3 break-words text-sm"
            >
              原负责人：{{ customer.source_owner_name }}
            </p><p class="mt-3 text-xs text-muted">
              完整审计事件读取尚未接入；此处仅展示已提供的来源事实。
            </p>
          </UCard><div class="min-w-0 space-y-4">
            <AltocKnowledgePanel :customer-id="String(customer.id)" /><AltocFinancialSummaryPanel :customer-id="String(customer.id)" />
          </div>
        </section>
        <section
          v-if="detailTab === 'timeline'"
          class="min-w-0 space-y-3"
        >
          <h2 class="font-semibold">
            已记录事件
          </h2><p class="text-sm text-muted">
            仅展示记录时间，不推断审批、签章、收款事件或操作人。
          </p><ol
            v-if="timeline.length"
            class="space-y-3"
          >
            <li
              v-for="event in timeline"
              :key="event.label"
              class="rounded-lg border border-muted p-3"
            >
              <p class="text-sm font-medium">
                {{ event.label }}
              </p><time class="break-words text-sm text-muted">{{ event.at }}</time>
            </li>
          </ol><CommonEmptyState
            v-else
            title="暂无可展示的事件"
          />
        </section>
      </template>
      <USlideover
        v-model:open="open"
        :title="editorTitle"
        description="按分组填写资料，星号为必填项；保存时会复核权限和版本。"
        :dismissible="!saving"
        :ui="{ content: 'w-full sm:max-w-3xl' }"
      >
        <template #body>
          <form
            id="altoc-customer-form"
            class="space-y-6"
            @submit.prevent="save"
          >
            <UAlert
              v-if="formError"
              color="error"
              title="保存失败"
              :description="formError"
            />
            <section
              v-for="group in fieldGroups"
              :key="group.title"
              class="space-y-3"
            >
              <h2 class="font-semibold">
                {{ group.title }}
              </h2>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <UFormField
                  v-for="key in group.fields"
                  :key="key"
                  :label="labels[key]"
                  :error="fieldErrors[key]"
                  :required="['name', 'taxpayer_name', 'owner_uid', 'invoice_type'].includes(key)"
                  :class="['description', 'remark', 'owner_dept_code'].includes(key) ? 'sm:col-span-2' : ''"
                >
                  <UserTreeSelector
                    v-if="key === 'owner_uid'"
                    v-model="selectedOwner"
                    selection-mode="single"
                    hide-committees
                    width-class="w-full"
                  />
                  <APFDepartmentSelect
                    v-else-if="key === 'owner_dept_code'"
                    v-model="draft.owner_dept_code"
                  />
                  <template v-else-if="optionsFor(key).length">
                    <USelectMenu
                      v-model="draft[key]"
                      value-key="value"
                      :items="selectOptions(key)"
                      placeholder="请选择"
                      class="w-full"
                    />
                    <UButton
                      v-if="!['invoice_type', 'status'].includes(key) && draft[key]"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      @click="draft[key] = ''"
                    >
                      清除（可选）
                    </UButton>
                  </template>
                  <UTextarea
                    v-else-if="['description', 'remark', 'address', 'mailing_address'].includes(key)"
                    v-model="draft[key]"
                    :maxlength="customerFieldLimit(mode, key)"
                    class="w-full"
                  />
                  <UInput
                    v-else
                    v-model="draft[key]"
                    :maxlength="customerFieldLimit(mode, key)"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </section>
          </form>
        </template>
        <template #footer>
          <div class="flex w-full flex-wrap justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="open = false"
            >
              取消
            </UButton><UButton
              type="submit"
              form="altoc-customer-form"
              :loading="saving"
            >
              保存{{ mode === 'owner' ? '归属' : mode === 'customer' ? '客户' : '资料' }}
            </UButton>
          </div>
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
