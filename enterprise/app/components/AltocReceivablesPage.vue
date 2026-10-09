<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import FinanceBusinessObjectSelect from '../../../finance/app/components/host/FinanceBusinessObjectSelect.vue'
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import UserTreeSelector from '../../../foundation/app/components/UserTreeSelector.vue'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'
import { agingLabels, receivableEventChanges, receivableColumnPreference, receivableOptionalColumns } from '../../shared/altoc-receivables'
import { requireAltocJsonMutationResult, altocContractStatusLabels as altocBillingScheduleStatusLabels } from '../utils/altocBusinessObjectPresentation'
import { formatMoney } from '../../../foundation/app/utils/format'

const props = defineProps<{ detail?: boolean, planId?: string, customerId?: string, contractId?: string, embedded?: boolean }>()
type Row = Record<string, unknown>
const emit = defineEmits<{ context: [row: Row] }>()
const route = useRoute()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const scope = useState<string>('enterprise-cache-scope', () => '')
const { status: accessStatus } = useEnterpriseNavigationAccess()
onMounted(() => {
  void loadPermissions()
})
const canView = computed(() => loaded.value && !permissionError.value && hasPermission('receivable', 'view'))
const page = ref(1)
const pageSize = ref(20)
const followupPage = ref(1)
const status = ref('all')
const customer = ref(props.customerId || '')
const contract = ref(props.contractId || '')
const currencyOptions = [{ label: '全部币种', value: 'all' }, { label: '人民币', value: 'CNY' }, { label: '美元', value: 'USD' }, { label: '欧元', value: 'EUR' }]
const currency = ref('')
const currencySelection = computed({
  get: () => currency.value || 'all',
  set(value) {
    currency.value = value === 'all' ? '' : value
  }
})
const legalEntity = ref('')
const bucket = ref('all')
const collectors = ref<string[]>([])
const filtersOpen = ref(false)
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const data = ref<Row | null>(null)
const loading = ref(false)
const error = ref('')
let epoch = 0
const rows = computed(() => (data.value?.items || []) as Row[])
const totals = computed(() => (data.value?.totals || []) as Row[])
const total = computed(() => Number(data.value?.total || 0))
const installed = computed(() => data.value?.collection_installed === true)
const filters = computed(() => ({ ...(debounced.value ? { search: debounced.value } : {}), ...(status.value !== 'all' ? { status: status.value } : {}), ...((props.customerId || customer.value) ? { customerId: props.customerId || customer.value } : {}), ...((props.contractId || contract.value) ? { contractId: props.contractId || contract.value } : {}), ...(currency.value ? { currencyCode: currency.value } : {}), ...(legalEntity.value ? { legalEntityCode: legalEntity.value } : {}), ...(bucket.value !== 'all' ? { agingBucket: bucket.value } : {}), ...(collectors.value[0] ? { collectionResponsibleUid: collectors.value[0] } : {}) }))
const filterCount = computed(() => Object.keys(filters.value).length - Number(Boolean(props.customerId)) - Number(Boolean(props.contractId)))
const visibleColumns = ref(receivableColumnPreference(null))
const allColumns: TableColumn<Row>[] = [
  { accessorKey: 'name', header: '应收款项 / 编号', meta: { class: { td: 'max-w-64' } } },
  { accessorKey: 'contract_name', header: '合同', meta: { class: { td: 'max-w-56 truncate' } } },
  { accessorKey: 'currency_code', header: '币种' },
  ...['amount', 'received_amount', 'unreceived_amount'].map((key, n) => ({ accessorKey: key, header: ['应收金额', '已收金额', '未收金额'][n], meta: { class: { td: 'text-right tabular-nums whitespace-nowrap', th: 'text-right' } } })),
  { accessorKey: 'due_date', header: '到期日' }, { accessorKey: 'aging_bucket', header: '账龄' },
  { accessorKey: 'collection_responsible_uid', header: '催收负责人' }, { accessorKey: 'collection_due_at', header: '下次跟进' }, { accessorKey: 'status', header: '状态' }
]
const columns = computed(() => allColumns.filter(column => !('accessorKey' in column) || !receivableOptionalColumns.includes(String(column.accessorKey)) || visibleColumns.value.includes(String(column.accessorKey))).map((column) => {
  const key = 'accessorKey' in column ? String(column.accessorKey) : ''
  const mobile = !['name', 'currency_code', 'unreceived_amount'].includes(key) ? 'hidden sm:table-cell ' : ''
  return { ...column, meta: { ...column.meta, class: { th: mobile + (column.meta?.class?.th || ''), td: mobile + (column.meta?.class?.td || '') } } }
}))
watch(scope, (value, old) => {
  visibleColumns.value = receivableColumnPreference(null)
  if (!import.meta.client) return
  try {
    if (old && old !== value) localStorage.removeItem(`apf-receivable-columns:v1:${old}`)
    if (value) visibleColumns.value = receivableColumnPreference(JSON.parse(localStorage.getItem(`apf-receivable-columns:v1:${value}`) || 'null'))
  } catch { /* malformed preferences never affect data or permission */ }
}, { immediate: true })
function saveColumns() {
  if (!scope.value || accessStatus.value !== 'ready') return
  try {
    localStorage.setItem(`apf-receivable-columns:v1:${scope.value}`, JSON.stringify(receivableColumnPreference(visibleColumns.value)))
    toast.add({ title: '已保存本机视图', color: 'success' })
  } catch { toast.add({ title: '无法保存本机视图', color: 'error' }) }
}
const summaryColumns: TableColumn<Row>[] = [{ accessorKey: 'currency_code', header: '币种' }, { accessorKey: 'aging_bucket', header: '账龄' }, { accessorKey: 'item_count', header: '款项数' }, { accessorKey: 'outstanding_amount', header: '未收金额', meta: { class: { td: 'text-right tabular-nums', th: 'text-right' } } }]
function drill(row: Row) {
  bucket.value = String(row.aging_bucket)
  currency.value = String(row.currency_code)
}
const amount = (value: unknown) => formatMoney(value as string | number, { style: 'decimal' })
function message(e: unknown, writing = false) {
  const x = e as { data?: { data?: { code?: string }, code?: string, message?: string }, statusCode?: number }
  const code = String(x.data?.data?.code || x.data?.code || '')
  const messages: Record<string, string> = { receivable_version_conflict: '资料已被他人修改，已刷新，请比较后重新确认；草稿已保留', historical_contract_not_ready: '历史合同财务未就绪，暂不可办理', receivable_collection_not_installed: '催收管理尚未安装，请联系管理员', apf_owner_invalid: '请选择有效的在职员工', apf_owner_directory_unavailable: '人员目录暂不可用，请稍后重试', receivable_closed: '款项已结清或取消，不能继续办理', receivable_idempotency_conflict: '请求内容已变化，请比较最新资料后重新确认', receivable_owner_changed: '催收负责人已变更，已刷新，请重新确认' }
  if (writing && !x.data && !x.statusCode) return '保存结果未确认，可能已提交，请保留原内容重试；重试沿用同一请求'
  return messages[code] || (x.statusCode === 403 ? '无权执行此操作' : x.data?.message || '服务暂不可用，请稍后重试')
}
async function load() {
  const current = ++epoch
  error.value = ''
  if (!canView.value || !scope.value || accessStatus.value !== 'ready') {
    data.value = null
    loading.value = false
    return
  }
  loading.value = true
  try {
    const id = String(props.planId ?? route.params.planId ?? '')
    const response = await $fetch<{ code: number, data: Row }>(`/altoc/api/v1/receivables${props.detail ? `/${encodeURIComponent(id)}` : ''}`, { query: props.detail ? { page: followupPage.value, pageSize: 20 } : { ...filters.value, page: page.value, pageSize: pageSize.value }, retry: 0 })
    if (response.code !== 0 || !response.data) throw new Error('invalid envelope')
    if (current === epoch) {
      data.value = response.data
      if (props.detail) emit('context', response.data)
    }
  } catch (e) {
    if (current === epoch) {
      data.value = null
      error.value = message(e)
    }
  } finally {
    if (current === epoch) loading.value = false
  }
}
watch(filters, () => {
  page.value = 1
})
watch([canView, scope, accessStatus, filters, page, pageSize, () => props.planId ?? route.params.planId], () => void load(), { immediate: true, flush: 'post' })
watch([() => props.customerId, () => props.contractId], () => {
  customer.value = props.customerId || ''
  contract.value = props.contractId || ''
})
watch(followupPage, () => void load())
onScopeDispose(() => {
  epoch++
})
function clear() {
  search.value = ''
  status.value = 'all'
  currency.value = ''
  legalEntity.value = ''
  bucket.value = 'all'
  collectors.value = []
  customer.value = props.customerId || ''
  contract.value = props.contractId || ''
}
const tab = ref('overview')
const tabs = [{ label: '基本信息', value: 'overview' }, { label: '催收记录', value: 'followups' }]
const formOpen = ref(false)
const saving = ref(false)
const action = ref<'collection-owner' | 'due-date' | 'followups'>('collection-owner')
const draft = ref<Record<string, string>>({})
const selectedOwner = ref<string[]>([])
const formError = ref('')
let intent = createConsoleMutationIntent('altoc-receivable')
watch(scope, () => {
  epoch++
  data.value = null
  formOpen.value = false
  draft.value = {}
  selectedOwner.value = []
  formError.value = ''
  saving.value = false
  intent = createConsoleMutationIntent('altoc-receivable')
})
const toast = useToast()
const { confirm } = useConfirm()
const actionLabels = { 'collection-owner': '指派催收负责人', 'due-date': '维护到期日', 'followups': '记录联系结果' }
const editable = computed(() => data.value?.financial_ready === true && installed.value && !['received', 'cancelled', 'bad_debt'].includes(String(data.value?.status)))
function openAction(kind: typeof action.value) {
  if (!intent.reset()) {
    toast.add({ title: '保存结果尚未确认，请先按原内容重试', color: 'warning' })
    return
  }
  action.value = kind
  draft.value = { due_date: String(data.value?.due_date || '').slice(0, 10), collection_due_at: String(data.value?.collection_due_at || '').slice(0, 16).replace(' ', 'T'), result: '', promised_payment_date: '', promised_amount: '', next_followup_at: '' }
  selectedOwner.value = data.value?.collection_responsible_uid ? [String(data.value.collection_responsible_uid)] : []
  formError.value = ''
  formOpen.value = true
}
async function save() {
  if (saving.value || !data.value) return
  if ((action.value === 'collection-owner' && !selectedOwner.value[0]) || (action.value === 'followups' && !draft.value.result?.trim())) {
    formError.value = action.value === 'collection-owner' ? '请选择催收负责人' : '请填写联系结果'
    return
  }
  if (action.value === 'followups' && draft.value.promised_amount && !/^\d{1,16}(\.\d{1,2})?$/.test(draft.value.promised_amount)) {
    formError.value = '承诺付款金额必须为非负金额，最多两位小数'
    return
  }
  if (action.value === 'due-date') {
    formOpen.value = false
    const accepted = await confirm({ title: `修改「${data.value.name}」到期日`, message: '账龄将按新日期计算，原日期保留在变更记录中；下次催收跟进时间不变。', tone: 'warning' })
    formOpen.value = true
    if (!accepted) return
  }
  const time = (v: string | undefined) => v ? `${v.replace('T', ' ')}:00` : null
  const body = { expectedVersion: Number(data.value.row_version), ...(action.value === 'collection-owner' ? { collection_responsible_uid: selectedOwner.value[0], collection_due_at: time(draft.value.collection_due_at) } : action.value === 'due-date' ? { due_date: draft.value.due_date || null } : { result: draft.value.result?.trim(), promised_payment_date: draft.value.promised_payment_date || null, promised_amount: draft.value.promised_amount || null, next_followup_at: time(draft.value.next_followup_at) }) }
  const requestScope = scope.value
  saving.value = true
  try {
    const path = `/altoc/api/v1/receivables/${String(data.value.id)}/${action.value}`
    const done = await intent.submit({ path, method: 'POST' as const, body }, async (request, key) => requireAltocJsonMutationResult(await $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key }, retry: 0 })))
    if (scope.value !== requestScope) return
    if (done) {
      formOpen.value = false
      intent.reset()
      await load()
      toast.add({ title: action.value === 'collection-owner' ? '已指派催收负责人' : action.value === 'due-date' ? '已更新到期日' : '已记录联系结果', color: 'success' })
    }
  } catch (e) {
    if (scope.value !== requestScope) return
    formError.value = message(e, true)
    if ((e as { statusCode?: number }).statusCode === 409) {
      await load()
      intent.reset()
    }
    toast.add({ title: '保存未完成', description: formError.value, color: 'error' })
  } finally {
    if (scope.value === requestScope) saving.value = false
  }
}
defineExpose({ refresh: load })
</script>

