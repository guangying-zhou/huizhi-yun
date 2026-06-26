<script setup lang="ts">
import type { AlertItem, ApiResponse, ListPayload, SummaryMetric } from '~/types'

const handleOpen = ref(false)
const selectedAlert = ref<AlertItem | null>(null)
const search = ref('')
const selectedStatus = ref<'all' | 'pending' | 'acknowledged' | 'resolved'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const query = computed(() => ({
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<AlertItem>>>('/api/v1/alerts', {
  query
})

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

const handleRefresh = () => refresh()
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
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          预警中心
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
        <AssetsPageIntroCard title="预警中心" description="处理到期、余量、超分配、超期未归还等预警闭环。" />
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">预警列表</span>
              <UBadge color="neutral" variant="soft">
                {{ total }} 条
              </UBadge>
            </div>
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
            @select="handleRowSelect"
          />
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
