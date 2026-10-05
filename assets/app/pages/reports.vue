<script setup lang="ts">
import type { ApiResponse, ReportRow, SummaryMetric } from '~/types'

usePageTitle('报表统计')

interface ReportPayload {
  summary: SummaryMetric[]
  rows: ReportRow[]
}

const [
  { data: assetsSummary, refresh: refreshAssetsSummary },
  { data: projectCosts, refresh: refreshProjectCosts },
  { data: deliveryCosts, refresh: refreshDeliveryCosts },
  { data: environmentResources, refresh: refreshEnvironmentResources }
] = await Promise.all([
  useFetch<ApiResponse<ReportPayload>>('/api/v1/reports/assets-summary'),
  useFetch<ApiResponse<ReportPayload>>('/api/v1/reports/project-costs'),
  useFetch<ApiResponse<ReportPayload>>('/api/v1/reports/delivery-costs'),
  useFetch<ApiResponse<ReportPayload>>('/api/v1/reports/environment-resources')
])

const rowColumns = [
  { accessorKey: 'label', header: '维度' },
  { accessorKey: 'value', header: '值' },
  { accessorKey: 'hint', header: '说明' }
]

const refresh = async () => {
  await Promise.all([
    refreshAssetsSummary(),
    refreshProjectCosts(),
    refreshDeliveryCosts(),
    refreshEnvironmentResources()
  ])
}
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <UDashboardPanel id="reports" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <UCard>
          <template #header>
            <span class="font-semibold">资产总览</span>
          </template>
          <AssetsSummaryMetricGrid :metrics="assetsSummary?.data.summary || []" />
          <div class="mt-4">
            <UTable :data="assetsSummary?.data.rows || []" :columns="rowColumns" />
          </div>
        </UCard>

        <div class="grid gap-4 xl:grid-cols-2">
          <UCard>
            <template #header>
              <span class="font-semibold">项目成本归因</span>
            </template>
            <AssetsSummaryMetricGrid :metrics="projectCosts?.data.summary || []" />
            <div class="mt-4">
              <UTable :data="projectCosts?.data.rows || []" :columns="rowColumns" />
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold">客户交付成本</span>
            </template>
            <AssetsSummaryMetricGrid :metrics="deliveryCosts?.data.summary || []" />
            <div class="mt-4">
              <UTable :data="deliveryCosts?.data.rows || []" :columns="rowColumns" />
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <span class="font-semibold">环境资源视图</span>
          </template>
          <AssetsSummaryMetricGrid :metrics="environmentResources?.data.summary || []" />
          <div class="mt-4">
            <UTable :data="environmentResources?.data.rows || []" :columns="rowColumns" />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
