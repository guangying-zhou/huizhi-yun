<script setup lang="ts">
import { formatMoney } from '../../../foundation/app/utils/format'

const props = defineProps<{ customerId?: string, agreementId?: string }>()
type Total = { currency: string, amount: string, count: number }
type Section = { access: 'allowed' | 'denied', currencyTotals?: Total[] }
type Cost = { projectCode: string, periodMonth: string, currency?: string, readiness: string, missingInputs: string[], laborCostAmount: string | null, directExpenseAmount: string | null, otherCostAmount: string | null, grossProfitAmount: string | null }
type Summary = { access: string, invoices?: Section, receipts?: Section, reconciliation?: Section, items?: Cost[] }
const today = new Date()
const month = ref(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
const state = ref<Summary | null>(null)
const pending = ref(false)
const message = ref('')
const scope = useState<string>('enterprise-cache-scope', () => '')
const sections = [{ key: 'invoices', label: '已开票' }, { key: 'receipts', label: '已收款' }, { key: 'reconciliation', label: '已核销' }] as const
let epoch = 0
async function load() {
  const current = ++epoch
  state.value = null
  message.value = ''
  if (!props.customerId && !props.agreementId) return
  pending.value = true
  try {
    const path = props.customerId ? `/altoc/api/v1/customers/${props.customerId}/service-finance-summary` : `/altoc/api/v1/service-agreements/${props.agreementId}/cost-summary`
    const result = await $fetch<{ data: Summary }>(path, { query: props.customerId ? {} : { periodMonth: month.value } })
    if (current === epoch) state.value = result.data
  } catch {
    if (current === epoch) message.value = '财务摘要暂不可用，请稍后重试'
  } finally {
    if (current === epoch) pending.value = false
  }
}
watch([() => props.customerId, () => props.agreementId, month, scope], () => {
  void load()
}, { immediate: true })
</script>

<template>
  <UCard class="min-w-0">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-semibold">
          {{ customerId ? '服务财务摘要' : '服务项目成本' }}
        </h2>
        <UFormField
          v-if="agreementId"
          label="核算月份"
        >
          <UInput
            v-model="month"
            type="month"
            :disabled="pending"
          />
        </UFormField>
      </div>
    </template>
    <p class="mb-3 text-sm text-muted">
      仅显示 Finance 授权范围内的确认事实；不同币种分别显示，尚未核算不表示零成本。
    </p>
    <UAlert
      v-if="message"
      color="error"
      :title="message"
    />
    <p
      v-else-if="pending"
      class="text-muted"
    >
      正在读取摘要…
    </p>
    <UAlert
      v-else-if="state?.access === 'denied'"
      color="neutral"
      title="无权查看 Finance 财务或成本摘要"
    />
    <div
      v-else-if="customerId && state"
      class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3"
    >
      <section
        v-for="section in sections"
        :key="section.key"
        class="min-w-0 rounded-lg border border-default p-3"
      >
        <h3 class="font-medium">
          {{ section.label }}
        </h3>
        <p
          v-if="state[section.key]?.access === 'denied'"
          class="mt-2 text-sm text-muted"
        >
          无权查看
        </p>
        <template v-else>
          <p
            v-if="!state[section.key]?.currencyTotals?.length"
            class="mt-2 text-sm text-muted"
          >
            暂无可见确认记录
          </p>
          <div
            v-for="total in state[section.key]?.currencyTotals"
            :key="total.currency"
            class="mt-2 text-right tabular-nums"
          >
            <p>{{ total.currency }} {{ formatMoney(total.amount) }}</p><p class="text-xs text-muted">
              {{ total.count }} 条可见记录
            </p>
          </div>
        </template>
      </section>
    </div>
    <div
      v-else-if="state?.access === 'allowed'"
      class="space-y-3"
    >
      <CommonEmptyState
        v-if="!state.items?.length"
        title="暂无可见服务项目"
      />
      <section
        v-for="item in state.items"
        :key="item.projectCode"
        class="min-w-0 rounded-lg border border-default p-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="break-all font-medium">
            {{ item.projectCode }}
          </h3><UBadge
            color="neutral"
            variant="subtle"
          >
            {{ item.readiness === 'ready' ? '已核算' : '尚未核算' }}
          </UBadge>
        </div>
        <p
          v-if="item.readiness !== 'ready'"
          class="mt-2 text-sm text-muted"
        >
          成本输入尚未完整，不显示金额；请在 Finance 核算页检查。
        </p>
        <dl
          v-else
          class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <div
            v-for="field in ([['laborCostAmount', '人工成本'], ['directExpenseAmount', '直接费用'], ['otherCostAmount', '其他成本'], ['grossProfitAmount', '毛利']] as const)"
            :key="field[0]"
            class="flex flex-wrap justify-between gap-2"
          >
            <dt class="text-muted">
              {{ field[1] }}
            </dt><dd class="text-right tabular-nums">
              {{ item.currency }} {{ formatMoney(item[field[0]]) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </UCard>
</template>
