<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { formatMoney } from '../../../../foundation/app/utils/format'
import { queueError, type QueueRow } from '../../utils/w3MigrationQueue'

const open = defineModel<boolean>('open', { required: true })
const { loaded, error: permissionError, hasPermission } = usePermissions()
const scope = useState<string>('enterprise-cache-scope', () => '')
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission('bank_accounts', 'view'))
const date = ref(new Date().toISOString().slice(0, 10)), staleBefore = ref(''), state = ref('all'), currency = ref('')
const page = ref(1), size = ref(20), total = ref(0), pending = ref(false), error = ref('')
const rows = ref<QueueRow[]>([]), totals = ref<QueueRow[]>([])
const labels: Record<string, string> = { known: '已登记', missing: '未登记余额', conflict: '同日金额冲突', stale: '余额过期' }
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const columns: TableColumn<QueueRow>[] = [{ accessorKey: 'account_name', header: '账户' }, { accessorKey: 'legal_entity_code', header: '主体编码' }, { accessorKey: 'currency_code', header: '币种' }, { accessorKey: 'value_date', header: '实际取值日' }, { id: 'balance_amount', header: '余额', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } }, { id: 'balance_state', header: '状态' }]
const validationError = computed(() => !date.value ? '请选择截止日' : staleBefore.value && staleBefore.value > date.value ? '过期边界不能晚于截止日' : state.value === 'stale' && !staleBefore.value ? '筛选过期账户前请选择过期边界' : currency.value && !/^[A-Z]{3}$/.test(currency.value) ? '币种使用三个大写字母' : '')
let epoch = 0
async function refresh() {
  const generation = ++epoch
  error.value = ''
  if (!open.value || !allowed.value || !scope.value) {
    rows.value = []
    totals.value = []
    total.value = 0
    pending.value = false
    return
  }
  if (validationError.value)
    return
  pending.value = true
  try {
    const result = await $fetch<{
      data: QueueRow[]
      total: number
      page: number
      pageSize: number
      balanceTotals: QueueRow[]
    }>('/finance/api/v1/bank-accounts', { query: { page: page.value, pageSize: size.value, asOfDate: date.value, ...(staleBefore.value ? { staleBefore: staleBefore.value } : {}), ...(state.value !== 'all' ? { balanceState: state.value } : {}), ...(currency.value ? { currencyCode: currency.value } : {}), ...(debounced.value ? { search: debounced.value } : {}) }, retry: 0 })
    if (generation !== epoch)
      return
    if (!Array.isArray(result.data) || !Array.isArray(result.balanceTotals) || !Number.isSafeInteger(result.total) || result.page !== page.value || result.pageSize !== size.value)
      throw Error('余额响应无效')
    rows.value = result.data
    total.value = result.total
    totals.value = result.balanceTotals
  } catch (failure) {
    if (generation === epoch) {
      error.value = queueError(failure)
      if (Number((failure as {
        statusCode?: number
      }).statusCode) === 403) {
        rows.value = []
        totals.value = []
        total.value = 0
      }
    }
  } finally {
    if (generation === epoch)
      pending.value = false
  }
}
watch([date, staleBefore, state, currency, size], () => {
  page.value = 1
})
watch([open, allowed, scope, date, staleBefore, state, currency, size, page, debounced], () => void refresh())
onScopeDispose(() => {
  epoch++
})
</script>

<template>
  <USlideover
    v-model:open="open"
    title="截至日期余额"
    description="每个可见账户取截止日之前最新有效日期；冲突不择优、不计入金额。"
    :ui="{ content: 'w-full sm:max-w-5xl' }"
  >
    <template #body>
      <CommonEmptyState
        v-if="!allowed"
        title="无权查看账户余额"
      />
      <div
        v-else
        class="space-y-4 min-w-0"
      >
        <div class="grid gap-3 sm:grid-cols-3">
          <UFormField
            label="截止日"
            required
          >
            <UInput
              v-model="date"
              type="date"
              class="w-full"
            />
          </UFormField><UFormField label="过期边界（早于此日）">
            <UInput
              v-model="staleBefore"
              type="date"
              class="w-full"
            />
          </UFormField><UFormField label="余额状态">
            <USelect
              v-model="state"
              :items="[{ label: '全部状态', value: 'all' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]"
              class="w-full"
            />
          </UFormField><UFormField label="币种">
            <UInput
              v-model="currency"
              placeholder="例如 CNY"
              class="w-full"
            />
          </UFormField><UFormField label="账户编码或名称">
            <UInput
              v-model="search"
              class="w-full"
              @keydown.enter="flush"
            />
          </UFormField><UButton
            color="neutral"
            variant="outline"
            label="刷新"
            :loading="pending"
            :disabled="!!validationError"
            class="self-end justify-center"
            @click="refresh"
          />
        </div>
        <UAlert
          v-if="validationError || error"
          color="error"
          :description="validationError || error"
        />
        <div class="grid gap-3 sm:grid-cols-2">
          <div
            v-for="item in totals"
            :key="String(item.legal_entity_code) + item.currency_code"
            class="rounded border border-muted p-3 text-sm"
          >
            <p class="text-muted">
              {{ item.legal_entity_code || '主体未记录' }} · {{ item.currency_code }}
            </p><p class="tabular-nums font-medium">
              {{ item.amount === null ? '未记录' : formatMoney(String(item.amount), { currency: String(item.currency_code) }) }}
            </p><p>覆盖 {{ item.covered_count }}/{{ item.account_count }} · 未登记 {{ item.missing_count }} · 冲突 {{ item.conflict_count }} · 过期 {{ item.stale_count }}</p>
          </div>
        </div>
        <div class="min-w-0 overflow-x-auto">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending"
          >
            <template #balance_amount-cell="{ row }">
              {{ row.original.balance_amount === null ? '未记录' : formatMoney(String(row.original.balance_amount), { currency: String(row.original.currency_code) }) }}
            </template><template #balance_state-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ labels[String(row.original.balance_state)] }}
              </UBadge>
            </template><template #empty>
              <CommonEmptyState :title="pending ? '正在加载' : error ? '加载失败' : '当前筛选无账户'" />
            </template>
          </UTable>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-muted">共 {{ total }} 条</span><USelect
            v-model="size"
            :items="[20, 50, 100]"
            aria-label="每页条数"
          /><UPagination
            v-model:page="page"
            :items-per-page="size"
            :total="total"
            :sibling-count="1"
            show-edges
            :disabled="pending"
          />
        </div>
      </div>
    </template>
  </USlideover>
</template>