<template>
  <div class="min-w-0 space-y-4">
    <ContentPageHeader
      v-if="!embedded"
      :title="detail ? '应收款项' : '应收工作台'"
      hosted
    >
      <template #actions>
        <UButton
          v-if="detail"
          to="/altoc/payments"
          color="neutral"
          variant="outline"
        >
          返回列表
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="load"
        >
          刷新
        </UButton>
      </template>
    </ContentPageHeader>
    <CommonEmptyState
      v-if="permissionError"
      icon="i-lucide-circle-alert"
      title="权限信息加载失败"
      description="请刷新后重试"
    />
    <CommonEmptyState
      v-else-if="!loaded"
      icon="i-lucide-loader-circle"
      title="正在加载权限"
    />
    <CommonEmptyState
      v-else-if="!canView"
      icon="i-lucide-lock-keyhole"
      title="无查看权限"
      description="需要应收查看权限"
    />
    <template v-else>
      <form
        v-if="!detail"
        class="flex min-w-0 flex-wrap items-center gap-2"
        @submit.prevent="flush"
      >
        <UInput
          v-model="search"
          class="min-w-0 flex-1 sm:max-w-72"
          placeholder="搜索款项、合同名称或编号"
          aria-label="搜索应收款项"
          @keydown.enter="flush"
        />
        <USelect
          v-model="bucket"
          :items="[{ label: '全部账龄', value: 'all' }, ...Object.entries(agingLabels).map(([value, label]) => ({ value, label }))]"
          aria-label="账龄"
          class="hidden sm:block"
        />
        <USelect
          v-model="currencySelection"
          :items="currencyOptions"
          aria-label="币种"
          class="hidden sm:block"
        />
        <UPopover v-model:open="filtersOpen">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-list-filter"
          >
            筛选{{ filterCount ? ` (${filterCount})` : '' }}
          </UButton>
          <template #content>
            <div class="grid w-72 gap-3 p-4">
              <UFormField
                v-if="!customerId"
                label="客户"
              >
                <AltocBusinessObjectSelect
                  v-model="customer"
                  kind="customers"
                  :enabled="filtersOpen"
                />
              </UFormField>
              <UFormField
                v-if="!contractId"
                label="合同"
              >
                <AltocBusinessObjectSelect
                  v-model="contract"
                  kind="contracts"
                  :enabled="filtersOpen"
                />
              </UFormField>
              <UFormField label="法人主体（约定收款账户归属）">
                <FinanceBusinessObjectSelect
                  v-model="legalEntity"
                  kind="legal-entities"
                  :enabled="filtersOpen"
                />
              </UFormField>
              <UFormField label="催收负责人">
                <UserTreeSelector
                  v-model="collectors"
                  selection-mode="single"
                  hide-committees
                  width-class="w-full"
                />
              </UFormField>
              <UFormField label="账龄">
                <USelect
                  v-model="bucket"
                  :items="[{ label: '全部', value: 'all' }, ...Object.entries(agingLabels).map(([value, label]) => ({ value, label }))]"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="币种">
                <USelect
                  v-model="currencySelection"
                  :items="currencyOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="状态">
                <USelect
                  v-model="status"
                  :items="[{ label: '全部', value: 'all' }, ...Object.entries(altocBillingScheduleStatusLabels).map(([value, label]) => ({ value, label }))]"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>
        </UPopover>
        <UPopover class="hidden sm:block">
          <UButton
            color="neutral"
            variant="outline"
            label="显示列"
          />
          <template #content>
            <div class="space-y-3 p-4">
              <div class="flex items-center justify-between gap-4">
                <span class="text-sm font-medium">显示列</span><UButton
                  label="保存本机视图"
                  size="sm"
                  variant="ghost"
                  color="neutral"
                  :disabled="!scope || accessStatus !== 'ready'"
                  @click="saveColumns"
                />
              </div>
              <UCheckbox
                v-for="column in allColumns.filter(c => 'accessorKey' in c && receivableOptionalColumns.includes(String(c.accessorKey)))"
                :key="String('accessorKey' in column ? column.accessorKey : '')"
                :label="String(column.header)"
                :model-value="visibleColumns.includes(String('accessorKey' in column ? column.accessorKey : ''))"
                @update:model-value="value => visibleColumns = value ? [...visibleColumns, String('accessorKey' in column ? column.accessorKey : '')] : visibleColumns.filter(key => key !== String('accessorKey' in column ? column.accessorKey : ''))"
              />
            </div>
          </template>
        </UPopover>
        <UButton
          v-if="filterCount"
          color="neutral"
          variant="ghost"
          @click="clear"
        >
          清除筛选
        </UButton>
      </form>
      <CommonEmptyState
        v-if="error"
        icon="i-lucide-circle-alert"
        title="资料加载失败"
        :description="error"
      />
      <template v-else-if="!detail">
        <UAlert
          v-if="data"
          color="info"
          variant="subtle"
          :title="`当前业务日 ${data.query_date} · 历史未就绪 ${data.historical_not_ready_count} 项未计入`"
        />
        <div
          v-if="totals.length"
          class="grid gap-2 sm:hidden"
          aria-label="账龄汇总"
        >
          <button
            v-for="row in totals"
            :key="String(row.currency_code) + String(row.aging_bucket)"
            type="button"
            class="grid min-w-0 grid-cols-[1fr_auto] gap-2 rounded-lg border border-default p-3 text-left hover:bg-elevated"
            @click="drill(row)"
          >
            <span class="min-w-0 text-sm">{{ row.currency_code }} · {{ agingLabels[String(row.aging_bucket)] }}<span class="mt-1 block text-xs text-muted">{{ row.item_count }} 项</span></span><span class="max-w-44 self-center break-all text-right text-sm font-medium tabular-nums">{{ amount(row.outstanding_amount) }}</span>
          </button>
        </div>
        <UTable
          v-if="totals.length"
          class="hidden sm:block"
          :data="totals"
          :columns="summaryColumns"
          :loading="loading"
        >
          <template #aging_bucket-cell="{ row }">
            <UButton
              variant="link"
              @click="drill(row.original)"
            >
              {{ agingLabels[String(row.original.aging_bucket)] }}
            </UButton>
          </template>
          <template #outstanding_amount-cell="{ row }">
            {{ amount(row.original.outstanding_amount) }}
          </template>
          <template #empty>
            <CommonEmptyState title="暂无应收汇总" />
          </template>
        </UTable>
        <div
          class="grid gap-3 sm:hidden"
          aria-label="应收款项列表"
        >
          <CommonEmptyState
            v-if="loading"
            icon="i-lucide-loader-circle"
            title="正在加载应收款项"
          />
          <CommonEmptyState
            v-else-if="!rows.length"
            title="暂无当前应收款项"
          />
          <UCard
            v-for="row in rows"
            :key="String(row.id)"
            :ui="{ body: 'p-3' }"
          >
            <NuxtLink
              :to="`/altoc/payments/${row.id}`"
              class="block truncate font-medium text-primary"
              :title="String(row.name)"
            >{{ row.name }}</NuxtLink>
            <p class="mt-1 truncate text-xs text-muted">
              {{ row.code }} · {{ row.contract_name }}
            </p>
            <div class="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span class="text-xs text-muted">未收金额 · {{ row.currency_code }}</span><strong class="break-all text-sm tabular-nums">{{ amount(row.unreceived_amount) }}</strong>
            </div>
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{{ row.due_date || '无到期日' }} · {{ agingLabels[String(row.aging_bucket)] }}</span><UBadge
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ altocBillingScheduleStatusLabels[String(row.status)] || '未识别状态' }}
              </UBadge>
            </div>
            <p class="mt-2 truncate text-xs text-muted">
              催收负责人：{{ row.collection_responsible_uid || '未指派' }}
            </p>
          </UCard>
        </div>
        <UTable
          :data="rows"
          :columns="columns"
          :loading="loading"
          class="hidden max-w-full sm:block"
        >
          <template #name-cell="{ row }">
            <NuxtLink
              :to="`/altoc/payments/${row.original.id}`"
              class="block truncate font-medium text-primary"
            >{{ row.original.name }}</NuxtLink><span class="text-xs text-muted">{{ row.original.code }}</span>
          </template>
          <template #amount-cell="{ row }">
            {{ amount(row.original.amount) }}
          </template>
          <template #received_amount-cell="{ row }">
            {{ amount(row.original.received_amount) }}
          </template>
          <template #unreceived_amount-cell="{ row }">
            {{ amount(row.original.unreceived_amount) }}
          </template>
          <template #aging_bucket-cell="{ row }">
            {{ agingLabels[String(row.original.aging_bucket)] }}
          </template>
          <template #status-cell="{ row }">
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ altocBillingScheduleStatusLabels[String(row.original.status)] || '未识别状态' }}
            </UBadge>
          </template>
          <template #empty>
            <CommonEmptyState
              icon="i-lucide-wallet"
              title="暂无当前应收款项"
              description="调整筛选或先在合同中生成结算计划"
            />
          </template>
        </UTable>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="total"
            :sibling-count="1"
          />
        </div>
      </template>
      <template v-else-if="data">
        <UAlert
          v-if="!data.financial_ready"
          color="warning"
          title="历史合同财务未就绪"
          description="待确认期初与财务就绪标识；金额不计入当前应收账龄，暂不可办理。"
        />
        <UAlert
          v-else-if="!installed"
          color="warning"
          title="催收管理尚未安装"
          description="可查看应收资料；指派与跟进暂不可用。"
        />
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <UCard
            v-for="[key, label] in [['amount', '应收金额'], ['received_amount', '已收金额'], ['unreceived_amount', '未收金额']]"
            :key="key"
          >
            <p class="text-xs text-muted">
              {{ label }} · {{ data.currency_code }}
            </p><p class="mt-1 font-semibold tabular-nums">
              {{ amount(data[key!]) }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              状态
            </p><UBadge
              class="mt-1"
              color="neutral"
            >
              {{ altocBillingScheduleStatusLabels[String(data.status)] }}
            </UBadge>
          </UCard>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="hasPermission('receivable', 'assign')"
            :disabled="!editable"
            @click="openAction('collection-owner')"
          >
            指派催收负责人
          </UButton>
          <UButton
            v-if="hasPermission('receivable', 'set-due-date')"
            :disabled="!editable"
            color="neutral"
            variant="outline"
            @click="openAction('due-date')"
          >
            维护到期日
          </UButton>
          <UButton
            v-if="hasPermission('receivable', 'followup')"
            :disabled="!editable"
            color="neutral"
            variant="outline"
            @click="openAction('followups')"
          >
            记录联系结果
          </UButton>
        </div>
        <UTabs
          v-model="tab"
          :items="tabs"
          :content="false"
        />
        <dl
          v-if="tab === 'overview'"
          class="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          <div
            v-for="[key, label] in [['code', '款项编号'], ['name', '名称'], ['contract_name', '合同'], ['due_date', '到期日'], ['collection_responsible_uid', '催收负责人'], ['collection_due_at', '下次跟进时间']]"
            :key="key"
            class="min-w-0"
          >
            <dt class="text-xs text-muted">
              {{ label }}
            </dt><dd class="mt-1 break-words">
              {{ data[key!] || '—' }}
            </dd>
          </div>
        </dl>
        <div
          v-else
          class="space-y-3"
        >
          <CommonEmptyState
            v-if="!(data.followups as Row[])?.length"
            title="暂无催收记录"
          />
          <UCard
            v-for="row in data.followups as Row[]"
            :key="String(row.code)"
          >
            <div class="flex flex-wrap justify-between gap-2">
              <strong>{{ ({ assign: '负责人变更', due_date: '到期日变更', followup: '联系结果' } as Record<string, string>)[String(row.event_type)] }}</strong><span class="text-xs text-muted">{{ row.actor_uid }} · {{ row.created_at }}</span>
            </div>
            <p
              v-for="change in receivableEventChanges(row)"
              :key="change"
              class="mt-2 break-words text-sm text-muted"
            >
              {{ change }}
            </p>
            <p
              v-if="row.result"
              class="mt-2 whitespace-pre-wrap break-words"
            >
              {{ row.result }}
            </p>
            <p
              v-if="row.promised_amount || row.promised_payment_date"
              class="mt-2 text-sm text-muted"
            >
              承诺付款：{{ row.promised_payment_date || '未约定日期' }} · {{ amount(row.promised_amount) }} {{ data.currency_code }}（非实际收款）
            </p>
            <p
              v-if="row.next_followup_at"
              class="mt-2 text-sm text-muted"
            >
              下次跟进：{{ row.next_followup_at }}
            </p>
          </UCard>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-muted">共 {{ data.followup_total }} 条</span><UPagination
              v-model:page="followupPage"
              :items-per-page="20"
              :total="Number(data.followup_total || 0)"
              :sibling-count="1"
            />
          </div>
        </div>
      </template>
    </template>
    <UModal
      v-if="canView"
      v-model:open="formOpen"
      :title="actionLabels[action]"
      :dismissible="!saving"
    >
      <template #body>
        <form
          id="collection-form"
          class="grid gap-4"
          @submit.prevent="save"
        >
          <UAlert
            v-if="formError"
            color="error"
            :title="formError"
          />
          <template v-if="action === 'collection-owner'">
            <UFormField
              label="催收负责人"
              required
            >
              <UserTreeSelector
                v-model="selectedOwner"
                selection-mode="single"
                hide-committees
              />
            </UFormField>
            <UFormField label="下次跟进时间">
              <UInput
                v-model="draft.collection_due_at"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
          </template>
          <UFormField
            v-else-if="action === 'due-date'"
            label="款项到期日"
          >
            <UInput
              v-model="draft.due_date"
              type="date"
              class="w-full"
            />
          </UFormField>
          <template v-else>
            <UFormField
              label="联系结果"
              required
            >
              <UTextarea
                v-model="draft.result"
                :maxlength="1000"
                class="w-full"
              />
            </UFormField>
            <UFormField label="承诺付款日">
              <UInput
                v-model="draft.promised_payment_date"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField label="承诺金额（非实际收款）">
              <UInput
                v-model="draft.promised_amount"
                inputmode="decimal"
                class="w-full"
              />
            </UFormField>
            <UFormField label="下次跟进时间">
              <UInput
                v-model="draft.next_followup_at"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
          </template>
        </form>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="formOpen = false"
        >
          取消
        </UButton><UButton
          type="submit"
          form="collection-form"
          :loading="saving"
        >
          保存
        </UButton>
      </template>
    </UModal>
  </div>
</template>
