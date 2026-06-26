<script setup lang="ts">
interface DashboardSummary {
  monthInvoiceAmount: string
  monthReceiptAmount: string
  pendingExpenseCount: number
  projectGrossProfitAmount: string
  unreconciledReceiptAmount: string
  bankAccountCount: number
}

usePageTitle('汇智云财务')

const { data: summaryResult, refresh } = useFetch<FinanceDataResponse<DashboardSummary>>(financeApiPath('/dashboard/summary'), {
  server: false,
  default: () => ({
    data: {
      monthInvoiceAmount: '0.00',
      monthReceiptAmount: '0.00',
      pendingExpenseCount: 0,
      projectGrossProfitAmount: '0.00',
      unreconciledReceiptAmount: '0.00',
      bankAccountCount: 0
    }
  })
})

const summary = computed(() => summaryResult.value.data)

const summaryCards = computed(() => [
  { label: '本月开票', value: formatMoney(summary.value.monthInvoiceAmount), hint: '正式发票台账', icon: 'i-lucide-file-check-2' },
  { label: '本月收款', value: formatMoney(summary.value.monthReceiptAmount), hint: '到账/收款记录', icon: 'i-lucide-wallet-cards' },
  { label: '待审批支出', value: String(summary.value.pendingExpenseCount), hint: '报销、项目支出、付款申请', icon: 'i-lucide-clipboard-list' },
  { label: '项目毛利', value: formatMoney(summary.value.projectGrossProfitAmount), hint: 'v0.3 项目核算', icon: 'i-lucide-chart-no-axes-combined' }
])

const quickLinks = [
  { label: '发票管理', description: '开票申请、正式发票和合同开票摘要', to: '/invoices', icon: 'i-lucide-file-check-2' },
  { label: '收款管理', description: '到账记录、收款渠道、银行账户和核销', to: '/receipts', icon: 'i-lucide-wallet-cards' },
  { label: '项目支出', description: '项目付款、销售费用、采购和手续费台账', to: '/expenses/projects', icon: 'i-lucide-briefcase-business' },
  { label: '项目核算', description: '收入、支出、成本、毛利和绩效归因', to: '/project-accounting', icon: 'i-lucide-chart-column' }
]

const { setRefresh, clearRefresh } = usePageActions()

onMounted(() => {
  setRefresh(() => {
    refresh()
  })
})

onUnmounted(() => {
  clearRefresh()
})
</script>

<template>
  <UDashboardPanel
    id="finance-dashboard"
    grow
  >
    <template #body>
      <div class="p-4 space-y-4">
        <UAlert
          v-if="summaryResult.warning"
          icon="i-lucide-database"
          color="warning"
          variant="subtle"
          :title="summaryResult.warning"
        />

        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <UCard
            v-for="card in summaryCards"
            :key="card.label"
            variant="subtle"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm text-muted">
                  {{ card.label }}
                </p>
                <p class="mt-1 text-2xl font-semibold">
                  {{ card.value }}
                </p>
                <p class="mt-2 text-xs text-muted">
                  {{ card.hint }}
                </p>
              </div>
              <UIcon
                :name="card.icon"
                class="size-5 text-primary"
              />
            </div>
          </UCard>
        </div>

        <div class="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold">快捷入口</span>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  v0.1-v0.3
                </UBadge>
              </div>
            </template>

            <div class="grid gap-3 md:grid-cols-2">
              <NuxtLink
                v-for="link in quickLinks"
                :key="link.to"
                :to="link.to"
                class="rounded-lg border border-default p-4 transition hover:border-primary/50 hover:bg-accented"
              >
                <div class="flex items-start gap-3">
                  <UIcon
                    :name="link.icon"
                    class="mt-0.5 size-5 text-primary"
                  />
                  <div class="space-y-1">
                    <p class="font-medium">
                      {{ link.label }}
                    </p>
                    <p class="text-sm text-muted">
                      {{ link.description }}
                    </p>
                  </div>
                </div>
              </NuxtLink>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold">台账状态</span>
            </template>
            <div class="space-y-2 text-sm text-muted">
              <p>活跃银行账户：{{ summary.bankAccountCount }}</p>
              <p>待核销收款：{{ formatMoney(summary.unreconciledReceiptAmount) }}</p>
              <p>Finance 维护真实开票、到账、费用和核销事实；Altoc 只消费合同财务摘要。</p>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
