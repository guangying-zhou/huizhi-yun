<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import FinanceBusinessObjectSelect from './FinanceBusinessObjectSelect.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { createFinanceIntent } from '../../utils/hostFinanceForms'
import { allocationPayload, adjustmentTypes, receivableStatusLabel, historicalStatusLabel, receivableMessage, receivableReadMessage, receivableTitles, type ReceivableMode, type ReceivableFact, type AllocationCandidate } from '../../utils/financeReceivables'

const props = defineProps<{
  mode: ReceivableMode
  objectCode?: string
  embedded?: boolean
}>()
const emit = defineEmits<{ changed: [] }>()
const { user: currentUser } = useAuth()
const route = useRoute()
const { hosted, moduleUrl, apiUrl } = useFinanceModule()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
const { confirm } = useConfirm()
const toast = useToast()
const intent = createFinanceIntent()
const resource = computed(() => props.mode === 'continuation' ? 'historical_finance' : props.mode.startsWith('adjust') ? 'receivable_adjustments' : 'reconciliation')
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission(resource.value, props.mode === 'adjust-new' ? 'edit' : 'view'))
const code = computed(() => String(props.objectCode ?? route.params.code ?? ''))
const contract = ref('')
const selectedContract = computed(() => props.mode === 'continuation' ? code.value : contract.value)
const status = ref('all')
const historyError = ref('')
const schedule = ref('')
const scheduleVersion = ref(0)
const type = ref('discount')
const amount = ref('')
const reason = ref('')
const page = ref(1)
const items = ref<ReceivableFact[]>([])
const candidates = ref<AllocationCandidate[]>([])
const amounts = reactive<Record<string, string>>({})
const selectedCandidates = reactive<Record<string, AllocationCandidate>>({})
const row = ref<ReceivableFact | null>(null)
const receipt = ref<ReceivableFact | null>(null)
const history = ref<ReceivableFact[]>([])
const total = ref(0)
const historyTotal = ref(0)
const historyPage = ref(1)
const pending = ref(false)
const saving = ref(false)
const error = ref('')
const { search, debounced: debouncedSearch, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const isList = computed(() => ['adjustments', 'batches'].includes(props.mode) || (props.mode === 'continuation' && !code.value))
const columns = computed(() => props.mode === 'continuation' ? [{ accessorKey: 'code', header: '合同编号' }, { accessorKey: 'name', header: '合同名称' }, { accessorKey: 'status', header: '接续状态' }, { accessorKey: 'opening_amount', header: '净期初' }, { accessorKey: 'currency_code', header: '币种' }, { accessorKey: 'cutoff_date', header: '快照日' }] : props.mode === 'batches' ? [{ accessorKey: 'code', header: '编号' }, { accessorKey: 'receipt_code', header: '到账' }, { accessorKey: 'currency_code', header: '币种' }, { accessorKey: 'total_amount', header: '金额' }, { accessorKey: 'status', header: '状态' }] : [{ accessorKey: 'code', header: '编号' }, { accessorKey: 'contract_code', header: '合同' }, { accessorKey: 'billing_schedule_code', header: '结算计划' }, { accessorKey: 'currency_code', header: '币种' }, { accessorKey: 'amount', header: '金额' }, { accessorKey: 'status', header: '状态' }])
const candidateColumns = [{ accessorKey: 'name', header: '结算计划' }, { accessorKey: 'contract_code', header: '合同' }, { accessorKey: 'outstanding_amount', header: '未结金额' }, { id: 'allocate', header: '本次分配' }]
const batchLines = computed(() => {
  try {
    return typeof row.value?.allocation_lines === 'string' ? JSON.parse(row.value.allocation_lines) : row.value?.allocation_lines || []
  } catch {
    return []
  }
})
const batchColumns = [{ accessorKey: 'code', header: '核销记录' }, { accessorKey: 'contractCode', header: '合同' }, { accessorKey: 'billingScheduleCode', header: '结算计划' }, { accessorKey: 'amount', header: '金额' }]
const historyColumns = [{ accessorKey: 'source_table', header: '来源' }, { accessorKey: 'source_pk', header: '来源编号' }, { accessorKey: 'amount', header: '历史金额' }, { accessorKey: 'captured_at', header: '保全时间' }]
const detailLabels: Record<string, string> = { code: '编号', receipt_code: '到账', contract_code: '合同', billing_schedule_code: '结算计划', opening_amount: '净期初', amount: '金额', total_amount: '分配总额', currency_code: '币种', cutoff_date: '快照日', status: '状态', adjustment_type: '调整类型', reason: '原因', entered_by: '录入人', confirmed_by: '确认人', confirmed_at: '确认时间', activated_by: '激活人', activated_at: '激活时间', reversed_by: '撤销人', reversed_at: '撤销时间', reverse_reason: '撤销原因' }
const detailKeys = computed(() => Object.keys(detailLabels).filter(key => row.value?.[key] != null))
function detailValue(key: string) {
  const value = row.value?.[key]
  if (key === 'status') return props.mode === 'continuation' ? (row.value?.ready ? '已激活' : '待激活') : receivableStatusLabel(String(value))
  if (key === 'adjustment_type') return adjustmentTypes.find(item => item.value === value)?.label || '未知类型'
  return String(value ?? '')
}

let generation = 0
onMounted(() => {
  void loadPermissions()
})
async function load() {
  if (!allowed.value)
    return
  const epoch = ++generation
  historyError.value = ''
  pending.value = true
  error.value = ''
  try {
    if (props.mode === 'continuation') {
      if (isList.value) {
        const response = await $fetch<{ data: { items: ReceivableFact[], total: number } }>(apiUrl('/historical-finance'), { query: { page: page.value, pageSize: 20, ...(debouncedSearch.value ? { search: debouncedSearch.value } : {}), ...(status.value !== 'all' ? { status: status.value } : {}) }, retry: 0 })
        if (epoch !== generation) return
        items.value = response.data.items
        total.value = response.data.total
      } else {
        const [preview, old] = await Promise.allSettled([
          $fetch<{ data: ReceivableFact }>(apiUrl(`/historical-finance/${encodeURIComponent(selectedContract.value)}`), { retry: 0 }),
          $fetch<{ data: { items: ReceivableFact[], total: number } }>(apiUrl(`/historical-finance/${encodeURIComponent(selectedContract.value)}/history`), { query: { page: historyPage.value, pageSize: 20 }, retry: 0 })
        ])
        if (epoch !== generation) return
        row.value = preview.status === 'fulfilled' ? preview.value.data : null
        if (preview.status === 'rejected') error.value = receivableReadMessage(preview.reason)
        history.value = old.status === 'fulfilled' ? old.value.data.items : []
        historyTotal.value = old.status === 'fulfilled' ? old.value.data.total : 0
        historyError.value = old.status === 'rejected' ? receivableReadMessage(old.reason) : ''
      }
    } else if (props.mode === 'allocate') {
      const [source, choices] = await Promise.all([$fetch<{
        data: ReceivableFact
      }>(apiUrl(`/receipts/${encodeURIComponent(code.value)}`), { retry: 0 }), $fetch<{
        data: {
          items: AllocationCandidate[]
          total: number
        }
      }>(apiUrl(`/receipts/${encodeURIComponent(code.value)}/allocation-candidates`), { query: { page: page.value, pageSize: 20 }, retry: 0 })])
      if (epoch !== generation)
        return
      receipt.value = source.data
      candidates.value = choices.data.items
      total.value = choices.data.total
      for (const candidate of candidates.value)
        if (amounts[candidate.code])
          selectedCandidates[candidate.code] = candidate
    } else if (props.mode !== 'adjust-new') {
      const base = props.mode.startsWith('adjust') ? 'receivable-adjustments' : 'allocation-batches'
      const response = await $fetch<{
        data: ReceivableFact | {
          items: ReceivableFact[]
          total: number
        }
      }>(apiUrl(`/${base}${isList.value ? '' : `/${encodeURIComponent(code.value)}`}`), { query: isList.value ? { page: page.value, pageSize: 20, ...(debouncedSearch.value ? { search: debouncedSearch.value } : {}) } : undefined, retry: 0 })
      if (epoch !== generation)
        return
      if (isList.value) {
        const value = response.data as {
          items: ReceivableFact[]
          total: number
        }
        items.value = value.items
        total.value = value.total
      } else
        row.value = response.data as ReceivableFact
    }
  } catch (failure) {
    if (epoch === generation)
      error.value = receivableReadMessage(failure)
  } finally {
    if (epoch === generation)
      pending.value = false
  }
}
watch(code, () => {
  generation++
  row.value = null
  history.value = []
  historyTotal.value = 0
  historyPage.value = 1
  error.value = ''
  historyError.value = ''
}, { flush: 'sync' })
watch(status, () => {
  page.value = 1
})
watch(() => [status.value, allowed.value, code.value, page.value, historyPage.value, contract.value, debouncedSearch.value], () => {
  void load()
}, { immediate: true })
onScopeDispose(() => {
  generation++
})
function allocationChanged(candidate: AllocationCandidate, value: string) {
  amounts[candidate.code] = value
  selectedCandidates[candidate.code] = candidate
}
async function write(action: 'activate' | 'allocate' | 'create' | 'confirm' | 'reverse') {
  if (action === 'allocate' && (!receipt.value?.confirmed_by || receipt.value.confirmed_by === currentUser.value)) return
  if (props.mode === 'adjust-detail' && ['confirm', 'reverse'].includes(action) && row.value?.entered_by === currentUser.value) return
  if (saving.value || !allowed.value || !hasPermission(resource.value, action === 'create' ? 'edit' : action === 'allocate' ? 'confirm' : action))
    return
  const objectCode = code.value
  let body: Record<string, unknown>
  let path: string
  try {
    if (action === 'activate' && row.value) {
      body = { expectedVersion: row.value.row_version, reviewHash: row.value.review_hash, evidenceSha256: row.value.evidence_sha256 }
      path = `/historical-finance/${selectedContract.value}/activate`
    } else if (action === 'allocate' && receipt.value) {
      body = allocationPayload(receipt.value.row_version, Object.values(selectedCandidates), amounts)
      path = `/receipts/${code.value}/allocate`
    } else if (action === 'create') {
      if (!contract.value || !schedule.value || !reason.value.trim() || !/^-?\d+(\.\d{1,2})?$/.test(amount.value) || Number(amount.value) === 0)
        throw new Error('请填写合同、结算计划、有效金额和调整原因')
      if (!scheduleVersion.value)
        throw new Error('请重新选择结算计划')
      body = { contractCode: contract.value, billingScheduleCode: schedule.value, scheduleVersion: scheduleVersion.value, adjustmentType: type.value, amount: amount.value, reason: reason.value }
      path = '/receivable-adjustments'
    } else if (row.value) {
      if (action === 'reverse' && !reason.value.trim())
        throw new Error('请填写撤销原因')
      body = { expectedVersion: row.value.row_version, ...(action === 'reverse' ? { reason: reason.value } : {}) }
      path = `/${props.mode === 'batch-detail' ? 'allocation-batches' : 'receivable-adjustments'}/${row.value.code}/${action}`
    } else
      return
    if (!await confirm({ tone: 'warning', title: action === 'create' ? '录入调整' : action === 'confirm' ? '确认调整' : action === 'reverse' ? '撤销' : action === 'activate' ? '激活历史接续' : '确认分配', message: `办理「${row.value?.code || receipt.value?.code || contract.value}」。${action === 'activate' ? '净期初与快照日将冻结，旧 OA 明细仅保全、不参与余额计算。' : action === 'allocate' ? '全部分配行将在同一事务生效，任一目标不满足条件则全部拒绝。' : '保留完整审计；调整录入人与确认人必须不同。'}` }))
      return
    if (objectCode !== code.value) return
    saving.value = true
    await $fetch(apiUrl(path), { method: 'POST', body, headers: { 'Idempotency-Key': intent.key({ action, path, body }) }, retry: 0 })
    intent.reset()
    toast.add({ title: '办理成功', color: 'success' })
    emit('changed')
    if (action === 'create')
      await navigateTo(moduleUrl('/receivable-adjustments'))
    else {
      if (action === 'allocate')
        for (const key of Object.keys(amounts))
          amounts[key] = ''
      await load()
    }
  } catch (failure) {
    toast.add({ title: receivableMessage(failure), color: 'error' })
    const status = (failure as {
      statusCode?: number
      status?: number
    }).statusCode || (failure as {
      status?: number
    }).status
    if (status === 409)
      await load()
  } finally {
    saving.value = false
  }
}
defineExpose({ hasDraft: () => saving.value || Object.values(amounts).some(Boolean) })
</script>

<template>
  <div class="space-y-4 min-w-0">
    <ContentPageHeader
      v-if="hosted && !embedded"
      :hosted="hosted"
      :title="receivableTitles[mode]"
    >
      <template #actions>
        <UButton
          v-if="mode === 'adjustments' && hasPermission(resource, 'edit')"
          :to="moduleUrl('/receivable-adjustments/new')"
          icon="i-lucide-plus"
        >
          录入调整
        </UButton>
        <UButton
          v-if="!isList"
          :to="moduleUrl(mode === 'continuation' ? '/historical-finance' : mode === 'batch-detail' ? '/allocation-batches' : '/reconciliation')"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-left"
        >
          返回
        </UButton>
        <UButton
          variant="outline"
          color="neutral"
          :loading="pending"
          @click="load"
        >
          刷新
        </UButton>
      </template>
    </ContentPageHeader>
    <CommonEmptyState
      v-if="!loaded"
      title="正在加载权限"
      icon="i-lucide-loader-circle"
    />
    <CommonEmptyState
      v-else-if="permissionError"
      title="权限加载失败"
      icon="i-lucide-circle-alert"
    />
    <CommonEmptyState
      v-else-if="!allowed"
      title="无权限"
      description="您没有查看或办理此功能的权限"
      icon="i-lucide-lock"
    />
    <template v-else>
      <UAlert
        v-if="error"
        color="error"
        :title="error"
      />
      <div
        v-if="isList"
        class="flex flex-wrap items-center gap-2"
      >
        <UInput
          v-model="search"
          :placeholder="mode === 'continuation' ? '搜索合同编号或名称' : '搜索编号'"
          class="w-full sm:w-72"
          @keydown.enter="flush"
        />
        <USelect
          v-if="mode === 'continuation'"
          v-model="status"
          :items="[{ label: '全部接续状态', value: 'all' }, { label: '待核验', value: 'pending' }, { label: '已激活', value: 'active' }]"
          class="w-40"
        />
      </div>
      <div
        v-if="isList"
        class="space-y-2 sm:hidden"
      >
        <NuxtLink
          v-for="item in items"
          :key="item.code"
          :to="moduleUrl(`/${mode === 'continuation' ? 'historical-finance' : mode === 'adjustments' ? 'receivable-adjustments' : 'allocation-batches'}/${item.code}`)"
          class="block min-w-0 rounded border border-default p-3"
        >
          <div class="truncate text-sm text-primary">{{ item.code }}</div>
          <div
            v-if="mode === 'continuation'"
            class="mt-1 truncate text-sm"
          >{{ item.name }}</div>
          <div
            v-if="mode === 'continuation'"
            class="mt-1 text-xs text-muted"
          >快照日 {{ item.cutoff_date || '未登记' }}</div><div class="mt-2 flex items-center justify-between gap-2 text-sm"><span>{{ item.opening_amount || item.amount || item.total_amount }} {{ item.currency_code }}</span><UBadge
            color="neutral"
            variant="subtle"
          >{{ mode === 'continuation' ? historicalStatusLabel(item.status) : receivableStatusLabel(item.status) }}</UBadge></div>
        </NuxtLink>
        <CommonEmptyState
          v-if="!items.length && !pending"
          title="暂无记录"
          icon="i-lucide-inbox"
        />
      </div>
      <UTable
        v-if="isList"
        class="hidden sm:block"
        :data="items"
        :columns="columns"
        :loading="pending"
      >
        <template #code-cell="{ row: item }">
          <NuxtLink
            :to="moduleUrl(`/${mode === 'continuation' ? 'historical-finance' : mode === 'adjustments' ? 'receivable-adjustments' : 'allocation-batches'}/${item.original.code}`)"
            class="text-primary"
          >{{ item.original.code }}</NuxtLink>
        </template>
        <template #opening_amount-cell="{ row: item }">
          <span class="block text-right tabular-nums">{{ item.original.opening_amount }}</span>
        </template>
        <template #name-cell="{ row: item }">
          <span
            class="block max-w-72 truncate"
            :title="String(item.original.name || '')"
          >{{ item.original.name }}</span>
        </template>
        <template #status-cell="{ row: item }">
          <UBadge
            color="neutral"
            variant="subtle"
          >
            {{ mode === 'continuation' ? historicalStatusLabel(item.original.status) : receivableStatusLabel(item.original.status) }}
          </UBadge>
        </template>
        <template #empty>
          <CommonEmptyState
            title="暂无记录"
            icon="i-lucide-inbox"
          />
        </template>
      </UTable>
      <div
        v-if="isList"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="20"
        />
      </div>
      <div
        v-if="mode === 'adjust-new'"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <UFormField
          label="合同"
          required
        >
          <FinanceBusinessObjectSelect
            v-model="contract"
            kind="contracts"
            :enabled="allowed"
            class="w-full"
          />
        </UFormField>
        <template v-if="mode === 'adjust-new'">
          <UFormField
            label="结算计划"
            required
          >
            <FinanceBusinessObjectSelect
              v-model="schedule"
              kind="billing-schedules"
              :enabled="allowed"
              :contract-code="contract"
              class="w-full"
              @select="scheduleVersion = Number($event.row_version || 0)"
            />
          </UFormField>
          <UFormField
            label="调整类型"
            required
          >
            <USelect
              v-model="type"
              :items="adjustmentTypes"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="金额（正数减少应收，调整可为负数）"
            required
          >
            <UInput
              v-model="amount"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="原因"
            required
            class="sm:col-span-2"
          >
            <UTextarea
              v-model="reason"
              class="w-full"
            />
          </UFormField>
          <UButton
            :loading="saving"
            @click="write('create')"
          >
            保存待确认调整
          </UButton>
        </template>
      </div>
      <template v-if="mode === 'allocate'">
        <UAlert
          v-if="receipt?.confirmed_by === currentUser"
          color="warning"
          title="到账已由你确认，请交另一位财务分配"
          description="由另一位获权人员打开交接链接办理，不能通过切换角色代替异人复核。"
        />
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm">到账 {{ receipt?.code }} · 可分配 {{ receipt?.unreconciled_amount }} {{ receipt?.currency_code }}</span><UButton
            v-if="hasPermission(resource, 'confirm')"
            class="shrink-0 whitespace-nowrap"
            :loading="saving"
            :disabled="!receipt?.confirmed_by || receipt.confirmed_by === currentUser"
            @click="write('allocate')"
          >
            确认全部分配
          </UButton>
        </div>
        <div class="space-y-2 sm:hidden">
          <div
            v-for="candidate in candidates"
            :key="candidate.code"
            class="min-w-0 rounded border border-default p-3"
          >
            <div
              class="truncate text-sm"
              :title="candidate.name"
            >
              {{ candidate.name }}
            </div><div class="mt-2 flex items-center justify-between gap-2">
              <span class="text-xs text-muted">{{ candidate.outstanding_amount }} {{ candidate.currency_code }}</span><UInput
                :model-value="amounts[candidate.code] || ''"
                class="w-28"
                inputmode="decimal"
                aria-label="本次分配金额"
                @update:model-value="allocationChanged(candidate, String($event))"
              />
            </div>
          </div><CommonEmptyState
            v-if="!candidates.length && !pending"
            title="暂无可分配目标"
            icon="i-lucide-inbox"
          />
        </div>
        <UTable
          class="hidden sm:block"
          :data="candidates"
          :columns="candidateColumns"
          :loading="pending"
        >
          <template #allocate-cell="{ row: item }">
            <UInput
              :model-value="amounts[item.original.code] || ''"
              class="w-28"
              inputmode="decimal"
              aria-label="本次分配金额"
              @update:model-value="allocationChanged(item.original, String($event))"
            />
          </template><template #empty>
            <CommonEmptyState
              title="暂无可分配目标"
              icon="i-lucide-inbox"
            />
          </template>
        </UTable>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
          />
        </div>
      </template>
      <CommonEmptyState
        v-if="mode === 'continuation' && !isList && !row && !pending"
        title="接续概览读取失败"
        description="请刷新核验，当前不会发起激活命令"
      />
      <template v-if="row">
        <UBadge
          v-if="mode === 'continuation'"
          :color="row.ready ? 'success' : 'warning'"
          variant="subtle"
        >
          {{ row.ready ? '已激活' : '净期初证据已核验，待激活' }}
        </UBadge>
        <div
          v-if="mode === 'batch-detail'"
          class="space-y-2 sm:hidden"
        >
          <div
            v-for="line in batchLines"
            :key="line.code"
            class="min-w-0 rounded border border-default p-3"
          >
            <div class="truncate text-sm">
              {{ line.code }}
            </div><div class="mt-2 text-sm">
              {{ line.amount }} {{ row.currency_code }}
            </div><div class="truncate text-xs text-muted">
              {{ line.billingScheduleCode }}
            </div>
          </div>
        </div>
        <UTable
          v-if="mode === 'batch-detail'"
          class="hidden sm:block"
          :data="batchLines"
          :columns="batchColumns"
          :loading="pending"
        >
          <template #empty>
            <CommonEmptyState
              title="暂无分配明细"
              icon="i-lucide-inbox"
            />
          </template>
        </UTable>
        <dl :class="mode === 'continuation' ? 'grid grid-cols-2 lg:grid-cols-4 gap-4' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'">
          <div
            v-for="key in detailKeys"
            :key="key"
            class="min-w-0"
          >
            <template v-if="row[key] != null">
              <dt class="text-xs text-muted">
                {{ detailLabels[key] }}
              </dt><dd
                class="truncate text-sm"
                :title="detailValue(key)"
              >
                {{ detailValue(key) }}
              </dd>
            </template>
          </div>
        </dl>
        <p
          v-if="mode === 'adjust-detail' && row.entered_by === currentUser"
          class="text-sm text-muted"
        >
          此调整由你录入，须由另一位财务确认或撤销。
        </p>
        <UButton
          v-if="mode === 'continuation' && !row.ready && row.evidence_sha256 && hasPermission(resource, 'activate')"
          :loading="saving"
          @click="write('activate')"
        >
          激活历史接续
        </UButton>
        <UButton
          v-if="mode === 'adjust-detail' && row.status === 'draft' && hasPermission(resource, 'confirm')"
          :disabled="row.entered_by === currentUser"
          :loading="saving"
          @click="write('confirm')"
        >
          确认调整
        </UButton>
        <div
          v-if="['adjust-detail', 'batch-detail'].includes(mode) && ['active', 'confirmed'].includes(row.status || '') && hasPermission(resource, mode === 'batch-detail' ? 'confirm' : 'reverse')"
          class="flex flex-wrap gap-2"
        >
          <UInput
            v-model="reason"
            placeholder="撤销原因"
            class="w-full sm:w-80"
          /><UButton
            color="warning"
            :loading="saving"
            :disabled="mode === 'adjust-detail' && row.entered_by === currentUser"
            @click="write('reverse')"
          >
            撤销
          </UButton>
        </div>
      </template>
      <template v-if="mode === 'continuation' && !isList">
        <UAlert
          color="info"
          title="旧 OA 明细仅保全查询，不参与净期初或当前余额计算"
        />
        <UAlert
          v-if="historyError"
          color="error"
          :title="historyError"
        />
        <template v-else>
          <div class="space-y-2 sm:hidden">
            <div
              v-for="item in history"
              :key="`${item.source_table}:${item.source_pk}`"
              class="min-w-0 rounded border border-default p-3 text-sm"
            >
              <div class="truncate">
                {{ item.source_table }} · {{ item.source_pk }}
              </div><div class="mt-2">
                {{ item.amount }} · {{ item.captured_at }}
              </div>
            </div><CommonEmptyState
              v-if="!history.length && !pending"
              title="此合同无关联的旧 OA 保全明细"
            />
          </div><UTable
            class="hidden sm:block"
            :data="history"
            :columns="historyColumns"
            :loading="pending"
          >
            <template #empty>
              <CommonEmptyState
                title="此合同无关联的旧 OA 保全明细"
                icon="i-lucide-inbox"
              />
            </template>
          </UTable><div class="flex justify-between gap-2">
            <span class="text-sm text-muted">共 {{ historyTotal }} 条</span><UPagination
              v-model:page="historyPage"
              :total="historyTotal"
              :items-per-page="20"
            />
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
