<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { financeApiPath, formatMoney, formatPlainDate } from '~/composables/useFinanceApi'
import type { BalanceSnapshotRow } from '~/utils/bankAccountCharts'
import { buildBalanceChart } from '~/utils/bankAccountCharts'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface BalanceSnapshotDisplayRow {
  id: number
  snapshot_date: string
  balance_amount: string
  currency_code: string
  source_type: string
  created_by: string | null
  created_at: string
}

interface SnapshotPage {
  data: BalanceSnapshotRow[]
  chartData: BalanceSnapshotRow[]
  total: number
  page: number
  pageSize: number
}

type BalanceRange = 'current_month' | 'last_30_days' | 'current_year' | 'last_1_year' | 'all'

const props = defineProps<{
  account: Record<string, unknown> | null
}>()

const open = defineModel<boolean>('open', { default: false })
const range = ref<BalanceRange>('current_month')
const page = ref(1)
const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const errorMessage = ref('')
const result = ref<SnapshotPage>({
  data: [],
  chartData: [],
  total: 0,
  page: 1,
  pageSize: 20
})

const rangeOptions: Array<{ label: string, value: BalanceRange }> = [
  { label: '本月', value: 'current_month' },
  { label: '近30天', value: 'last_30_days' },
  { label: '本年', value: 'current_year' },
  { label: '近1年', value: 'last_1_year' },
  { label: '全部', value: 'all' }
]

const columns: TableColumn<BalanceSnapshotDisplayRow>[] = [
  { accessorKey: 'snapshot_date', header: '日期' },
  { accessorKey: 'balance_amount', header: '余额' },
  { accessorKey: 'currency_code', header: '币种' },
  { accessorKey: 'source_type', header: '来源' },
  { accessorKey: 'created_by', header: '记录人' },
  { accessorKey: 'created_at', header: '记录时间' }
]

const rows = computed(() => result.value.data.map(row => ({
  ...row,
  snapshot_date: formatPlainDate(row.snapshot_date),
  balance_amount: formatMoney(row.balance_amount)
})))
const chartData = computed(() => result.value.chartData)
const chart = computed(() => buildBalanceChart(chartData.value))

function normalizeSnapshotPage(value: unknown): SnapshotPage {
  const payload = value && typeof value === 'object' && 'code' in value && 'data' in value
    ? (value as RuntimeEnvelope<Partial<SnapshotPage>>).data
    : value
  const page = payload && typeof payload === 'object' ? payload as Partial<SnapshotPage> : {}
  const data = Array.isArray(page.data) ? page.data : []
  return {
    data,
    chartData: Array.isArray(page.chartData) ? page.chartData : [],
    total: Number(page.total || data.length),
    page: Number(page.page || 1),
    pageSize: Number(page.pageSize || 20)
  }
}

async function refresh() {
  const code = String(props.account?.code || '')
  if (!code) return
  status.value = 'pending'
  errorMessage.value = ''
  try {
    const response = await $fetch(financeApiPath(`/bank-accounts/${encodeURIComponent(code)}/balance-snapshots`), {
      query: {
        page: page.value,
        pageSize: 20,
        range: range.value
      }
    })
    result.value = normalizeSnapshotPage(response)
    status.value = 'success'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '请检查网络后重试。'
  }
}

function setRange(value: BalanceRange) {
  range.value = value
  page.value = 1
  refresh()
}

watch([open, () => props.account?.code], ([isOpen]) => {
  if (!isOpen) return
  range.value = 'current_month'
  page.value = 1
  refresh()
})

watch(page, () => {
  if (open.value) refresh()
})
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :title="String(account?.account_name || '余额变动')"
    :description="String(account?.code || '')"
    :ui="{ content: 'sm:max-w-4xl', body: 'space-y-4' }"
  >
    <template #body>
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          v-for="item in rangeOptions"
          :key="item.value"
          size="sm"
          :color="range === item.value ? 'primary' : 'neutral'"
          :variant="range === item.value ? 'solid' : 'soft'"
          @click="setRange(item.value)"
        >
          {{ item.label }}
        </UButton>
      </div>

      <UAlert
        v-if="status === 'error'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="余额快照加载失败"
        :description="errorMessage"
      />

      <div class="grid gap-3 md:grid-cols-3">
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">
            最新余额
          </p>
          <p class="mt-1 text-lg font-semibold text-highlighted">
            {{ chart.latest ? formatMoney(chart.latest.amount) : '-' }}
          </p>
        </div>
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">
            最高余额
          </p>
          <p class="mt-1 text-lg font-semibold text-highlighted">
            {{ chartData.length ? formatMoney(chart.max) : '-' }}
          </p>
        </div>
        <div class="rounded-lg border border-default p-3">
          <p class="text-xs text-muted">
            最低余额
          </p>
          <p class="mt-1 text-lg font-semibold text-highlighted">
            {{ chartData.length ? formatMoney(chart.min) : '-' }}
          </p>
        </div>
      </div>

      <div class="rounded-lg border border-default p-3">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <p class="font-medium text-highlighted">
              余额趋势
            </p>
            <p class="text-sm text-muted">
              {{ chartData.length }} 个余额快照
            </p>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="status === 'pending'"
            title="刷新余额快照"
            aria-label="刷新余额快照"
            @click="refresh"
          />
        </div>

        <div
          v-if="chart.points"
          class="overflow-x-auto"
        >
          <svg
            viewBox="0 0 640 220"
            class="h-64 min-w-[640px] w-full"
            role="img"
            aria-label="账户余额趋势折线图"
          >
            <line
              x1="28"
              y1="196"
              x2="612"
              y2="196"
              class="stroke-muted"
              stroke-width="1"
            />
            <polygon
              :points="chart.areaPoints"
              class="fill-primary/10"
            />
            <polyline
              :points="chart.points"
              fill="none"
              class="stroke-primary"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <g
              v-for="label in chart.labels"
              :key="`${label.date}-${label.x}`"
            >
              <line
                :x1="label.x"
                y1="24"
                :x2="label.x"
                y2="196"
                class="stroke-muted"
                stroke-width="1"
                stroke-dasharray="4 6"
              />
              <text
                :x="label.x"
                y="214"
                text-anchor="middle"
                class="fill-muted text-[11px]"
              >
                {{ label.date }}
              </text>
            </g>
          </svg>
        </div>
        <UAlert
          v-else
          icon="i-lucide-chart-line"
          color="neutral"
          variant="subtle"
          title="当前区间暂无余额快照"
        />
      </div>

      <div class="rounded-lg border border-default">
        <UTable
          :data="rows"
          :columns="columns"
          :loading="status === 'pending'"
        >
          <template #balance_amount-cell="{ row }">
            <span class="font-medium text-highlighted">{{ row.original.balance_amount }}</span>
          </template>
          <template #empty>
            <CommonEmptyState
              icon="i-lucide-chart-line"
              title="暂无余额快照"
              description="当前账户和时间范围内没有余额记录。"
            />
          </template>
        </UTable>
        <div class="flex items-center justify-between gap-3 border-t border-default px-4 py-3 text-sm text-muted">
          <span>共 {{ result.total }} 条</span>
          <UPagination
            v-model:page="page"
            :total="result.total"
            :items-per-page="result.pageSize"
          />
        </div>
      </div>
    </template>
  </USlideover>
</template>
