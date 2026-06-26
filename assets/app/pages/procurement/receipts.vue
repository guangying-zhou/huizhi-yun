<script setup lang="ts">
import type { ApiResponse, ListPayload, ReceiptItem, SummaryMetric } from '~/types'

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh } = await useFetch<ApiResponse<ListPayload<ReceiptItem>>>('/api/v1/receipts')

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<ReceiptItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  receipt_type_label: getLabel('receipt_type', item.receipt_type),
  status_label: getLabel('receipt_status', item.status)
})))

const columns = [
  { accessorKey: 'receipt_no', header: '记录编号' },
  { accessorKey: 'order_no', header: '采购单号' },
  { accessorKey: 'receipt_type_label', header: '类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'processed_at', header: '处理时间' }
]

const handleRefresh = () => refresh()
</script>

<template>
  <UDashboardPanel id="receipts" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          入库与激活
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4 space-y-4">
        <AssetsPageIntroCard title="入库与激活台" description="统一查看实物入库、资源激活和登记待办。" />
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <span class="font-semibold">处理记录</span>
          </template>
          <UTable :data="displayItems" :columns="columns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
