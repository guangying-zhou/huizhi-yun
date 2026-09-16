<script setup lang="ts">
import type { ApiResponse, ListPayload, ReceiptItem, SummaryMetric } from '~/types'

usePageTitle('入库与激活')

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
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(handleRefresh))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <UDashboardPanel id="receipts" grow>
    <template #body>
      <div class="p-4 space-y-4">
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
