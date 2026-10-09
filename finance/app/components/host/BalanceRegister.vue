<script setup lang="ts">
import { financeBusinessDate, financeRecordedTime } from '../../utils/financeWorkbench'
import { w3BalanceFlags } from '../../utils/w3AccountPresentation'
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { formatMoney } from '../../../../foundation/app/utils/format'
import type { BalanceEntry, BalanceSnapshot } from '../../types/hostFinance'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { createFinanceIntent, financeWriteMessage } from '../../utils/hostFinanceForms'
import { balanceDraft } from '../../utils/w3AccountForms'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import FinanceBusinessObjectSelect from './FinanceBusinessObjectSelect.vue'

const props = defineProps<{
  canView: boolean
  canRegister: boolean
  accountCode?: string
}>()
const emit = defineEmits<{
  saved: [
  ]
}>()
const { apiUrl, sessionScope } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const toast = useToast()
const intent = createFinanceIntent()
const open = ref(false)
const saving = ref(false)
const error = ref('')
const form = reactive({ code: '', date: '', amount: '', note: '' })
const existingCount = ref<number | null>(null)
const previewPending = ref(false)
let previewEpoch = 0
function register() {
  if (!props.canRegister)
    return
  Object.assign(form, { code: props.accountCode || '', date: financeBusinessDate(), amount: '', note: '' })
  intent.reset()
  error.value = ''
  open.value = true
}
watch([open, () => form.code, () => form.date], async () => {
  const current = ++previewEpoch
  existingCount.value = null
  previewPending.value = false
  if (!open.value || !props.canView || !form.code || !/^\d{4}-\d{2}-\d{2}$/.test(form.date))
    return
  previewPending.value = true
  try {
    const response = await api.balanceEntries(form.code, form.date)
    if (current === previewEpoch)
      existingCount.value = response.total
  } catch {
    if (current === previewEpoch)
      error.value = '现有登记条数暂不可用，请稍后重试'
  } finally {
    if (current === previewEpoch)
      previewPending.value = false
  }
})
async function submit() {
  if (!props.canRegister || saving.value)
    return
  if (!form.code) {
    error.value = '请选择银行账户'
    return
  }
  let body
  try {
    body = balanceDraft(form.date, form.amount, form.note)
  } catch (failure) {
    error.value = (failure as Error).message
    return
  }
  saving.value = true
  error.value = ''
  try {
    await api.registerBalance(form.code, body, intent.key({ code: form.code, ...body }))
    open.value = false
    intent.reset()
    toast.add({ title: '余额已登记，历史流水保留', color: 'success' })
    emit('saved')
  } catch (failure) {
    error.value = financeWriteMessage(failure)
    toast.add({ title: error.value, color: 'error' })
  } finally {
    saving.value = false
  }
}
const evidenceTab = ref('entries')
const historyOpen = ref(false)
const selected = ref<BalanceSnapshot | null>(null)
const page = ref(1)
const entries = ref<BalanceEntry[]>([])
const total = ref(0)
const loading = ref(false)
const historyError = ref('')
let epoch = 0
async function loadHistory() {
  const current = ++epoch
  entries.value = []
  total.value = 0
  historyError.value = ''
  if (!historyOpen.value || !selected.value || !props.canView) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const response = await api.balanceEntries(selected.value.account_code, selected.value.snapshot_date.slice(0, 10), page.value)
    if (current === epoch) {
      entries.value = response.data
      total.value = response.total
    }
  } catch (failure) {
    if (current === epoch)
      historyError.value = financeWriteMessage(failure)
  } finally {
    if (current === epoch)
      loading.value = false
  }
}
function showEntries(snapshot: BalanceSnapshot) {
  evidenceTab.value = 'entries'
  selected.value = snapshot
  page.value = 1
  historyOpen.value = true
}
watch([historyOpen, selected, page, () => props.canView], () => void loadHistory())
const columns: TableColumn<BalanceEntry>[] = [{ accessorKey: 'recorded_at', header: '登记时间' }, { accessorKey: 'balance_amount', header: '金额' }, { accessorKey: 'recorded_by_name', header: '登记人' }, { accessorKey: 'note', header: '备注' }, { accessorKey: 'is_day_latest', header: '当日展示值' }]
const byLabel = (entry: BalanceEntry) => entry.recorded_by ? entry.recorded_by_name || entry.recorded_by : `${entry.recorded_by_name || '未映射人员'}（原系统人员）`
watch(() => sessionScope?.value, () => {
  open.value = false
  historyOpen.value = false
  selected.value = null
  entries.value = []
  Object.assign(form, { code: '', date: '', amount: '', note: '' })
  intent.reset()
  epoch++
  previewEpoch++
})
onScopeDispose(() => {
  epoch++
  previewEpoch++
})
defineExpose({ register, showEntries })
</script>

