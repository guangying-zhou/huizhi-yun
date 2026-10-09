<script setup lang="ts">
import AltocListColumns from './AltocListColumns.vue'
import RemoteObjectSelectMenu from '../../../foundation/app/components/RemoteObjectSelectMenu.vue'
import ContentPageHeader from '../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import { apfServerFieldErrors, apfEnumLabel } from '../utils/apfFormPresentation'
import { UModal, USlideover } from '#components'
import type { TableColumn } from '@nuxt/ui'
import { formatMoney } from '../../../foundation/app/utils/format'
import { altocValidationMessage, quotationItemsPayload } from '../utils/altocHostForms'
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{ detail?: boolean }>()
type Row = Record<string, unknown>
type Item = { item_name: string, specification: string, unit: string, quantity: string, unit_price: string, discount_rate: string, tax_rate: string }
const route = useRoute()
const { loaded, hasPermission, error: permissionError, loadPermissions } = usePermissions()
// Host composition skips the standalone Altoc permission middleware.
onMounted(() => {
  void loadPermissions()
})
const { status: accessStatus } = useEnterpriseNavigationAccess()
const scopeKey = useState<string>('enterprise-cache-scope', () => '')
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('quotation', 'edit'))
const quote = ref<Row | null>(null)
const rows = ref<Row[]>([])
const total = ref(0)
const page = ref(1)
const { search, debounced, flush } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const pending = ref(false)
const saving = ref(false)
const formError = ref('')
const formFields = ref<Record<string, string>>({})
const money = (value: unknown, currency: unknown) => formatMoney(value === null || value === undefined || value === '' ? null : String(value), { currency: String(currency || 'CNY') })
const error = ref('')
const id = computed(() => String(route.params.quotationId || ''))
const base = '/altoc/api/v1/quotes'
const parent = computed(() => `${base}/${encodeURIComponent(id.value)}`)
const editable = computed(() => canEdit.value && ['draft', 'rejected'].includes(String(quote.value?.status)))
const columnDefinitions: TableColumn<Row>[] = [{ accessorKey: 'quotation_no', header: '报价编号' }, { accessorKey: 'status', header: '状态' }, { accessorKey: 'customer_id', header: '客户编号' }, { accessorKey: 'amount_tax_inclusive', header: '含税金额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }, { accessorKey: 'currency_code', header: '币种' }]
const optionalColumns = [{ key: 'customer_id', label: '客户编号' }, { key: 'amount_tax_inclusive', label: '含税金额' }, { key: 'currency_code', label: '币种' }]
const visibleColumns = ref(optionalColumns.map(column => column.key))
const columns = computed(() => columnDefinitions.filter(column => !('accessorKey' in column) || !optionalColumns.some(item => item.key === column.accessorKey) || visibleColumns.value.includes(String(column.accessorKey))))
const labels: Record<string, string> = { draft: '草稿', pending_approval: '审批中', approved: '已批准', rejected: '已退回', sent: '已发送', accepted: '已接受', expired: '已过期', withdrawn: '已撤回', voided: '已作废' }
const toast = useToast()
const { confirm } = useConfirm()
const intent = createConsoleMutationIntent('altoc-quotation')
let epoch = 0
const open = ref(false)
const mode = ref<'header' | 'items'>('header')
const draft = reactive({ customerId: '', quotation_no: '', valid_until: '', currency_code: 'CNY', remark: '' })
const customerPage = ref(1)
const customerHasMore = ref(false)
const customerRows = ref<Row[]>([])
const customerLoading = ref(false)
const customerError = ref('')
const selectedCustomer = ref<{ value: string, label: string } | null>(null)
const { search: customerSearch, debounced: customerDebounced, flush: flushCustomerSearch } = useDebouncedSearch()
const customerOptions = computed(() => {
  const options = customerRows.value.map(row => ({ value: String(row.id), label: `${row.name}（${row.code}）` }))
  if (selectedCustomer.value && !options.some(row => row.value === selectedCustomer.value?.value)) options.unshift(selectedCustomer.value)
  return options
})
let customerEpoch = 0
async function loadCustomers(append = false) {
  if (append && (customerLoading.value || !customerHasMore.value)) return
  const requestedPage = append ? customerPage.value + 1 : 1
  const current = ++customerEpoch
  if (!append) {
    customerRows.value = []
    customerPage.value = 1
    customerHasMore.value = false
  }
  customerLoading.value = false
  if (!open.value || props.detail || !canEdit.value || !scopeKey.value || accessStatus.value !== 'ready') return
  customerLoading.value = true
  customerError.value = ''
  try {
    const result = await $fetch<{ data: { items: Row[], total: number } }>('/altoc/api/v1/customers', { query: { page: requestedPage, pageSize: 20, ...(customerDebounced.value ? { search: customerDebounced.value } : {}) }, retry: 0 })
    if (current !== customerEpoch) return
    if (!Array.isArray(result.data?.items) || !Number.isSafeInteger(result.data.total) || result.data.total < result.data.items.length) throw new Error('客户列表无效')
    customerRows.value = append ? [...customerRows.value, ...result.data.items.filter(row => !customerRows.value.some(old => old.id === row.id))] : result.data.items
    customerPage.value = requestedPage
    customerHasMore.value = result.data.items.length > 0 && result.data.items.length <= 20 && requestedPage * 20 < result.data.total
  } catch {
    if (current === customerEpoch) customerError.value = '客户列表加载失败，请重试或确认客户查看权限'
  } finally {
    if (current === customerEpoch) customerLoading.value = false
  }
}
watch([open, customerDebounced, canEdit, scopeKey, accessStatus], () => void loadCustomers())
watch(() => draft.customerId, (value) => {
  selectedCustomer.value = customerOptions.value.find(row => row.value === value) || null
})
const lines = ref<Item[]>([])
const versions = ref<Row[]>([])
const versionTotal = ref(0)
const versionPage = ref(1)
const selectedVersion = ref<Row | null>(null)
const versionOpen = ref(false)
const versionLoading = ref(false)
const ownerUids = computed(() => [...rows.value.map(r => String(r.owner_uid || '')), String(quote.value?.owner_uid || ''), ...versions.value.map(r => String(r.created_by || ''))])
const { userName, departmentName, directoryError } = useAltocDirectoryLabels(ownerUids)
const itemColumns: TableColumn<Row>[] = [
  { accessorKey: 'item_name', header: '名称' }, { accessorKey: 'specification', header: '规格' },
  { accessorKey: 'quantity', header: '数量', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
  ...['unit_price', 'amount_tax_inclusive'].map(k => ({ accessorKey: k, header: k === 'unit_price' ? '含税单价' : '含税金额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } })),
  { accessorKey: 'discount_rate', header: '折扣 %' }, { accessorKey: 'tax_rate', header: '税率 %' }
]
function clear() {
  rows.value = []
  quote.value = null
  total.value = 0
  versions.value = []
  versionTotal.value = 0
  selectedVersion.value = null
}
async function load() {
  const current = ++epoch
  clear()
  if (!scopeKey.value || accessStatus.value !== 'ready') return
  pending.value = true
  error.value = ''
  try {
    const result = await $fetch<{ data: Row }>(props.detail ? parent.value : base, { query: props.detail ? {} : { page: page.value, pageSize: 20, ...(debounced.value.trim() ? { search: debounced.value.trim() } : {}) } })
    if (current !== epoch) return
    if (props.detail) quote.value = result.data
    else {
      rows.value = result.data.items as Row[]
      total.value = Number(result.data.total)
    }
  } catch (e) {
    if (current === epoch) error.value = Number((e as { statusCode?: number }).statusCode) === 403 ? '无查看权限' : '报价暂不可用，请重试'
  } finally { if (current === epoch) pending.value = false }
}
watch([id, page, debounced, scopeKey, accessStatus], load, { immediate: true })
watch([scopeKey, id], () => {
  open.value = false
  versionOpen.value = false
})
onScopeDispose(() => {
  epoch++
  customerEpoch++
})
function blankItem(): Item {
  return { item_name: '', specification: '', unit: '', quantity: '1.0000', unit_price: '0.00', discount_rate: '0.00', tax_rate: '6.00' }
}
function begin(kind: 'header' | 'items') {
  if (!intent.reset()) {
    toast.add({ title: '请先重试未完成的操作', color: 'warning' })
    return
  }
  formError.value = ''
  formFields.value = {}
  mode.value = kind
  selectedCustomer.value = null
  customerSearch.value = ''
  customerPage.value = 1
  draft.customerId = String(quote.value?.customer_id ?? '')
  draft.quotation_no = String(quote.value?.quotation_no ?? '')
  draft.valid_until = String(quote.value?.valid_until ?? '').slice(0, 10)
  draft.currency_code = String(quote.value?.currency_code ?? 'CNY')
  draft.remark = String(quote.value?.remark ?? '')
  lines.value = ((quote.value?.items ?? []) as Row[]).map(row => ({ item_name: String(row.item_name), specification: String(row.specification ?? ''), unit: String(row.unit ?? ''), quantity: String(row.quantity), unit_price: String(row.unit_price), discount_rate: String(row.discount_rate), tax_rate: String(row.tax_rate) }))
  if (!lines.value.length) lines.value = [blankItem()]
  open.value = true
}
async function send(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  if (!scopeKey.value || accessStatus.value !== 'ready' || saving.value) return
  const current = epoch
  saving.value = true
  try {
    const done = await intent.submit({ path, method, body }, (request, key) => $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key } }))
    if (done && current === epoch) {
      open.value = false
      toast.add({ title: '已保存', color: 'success' })
      await load()
    }
  } catch (e) {
    formFields.value = { ...formFields.value, ...apfServerFieldErrors(e, Object.keys(body)) }
    formError.value = altocValidationMessage(e)
    toast.add({ title: '保存失败', description: formError.value, color: 'error' })
  } finally { saving.value = false }
}
async function save() {
  formFields.value = {}
  formError.value = ''
  if (mode.value === 'header' && !props.detail && !/^[1-9]\d*$/.test(draft.customerId.trim())) formFields.value.customerId = '请选择有权访问的客户'
  if (mode.value === 'header' && !/^[A-Z]{3}$/.test(draft.currency_code.trim())) formFields.value.currency_code = '请填写三位币种编码，例如 CNY'
  if (mode.value === 'items' && (!lines.value.length || lines.value.some(l => !l.item_name.trim()))) formError.value = '每条报价明细都需要名称。'
  if (formError.value || Object.keys(formFields.value).length) return
  if (mode.value === 'items') return send(`${parent.value}/items`, 'PATCH', quotationItemsPayload(quote.value?.row_version, lines.value))
  const body: Record<string, unknown> = { quotation_no: draft.quotation_no.trim() || null, valid_until: draft.valid_until || null, remark: draft.remark.trim() || null }
  if (props.detail) body.expectedVersion = quote.value?.row_version
  else {
    body.customerId = draft.customerId.trim()
    body.currency_code = draft.currency_code.trim()
  }
  await send(props.detail ? parent.value : base, props.detail ? 'PATCH' : 'POST', body)
}
async function transition(action: 'submit' | 'send' | 'accept') {
  if (!await confirm({ title: action === 'submit' ? '提交报价审批' : action === 'send' ? '发送报价' : '确认接受报价', message: action === 'submit' ? '提交后冻结本轮报价，批准或退回由审批人处理。' : action === 'send' ? '发送后将冻结本次报价版本，不可修改明细。' : '将此报价标记为已接受，历史版本保持不变。', tone: 'warning' })) return
  await send(`${parent.value}/transition`, 'POST', { expectedVersion: quote.value?.row_version, action })
}
async function loadVersions(version?: number) {
  if (!scopeKey.value || accessStatus.value !== 'ready') return
  const current = epoch
  versionLoading.value = true
  try {
    const result = await $fetch<{ data: Row | Row[], total?: number }>(`${parent.value}/versions${version ? `/${version}` : ''}`, { query: version ? {} : { page: versionPage.value, pageSize: 20 } })
    if (current !== epoch) return
    if (version) selectedVersion.value = result.data as Row
    else {
      versions.value = result.data as Row[]
      versionTotal.value = Number(result.total)
      selectedVersion.value = null
    }
    versionOpen.value = true
  } catch {
    toast.add({ title: '版本读取失败', color: 'error' })
  } finally {
    versionLoading.value = false
  }
}
watch(versionPage, () => loadVersions())
</script>

<template>
  <UDashboardPanel id="altoc-quotations">
    <template #header>
      <ContentPageHeader
        :title="detail ? String(quote?.quotation_no || quote?.code || '报价详情') : '报价'"
        hosted
        breadcrumb="销售 / 报价与投标 / 报价"
        description="维护报价明细并查看版本记录。"
      >
        <template #actions>
          <UButton
            v-if="detail"
            to="/altoc/quotes"
            color="neutral"
            variant="outline"
          >
            返回列表
          </UButton>
          <UButton
            v-if="canEdit && !detail"
            @click="begin('header')"
          >
            新建报价
          </UButton>
          <UButton
            v-if="editable"
            @click="begin('header')"
          >
            编辑报价
          </UButton>
          <UButton
            v-if="editable"
            color="neutral"
            variant="outline"
            @click="begin('items')"
          >
            编辑明细
          </UButton>
          <UButton
            v-if="canEdit && quote?.status === 'approved'"
            :loading="saving"
            @click="transition('send')"
          >
            发送报价
          </UButton>
          <UButton
            v-if="canEdit && quote?.status === 'sent'"
            :loading="saving"
            @click="transition('accept')"
          >
            确认接受
          </UButton>
          <UButton
            :loading="pending"
            color="neutral"
            variant="outline"
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
        v-if="error"
        color="error"
        :title="error"
      />
      <template v-else-if="!detail">
        <div
          class="flex min-w-0 items-center gap-2"
          aria-label="报价列表工具栏"
        >
          <UInput
            v-model="search"
            placeholder="搜索报价名称或编号"
            aria-label="搜索报价"
            class="min-w-0 flex-1 sm:max-w-72"
            icon="i-lucide-search"
            @keyup.enter="flush"
          />
          <AltocListColumns
            v-model="visibleColumns"
            name="quotations"
            :columns="optionalColumns"
            class="ml-auto"
          />
          <UButton
            v-if="search.trim()"
            color="neutral"
            variant="ghost"
            icon="i-lucide-filter-x"
            aria-label="清除筛选"
            @click="search = ''; flush()"
          />
        </div>
        <div class="max-w-full overflow-x-auto">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending || (!loaded && !permissionError)"
            class="w-full min-w-[40rem]"
          >
            <template #quotation_no-cell="{ row }">
              <NuxtLink
                :to="`/altoc/quotes/${row.original.id}`"
                class="block max-w-64 truncate text-primary"
              >{{ row.original.quotation_no || row.original.code }}</NuxtLink>
            </template>
            <template #status-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ labels[String(row.original.status)] || apfEnumLabel(row.original.status) }}
              </UBadge>
            </template>
            <template #amount_tax_inclusive-cell="{ row }">
              <span class="tabular-nums">{{ money(row.original.amount_tax_inclusive, row.original.currency_code) }}</span>
            </template>
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-file-text"
                title="暂无报价"
                :description="canEdit ? '调整搜索条件，或新建报价。' : '调整搜索条件后重试。'"
              >
                <UButton
                  v-if="canEdit"
                  @click="begin('header')"
                >
                  新建报价
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
      <template v-else-if="quote">
        <UCard>
          <UBadge
            color="neutral"
            variant="subtle"
          >
            {{ labels[String(quote.status)] || apfEnumLabel(quote.status) }}
          </UBadge><p>客户编号：{{ quote.customer_id }}</p><p>有效期：{{ quote.valid_until || '未设置' }}</p><p
            v-if="quote.remark"
            class="break-words"
          >
            备注：{{ quote.remark }}
          </p><p class="mt-2 text-sm text-muted">
            负责人：{{ userName(quote.owner_uid) }} · {{ departmentName(quote.owner_dept_code) }}
          </p><p
            v-if="directoryError"
            class="text-sm text-muted"
          >
            目录资料暂不可用
          </p><p class="mt-3 text-right tabular-nums">
            含税金额：{{ money(quote.amount_tax_inclusive, quote.currency_code) }}；不含税：{{ money(quote.amount_tax_exclusive, quote.currency_code) }}
          </p>
        </UCard>
        <UAlert
          v-if="quote.status === 'pending_approval'"
          title="审批处理中"
          description="批准或退回结果由正式审批流程回写。若提交结果未确认，请沿用同一请求重试。"
          color="warning"
        /><UButton
          v-if="editable"
          :loading="saving"
          @click="transition('submit')"
        >
          提交审批
        </UButton>
        <UCard>
          <template #header>
            <h2 class="font-semibold">
              报价明细
            </h2>
          </template><UTable
            :data="(quote.items as Row[])"
            :columns="itemColumns"
            :loading="pending"
          >
            <template #unit_price-cell="{ row }">
              {{ money(row.original.unit_price, quote.currency_code) }}
            </template><template #amount_tax_inclusive-cell="{ row }">
              {{ money(row.original.amount_tax_inclusive, quote.currency_code) }}
            </template><template #empty>
              <CommonEmptyState
                title="暂无明细"
                description="有编辑权限时，可通过页头编辑明细。"
              />
            </template>
          </UTable>
        </UCard>
        <UButton
          :loading="versionLoading"
          color="neutral"
          @click="loadVersions()"
        >
          版本历史
        </UButton>
      </template>
      <component
        :is="mode === 'items' ? USlideover : UModal"
        v-model:open="open"
        description="填写报价基本信息或逐行维护明细；金额以服务端计算为准。"
        :dismissible="!saving"
        :ui="{ content: mode === 'items' ? 'w-full sm:max-w-4xl' : 'w-full sm:max-w-xl' }"
        :title="mode === 'items' ? '编辑报价明细' : detail ? '编辑报价' : '新建报价'"
      >
        <template #body>
          <form
            id="altoc-quotation-form"
            class="space-y-3"
            @submit.prevent="save"
          >
            <UAlert
              v-if="formError"
              color="error"
              title="保存失败"
              :description="formError"
            />
            <template v-if="mode === 'header'">
              <UFormField
                v-if="!detail"
                label="客户（当前有权访问的客户）"
                :error="formFields.customerId"
                required
              >
                <RemoteObjectSelectMenu
                  v-model="draft.customerId"
                  v-model:search-term="customerSearch"
                  :items="customerOptions"
                  :loading="customerLoading"
                  :error="customerError"
                  :has-more="customerHasMore"
                  :disabled="!open || !canEdit"
                  placeholder="搜索客户名称或编号"
                  @load-more="loadCustomers(true)"
                  @retry="loadCustomers(customerRows.length > 0)"
                  @flush="flushCustomerSearch"
                />
              </UFormField>
              <UFormField
                label="报价单号"
                :error="formFields.quotation_no"
              >
                <UInput
                  v-model="draft.quotation_no"
                  class="w-full"
                  maxlength="50"
                />
              </UFormField>
              <UFormField
                v-if="!detail"
                label="币种"
                :error="formFields.currency_code"
                required
              >
                <UInput
                  v-model="draft.currency_code"
                  maxlength="3"
                  class="w-full"
                  required
                />
              </UFormField>
              <UFormField
                label="有效期"
                :error="formFields.valid_until"
              >
                <UInput
                  v-model="draft.valid_until"
                  type="date"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="备注（可选）"
                :error="formFields.remark"
              >
                <UTextarea
                  v-model="draft.remark"
                  maxlength="500"
                  class="w-full"
                />
              </UFormField>
            </template>
            <template v-else>
              <p class="text-sm">
                含税单价；逐行计算折扣后金额并四舍五入至两位，不含税金额按本行税率计算。以服务端结果为准。
              </p>
              <UCard
                v-for="(line, index) in lines"
                :key="index"
              >
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <UFormField
                    label="名称"
                    required
                  >
                    <UInput
                      v-model="line.item_name"
                      required
                      maxlength="200"
                    />
                  </UFormField>
                  <UFormField label="规格">
                    <UInput
                      v-model="line.specification"
                      maxlength="500"
                    />
                  </UFormField>
                  <UFormField label="单位">
                    <UInput
                      v-model="line.unit"
                      maxlength="20"
                    />
                  </UFormField>
                  <UFormField label="数量（最多四位小数）">
                    <UInput
                      v-model="line.quantity"
                      inputmode="decimal"
                      required
                    />
                  </UFormField>
                  <UFormField label="含税单价">
                    <UInput
                      v-model="line.unit_price"
                      inputmode="decimal"
                      required
                    />
                  </UFormField>
                  <UFormField label="折扣 %">
                    <UInput
                      v-model="line.discount_rate"
                      inputmode="decimal"
                      required
                    />
                  </UFormField>
                  <UFormField label="税率 %">
                    <UInput
                      v-model="line.tax_rate"
                      inputmode="decimal"
                      required
                    />
                  </UFormField>
                </div>
                <UButton
                  v-if="lines.length > 1"
                  color="neutral"
                  @click="lines.splice(index, 1)"
                >
                  移除本行（保存后生效）
                </UButton>
              </UCard>
              <UButton
                color="neutral"
                :disabled="lines.length >= 1000"
                @click="lines.push(blankItem())"
              >
                添加明细
              </UButton>
            </template>
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
              form="altoc-quotation-form"
              :loading="saving"
            >
              保存报价
            </UButton>
          </div>
        </template>
      </component>
      <UModal
        v-model:open="versionOpen"
        title="不可变报价版本"
        description="读取发送时冻结的版本；历史版本不能修改。"
      >
        <template #body>
          <template v-if="selectedVersion">
            <p>版本 {{ selectedVersion.version_no }}</p><UCard>
              <p>{{ selectedVersion.quotation_no || selectedVersion.code }}</p><UBadge
                color="neutral"
                variant="subtle"
              >
                {{ labels[String(selectedVersion.status)] || '历史版本' }}
              </UBadge><p class="text-right tabular-nums">
                {{ money(selectedVersion.amount_tax_inclusive, selectedVersion.currency_code) }}
              </p><p
                v-if="selectedVersion.remark"
                class="break-words"
              >
                {{ selectedVersion.remark }}
              </p><UTable
                :data="(selectedVersion.items || []) as Row[]"
                :columns="itemColumns"
                :loading="versionLoading"
              >
                <template #unit_price-cell="{ row }">
                  {{ money(row.original.unit_price, selectedVersion.currency_code) }}
                </template><template #amount_tax_inclusive-cell="{ row }">
                  {{ money(row.original.amount_tax_inclusive, selectedVersion.currency_code) }}
                </template>
              </UTable>
            </UCard><UButton @click="loadVersions()">
              返回版本列表
            </UButton>
          </template>
          <template v-else>
            <UButton
              v-for="version in versions"
              :key="String(version.version_no)"
              class="mb-2"
              color="neutral"
              @click="loadVersions(Number(version.version_no))"
            >
              版本 {{ version.version_no }}
            </UButton><p v-if="!versions.length">
              暂无冻结版本
            </p><p>共 {{ versionTotal }} 个版本</p><UPagination
              v-model:page="versionPage"
              :total="versionTotal"
              :items-per-page="20"
            />
          </template>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
