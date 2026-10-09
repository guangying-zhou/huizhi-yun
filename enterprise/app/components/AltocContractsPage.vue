<script setup lang="ts">
import AltocReceivablesPage from './AltocReceivablesPage.vue'
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import W3MigrationSnapshot from './W3MigrationSnapshot.vue'
import W3ChildContracts from './W3ChildContracts.vue'
import W3SourceInfo from './W3SourceInfo.vue'
import W3HistoricalContractActions from './W3HistoricalContractActions.vue'
import { historicalContract, effectiveAmountExceedsTotal, w3OwnerLabel, w3ContractCategories } from '../utils/w3Presentation'
import APFDepartmentSelect from './APFDepartmentSelect.vue'
import APFReferenceMultiSelect from './APFReferenceMultiSelect.vue'
import { apfServerFieldErrors, apfEnumLabel } from '../utils/apfFormPresentation'
import { altocContractStatusLabels, requireAltocJsonMutationResult } from '../utils/altocBusinessObjectPresentation'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { contractListViews, contractListState, contractListQuery, contractListAmount, contractListDateLabel, contractListPreference, contractEffectiveAmount, contractAmountRangeError } from '../utils/altocContractList'
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '../../../foundation/app/utils/format'
import { altocValidationMessage } from '../utils/altocHostForms'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{
  detail?: boolean
}>()
type Row = Record<string, unknown>
type Field = {
  key: string
  label: string
  type?: 'boolean'
  options?: {
    label: string
    value: string
  }[]
}
const opts = (...pairs: string[]) => pairs.map((p) => {
  const [value, label] = p.split(':')
  return { value: value!, label: label! }
})
const route = useRoute()
const router = useRouter()
const initialList = contractListState(route.query)
const listView = ref(initialList.view)
const filtersOpen = ref(false)
const signedDateFrom = ref(initialList.signedDateFrom)
const signedDateTo = ref(initialList.signedDateTo)
const businessYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()))
const { loaded, hasPermission, error: permissionError, loadPermissions } = usePermissions()
// Host composition skips the standalone Altoc permission middleware.
onMounted(() => {
  void loadPermissions()
})
const { status: accessStatus } = useEnterpriseNavigationAccess()
const cacheScope = useState<string>('enterprise-cache-scope', () => '')
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('contract', 'edit'))
const canClose = computed(() => loaded.value && !permissionError.value && hasPermission('contract', 'close'))
const contract = ref<Row | null>(null)
const rows = ref<Row[]>([])
const total = ref(0)
const summary = ref<Row | null>(null)
const pageSize = ref(initialList.pageSize)
const statusFilter = ref(initialList.status)
const customerFilter = ref(initialList.customerId)
const ownerFilter = ref(initialList.ownerUid)
const selectedFilterOwner = computed({
  get: () => ownerFilter.value ? [ownerFilter.value] : [],
  set: (v: string[]) => {
    ownerFilter.value = v[0] || ''
  }
})
const directionFilter = ref(initialList.direction)
const typeFilter = ref(initialList.contractType)
const statusChoice = computed({ get: () => statusFilter.value || 'all', set: (v: string) => {
  statusFilter.value = v === 'all' ? '' : v
} })
const directionChoice = computed({ get: () => directionFilter.value || 'all', set: (v: string) => {
  directionFilter.value = v === 'all' ? '' : v
} })
const typeChoice = computed({ get: () => typeFilter.value || 'all', set: (v: string) => {
  typeFilter.value = v === 'all' ? '' : v
} })
const amountMin = ref(initialList.amountMin)
const amountMax = ref(initialList.amountMax)
const detailTab = ref('overview')
const detailTabs = [{ label: '概览', value: 'overview' }, { label: '应收', value: 'receivables' }, { label: '履约与项目', value: 'performance' }, { label: '来源与关联', value: 'source' }]
const amountError = computed(() => contractAmountRangeError(amountMin.value, amountMax.value))
const originFilter = ref(initialList.origin)
const categoryFilter = ref(initialList.category)
const ownerUnassigned = ref(initialList.ownerUnassigned)
let restoringQuery = false
watch([pageSize, statusFilter, customerFilter, ownerFilter, directionFilter, typeFilter, amountMin, amountMax, originFilter, categoryFilter, ownerUnassigned, signedDateFrom, signedDateTo], () => {
  if (restoringQuery) return
  page.value = 1
})
const page = ref(initialList.page)
const { search, debounced, flush } = useDebouncedSearch({
  initial: initialList.search,
  onChange: () => {
    if (!restoringQuery) page.value = 1
  }
})
const listState = computed(() => ({ page: page.value, pageSize: pageSize.value, status: statusFilter.value, customerId: customerFilter.value, ownerUid: ownerFilter.value, direction: directionFilter.value, contractType: typeFilter.value, amountMin: amountMin.value, amountMax: amountMax.value, search: debounced.value, origin: originFilter.value, category: categoryFilter.value, ownerUnassigned: ownerUnassigned.value, signedDateFrom: signedDateFrom.value, signedDateTo: signedDateTo.value, view: listView.value }))
const listQuery = computed(() => contractListQuery(listState.value, businessYear))
const activeFilterCount = computed(() => [statusFilter.value, customerFilter.value, ownerFilter.value, directionFilter.value, typeFilter.value, amountMin.value, amountMax.value].filter(Boolean).length + Number(originFilter.value !== 'all') + Number(categoryFilter.value !== 'all') + Number(ownerUnassigned.value) + Number(Boolean(listQuery.value.signedDateFrom)) + Number(Boolean(listQuery.value.signedDateTo)))
const hasListFilters = computed(() => activeFilterCount.value > 0 || Boolean(debounced.value.trim()))
const dateError = computed(() => listQuery.value.signedDateFrom && listQuery.value.signedDateTo && listQuery.value.signedDateFrom > listQuery.value.signedDateTo ? '起始签约日不能晚于截止日' : '')
watch(listView, (value) => {
  if (restoringQuery) return
  originFilter.value = value === 'historical' ? 'historical_import' : 'all'
  ownerUnassigned.value = value === 'unassigned'
  signedDateFrom.value = ''
  signedDateTo.value = ''
  page.value = 1
})
function clearListFilters() {
  listView.value = 'all'
  originFilter.value = 'all'
  categoryFilter.value = 'all'
  ownerUnassigned.value = false
  signedDateFrom.value = ''
  signedDateTo.value = ''
  statusFilter.value = customerFilter.value = ownerFilter.value = directionFilter.value = typeFilter.value = amountMin.value = amountMax.value = ''
  search.value = ''
  flush()
  page.value = 1
}
const optionalColumns = [{ key: 'contract_category', label: '类别' }, { key: 'effective_amount', label: '有效合同额' }, { key: 'owner_uid', label: '负责人' }, { key: 'direction', label: '方向' }, { key: 'effective_date', label: '生效日期' }, { key: 'end_date', label: '结束日期' }]
const showExtendedColumns = ref(false)
const visibleColumns = ref(['contract_category', 'effective_amount', 'owner_uid'])
function preferenceKey(scope: string) {
  return `apf-contract-list:v1:${scope}`
}
function saveListView() {
  if (typeof window === 'undefined' || !cacheScope.value || accessStatus.value !== 'ready') return
  try {
    window.localStorage.setItem(preferenceKey(cacheScope.value), JSON.stringify(contractListPreference({ columns: visibleColumns.value, expanded: showExtendedColumns.value })))
    toast.add({ title: '已保存本机视图', description: '仅保存显示列设置，不保存搜索文字或合同内容。', color: 'success' })
  } catch {
    toast.add({ title: '无法保存本机视图', color: 'error' })
  }
}
watch(cacheScope, (scope, oldScope) => {
  if (typeof window === 'undefined') return
  try {
    if (oldScope && oldScope !== scope) window.localStorage.removeItem(preferenceKey(oldScope))
    const value = scope ? window.localStorage.getItem(preferenceKey(scope)) : null
    if (!value || Object.keys(route.query).length) return
    const preference = contractListPreference(JSON.parse(value))
    visibleColumns.value = preference.columns
    showExtendedColumns.value = preference.expanded
  } catch { /* Browser storage is optional; the server query remains authoritative. */ }
}, { immediate: true })

