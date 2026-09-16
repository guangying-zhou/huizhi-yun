<script setup lang="ts">
import type { ApiResponse, ReportRow, SummaryMetric } from '~/types'

usePageTitle('资产总览')

interface AssetOverviewPayload {
  summary: SummaryMetric[]
  rows: ReportRow[]
}

const { data: response, error, refresh, status } = await useFetch<ApiResponse<AssetOverviewPayload>>(
  '/api/v1/reports/assets-summary'
)

const metrics = computed(() => response.value?.data.summary || [])
const rows = computed(() => response.value?.data.rows || [])
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'label', header: '资产维度' },
  { accessorKey: 'value', header: '数量 / 金额' },
  { accessorKey: 'hint', header: '说明' }
]

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <UDashboardPanel id="asset-overview" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          title="资产汇总加载失败"
          description="请稍后重试；若持续失败，请检查数据运行时状态。"
        >
          <template #actions>
            <UButton
              color="error"
              variant="soft"
              size="sm"
              @click="refresh()"
            >
              重新加载
            </UButton>
          </template>
        </UAlert>

        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">资产构成</span>
              <UBadge color="neutral" variant="soft">
                {{ rows.length }} 项
              </UBadge>
            </div>
          </template>

          <UTable :data="rows" :columns="columns" :loading="loading">
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-chart-pie"
                title="暂无资产汇总"
                description="完成资产录入后，这里将展示分类、状态与成本汇总。"
              />
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