<template>
  <UModal
    v-model:open="open"
    title="登记余额"
    description="每次登记保留独立流水，不覆盖历史。"
    :dismissible="!saving"
    :close="!saving"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="submit"
      >
        <UFormField
          label="银行账户"
          required
        >
          <FinanceBusinessObjectSelect
            v-model="form.code"
            kind="bank-accounts"
            account-value="code"
            :enabled="open && canView && !saving && !accountCode"
          /><p
            v-if="accountCode"
            class="text-sm text-muted"
          >
            {{ accountCode }}
          </p>
        </UFormField>
        <UFormField
          label="对账日期"
          required
        >
          <UInput
            v-model="form.date"
            type="date"
            :disabled="saving"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="余额金额"
          required
          help="贷款账户可登记负数，最多两位小数。"
        >
          <UInput
            v-model="form.amount"
            inputmode="decimal"
            :disabled="saving"
            class="w-full"
          />
        </UFormField>
        <UFormField label="备注">
          <UTextarea
            v-model="form.note"
            maxlength="500"
            :disabled="saving"
            class="w-full"
          />
        </UFormField>
        <p
          v-if="previewPending"
          role="status"
          class="text-sm text-muted"
        >
          正在核对现有登记…
        </p><p
          v-else-if="existingCount !== null"
          class="text-sm text-muted"
        >
          已有 {{ existingCount }} 条登记，本次将成为当日展示值；人工登记优先于导入快照。
        </p>
        <UAlert
          v-if="error"
          color="error"
          :title="error"
        />
        <div class="flex flex-wrap gap-2">
          <UButton
            type="submit"
            :loading="saving"
            :disabled="!canRegister || previewPending"
          >
            登记
          </UButton><UButton
            color="neutral"
            :disabled="saving"
            @click="open = false"
          >
            取消
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
  <USlideover
    v-model:open="historyOpen"
    title="当日余额登记流水"
    :description="`${selected?.account_name || selected?.account_code || ''} · ${selected?.snapshot_date?.slice(0, 10) || ''}`"
    :ui="{ content: 'w-full sm:max-w-3xl' }"
  >
    <template #body>
      <div
        v-if="selected"
        class="mb-4 grid gap-3 rounded-lg border border-default p-4 sm:grid-cols-3"
      >
        <div class="min-w-0">
          <p class="text-xs text-muted">
            账户
          </p><p class="break-words text-sm">
            {{ selected.account_name || selected.account_code }}
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            余额日期
          </p><p class="text-sm">
            {{ selected.snapshot_date.slice(0, 10) }}
          </p>
        </div>
        <div class="min-w-0">
          <p class="text-xs text-muted">
            当日有效快照
          </p><p class="break-words font-semibold tabular-nums">
            {{ formatMoney(selected.balance_amount, { currency: selected.currency_code }) }}
          </p>
        </div>
      </div>
      <div
        v-if="selected && w3BalanceFlags(selected).length"
        class="mb-4 flex flex-wrap gap-2"
      >
        <UBadge
          v-for="flag in w3BalanceFlags(selected)"
          :key="flag"
          color="warning"
          variant="subtle"
        >
          {{ flag }}
        </UBadge>
      </div>
      <UTabs
        v-model="evidenceTab"
        :content="false"
        :items="[{ label: '当日登记', value: 'entries' }, { label: '来源与核对', value: 'source' }]"
        class="mb-4"
      />
      <div
        v-if="evidenceTab === 'source'"
        class="space-y-3 text-sm"
      >
        <p>有效快照来源：{{ { manual: '人工登记', import: '导入', api: 'API' }[selected?.source_type || 'manual'] }}</p>
        <p class="text-muted">
          同日人工登记优先于导入；原始登记保留，列表不累计多次登记金额。
        </p>
        <p
          v-if="selected?.note"
          class="break-words"
        >
          {{ selected.note }}
        </p>
      </div>
      <CommonEmptyState
        v-else-if="historyError"
        title="流水加载失败"
        :description="historyError"
      >
        <UButton @click="loadHistory">
          重试
        </UButton>
      </CommonEmptyState>
      <template v-else>
        <UTable
          :data="entries"
          :columns="columns"
          :loading="loading"
          class="hidden sm:block"
        >
          <template #recorded_at-cell="{ row }">
            {{ financeRecordedTime(row.original.recorded_at) }}
          </template>
          <template #balance_amount-cell="{ row }">
            <span class="block text-right tabular-nums">{{ formatMoney(row.original.balance_amount, { currency: row.original.currency_code }) }}</span>
          </template>
          <template #recorded_by_name-cell="{ row }">
            {{ byLabel(row.original) }}
          </template>
          <template #note-cell="{ row }">
            <span class="block max-w-48 truncate">{{ row.original.note || '—' }}</span>
          </template>
          <template #is_day_latest-cell="{ row }">
            <UBadge
              v-if="row.original.is_day_latest"
              color="success"
            >
              展示值来源
            </UBadge><span v-else>历史登记</span>
          </template>
          <template #empty>
            <CommonEmptyState
              title="暂无登记流水"
              description="历史快照可能尚未迁入流水表。"
            />
          </template>
        </UTable>
        <div class="space-y-3 sm:hidden">
          <UProgress
            v-if="loading"
            aria-label="加载流水"
          /><CommonEmptyState
            v-else-if="!entries.length"
            title="暂无登记流水"
          /><article
            v-for="entry in entries"
            :key="entry.id"
            class="min-w-0 space-y-2 rounded-lg border border-default p-3"
          >
            <p class="break-all text-sm">
              {{ financeRecordedTime(entry.recorded_at) }}
            </p><p class="text-right tabular-nums">
              {{ formatMoney(entry.balance_amount, { currency: entry.currency_code }) }}
            </p><p class="break-words text-sm">
              {{ byLabel(entry) }} · {{ entry.entry_source === 'manual' ? '人工登记' : '导入' }}
            </p><p class="break-words text-sm text-muted">
              {{ entry.note || '无备注' }}
            </p><UBadge
              v-if="entry.is_day_latest"
              color="success"
            >
              展示值来源
            </UBadge>
          </article>
        </div>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="20"
            :sibling-count="0"
            :show-edges="false"
          />
        </div>
      </template>
    </template>
  </USlideover>
</template>