const listColumns = computed<TableColumn<Row>[]>(() => [
  { accessorKey: 'signed_date', header: '签约日期 ↓', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell whitespace-nowrap' } } },
  { accessorKey: 'name', header: '合同名称 / 编号', meta: { class: { th: 'sm:sticky sm:left-0 bg-default', td: 'sm:sticky sm:left-0 bg-default' } } },
  ...optionalColumns.filter(c => visibleColumns.value.includes(c.key)).slice(0, 1).map(c => ({ accessorKey: c.key, header: c.label, meta: { class: { th: showExtendedColumns.value ? '' : 'hidden sm:table-cell', td: showExtendedColumns.value ? '' : 'hidden sm:table-cell' } } })),
  { accessorKey: 'customer_name', header: '客户', meta: { class: { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell max-w-48 whitespace-normal break-words' } } },
  { id: 'contract_amount', header: '合同金额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums whitespace-nowrap' } } },
  ...optionalColumns.filter(c => visibleColumns.value.includes(c.key)).slice(1).map(c => ({ accessorKey: c.key, header: c.label, meta: { class: { th: (showExtendedColumns.value ? '' : 'hidden sm:table-cell') + (c.key === 'effective_amount' ? ' text-right' : ''), td: (showExtendedColumns.value ? 'whitespace-nowrap' : 'hidden sm:table-cell whitespace-nowrap') + (c.key === 'effective_amount' ? ' text-right tabular-nums' : '') } } })),
  { accessorKey: 'status', header: '业务状态' }, { id: 'actions', header: '操作' }
])
const pending = ref(false)
const saving = ref(false)
const formError = ref('')
const formFields = ref<Record<string, string>>({})
const money = (value: unknown, currency: unknown) => formatMoney(value === null || value === undefined || value === '' ? null : String(value), { currency: String(currency || 'CNY') })
const error = ref('')
const id = computed(() => String(route.params.contractId || ''))
const base = '/altoc/api/v1/contracts'
const parent = computed(() => `${base}/${encodeURIComponent(id.value)}`)
const historical = computed(() => historicalContract(contract.value))
const editable = computed(() => !historical.value && canEdit.value && ['draft', 'rejected'].includes(String(contract.value?.status)))
const toast = useToast()
const { confirm } = useConfirm()
const intent = createConsoleMutationIntent('altoc-contract')
const open = ref(false)
const mode = ref('header')
const draft = reactive<Record<string, string> & { customerId: string, quotationId: string }>({ name: '', customerId: '', quotationId: '', contract_no: '', currency_code: 'CNY', direction: 'sales', sign_date: '', effective_date: '', end_date: '', content_summary: '', remark: '' })
const editingRows = ref<Row[]>([])
const selectedProjects = ref<Row[]>([])
const rejectReason = ref('')
const rejectCode = ref('')
let epoch = 0
const labels = altocContractStatusLabels
const fields: Record<string, Field[]> = {
  lines: [{ key: 'line_type', label: '行类型', options: opts('software_license:软件许可', 'implementation:实施', 'customization:定制', 'service:服务', 'maintenance:维保', 'hardware:硬件', 'training:培训', 'other:其它') }, { key: 'name', label: '名称' }, { key: 'quantity', label: '数量' }, { key: 'unit', label: '单位' }, { key: 'unit_price', label: '单价' }, { key: 'tax_rate', label: '税率 %' }, { key: 'acceptance_required', label: '需要验收', type: 'boolean' }, { key: 'project_policy', label: '项目策略', options: opts('none:无需项目', 'optional:可选项目', 'required:必须关联项目') }],
  payment_terms: [{ key: 'contract_line_code', label: '合同行', options: [] }, { key: 'term_name', label: '条款名称' }, { key: 'term_type', label: '条款类型', options: opts('one_time:一次性', 'advance:预付', 'milestone:里程碑', 'acceptance:验收', 'retention:质保', 'annual_service:年度服务', 'recurring:周期') }, { key: 'amount', label: '金额（比例为空时）' }, { key: 'ratio', label: '比例 %（可空）' }, { key: 'trigger_type', label: '触发条件', options: opts('contract_signed:合同签署', 'obligation_completed:义务完成', 'obligation_accepted:义务验收', 'milestone_accepted:里程碑验收', 'date:日期', 'recurring:周期', 'manual:人工') }, { key: 'trigger_obligation_code', label: '履约义务', options: [] }, { key: 'expected_date', label: '预计日期 YYYY-MM-DD' }, { key: 'recurrence_interval', label: '周期', options: opts('month:月', 'quarter:季', 'year:年') }, { key: 'service_start_date', label: '服务开始日期' }, { key: 'service_end_date', label: '服务结束日期' }, { key: 'invoice_required', label: '需要开票', type: 'boolean' }],
  obligations: [{ key: 'contract_line_code', label: '合同行', options: [] }, { key: 'obligation_type', label: '义务类型', options: opts('delivery:交付', 'acceptance:验收', 'service_period:服务期间', 'service_delivery:服务交付', 'goods_delivery:货物交付', 'training:培训', 'warranty:保修') }, { key: 'name', label: '名称' }, { key: 'acceptance_required', label: '需要验收', type: 'boolean' }]
}
const ownerUids = computed(() => [...rows.value.map(r => String(r.owner_uid || '')), String(contract.value?.owner_uid || '')])
const { userName, departmentName, directoryError } = useAltocDirectoryLabels(ownerUids)
const editorTitle = computed(() => mode.value === 'header' ? props.detail ? '编辑合同' : '新建合同' : mode.value === 'from-quotation' ? '由报价转合同' : mode.value === 'projects' ? '关联交付项目' : mode.value === 'activate' ? '启动履约' : mode.value === 'reject' ? '退回履约' : ({ lines: '编辑合同行', payment_terms: '编辑付款条款', obligations: '编辑履约义务' } as Record<string, string>)[mode.value] || '编辑合同')
function sectionColumns(key: string): TableColumn<Row>[] {
  return [{ accessorKey: key === 'payment_terms' ? 'term_name' : key === 'project_links' ? 'project_name_snapshot' : 'name', header: '名称' }, { accessorKey: key === 'project_links' ? 'project_code' : 'code', header: '编号' }, ...(['lines', 'payment_terms', 'billing_schedules'].includes(key) ? [{ accessorKey: key === 'lines' ? 'amount_tax_inclusive' : 'amount', header: '金额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }] : []), ...(['payment_terms', 'project_links'].includes(key) ? [] : [{ accessorKey: 'status', header: '状态' }]), { id: 'actions', header: '操作' }]
}
const sections = [{ key: 'lines', title: '合同行' }, { key: 'payment_terms', title: '付款条款' }, { key: 'obligations', title: '履约义务' }, { key: 'billing_schedules', title: '结算计划' }, { key: 'project_links', title: '关联项目' }]
function children(key: string): Row[] {
  return (contract.value?.[key] || []) as Row[]
}
const activeFields = computed(() => (fields[mode.value] || []).map(f => f.key === 'contract_line_code' ? { ...f, options: [{ label: '合同级', value: '' }, ...children('lines').map(r => ({ label: String(r.name), value: String(r.code) }))] } : f.key === 'trigger_obligation_code' ? { ...f, options: [{ label: '无', value: '' }, ...children('obligations').map(r => ({ label: String(r.name), value: String(r.code) }))] } : f))
async function load() {
  const current = ++epoch
  if (!cacheScope.value || accessStatus.value !== 'ready') {
    rows.value = []
    contract.value = null
    total.value = 0
    summary.value = null
    pending.value = false
    return
  }
  if (!props.detail && (dateError.value || amountError.value)) return
  pending.value = true
  error.value = ''
  try {
    const result = await $fetch<{
      data: Row
    }>(props.detail ? parent.value : base, { query: props.detail ? {} : listQuery.value })
    if (current !== epoch)
      return
    if (props.detail)
      contract.value = result.data
    else {
      rows.value = result.data.items as Row[]
      total.value = Number(result.data.total)
      summary.value = result.data.summary as Row || null
    }
  } catch (failure) {
    if (current === epoch) {
      const status = Number((failure as { statusCode?: number, status?: number }).statusCode || (failure as { status?: number }).status)
      error.value = status === 403 ? '无合同查看权限' : status === 503 ? '合同服务暂不可用，请稍后重试' : '合同加载失败，请重试'
      if (status === 403) {
        rows.value = []
        contract.value = null
        total.value = 0
        summary.value = null
      }
    }
  } finally {
    if (current === epoch)
      pending.value = false
  }
}
watch([id, listQuery, cacheScope, accessStatus], () => {
  if (!props.detail) {
    const query = listQuery.value
    void router.replace({ query: Object.fromEntries(Object.entries({ ...query, ...(listView.value !== 'all' ? { view: listView.value } : {}) }).map(([key, value]) => [key, String(value)])) })
  }
  void load()
}, { immediate: true })
watch(() => route.query, (query) => {
  if (props.detail) return
  const next = contractListState(query)
  if (JSON.stringify(contractListQuery(next, businessYear)) === JSON.stringify(listQuery.value) && next.view === listView.value) return
  restoringQuery = true
  pageSize.value = next.pageSize
  statusFilter.value = next.status
  customerFilter.value = next.customerId
  ownerFilter.value = next.ownerUid
  directionFilter.value = next.direction
  typeFilter.value = next.contractType
  amountMin.value = next.amountMin
  amountMax.value = next.amountMax
  originFilter.value = next.origin
  categoryFilter.value = next.category
  ownerUnassigned.value = next.ownerUnassigned
  signedDateFrom.value = next.signedDateFrom
  signedDateTo.value = next.signedDateTo
  listView.value = next.view
  search.value = next.search
  flush()
  page.value = next.page
  void nextTick(() => {
    restoringQuery = false
  })
})
watch([id, cacheScope], () => {
  rows.value = []
  contract.value = null
  total.value = 0
  summary.value = null
  open.value = false
})
onScopeDispose(() => {
  epoch++
})
function begin(kind: string) {
  if (!intent.reset()) {
    toast.add({ title: '请先重试未完成的操作', color: 'warning' })
    return
  }
  formError.value = ''
  formFields.value = {}
  mode.value = kind
  for (const k of Object.keys(draft))
    draft[k] = String(contract.value?.[k] ?? (k === 'currency_code' ? 'CNY' : k === 'direction' ? 'sales' : ''))
  editingRows.value = children(kind).map(row => Object.fromEntries(['id', ...(fields[kind] || []).map(f => f.key)].map(k => [k, (fields[kind] || []).find(f => f.key === k)?.type === 'boolean' ? row[k] === true || Number(row[k]) === 1 : row[k] ?? (k === 'contract_line_code' ? children('lines').find(l => l.id === row.contract_line_id)?.code || '' : k === 'trigger_obligation_code' ? children('obligations').find(o => o.id === row.trigger_obligation_id)?.code || '' : '')])))
  selectedProjects.value = []
  open.value = true
}
function addRow() {
  editingRows.value.push(mode.value === 'lines' ? { line_type: 'implementation', name: '', quantity: '1.0000', unit: '', unit_price: '0.00', tax_rate: '6.00', acceptance_required: true, project_policy: 'optional' } : mode.value === 'payment_terms' ? { contract_line_code: '', term_name: '', term_type: 'one_time', amount: '0.00', ratio: '', trigger_type: 'contract_signed', trigger_obligation_code: '', expected_date: '', recurrence_interval: 'month', service_start_date: '', service_end_date: '', invoice_required: true } : { contract_line_code: '', obligation_type: 'delivery', name: '', acceptance_required: true })
}
async function send(path: string, method: 'POST' | 'PATCH', body: Row) {
  if (saving.value || !cacheScope.value || accessStatus.value !== 'ready')
    return
  const current = epoch
  saving.value = true
  try {
    const done = await intent.submit({ path, method, body }, async (r, key) => requireAltocJsonMutationResult(await $fetch(r.path, { method: r.method, body: r.body, headers: { 'Idempotency-Key': key }, retry: 0 })))
    if (done && current === epoch) {
      open.value = false
      await load()
      toast.add({ title: '已保存', color: 'success' })
    }
  } catch (e) {
    formFields.value = { ...formFields.value, ...apfServerFieldErrors(e, Object.keys(body)) }
    formError.value = altocValidationMessage(e)
    toast.add({ title: '保存失败', description: formError.value, color: 'error' })
  } finally {
    saving.value = false
  }
}
async function save() {
  formError.value = ''
  formFields.value = {}
  if (['header', 'from-quotation'].includes(mode.value)) {
    if (!draft.name?.trim()) formFields.value.name = '请填写合同名称'
    if (!props.detail) {
      const key = mode.value === 'from-quotation' ? 'quotationId' : 'customerId'
      if (!/^[1-9]\d*$/.test(draft[key]?.trim() || '')) formFields.value[key] = '请填写有权访问的业务对象编号'
    }
  }
  if (mode.value === 'reject' && !rejectReason.value.trim()) formFields.value.reason = '请填写退回原因'
  if (Object.keys(formFields.value).length) return
  const expectedVersion = contract.value?.row_version
  if (mode.value === 'reject') return send(`${parent.value}/obligations/transition`, 'POST', { expectedVersion, action: 'reject', obligationCode: rejectCode.value, reason: rejectReason.value.trim() })
  if (['projects', 'activate'].includes(mode.value)) {
    const projects = selectedProjects.value.map(p => ({ ...p, lineCodes: String(p.lineCodes || '').split(',').map(s => s.trim()).filter(Boolean), obligationCodes: String(p.obligationCodes || '').split(',').map(s => s.trim()).filter(Boolean), billingScheduleCodes: String(p.billingScheduleCodes || '').split(',').map(s => s.trim()).filter(Boolean) }))
    return send(`${parent.value}/${mode.value === 'activate' ? 'activate' : 'projects'}`, 'POST', { expectedVersion, projects })
  }
  if (fields[mode.value]) {
    const cleaned = editingRows.value.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ['ratio', 'expected_date', 'service_start_date', 'service_end_date', 'contract_line_code', 'trigger_obligation_code'].includes(k) && v === '' ? null : v]).filter(([k]) => !(k === 'recurrence_interval' && !['annual_service', 'recurring'].includes(String(r.term_type)) && r.trigger_type !== 'recurring') && !(k === 'amount' && r.ratio))))
    return send(`${parent.value}/${mode.value === 'payment_terms' ? 'payment-terms' : mode.value}`, 'PATCH', { expectedVersion, rows: cleaned })
  }
  const body: Row = Object.fromEntries(['name', 'contract_no', 'sign_date', 'effective_date', 'end_date', 'content_summary', 'remark'].map(k => [k, draft[k] || (k === 'name' ? '' : null)]))
  if (props.detail)
    body.expectedVersion = expectedVersion
  else {
    body.direction = draft.direction
    if (mode.value === 'from-quotation')
      body.quotationId = draft.quotationId
    else {
      body.customerId = draft.customerId
      body.currency_code = draft.currency_code
    }
  }
  return send(props.detail ? parent.value : mode.value === 'from-quotation' ? `${base}/from-quotation` : base, props.detail ? 'PATCH' : 'POST', body)
}
function beginReject(row: Row) {
  begin('reject')
  rejectCode.value = String(row.code)
  rejectReason.value = ''
}
async function action(path: string, title: string, extra: Row = {}) {
  if (!await confirm({ title, message: '将推进合同或履约状态，当前权限与版本会重新核验。', tone: 'warning' }))
    return
  // Uncertain delivery retains its key; submit only permits the identical intent.
  intent.reset()
  await send(`${parent.value}/${path}`, 'POST', { expectedVersion: contract.value?.row_version, ...extra })
}
</script>

<template>
  <UDashboardPanel id="altoc-contracts">
    <template #header>
      <ContentPageHeader
        class="px-4 pt-4 sm:px-6 sm:pt-6"
        :title="detail ? String(contract?.name || '合同详情') : '合同'"
        hosted
        breadcrumb="销售 / 合同管理 / 合同"
        :description="detail ? '维护合同行、付款条款、履约义务与项目关联。' : '按签约日期倒序查看合同，原生与历史金额分别标明口径。'"
      >
        <template #actions>
          <UButton
            v-if="detail"
            :to="{ path: '/altoc/contracts', query: route.query }"
            color="neutral"
            variant="ghost"
          >
            返回合同列表
          </UButton><template v-if="canEdit">
            <UButton
              v-if="!detail"
              @click="begin('header')"
            >
              新建合同
            </UButton><UButton
              v-if="!detail"
              variant="outline"
              @click="begin('from-quotation')"
            >
              由报价转合同
            </UButton><UButton
              v-if="detail && editable"
              @click="begin('header')"
            >
              编辑合同
            </UButton>
          </template>
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
        v-if="detail && error"
        color="error"
        :description="error"
      />
      <div
        v-if="!detail"
        class="space-y-3"
      >
        <div
          v-if="summary && !error"
          class="grid grid-cols-2 gap-3"
          aria-label="当前查询汇总"
        >
          <UCard>
            <p class="text-sm text-muted">
              符合条件的合同
            </p><p class="mt-1 text-xl font-semibold tabular-nums">
              {{ summary.count }}
            </p>
          </UCard>
          <UCard>
            <p class="text-sm text-muted">
              当前合同额合计（按币种）
            </p><p
              v-for="amount in (summary.amounts as Row[] || [])"
              :key="String(amount.currency_code)"
              class="mt-1 text-sm tabular-nums"
            >
              {{ money(amount.amount, amount.currency_code) }}
            </p>
          </UCard>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <USelect
            v-model="listView"
            :items="contractListViews"
            aria-label="合同视图"
            class="min-h-11 w-36"
          />
          <UInput
            v-model="search"
            placeholder="搜索合同编号、名称或可见客户"
            aria-label="搜索合同"
            class="order-last w-full sm:order-none sm:w-72"
            @keyup.enter="flush"
          />
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-11"
            :label="`筛选${activeFilterCount ? ` · ${activeFilterCount}` : ''}`"
            @click="filtersOpen = true"
          />
          <UPopover>
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-11"
              label="显示列"
            /><template #content>
              <div class="space-y-3 p-4">
                <div class="flex items-center justify-between gap-4">
                  <p class="text-sm font-medium">
                    显示列
                  </p>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="!cacheScope || accessStatus !== 'ready'"
                    label="保存本机视图"
                    @click="saveListView"
                  />
                </div><UCheckbox
                  v-model="showExtendedColumns"
                  label="手机显示扩展列（表内横向滚动）"
                /><UCheckbox
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
            class="min-h-11"
            label="清除筛选"
            @click="clearListFilters"
          />
        </div>
        <div
          v-if="summary && Array.isArray(summary.effectiveMetrics)"
          class="flex flex-wrap gap-3 text-sm"
        >
          <div
            v-for="metric in (summary.effectiveMetrics as Row[])"
            :key="String(metric.currency_code)"
            class="rounded border border-muted px-3 py-2"
          >
            <span class="text-muted">{{ metric.currency_code }} · 有效合同额</span><span class="ml-2 tabular-nums font-medium">{{ metric.effective_amount === null ? '未记录' : formatMoney(String(metric.effective_amount), { currency: String(metric.currency_code) }) }}</span><span class="ml-2 text-xs text-muted">{{ metric.contract_count }} 份 · {{ metric.missing_count }} 份未记录有效额</span>
          </div>
        </div>
        <p class="text-xs text-muted">
          签约日期倒序 · 同日按 ID 倒序 · 空日期最后 · 历史日期按 Asia/Shanghai 日历日
        </p>
        <UAlert
          v-if="dateError || amountError"
          color="warning"
          :description="dateError || amountError"
        />
        <UAlert
          v-if="error"
          :color="error === '无合同查看权限' ? 'warning' : 'error'"
          :title="error"
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              label="重试"
              @click="load"
            />
          </template>
        </UAlert>
        <div
          v-else
          class="max-w-full overflow-x-auto rounded-lg border border-default"
          aria-label="合同列表，宽表可横向滚动"
          tabindex="0"
        >
          <UTable
            :data="rows"
            :columns="listColumns"
            :loading="pending || (!loaded && !permissionError)"
          >
            <template #signed_date-cell="{ row }">
              {{ contractListDateLabel(row.original) }}
            </template>
            <template #name-cell="{ row }">
              <NuxtLink
                :to="{ path: `/altoc/contracts/${row.original.id}`, query: route.query }"
                class="block w-36 whitespace-normal break-words font-medium text-primary sm:w-56"
              >{{ row.original.name }}</NuxtLink><p class="mt-1 max-w-56 truncate text-xs text-muted">
                {{ row.original.contract_no || row.original.code }}
              </p><p class="text-xs text-muted sm:hidden">
                {{ contractListDateLabel(row.original) }}
              </p><p class="text-xs text-muted sm:hidden">
                {{ row.original.customer_visible ? row.original.customer_name : '受限客户' }}
              </p><UBadge
                v-if="historicalContract(row.original)"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                历史导入
              </UBadge>
            </template>
            <template #customer_name-cell="{ row }">
              <NuxtLink
                v-if="row.original.customer_visible"
                :to="`/altoc/customers/${row.original.customer_id}`"
                class="text-primary"
              >{{ row.original.customer_name }}</NuxtLink>
              <span
                v-else
                class="text-muted"
              >受限客户</span>
            </template>
            <template #contract_amount-cell="{ row }">
              <span>{{ contractListAmount(row.original).value === null ? '未记录' : money(contractListAmount(row.original).value, row.original.currency_code) }}</span><p class="text-xs text-muted">
                {{ contractListAmount(row.original).label }}
              </p>
            </template>
            <template #effective_amount-cell="{ row }">
              <span>{{ contractEffectiveAmount(row.original).value === null ? '未记录' : money(contractEffectiveAmount(row.original).value, row.original.currency_code) }}</span>
              <p class="text-xs text-muted">
                {{ contractEffectiveAmount(row.original).fallback ? `未提供有效额，回退${contractEffectiveAmount(row.original).label}` : contractEffectiveAmount(row.original).label }}
              </p>
              <NuxtLink
                v-if="effectiveAmountExceedsTotal(row.original)"
                :to="{ path: '/altoc/migration', query: { kind: 'effective_amount_exceeds_total' } }"
                class="block text-xs text-warning"
              >大于合同总额 · 查看核对事项</NuxtLink>
            </template>
            <template #contract_category-cell="{ row }">
              {{ w3ContractCategories[String(row.original.contract_category)] || '未登记' }}
            </template>
            <template #owner_uid-cell="{ row }">
              {{ w3OwnerLabel(row.original.owner_uid, userName(row.original.owner_uid)) }}
            </template>
            <template #direction-cell="{ row }">
              {{ row.original.direction === 'purchase' ? '采购' : '销售' }}
            </template>
            <template #effective_date-cell="{ row }">
              {{ row.original.effective_date || '未记录' }}
            </template>
            <template #end_date-cell="{ row }">
              {{ row.original.end_date || '未记录' }}
            </template>
            <template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ labels[String(row.original.status)] || apfEnumLabel(row.original.status) }}
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <UButton
                :to="{ path: `/altoc/contracts/${row.original.id}`, query: route.query }"
                color="neutral"
                variant="ghost"
                class="min-h-11"
                label="查看"
              />
            </template>
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-files"
                :title="pending ? '正在加载合同' : hasListFilters ? '没有符合条件的合同' : '暂无合同'"
                :description="pending ? '请稍候。' : hasListFilters ? '清除或调整筛选条件后重试。' : '合同用于登记签约内容与履约计划。'"
              >
                <UButton
                  v-if="!pending && hasListFilters"
                  color="neutral"
                  variant="outline"
                  label="清除筛选"
                  @click="clearListFilters"
                /><UButton
                  v-else-if="!pending && canEdit"
                  label="新建合同"
                  @click="begin('header')"
                />
              </CommonEmptyState>
            </template>
          </UTable>
        </div>
        <p
          v-if="directoryError"
          class="text-xs text-muted"
        >
          目录资料暂不可用；待匹配与已确认负责人分别显示。
        </p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-muted">共 {{ total }} 条</span><USelect
            v-model="pageSize"
            :items="[{ label: '20 条 / 页', value: 20 }, { label: '50 条 / 页', value: 50 }, { label: '100 条 / 页', value: 100 }]"
            aria-label="每页条数"
            class="w-32"
          /><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="pageSize"
            :sibling-count="1"
            show-edges
            show-controls
            :disabled="pending || Boolean(dateError || amountError) || Boolean(error)"
          />
        </div>
        <USlideover
          v-model:open="filtersOpen"
          title="筛选合同"
          description="条件作用于全部可见合同，不仅是当前页。"
          :ui="{ content: 'w-full sm:max-w-md' }"
        >
          <template #body>
            <div class="space-y-5">
              <UFormField label="合同编号 / 名称 / 客户">
                <UInput
                  v-model="search"
                  class="w-full"
                  placeholder="搜索可见资料"
                  @keyup.enter="flush"
                />
              </UFormField>
              <UFormField label="客户">
                <AltocBusinessObjectSelect
                  v-model="customerFilter"
                  kind="customers"
                  :enabled="filtersOpen"
                />
              </UFormField>
              <UFormField label="状态">
                <USelect
                  v-model="statusChoice"
                  :items="[{ label: '全部状态', value: 'all' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="合同方向">
                <USelect
                  v-model="directionChoice"
                  :items="[{ label: '全部方向', value: 'all' }, { label: '销售', value: 'sales' }, { label: '采购', value: 'purchase' }]"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="合同类型">
                <USelect
                  v-model="typeChoice"
                  :items="[{ label: '全部类型', value: 'all' }, { label: '标准', value: 'standard' }, { label: '软件许可', value: 'software_license' }, { label: '定制', value: 'customization' }, { label: '硬件', value: 'hardware' }, { label: '培训', value: 'training' }, { label: '实施', value: 'implementation' }, { label: '服务', value: 'service' }, { label: '维保', value: 'maintenance' }, { label: '混合', value: 'mixed' }, { label: '其它', value: 'other' }]"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="负责人">
                <UserTreeSelector
                  v-model="selectedFilterOwner"
                  selection-mode="single"
                  hide-committees
                  width-class="w-full"
                />
              </UFormField>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <UFormField
                  label="最低合同金额"
                  :error="amountError"
                >
                  <UInput
                    v-model="amountMin"
                    inputmode="decimal"
                    placeholder="不限"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="最高合同金额">
                  <UInput
                    v-model="amountMax"
                    inputmode="decimal"
                    placeholder="不限"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <p class="text-xs text-muted">
                按列表合同金额筛选；历史合同使用原签约额。金额区间不换算币种。
              </p>
              <USelect
                v-model="originFilter"
                :items="[{ label: '全部来源', value: 'all' }, { label: '历史导入', value: 'historical_import' }, { label: '原生合同', value: 'native' }]"
                aria-label="合同来源"
                class="w-full sm:w-36"
              />
              <USelect
                v-model="categoryFilter"
                :items="[{ label: '全部业务类别', value: 'all' }, ...Object.entries(w3ContractCategories).map(([value, label]) => ({ value, label }))]"
                aria-label="合同业务类别"
                class="w-full sm:w-44"
              />
              <UFormField
                label="起始签约日"
                :error="dateError"
              >
                <UInput
                  v-model="signedDateFrom"
                  type="date"
                  :disabled="listView === 'this-year'"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="截止签约日">
                <UInput
                  v-model="signedDateTo"
                  type="date"
                  :disabled="listView === 'this-year'"
                  class="w-full"
                />
              </UFormField>
              <UCheckbox
                v-model="ownerUnassigned"
                :disabled="Boolean(ownerFilter)"
                label="负责人待匹配"
              />
            </div>
          </template><template #footer>
            <UButton
              label="查看结果"
              :disabled="Boolean(dateError || amountError)"
              @click="flush(); filtersOpen = false"
            /><UButton
              color="neutral"
              variant="ghost"
              label="清除筛选"
              @click="clearListFilters"
            />
          </template>
        </USlideover>
      </div>
      <div
        v-else-if="contract"
        class="space-y-4"
      >
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <UCard class="min-w-0 lg:col-span-2">
            <h2 class="font-semibold">
              {{ contract.name }}
            </h2><p>
              {{ contract.code }} <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ labels[String(contract.status)] || apfEnumLabel(contract.status) }}
              </UBadge>
            </p><dl class="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt class="text-muted">
                  客户
                </dt><dd>{{ contract.customer_visible ? contract.customer_name : '受限客户' }}</dd>
              </div>
              <div>
                <dt class="text-muted">
                  签约日
                </dt><dd>{{ contractListDateLabel(contract) }}</dd>
              </div>
              <div>
                <dt class="text-muted">
                  业务类别
                </dt><dd>{{ w3ContractCategories[String(contract.contract_category)] || '未登记' }}</dd>
              </div>
              <div>
                <dt class="text-muted">
                  合同编号
                </dt><dd class="break-words">
                  {{ contract.contract_no || contract.code }}
                </dd>
              </div>
            </dl><p class="mt-3 text-sm text-muted">
              负责人：{{ w3OwnerLabel(contract.owner_uid, userName(contract.owner_uid)) }} · {{ departmentName(contract.owner_dept_code) }}
            </p><p
              v-if="directoryError"
              class="text-sm text-muted"
            >
              目录资料暂不可用
            </p><p
              v-if="!Object.hasOwn(contract, 'signed_amount')"
              class="mt-3 text-right tabular-nums"
            >
              含税金额 {{ money(contract.amount_tax_inclusive, contract.currency_code) }}
            </p><UAlert
              v-if="!historical"
              class="mt-3"
              color="info"
              description="提交后由正式审批流程处理，只有正式批准的合同才能签署。"
            /><div
              v-if="canEdit"
              class="mt-3 flex flex-wrap gap-2"
            >
              <UButton
                v-if="!historical && ['draft', 'rejected'].includes(String(contract.status))"
                :loading="saving"
                @click="action('submit', '提交审批')"
              >
                提交审批
              </UButton><UButton
                v-if="!historical && contract.status === 'approved'"
                @click="action('sign', '签署合同')"
              >
                签署并生效
              </UButton><UButton
                v-if="!historical && contract.status === 'effective'"
                color="neutral"
                variant="outline"
                @click="begin('projects')"
              >
                创建或关联项目
              </UButton><UButton
                v-if="!historical && contract.status === 'effective' && children('project_links').length"
                @click="begin('activate')"
              >
                启动履约
              </UButton>
            </div>
            <W3HistoricalContractActions
              v-if="historical"
              :contract="contract"
              :can-edit="canEdit"
              :can-close="canClose"
              @saved="load"
            />
          </UCard>
          <UCard class="min-w-0">
            <h2 class="text-sm text-muted">
              {{ contractListAmount(contract).label }}
            </h2>
            <p class="mt-2 text-xl tabular-nums">
              {{ money(contractListAmount(contract).value, contract.currency_code) }}
            </p>
            <h2 class="mt-4 text-sm text-muted">
              有效合同额
            </h2>
            <p class="mt-2 text-lg tabular-nums">
              {{ money(contractEffectiveAmount(contract).value, contract.currency_code) }}
            </p>
            <p class="text-xs text-muted">
              {{ contractEffectiveAmount(contract).fallback ? `未提供有效额，回退${contractEffectiveAmount(contract).label}` : contractEffectiveAmount(contract).label }}
            </p>
            <UBadge
              v-if="effectiveAmountExceedsTotal(contract)"
              class="mt-2"
              color="warning"
              variant="subtle"
            >
              大于合同总额，待确认
            </UBadge>
          </UCard>
        </div>
        <UTabs
          v-model="detailTab"
          :items="detailTabs"
          :content="false"
          class="max-w-full"
        />
        <AltocReceivablesPage
          v-if="detailTab === 'receivables'"
          :contract-id="String(contract.id)"
          embedded
        />
        <section
          v-if="detailTab === 'overview'"
          class="space-y-4"
        >
          <UAlert
            v-if="historical"
            color="info"
            title="历史导入合同"
            description="本合同由原系统导入，未经本系统审批与签署流程。履约与激活状态未在本系统跟踪。历史导入合同不维护合同行/付款条款。"
          />
          <p
            v-if="String(contract.owner_uid).startsWith('system:')"
            class="text-sm text-warning"
          >
            待匹配（原负责人：{{ contract.source_owner_name || '未知' }}）
          </p>
          <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div v-if="contract.legal_entity_code">
              <dt class="text-sm text-muted">
                签约主体
              </dt><dd>
                <NuxtLink
                  :to="{ path: '/finance/legal-entities', query: { search: String(contract.legal_entity_code) } }"
                  class="text-primary"
                >{{ contract.legal_entity_name || contract.legal_entity_name_snapshot || '—' }}（{{ contract.legal_entity_code }}）</NuxtLink>
              </dd>
            </div>
            <div v-if="contract.receiving_bank_account_code">
              <dt class="text-sm text-muted">
                约定收款账户
              </dt><dd class="break-words">
                {{ contract.receiving_bank_account_code }} · {{ contract.receiving_bank_account_short_name || '—' }}
              </dd>
            </div>
            <div v-if="historical">
              <dt class="text-sm text-muted">
                履约 / 激活状态
              </dt><dd>历史导入，未跟踪</dd>
            </div>
            <div v-if="contract.parent_contract_id">
              <dt class="text-sm text-muted">
                上级合同
              </dt><dd>
                <NuxtLink
                  :to="`/altoc/contracts/${contract.parent_contract_id}`"
                  class="text-primary"
                >查看上级合同</NuxtLink>
              </dd>
            </div>
          </dl>
        </section>
        <section
          v-if="detailTab === 'source'"
          class="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <W3MigrationSnapshot
            v-if="contract.migration_snapshot"
            :snapshot="contract.migration_snapshot as Row"
            :currency="String(contract.currency_code || 'CNY')"
          />
          <W3ChildContracts :contract-id="String(contract.id)" />
          <W3SourceInfo
            v-if="contract.source_info"
            :source="contract.source_info as Row"
          />
        </section>
        <section
          v-if="detailTab === 'performance'"
          class="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2"
        >
          <UCard
            v-for="section in sections"
            :key="section.key"
          >
            <template #header>
              <div class="flex items-center justify-between">
                <h2>{{ section.title }}</h2><UButton
                  v-if="editable && fields[section.key]"
                  variant="outline"
                  @click="begin(section.key)"
                >
                  编辑
                </UButton>
              </div>
            </template><UTable
              :data="children(section.key)"
              :columns="sectionColumns(section.key)"
              :loading="pending"
            >
              <template #amount-cell="{ row }">
                {{ money(row.original.amount, row.original.currency_code || contract.currency_code) }}
              </template><template #amount_tax_inclusive-cell="{ row }">
                {{ money(row.original.amount_tax_inclusive, row.original.currency_code || contract.currency_code) }}
              </template><template #empty>
                <CommonEmptyState
                  title="暂无记录"
                  description="此区块尚未填写资料。"
                />
              </template>
              <template #status-cell="{ row }">
                <UBadge
                  color="neutral"
                  variant="subtle"
                >
                  {{ labels[String(row.original.status)] || apfEnumLabel(row.original.status) }}
                </UBadge>
              </template><template #actions-cell="{ row }">
                <UButton
                  v-if="!historical && section.key === 'billing_schedules' && canEdit && contract.status === 'effective' && ['billable', 'invoicing'].includes(String(row.original.status)) && row.original.direction === 'receivable'"
                  variant="link"
                  :to="{ path: '/finance/invoices/requests/new', query: { source: 'altoc', contractId: String(contract.id), billingScheduleCode: String(row.original.code), expectedVersion: String(contract.row_version), scheduleVersion: String(row.original.row_version) } }"
                >
                  申请开票
                </UButton>
                <div
                  v-if="!historical && section.key === 'obligations' && canEdit && contract.status === 'effective'"
                  class="flex flex-wrap gap-1"
                >
                  <UButton
                    v-if="['not_started', 'rejected', 'blocked'].includes(String(row.original.status))"
                    variant="link"
                    @click="action('obligations/transition', '开始履约', { action: 'start', obligationCode: row.original.code })"
                  >
                    开始
                  </UButton><UButton
                    v-if="['in_progress', 'rejected'].includes(String(row.original.status))"
                    variant="link"
                    @click="action('obligations/transition', '提交履约', { action: 'submit', obligationCode: row.original.code })"
                  >
                    提交
                  </UButton><UButton
                    v-if="['submitted', 'completed'].includes(String(row.original.status))"
                    variant="link"
                    @click="action('obligations/transition', '确认验收', { action: 'accept', obligationCode: row.original.code })"
                  >
                    验收
                  </UButton>
                  <UButton
                    v-if="row.original.status === 'submitted'"
                    color="error"
                    variant="link"
                    @click="beginReject(row.original)"
                  >
                    退回
                  </UButton>
                </div>
              </template>
            </UTable>
          </UCard>
        </section>
      </div>
      <USlideover
        v-model:open="open"
        :title="editorTitle"
        description="按合同、条款或项目计划分组编辑；保存时复核版本、权限与状态。"
        :ui="{ content: 'w-full sm:max-w-4xl' }"
        :dismissible="!saving"
      >
        <template #body>
          <div class="space-y-4">
            <UAlert
              v-if="formError"
              color="error"
              title="保存失败"
              :description="formError"
            />
            <template v-if="mode === 'header' || mode === 'from-quotation'">
              <h2 class="font-semibold">
                基本信息
              </h2><UFormField
                label="名称"
                required
                :error="formFields.name"
              >
                <UInput
                  v-model="draft.name"
                  class="w-full"
                />
              </UFormField><UFormField
                v-if="!detail"
                :label="mode === 'from-quotation' ? '报价（已批准或已接受）' : '客户'"
                required
                :error="formFields[mode === 'from-quotation' ? 'quotationId' : 'customerId']"
              >
                <AltocBusinessObjectSelect
                  v-if="mode === 'from-quotation'"
                  v-model="draft.quotationId"
                  kind="quotes"
                  :enabled="open"
                /><AltocBusinessObjectSelect
                  v-else
                  v-model="draft.customerId"
                  kind="customers"
                  :enabled="open"
                />
              </UFormField><UFormField
                v-if="!detail"
                label="合同方向"
                :error="formFields.direction"
              >
                <USelectMenu
                  v-model="draft.direction"
                  value-key="value"
                  :items="[{ label: '销售', value: 'sales' }, { label: '采购', value: 'purchase' }]"
                />
              </UFormField><UFormField
                v-if="!detail && mode !== 'from-quotation'"
                label="币种"
                :error="formFields.currency_code"
              >
                <UInput v-model="draft.currency_code" />
              </UFormField><UFormField
                v-for="k in ['contract_no', 'sign_date', 'effective_date', 'end_date', 'content_summary', 'remark']"
                :key="k"
                :label="({ contract_no: '合同编号', sign_date: '签署日期', effective_date: '生效日期', end_date: '结束日期', content_summary: '内容摘要', remark: '备注' } as Record<string, string>)[k]"
              >
                <UTextarea
                  v-if="['content_summary', 'remark'].includes(k)"
                  v-model="draft[k]"
                  class="w-full"
                /><UInput
                  v-else
                  v-model="draft[k]"
                  :type="k.endsWith('date') ? 'date' : 'text'"
                  class="w-full"
                />
              </UFormField>
            </template>
            <template v-else-if="['projects', 'activate'].includes(mode)">
              <UAlert description="项目创建/编辑及里程碑操作还需 Aims 对应范围许可。多项目行分摊先记为未分配，不自动均分金额。" /><UCard
                v-for="(p, n) in selectedProjects"
                :key="n"
              >
                <div class="grid grid-cols-1 gap-3">
                  <UFormField label="项目编码">
                    <UInput
                      v-if="p.create"
                      v-model="p.projectCode as string"
                      placeholder="新项目编码"
                    /><AltocBusinessObjectSelect
                      v-else
                      v-model="p.projectCode as string"
                      kind="projects"
                      :enabled="open && canEdit"
                    />
                  </UFormField><UFormField label="项目名称">
                    <UInput v-model="p.name as string" />
                  </UFormField><UFormField label="负责部门（可选）">
                    <p class="mb-2 text-sm text-muted">
                      {{ departmentName(p.deptCode) }}
                    </p>
                    <APFDepartmentSelect
                      :model-value="String(p.deptCode || '')"
                      @update:model-value="p.deptCode = $event"
                    />
                  </UFormField><UCheckbox
                    v-model="p.create as boolean"
                    label="创建新项目"
                  /><UFormField
                    v-for="(label, key) in { lineCodes: '合同行', obligationCodes: '履约义务', billingScheduleCodes: '结算计划（生成里程碑）' }"
                    :key="key"
                    :label="label"
                  >
                    <APFReferenceMultiSelect
                      v-model="p[key] as string"
                      :rows="Array.isArray(contract?.[key === 'lineCodes' ? 'lines' : key === 'obligationCodes' ? 'obligations' : 'billing_schedules']) ? contract?.[key === 'lineCodes' ? 'lines' : key === 'obligationCodes' ? 'obligations' : 'billing_schedules'] as Row[] : []"
                    />
                  </UFormField><UButton
                    color="error"
                    variant="ghost"
                    @click="selectedProjects.splice(n, 1)"
                  >
                    移除本次计划
                  </UButton>
                </div>
              </UCard><UButton
                variant="outline"
                @click="selectedProjects.push({ projectCode: '', name: '', deptCode: '', create: true, lineCodes: '', obligationCodes: '', billingScheduleCodes: '' })"
              >
                添加项目计划
              </UButton>
            </template>
            <template v-else-if="mode === 'reject'">
              <UAlert
                color="warning"
                description="退回该履约提交，结算状态由服务端核验。"
              />
              <UFormField
                label="退回原因"
                required
                :error="formFields.reason"
              >
                <UTextarea
                  v-model="rejectReason"
                  class="w-full"
                />
              </UFormField>
            </template>
            <template v-else>
              <UCard
                v-for="(r, n) in editingRows"
                :key="n"
              >
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <UFormField
                    v-for="f in activeFields"
                    :key="f.key"
                    :label="f.label"
                  >
                    <UCheckbox
                      v-if="f.type === 'boolean'"
                      v-model="r[f.key] as boolean"
                    /><USelectMenu
                      v-else-if="f.options"
                      v-model="r[f.key] as string"
                      value-key="value"
                      :items="f.options"
                      class="w-full"
                    /><UInput
                      v-else
                      v-model="r[f.key] as string"
                      class="w-full"
                    />
                  </UFormField>
                </div><UButton
                  class="mt-3"
                  color="error"
                  variant="ghost"
                  @click="editingRows.splice(n, 1)"
                >
                  移除此行
                </UButton>
              </UCard><UButton
                variant="outline"
                @click="addRow"
              >
                添加一行
              </UButton>
            </template>
          </div>
        </template><template #footer>
          <UButton
            :loading="saving"
            @click="save"
          >
            保存
          </UButton><UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="open = false"
          >
            取消
          </UButton>
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
