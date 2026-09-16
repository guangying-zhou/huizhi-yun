<script setup lang="ts">
import type { AlertItem, ApiResponse, ListPayload, SummaryMetric } from '~/types'

usePageTitle('预警中心')

const handleOpen = ref(false)
const selectedAlert = ref<AlertItem | null>(null)
const page = ref(1)
const pageSize = ref(20)
const { search, debounced: debouncedSearch } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const selectedStatus = ref<'all' | 'pending' | 'acknowledged' | 'resolved'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

watch(selectedStatus, () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  search: debouncedSearch.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<AlertItem>>>('/api/v1/alerts', {
  query
})
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<AlertItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  status_label: getLabel('alert_status', item.status)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'alert_no', header: '预警编号' },
  { accessorKey: 'title', header: '标题' },
  { accessorKey: 'alert_type', header: '类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'due_at', header: '处理时限' }
]

const handleRowSelect = (_event: Event, row: { original: AlertItem }) => {
  selectedAlert.value = row.original
  handleOpen.value = true
}
const handleHandled = async () => {
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="alerts" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <span class="font-semibold">预警列表</span>
          </template>

          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索预警编号、标题、类型或项目"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'pending' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'pending'"
                >
                  待处理
                </UButton>
                <UButton
                  :variant="selectedStatus === 'acknowledged' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'acknowledged'"
                >
                  已确认
                </UButton>
                <UButton
                  :variant="selectedStatus === 'resolved' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'resolved'"
                >
                  已解决
                </UButton>
              </div>
            </div>
          </div>

          <UTable
            :data="displayItems"
            :columns="columns"
            :loading="loading"
            :ui="selectableTableUi"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-bell"
                title="暂无预警"
                description="当前没有到期或配额预警。"
              />
            </template>
          </UTable>

          <div
            v-if="total > 0"
            class="mt-4 flex items-center justify-between border-t border-default pt-4"
          >
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsAlertHandleModal
    :open="handleOpen"
    :alert="selectedAlert"
    @update:open="handleOpen = $event"
    @handled="handleHandled"
  />
</template>
